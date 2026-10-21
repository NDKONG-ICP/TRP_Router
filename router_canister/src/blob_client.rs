use candid::{CandidType, Deserialize, Principal};
use sha2::{Digest, Sha256};

#[derive(CandidType, Deserialize)]
enum BlobKind {
    Image,
    Model,
    Preset,
    Reference,
    Dataset,
    Other,
}

#[derive(CandidType, Deserialize)]
struct UploadProgress {
    upload_id: String,
    received: u64,
    chunks: u32,
}

#[derive(CandidType, Deserialize)]
struct NewUpload {
    content_type: String,
    total_size: u64,
    kind: BlobKind,
    filename: Option<String>,
}

// Re-use blob_store candid shapes (BlobMeta inside ok)
#[derive(CandidType, Deserialize)]
struct BlobMeta {
    id: String,
    content_type: String,
    size: u64,
    kind: BlobKind,
    filename: Option<String>,
    owner: Principal,
    created_at: u64,
    chunk_size: u32,
    chunk_count: u32,
}

#[derive(CandidType, Deserialize)]
enum CommitResultMeta {
    ok(BlobMeta),
    err(String),
}

const CHUNK: usize = 1_900_000;

pub async fn store_image(blob_store: Principal, bytes: Vec<u8>) -> Result<String, String> {
    let hash = hex::encode(Sha256::digest(&bytes));
    let upload_id: (String,) = ic_cdk::call(
        blob_store,
        "begin_upload",
        (NewUpload {
            content_type: "image/png".into(),
            total_size: bytes.len() as u64,
            kind: BlobKind::Image,
            filename: Some("generated.png".into()),
        },),
    )
    .await
    .map_err(|e| format!("begin_upload: {e:?}"))?;

    let mut idx = 0u32;
    let mut off = 0;
    while off < bytes.len() {
        let end = std::cmp::min(off + CHUNK, bytes.len());
        let chunk = bytes[off..end].to_vec();
        let _: (UploadProgress,) = ic_cdk::call(
            blob_store,
            "put_chunk",
            (upload_id.0.clone(), idx, chunk),
        )
        .await
        .map_err(|e| format!("put_chunk: {e:?}"))?;
        idx += 1;
        off = end;
    }

    let committed: (CommitResultMeta,) = ic_cdk::call(
        blob_store,
        "commit_upload",
        (upload_id.0, hash.clone()),
    )
    .await
    .map_err(|e| format!("commit_upload: {e:?}"))?;

    match committed.0 {
        CommitResultMeta::ok(meta) => Ok(meta.id),
        CommitResultMeta::err(e) => Err(e),
    }
}
