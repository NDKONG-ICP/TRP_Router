//! raven_nft — ICRC-7 collection for Raven Diffusion generations.
//!
//! Each token is a fully on-chain Stable Diffusion output: the PNG bytes are
//! stored in this canister and served over HTTP, and the ICRC-7 token metadata
//! records the provenance (prompt, seed, source canister, module hash, SHA-256).
//!
//! Provenance integrity: `mint` recomputes SHA-256 over the submitted bytes and
//! rejects the mint unless it matches the claimed `sha256`. Because Raven
//! Diffusion is deterministic, anyone can independently verify a token by
//! regenerating `(prompt, seed)` on the source canister and comparing the SHA.
//!
//! Same ICRC-7 standard IC SPICY MAIN runs (dfinity/ICRC ICRC-7, 2024-07-07
//! pin); implemented in Rust to match the trp-router stack. ICRC-37 (approvals)
//! is a planned follow-up; transferability is provided by `icrc7_transfer`.

use candid::{CandidType, Deserialize, Int, Nat, Principal};
use ic_stable_structures::memory_manager::{MemoryId, MemoryManager, VirtualMemory};
use ic_stable_structures::{storable::Bound, DefaultMemoryImpl, StableBTreeMap, StableCell, Storable};
use sha2::{Digest, Sha256};
use std::borrow::Cow;
use std::cell::RefCell;
use std::collections::HashMap;

const SOURCE_CANISTER: &str = "7chv3-5iaaa-aaaao-bbq3a-cai";
const MAX_IMAGE_BYTES: usize = 262_144; // 256 KiB — 64x64 PNGs are ~10 KiB.
const MAX_PROMPT_CHARS: usize = 1_000;
const DEFAULT_TAKE: u64 = 100;
const MAX_TAKE: u64 = 500;
const DAILY_MINT_LIMIT: u32 = 30; // per non-admin principal
const NS_PER_DAY: u64 = 86_400_000_000_000;

// ─────────────────────────── ICRC-7 standard types ───────────────────────────

#[derive(CandidType, Deserialize, Clone, Debug, PartialEq)]
pub struct Account {
    pub owner: Principal,
    pub subaccount: Option<Vec<u8>>,
}

/// ICRC-3 compatible generic metadata value (exact spec variant set).
#[derive(CandidType, Deserialize, Clone, Debug)]
pub enum Value {
    Nat(Nat),
    Int(Int),
    Text(String),
    Blob(Vec<u8>),
    Array(Vec<Value>),
    Map(Vec<(String, Value)>),
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct TransferArg {
    pub from_subaccount: Option<Vec<u8>>,
    pub to: Account,
    pub token_id: Nat,
    pub memo: Option<Vec<u8>>,
    pub created_at_time: Option<u64>,
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub enum TransferError {
    NonExistingTokenId,
    InvalidRecipient,
    Unauthorized,
    TooOld,
    CreatedInFuture { ledger_time: u64 },
    Duplicate { duplicate_of: Nat },
    GenericError { error_code: Nat, message: String },
    GenericBatchError { error_code: Nat, message: String },
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub enum TransferResult {
    Ok(Nat),
    Err(TransferError),
}

#[derive(CandidType, Deserialize)]
pub struct SupportedStandard {
    pub name: String,
    pub url: String,
}

// ─────────────────────────── mint API ───────────────────────────

#[derive(CandidType, Deserialize)]
pub struct MintRequest {
    pub prompt: String,
    pub seed: u64,
    pub module_hash: String,
    pub sha256: String,
    pub image: Vec<u8>,
    /// Owner of the minted token; defaults to the caller.
    pub to: Option<Account>,
}

#[derive(CandidType, Deserialize)]
pub enum MintResult {
    Ok(Nat),
    Err(String),
}

// ─────────────────────────── stored record ───────────────────────────

#[derive(CandidType, Deserialize, Clone)]
struct TokenRecord {
    owner: Principal,
    owner_subaccount: Option<Vec<u8>>,
    image: Vec<u8>,
    content_type: String,
    prompt: String,
    seed: u64,
    module_hash: String,
    sha256: String,
    created_at: u64,
}

impl Storable for TokenRecord {
    fn to_bytes(&self) -> Cow<[u8]> {
        Cow::Owned(candid::encode_one(self).expect("encode TokenRecord"))
    }
    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        candid::decode_one(&bytes).expect("decode TokenRecord")
    }
    const BOUND: Bound = Bound::Unbounded;
}

#[derive(CandidType, Deserialize, Clone)]
struct Config {
    next_id: u64,
    tx_counter: u64,
    admins: Vec<Principal>,
    name: String,
    symbol: String,
    description: String,
    logo: Option<String>,
}

impl Default for Config {
    fn default() -> Self {
        Config {
            next_id: 0,
            tx_counter: 0,
            admins: Vec::new(),
            name: "Raven Diffusion".to_string(),
            symbol: "RAVEN".to_string(),
            description: "Fully on-chain Stable Diffusion generations by The Raven Project. \
                          Each token's image is produced and stored entirely inside Internet \
                          Computer canisters; same seed reproduces the same bytes."
                .to_string(),
            logo: None,
        }
    }
}

impl Storable for Config {
    fn to_bytes(&self) -> Cow<[u8]> {
        Cow::Owned(candid::encode_one(self).expect("encode Config"))
    }
    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        candid::decode_one(&bytes).expect("decode Config")
    }
    const BOUND: Bound = Bound::Unbounded;
}

type Memory = VirtualMemory<DefaultMemoryImpl>;

thread_local! {
    static MM: RefCell<MemoryManager<DefaultMemoryImpl>> =
        RefCell::new(MemoryManager::init(DefaultMemoryImpl::default()));

    static TOKENS: RefCell<StableBTreeMap<u64, TokenRecord, Memory>> =
        RefCell::new(StableBTreeMap::init(MM.with(|m| m.borrow().get(MemoryId::new(0)))));

    static CONFIG: RefCell<StableCell<Config, Memory>> = RefCell::new(
        StableCell::init(MM.with(|m| m.borrow().get(MemoryId::new(1))), Config::default())
            .expect("init config cell"),
    );

    // Per-principal mint rate limiting (in-heap; resets on upgrade, which is fine
    // for abuse control). Maps principal -> (day_bucket, count_in_day).
    static RATE: RefCell<HashMap<Principal, (u64, u32)>> = RefCell::new(HashMap::new());
}

fn with_config<R>(f: impl FnOnce(&Config) -> R) -> R {
    CONFIG.with(|c| f(c.borrow().get()))
}

fn mutate_config(f: impl FnOnce(&mut Config)) {
    CONFIG.with(|c| {
        let mut cfg = c.borrow().get().clone();
        f(&mut cfg);
        c.borrow_mut().set(cfg).expect("set config");
    });
}

fn is_admin(p: &Principal) -> bool {
    with_config(|c| c.admins.iter().any(|a| a == p))
}

fn canister_id() -> Principal {
    ic_cdk::id()
}

fn image_url(token_id: u64) -> String {
    // Raw domain: query HTTP served without asset certification.
    format!("https://{}.raw.icp0.io/token/{}.png", canister_id(), token_id)
}

// ─────────────────────────── lifecycle ───────────────────────────

#[ic_cdk_macros::init]
fn init() {
    let caller = ic_cdk::caller();
    mutate_config(|c| {
        if !c.admins.iter().any(|a| a == &caller) {
            c.admins.push(caller);
        }
    });
}

#[ic_cdk_macros::post_upgrade]
fn post_upgrade() {
    // Stable structures persist automatically; nothing to restore.
}

// ─────────────────────────── admin ───────────────────────────

#[ic_cdk_macros::update]
fn add_admin(p: Principal) -> Result<(), String> {
    let caller = ic_cdk::caller();
    if !is_admin(&caller) {
        return Err("not authorized".to_string());
    }
    mutate_config(|c| {
        if !c.admins.iter().any(|a| a == &p) {
            c.admins.push(p);
        }
    });
    Ok(())
}

#[ic_cdk_macros::update]
fn remove_admin(p: Principal) -> Result<(), String> {
    let caller = ic_cdk::caller();
    if !is_admin(&caller) {
        return Err("not authorized".to_string());
    }
    mutate_config(|c| c.admins.retain(|a| a != &p));
    Ok(())
}

#[ic_cdk_macros::query]
fn get_admins() -> Vec<Principal> {
    with_config(|c| c.admins.clone())
}

#[ic_cdk_macros::update]
fn set_logo(url: String) -> Result<(), String> {
    let caller = ic_cdk::caller();
    if !is_admin(&caller) {
        return Err("not authorized".to_string());
    }
    mutate_config(|c| c.logo = Some(url));
    Ok(())
}

// ─────────────────────────── mint ───────────────────────────

fn check_rate_limit(caller: &Principal) -> Result<(), String> {
    if is_admin(caller) {
        return Ok(());
    }
    let now = ic_cdk::api::time();
    let day = now / NS_PER_DAY;
    RATE.with(|r| {
        let mut map = r.borrow_mut();
        let entry = map.entry(*caller).or_insert((day, 0));
        if entry.0 != day {
            *entry = (day, 0);
        }
        if entry.1 >= DAILY_MINT_LIMIT {
            return Err(format!("daily mint limit reached ({DAILY_MINT_LIMIT}/day)"));
        }
        entry.1 += 1;
        Ok(())
    })
}

#[ic_cdk_macros::update]
fn mint(req: MintRequest) -> MintResult {
    let caller = ic_cdk::caller();
    if caller == Principal::anonymous() {
        return MintResult::Err("anonymous principal cannot mint; sign in first".to_string());
    }
    if req.image.is_empty() || req.image.len() > MAX_IMAGE_BYTES {
        return MintResult::Err(format!(
            "image must be 1..={MAX_IMAGE_BYTES} bytes (got {})",
            req.image.len()
        ));
    }
    if req.prompt.chars().count() > MAX_PROMPT_CHARS {
        return MintResult::Err("prompt too long".to_string());
    }

    // Provenance integrity: the stored SHA must equal the hash of the stored bytes.
    let mut hasher = Sha256::new();
    hasher.update(&req.image);
    let computed = hex::encode(hasher.finalize());
    if computed != req.sha256.to_lowercase() {
        return MintResult::Err(format!(
            "sha256 mismatch: bytes hash to {computed}, claim was {}",
            req.sha256
        ));
    }

    if let Err(e) = check_rate_limit(&caller) {
        return MintResult::Err(e);
    }

    let owner_account = req.to.unwrap_or(Account {
        owner: caller,
        subaccount: None,
    });

    let token_id = with_config(|c| c.next_id);
    let record = TokenRecord {
        owner: owner_account.owner,
        owner_subaccount: owner_account.subaccount,
        image: req.image,
        content_type: "image/png".to_string(),
        prompt: req.prompt,
        seed: req.seed,
        module_hash: req.module_hash,
        sha256: computed,
        created_at: ic_cdk::api::time(),
    };

    TOKENS.with(|t| t.borrow_mut().insert(token_id, record));
    mutate_config(|c| c.next_id = token_id + 1);

    MintResult::Ok(Nat::from(token_id))
}

// ─────────────────────────── ICRC-7 queries ───────────────────────────

#[ic_cdk_macros::query]
fn icrc7_name() -> String {
    with_config(|c| c.name.clone())
}

#[ic_cdk_macros::query]
fn icrc7_symbol() -> String {
    with_config(|c| c.symbol.clone())
}

#[ic_cdk_macros::query]
fn icrc7_description() -> Option<String> {
    with_config(|c| Some(c.description.clone()))
}

#[ic_cdk_macros::query]
fn icrc7_logo() -> Option<String> {
    with_config(|c| c.logo.clone())
}

#[ic_cdk_macros::query]
fn icrc7_total_supply() -> Nat {
    TOKENS.with(|t| Nat::from(t.borrow().len()))
}

#[ic_cdk_macros::query]
fn icrc7_supply_cap() -> Option<Nat> {
    None // unlimited collection
}

#[ic_cdk_macros::query]
fn icrc7_max_query_batch_size() -> Option<Nat> {
    Some(Nat::from(MAX_TAKE))
}

#[ic_cdk_macros::query]
fn icrc7_max_update_batch_size() -> Option<Nat> {
    Some(Nat::from(MAX_TAKE))
}

#[ic_cdk_macros::query]
fn icrc7_default_take_value() -> Option<Nat> {
    Some(Nat::from(DEFAULT_TAKE))
}

#[ic_cdk_macros::query]
fn icrc7_max_take_value() -> Option<Nat> {
    Some(Nat::from(MAX_TAKE))
}

#[ic_cdk_macros::query]
fn icrc7_max_memo_size() -> Option<Nat> {
    Some(Nat::from(32u64))
}

#[ic_cdk_macros::query]
fn icrc7_collection_metadata() -> Vec<(String, Value)> {
    with_config(|c| {
        let mut m = vec![
            ("icrc7:name".to_string(), Value::Text(c.name.clone())),
            ("icrc7:symbol".to_string(), Value::Text(c.symbol.clone())),
            ("icrc7:description".to_string(), Value::Text(c.description.clone())),
            ("icrc7:total_supply".to_string(), Value::Nat(icrc7_total_supply())),
            ("raven:source_canister".to_string(), Value::Text(SOURCE_CANISTER.to_string())),
            ("raven:fully_on_chain".to_string(), Value::Text("true".to_string())),
        ];
        if let Some(logo) = &c.logo {
            m.push(("icrc7:logo".to_string(), Value::Text(logo.clone())));
        }
        m
    })
}

fn build_token_metadata(token_id: u64, r: &TokenRecord) -> Vec<(String, Value)> {
    vec![
        (
            "icrc7:name".to_string(),
            Value::Text(format!("Raven Diffusion #{token_id}")),
        ),
        ("image".to_string(), Value::Text(image_url(token_id))),
        ("prompt".to_string(), Value::Text(r.prompt.clone())),
        ("seed".to_string(), Value::Nat(Nat::from(r.seed))),
        (
            "source_canister".to_string(),
            Value::Text(SOURCE_CANISTER.to_string()),
        ),
        ("module_hash".to_string(), Value::Text(r.module_hash.clone())),
        ("sha256".to_string(), Value::Text(r.sha256.clone())),
        ("deterministic".to_string(), Value::Text("true".to_string())),
        ("created_at".to_string(), Value::Nat(Nat::from(r.created_at))),
    ]
}

#[ic_cdk_macros::query]
fn icrc7_token_metadata(token_ids: Vec<Nat>) -> Vec<Option<Vec<(String, Value)>>> {
    TOKENS.with(|t| {
        let tokens = t.borrow();
        token_ids
            .iter()
            .map(|id| {
                nat_to_u64(id).and_then(|id| {
                    tokens.get(&id).map(|r| build_token_metadata(id, &r))
                })
            })
            .collect()
    })
}

#[ic_cdk_macros::query]
fn icrc7_owner_of(token_ids: Vec<Nat>) -> Vec<Option<Account>> {
    TOKENS.with(|t| {
        let tokens = t.borrow();
        token_ids
            .iter()
            .map(|id| {
                nat_to_u64(id).and_then(|id| {
                    tokens.get(&id).map(|r| Account {
                        owner: r.owner,
                        subaccount: r.owner_subaccount.clone(),
                    })
                })
            })
            .collect()
    })
}

#[ic_cdk_macros::query]
fn icrc7_balance_of(accounts: Vec<Account>) -> Vec<Nat> {
    TOKENS.with(|t| {
        let tokens = t.borrow();
        accounts
            .iter()
            .map(|a| {
                let n = tokens
                    .iter()
                    .filter(|(_, r)| account_matches(r, a))
                    .count();
                Nat::from(n as u64)
            })
            .collect()
    })
}

#[ic_cdk_macros::query]
fn icrc7_tokens(prev: Option<Nat>, take: Option<Nat>) -> Vec<Nat> {
    let take = clamp_take(take);
    let prev = prev.and_then(|p| nat_to_u64(&p));
    TOKENS.with(|t| {
        let tokens = t.borrow();
        let mut ids: Vec<u64> = tokens.iter().map(|(id, _)| id).collect();
        ids.sort_unstable();
        ids.into_iter()
            .filter(|id| prev.map_or(true, |p| *id > p))
            .take(take)
            .map(Nat::from)
            .collect()
    })
}

#[ic_cdk_macros::query]
fn icrc7_tokens_of(account: Account, prev: Option<Nat>, take: Option<Nat>) -> Vec<Nat> {
    let take = clamp_take(take);
    let prev = prev.and_then(|p| nat_to_u64(&p));
    TOKENS.with(|t| {
        let tokens = t.borrow();
        let mut ids: Vec<u64> = tokens
            .iter()
            .filter(|(_, r)| account_matches(r, &account))
            .map(|(id, _)| id)
            .collect();
        ids.sort_unstable();
        ids.into_iter()
            .filter(|id| prev.map_or(true, |p| *id > p))
            .take(take)
            .map(Nat::from)
            .collect()
    })
}

#[ic_cdk_macros::query]
fn icrc10_supported_standards() -> Vec<SupportedStandard> {
    vec![
        SupportedStandard {
            name: "ICRC-7".to_string(),
            url: "https://github.com/dfinity/ICRC/tree/main/ICRCs/ICRC-7".to_string(),
        },
        SupportedStandard {
            name: "ICRC-10".to_string(),
            url: "https://github.com/dfinity/ICRC/tree/main/ICRCs/ICRC-10".to_string(),
        },
    ]
}

// ─────────────────────────── ICRC-7 transfer ───────────────────────────

#[ic_cdk_macros::update]
fn icrc7_transfer(args: Vec<TransferArg>) -> Vec<Option<TransferResult>> {
    let caller = ic_cdk::caller();
    let now = ic_cdk::api::time();
    args.into_iter()
        .map(|arg| Some(transfer_one(caller, now, arg)))
        .collect()
}

fn transfer_one(caller: Principal, now: u64, arg: TransferArg) -> TransferResult {
    let token_id = match nat_to_u64(&arg.token_id) {
        Some(id) => id,
        None => return TransferResult::Err(TransferError::NonExistingTokenId),
    };
    if let Some(ts) = arg.created_at_time {
        if ts > now.saturating_add(NS_PER_DAY) {
            return TransferResult::Err(TransferError::CreatedInFuture { ledger_time: now });
        }
        if now.saturating_sub(ts) > NS_PER_DAY {
            return TransferResult::Err(TransferError::TooOld);
        }
    }
    if arg.to.owner == Principal::anonymous() {
        return TransferResult::Err(TransferError::InvalidRecipient);
    }

    TOKENS.with(|t| {
        let mut tokens = t.borrow_mut();
        let mut rec = match tokens.get(&token_id) {
            Some(r) => r,
            None => return TransferResult::Err(TransferError::NonExistingTokenId),
        };
        // Only the current owner (matching from_subaccount) may transfer.
        if rec.owner != caller || rec.owner_subaccount != arg.from_subaccount {
            return TransferResult::Err(TransferError::Unauthorized);
        }
        rec.owner = arg.to.owner;
        rec.owner_subaccount = arg.to.subaccount.clone();
        tokens.insert(token_id, rec);
        let tx = with_config(|c| c.tx_counter);
        mutate_config(|c| c.tx_counter = tx + 1);
        TransferResult::Ok(Nat::from(tx))
    })
}

// ─────────────────────────── HTTP image serving ───────────────────────────

#[derive(CandidType, Deserialize)]
struct HttpRequest {
    method: String,
    url: String,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

#[derive(CandidType)]
struct HttpResponse {
    status_code: u16,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

#[ic_cdk_macros::query]
fn http_request(req: HttpRequest) -> HttpResponse {
    let path = req.url.split('?').next().unwrap_or("").to_string();
    // /token/<id>.png
    if let Some(rest) = path.strip_prefix("/token/") {
        if let Some(id_str) = rest.strip_suffix(".png") {
            if let Ok(id) = id_str.parse::<u64>() {
                if let Some(rec) = TOKENS.with(|t| t.borrow().get(&id)) {
                    return HttpResponse {
                        status_code: 200,
                        headers: vec![
                            ("Content-Type".to_string(), rec.content_type.clone()),
                            ("Cache-Control".to_string(), "public, max-age=31536000, immutable".to_string()),
                            ("Access-Control-Allow-Origin".to_string(), "*".to_string()),
                        ],
                        body: rec.image,
                    };
                }
            }
        }
    }
    if path == "/" {
        let body = format!(
            "Raven Diffusion — ICRC-7 collection. {} tokens. Images at /token/<id>.png",
            icrc7_total_supply()
        );
        return HttpResponse {
            status_code: 200,
            headers: vec![("Content-Type".to_string(), "text/plain".to_string())],
            body: body.into_bytes(),
        };
    }
    HttpResponse {
        status_code: 404,
        headers: vec![("Content-Type".to_string(), "text/plain".to_string())],
        body: b"not found".to_vec(),
    }
}

// ─────────────────────────── helpers ───────────────────────────

fn account_matches(r: &TokenRecord, a: &Account) -> bool {
    r.owner == a.owner && r.owner_subaccount == a.subaccount
}

fn clamp_take(take: Option<Nat>) -> usize {
    let t = take.and_then(|n| nat_to_u64(&n)).unwrap_or(DEFAULT_TAKE);
    t.min(MAX_TAKE) as usize
}

fn nat_to_u64(n: &Nat) -> Option<u64> {
    use std::convert::TryFrom;
    u64::try_from(n.0.clone()).ok()
}

ic_cdk::export_candid!();
