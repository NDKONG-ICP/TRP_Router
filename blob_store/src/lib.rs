use candid::{CandidType, Deserialize, Principal};
use ic_cdk::{api::time, caller, query, update};
use ic_stable_structures::{
    memory_manager::{MemoryId, MemoryManager, VirtualMemory},
    DefaultMemoryImpl, StableBTreeMap, Storable,
};
use sha2::{Digest, Sha256};
use std::borrow::Cow;
use std::cell::RefCell;

const CHUNK_SIZE: u32 = 1_900_000;
const STREAMING_THRESHOLD: u64 = 2_000_000;

type Memory = VirtualMemory<DefaultMemoryImpl>;

#[derive(CandidType, Deserialize, Clone, Debug, serde::Serialize)]
pub enum BlobKind {
    Image,
    Model,
    Preset,
    Reference,
    Dataset,
    Other,
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct NewUpload {
    pub content_type: String,
    pub total_size: u64,
    pub kind: BlobKind,
    pub filename: Option<String>,
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct UploadProgress {
    pub upload_id: String,
    pub received: u64,
    pub chunks: u32,
}

#[derive(CandidType, Deserialize, Clone, Debug, serde::Serialize)]
pub struct BlobMeta {
    pub id: String,
    pub content_type: String,
    pub size: u64,
    pub kind: BlobKind,
    pub filename: Option<String>,
    pub owner: Principal,
    pub created_at: u64,
    pub chunk_size: u32,
    pub chunk_count: u32,
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub enum CommitResult {
    ok(BlobMeta),
    err(String),
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub enum UnitResult {
    ok,
    err(String),
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct Stats {
    pub blobs: u64,
    pub bytes: u64,
    pub uploads_in_flight: u32,
    pub stable_used_bytes: u64,
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct HeaderField(pub String, pub String);

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct HttpRequest {
    pub method: String,
    pub url: String,
    pub headers: Vec<HeaderField>,
    pub body: Vec<u8>,
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct StreamingToken {
    pub id: String,
    pub index: u32,
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct StreamingCallbackResponse {
    pub body: Vec<u8>,
    pub token: Option<StreamingToken>,
}

candid::define_function!(
    pub StreamingHttpCallback : (StreamingToken) -> (StreamingCallbackResponse) query
);

#[derive(CandidType, Deserialize, Clone, Debug)]
pub enum StreamingStrategy {
    Callback(CallbackRecord),
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct CallbackRecord {
    pub callback: StreamingHttpCallback,
    pub token: StreamingToken,
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct HttpResponse {
    pub status_code: u16,
    pub headers: Vec<HeaderField>,
    pub body: Vec<u8>,
    pub streaming_strategy: Option<StreamingStrategy>,
}

#[derive(Clone, Debug, candid::CandidType, Deserialize, serde::Serialize)]
struct InFlightUpload {
    content_type: String,
    total_size: u64,
    kind: BlobKind,
    filename: Option<String>,
    owner: Principal,
    received: u64,
    chunks: u32,
    chunk_data: Vec<Vec<u8>>,
}

#[derive(Clone, Debug, candid::CandidType, Deserialize, serde::Serialize)]
struct StoredBlobMeta {
    meta: BlobMeta,
}

impl Storable for StoredBlobMeta {
    fn to_bytes(&self) -> Cow<[u8]> {
        Cow::Owned(candid::encode_one(self).expect("encode StoredBlobMeta"))
    }
    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        candid::decode_one(bytes.as_ref()).expect("decode StoredBlobMeta")
    }
    const BOUND: ic_stable_structures::storable::Bound =
        ic_stable_structures::storable::Bound::Unbounded;
}

#[derive(
    Clone,
    Debug,
    candid::CandidType,
    Deserialize,
    serde::Serialize,
    PartialEq,
    Eq,
    PartialOrd,
    Ord,
)]
struct ChunkKey {
    blob_id: String,
    index: u32,
}

impl Storable for ChunkKey {
    fn to_bytes(&self) -> Cow<[u8]> {
        Cow::Owned(candid::encode_one(self).expect("encode ChunkKey"))
    }
    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        candid::decode_one(bytes.as_ref()).expect("decode ChunkKey")
    }
    const BOUND: ic_stable_structures::storable::Bound =
        ic_stable_structures::storable::Bound::Unbounded;
}

#[derive(Clone, candid::CandidType, Deserialize, serde::Serialize)]
struct BlobBytes(Vec<u8>);

impl Storable for BlobBytes {
    fn to_bytes(&self) -> Cow<[u8]> {
        Cow::Owned(self.0.clone())
    }
    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        BlobBytes(bytes.to_vec())
    }
    const BOUND: ic_stable_structures::storable::Bound =
        ic_stable_structures::storable::Bound::Unbounded;
}

thread_local! {
    static MEMORY_MANAGER: RefCell<MemoryManager<DefaultMemoryImpl>> =
        RefCell::new(MemoryManager::init(DefaultMemoryImpl::default()));
    static META: RefCell<StableBTreeMap<String, StoredBlobMeta, Memory>> = RefCell::new(
        StableBTreeMap::init(MEMORY_MANAGER.with(|m| m.borrow().get(MemoryId::new(0))))
    );
    static CHUNKS: RefCell<StableBTreeMap<ChunkKey, BlobBytes, Memory>> = RefCell::new(
        StableBTreeMap::init(MEMORY_MANAGER.with(|m| m.borrow().get(MemoryId::new(1))))
    );
    static INFLIGHT: RefCell<std::collections::BTreeMap<String, InFlightUpload>> =
        RefCell::new(std::collections::BTreeMap::new());
    static ADMINS: RefCell<Vec<Principal>> = RefCell::new(Vec::new());
    static UPLOAD_COUNTER: RefCell<u64> = RefCell::new(0);
}

fn is_admin(p: Principal) -> bool {
    let admins = ADMINS.with(|a| a.borrow().clone());
    if admins.is_empty() {
        return p == caller();
    }
    admins.contains(&p)
}

fn chunk_key(blob_id: &str, index: u32) -> ChunkKey {
    ChunkKey {
        blob_id: blob_id.to_string(),
        index,
    }
}

fn store_blob_chunks(blob_id: &str, data: &[u8]) -> (u32, u32) {
    let mut idx = 0u32;
    let mut off = 0usize;
    while off < data.len() {
        let end = std::cmp::min(off + CHUNK_SIZE as usize, data.len());
        let slice = data[off..end].to_vec();
        CHUNKS.with(|c| {
            c.borrow_mut()
                .insert(chunk_key(blob_id, idx), BlobBytes(slice));
        });
        idx += 1;
        off = end;
    }
    (CHUNK_SIZE, idx)
}

fn read_blob_bytes(blob_id: &str, chunk_count: u32) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    for i in 0..chunk_count {
        let chunk = CHUNKS.with(|c| c.borrow().get(&chunk_key(blob_id, i)));
        match chunk {
            Some(bytes) => out.extend_from_slice(&bytes.0),
            None => return None,
        }
    }
    Some(out)
}

#[update]
fn begin_upload(new_upload: NewUpload) -> String {
    let id = UPLOAD_COUNTER.with(|c| {
        let n = *c.borrow() + 1;
        *c.borrow_mut() = n;
        format!("up-{}-{}", time(), n)
    });
    INFLIGHT.with(|m| {
        m.borrow_mut().insert(
            id.clone(),
            InFlightUpload {
                content_type: new_upload.content_type,
                total_size: new_upload.total_size,
                kind: new_upload.kind,
                filename: new_upload.filename,
                owner: caller(),
                received: 0,
                chunks: 0,
                chunk_data: Vec::new(),
            },
        );
    });
    id
}

#[update]
fn put_chunk(upload_id: String, index: u32, bytes: Vec<u8>) -> UploadProgress {
    if bytes.len() as u32 > CHUNK_SIZE {
        ic_cdk::trap("chunk exceeds max size");
    }
    INFLIGHT.with(|m| {
        let mut map = m.borrow_mut();
        let u = map
            .get_mut(&upload_id)
            .unwrap_or_else(|| ic_cdk::trap("unknown upload_id"));
        while u.chunk_data.len() <= index as usize {
            u.chunk_data.push(Vec::new());
        }
        u.chunk_data[index as usize] = bytes.clone();
        u.received = u
            .chunk_data
            .iter()
            .map(|c| c.len() as u64)
            .sum();
        u.chunks = u.chunk_data.len() as u32;
        UploadProgress {
            upload_id: upload_id.clone(),
            received: u.received,
            chunks: u.chunks,
        }
    })
}

#[update]
fn commit_upload(upload_id: String, expected_sha256_hex: String) -> CommitResult {
    let expected = expected_sha256_hex.trim().to_lowercase();
    if expected.len() != 64 || !expected.chars().all(|c| c.is_ascii_hexdigit()) {
        return CommitResult::err("expected_sha256_hex must be 64 hex chars".into());
    }
    let upload = INFLIGHT.with(|m| m.borrow_mut().remove(&upload_id));
    let Some(u) = upload else {
        return CommitResult::err("unknown upload_id".into());
    };
    let mut assembled = Vec::new();
    for chunk in &u.chunk_data {
        assembled.extend_from_slice(chunk);
    }
    if u.total_size > 0 && assembled.len() as u64 != u.total_size {
        return CommitResult::err(format!(
            "size mismatch: got {} expected {}",
            assembled.len(),
            u.total_size
        ));
    }
    let hash = Sha256::digest(&assembled);
    let hex_hash = hex::encode(hash);
    if hex_hash != expected {
        return CommitResult::err(format!(
            "hash mismatch: computed {} expected {}",
            hex_hash, expected
        ));
    }
    let (chunk_size, chunk_count) = store_blob_chunks(&hex_hash, &assembled);
    let meta = BlobMeta {
        id: hex_hash.clone(),
        content_type: u.content_type,
        size: assembled.len() as u64,
        kind: u.kind,
        filename: u.filename,
        owner: u.owner,
        created_at: time(),
        chunk_size,
        chunk_count,
    };
    META.with(|m| {
        m.borrow_mut()
            .insert(hex_hash.clone(), StoredBlobMeta { meta: meta.clone() });
    });
    CommitResult::ok(meta)
}

#[update]
fn abort_upload(upload_id: String) {
    INFLIGHT.with(|m| {
        m.borrow_mut().remove(&upload_id);
    });
}

#[query]
fn get_meta(id: String) -> Option<BlobMeta> {
    META.with(|m| m.borrow().get(&id.to_lowercase()).map(|s| s.meta))
}

#[query]
fn get_chunk(id: String, index: u32) -> Option<Vec<u8>> {
    let id = id.to_lowercase();
    let count = META.with(|m| m.borrow().get(&id).map(|s| s.meta.chunk_count))?;
    if index >= count {
        return None;
    }
    CHUNKS.with(|c| c.borrow().get(&chunk_key(&id, index)).map(|b| b.0))
}

#[query]
fn exists(id: String) -> bool {
    META.with(|m| m.borrow().get(&id.to_lowercase()).is_some())
}

#[query]
fn http_request_streaming_callback(token: StreamingToken) -> StreamingCallbackResponse {
    let body = get_chunk(token.id.clone(), token.index).unwrap_or_default();
    let next = token.index + 1;
    let chunk_count = META.with(|m| {
        m.borrow()
            .get(&token.id.to_lowercase())
            .map(|s| s.meta.chunk_count)
            .unwrap_or(0)
    });
    let next_token = if next < chunk_count {
        Some(StreamingToken {
            id: token.id,
            index: next,
        })
    } else {
        None
    };
    StreamingCallbackResponse {
        body,
        token: next_token,
    }
}

#[query]
fn http_request(req: HttpRequest) -> HttpResponse {
    let path = req.url.split('?').next().unwrap_or(&req.url);
    if !path.starts_with("/blob/") {
        return HttpResponse {
            status_code: 404,
            headers: vec![HeaderField("Content-Type".into(), "text/plain".into())],
            body: b"not found".to_vec(),
            streaming_strategy: None,
        };
    }
    let id = path.trim_start_matches("/blob/").to_lowercase();
    let Some(stored) = META.with(|m| m.borrow().get(&id)) else {
        return HttpResponse {
            status_code: 404,
            headers: vec![],
            body: b"blob not found".to_vec(),
            streaming_strategy: None,
        };
    };
    let meta = stored.meta;
    if meta.size > STREAMING_THRESHOLD {
        let first = get_chunk(id.clone(), 0).unwrap_or_default();
        let callback = StreamingHttpCallback::new(
            ic_cdk::id(),
            "http_request_streaming_callback".into(),
        );
        return HttpResponse {
            status_code: 200,
            headers: vec![HeaderField(
                "Content-Type".into(),
                meta.content_type.clone(),
            )],
            body: first,
            streaming_strategy: Some(StreamingStrategy::Callback(CallbackRecord {
                callback,
                token: StreamingToken {
                    id: id.clone(),
                    index: 1,
                },
            })),
        };
    }
    let bytes = read_blob_bytes(&id, meta.chunk_count).unwrap_or_default();
    HttpResponse {
        status_code: 200,
        headers: vec![HeaderField(
            "Content-Type".into(),
            meta.content_type.clone(),
        )],
        body: bytes,
        streaming_strategy: None,
    }
}

#[update]
fn delete_blob(id: String) -> UnitResult {
    if !is_admin(caller()) {
        return UnitResult::err("admin only".into());
    }
    let id = id.to_lowercase();
    let Some(stored) = META.with(|m| m.borrow().get(&id)) else {
        return UnitResult::err("not found".into());
    };
    for i in 0..stored.meta.chunk_count {
        CHUNKS.with(|c| {
            c.borrow_mut().remove(&chunk_key(&id, i));
        });
    }
    META.with(|m| {
        m.borrow_mut().remove(&id);
    });
    UnitResult::ok
}

#[update]
fn set_admins(admins: Vec<Principal>) -> UnitResult {
    if !ADMINS.with(|a| a.borrow().is_empty()) && !is_admin(caller()) {
        return UnitResult::err("admin only".into());
    }
    ADMINS.with(|a| *a.borrow_mut() = admins);
    UnitResult::ok
}

#[query]
fn stats() -> Stats {
    let (blobs, bytes) = META.with(|m| {
        let map = m.borrow();
        let mut b = 0u64;
        let mut sz = 0u64;
        for v in map.iter() {
            b += 1;
            sz += v.1.meta.size;
        }
        (b, sz)
    });
    let inflight = INFLIGHT.with(|m| m.borrow().len() as u32);
    Stats {
        blobs,
        bytes,
        uploads_in_flight: inflight,
        stable_used_bytes: bytes,
    }
}

ic_cdk::export_candid!();
