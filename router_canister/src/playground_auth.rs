use crate::{HeaderField, HttpResponse};
use candid::Principal;
use ic_stable_structures::{
    memory_manager::{MemoryId, MemoryManager, VirtualMemory},
    DefaultMemoryImpl, StableBTreeMap, Storable,
};
use sha2::{Digest, Sha256};
use std::borrow::Cow;
use std::cell::RefCell;

type Memory = VirtualMemory<DefaultMemoryImpl>;

#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, candid::CandidType, serde::Serialize, serde::Deserialize)]
struct KeyHash([u8; 32]);

impl Storable for KeyHash {
    fn to_bytes(&self) -> Cow<[u8]> {
        Cow::Owned(self.0.to_vec())
    }
    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        let mut a = [0u8; 32];
        a.copy_from_slice(bytes.as_ref());
        KeyHash(a)
    }
    const BOUND: ic_stable_structures::storable::Bound =
        ic_stable_structures::storable::Bound::Bounded {
            max_size: 32,
            is_fixed_size: true,
        };
}

thread_local! {
    static MEMORY_MANAGER: RefCell<MemoryManager<DefaultMemoryImpl>> =
        RefCell::new(MemoryManager::init(DefaultMemoryImpl::default()));
    static ACCEPTED_API_KEY_HASHES: RefCell<StableBTreeMap<KeyHash, u8, Memory>> = RefCell::new(
        StableBTreeMap::init(MEMORY_MANAGER.with(|m| m.borrow().get(MemoryId::new(20))))
    );
}

fn hash_key(key: &str) -> [u8; 32] {
    Sha256::digest(key.as_bytes()).into()
}

fn header_value(headers: &[HeaderField], name: &str) -> Option<String> {
    let want = name.to_ascii_lowercase();
    headers
        .iter()
        .find(|h| h.0.to_ascii_lowercase() == want)
        .map(|h| h.1.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn bearer_token(headers: &[HeaderField]) -> Option<String> {
    if let Some(auth) = header_value(headers, "authorization") {
        if let Some(rest) = auth.strip_prefix("Bearer ") {
            let t = rest.trim();
            if !t.is_empty() {
                return Some(t.to_string());
            }
        }
    }
    // Browser CORS: icp0.io boundary allows x-oc-api-key, not Authorization.
    header_value(headers, "x-oc-api-key")
}

fn unauthorized(msg: &str) -> HttpResponse {
    super::json_response(
        401,
        &format!(r#"{{"error":"{}"}}"#, msg.replace('"', "\\\"")),
    )
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ActorKind {
    InternetIdentity,
    ApiKeyShared,
}

pub struct ActorDetail {
    pub principal: Principal,
    pub kind: ActorKind,
}

/// Resolve the quota principal for a playground / image request.
pub fn resolve_actor(headers: &[HeaderField]) -> Result<Principal, HttpResponse> {
    resolve_actor_detail(headers).map(|d| d.principal)
}

pub fn resolve_actor_detail(headers: &[HeaderField]) -> Result<ActorDetail, HttpResponse> {
    let Some(token) = bearer_token(headers) else {
        return Err(unauthorized(
            "missing Authorization: Bearer (API key or ii:<principal>)",
        ));
    };
    if let Some(principal_text) = token.strip_prefix("ii:") {
        let p = Principal::from_text(principal_text.trim()).map_err(|_| {
            unauthorized("invalid ii: principal in Authorization header")
        })?;
        return Ok(ActorDetail {
            principal: p,
            kind: ActorKind::InternetIdentity,
        });
    }
    let h = hash_key(&token);
    let accepted = ACCEPTED_API_KEY_HASHES.with(|m| m.borrow().contains_key(&KeyHash(h)));
    if !accepted {
        return Err(unauthorized("invalid API key"));
    }
    Ok(ActorDetail {
        principal: Principal::self_authenticating(format!("trp-key:{token}").as_bytes()),
        kind: ActorKind::ApiKeyShared,
    })
}

/// Controller-only: register a shared beta API key (stored as SHA-256, not plaintext).
pub fn register_api_key(key: String) {
    assert_controller();
    let h = hash_key(key.trim());
    ACCEPTED_API_KEY_HASHES.with(|m| {
        m.borrow_mut().insert(KeyHash(h), 1);
    });
}

fn assert_controller() {
    let c = ic_cdk::caller();
    if !ic_cdk::api::is_controller(&c) {
        ic_cdk::trap("controller only");
    }
}
