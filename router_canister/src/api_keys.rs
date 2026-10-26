//! Named API keys (SHA-256 stored). Legacy playground keys remain in `playground_auth`.

use crate::mem;
use ic_stable_structures::{StableBTreeMap, Storable};
use sha2::{Digest, Sha256};
use std::borrow::Cow;
use std::cell::RefCell;

#[derive(Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct KeyHash([u8; 32]);

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

#[derive(Clone, candid::CandidType, serde::Serialize, serde::Deserialize)]
struct KeyRecord {
    label: String,
    active: bool,
    created_ns: u64,
}

impl Storable for KeyRecord {
    fn to_bytes(&self) -> Cow<[u8]> {
        Cow::Owned(serde_json::to_vec(self).unwrap_or_default())
    }
    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        serde_json::from_slice(bytes.as_ref()).unwrap_or(KeyRecord {
            label: String::new(),
            active: false,
            created_ns: 0,
        })
    }
    const BOUND: ic_stable_structures::storable::Bound =
        ic_stable_structures::storable::Bound::Unbounded;
}

thread_local! {
    static KEYS: RefCell<StableBTreeMap<KeyHash, KeyRecord, mem::Memory>> =
        RefCell::new(StableBTreeMap::init(mem::vmem(34)));
}

pub fn hash_key(key: &str) -> [u8; 32] {
    Sha256::digest(key.trim().as_bytes()).into()
}

pub fn is_active_key(token: &str) -> bool {
    let h = KeyHash(hash_key(token));
    KEYS.with(|m| {
        m.borrow()
            .get(&h)
            .map(|r| r.active)
            .unwrap_or(false)
    })
}

pub fn insert_key(key: &str, label: String, created_ns: u64) {
    let h = KeyHash(hash_key(key));
    KEYS.with(|m| {
        m.borrow_mut().insert(
            h,
            KeyRecord {
                label,
                active: true,
                created_ns,
            },
        );
    });
}

pub fn revoke_key(key: &str) -> bool {
    let h = KeyHash(hash_key(key));
    KEYS.with(|m| {
        if let Some(mut r) = m.borrow().get(&h) {
            r.active = false;
            m.borrow_mut().insert(h, r);
            true
        } else {
            false
        }
    })
}

#[derive(candid::CandidType, serde::Serialize)]
pub struct ListedKey {
    pub label: String,
    pub key_prefix: String,
    pub active: bool,
    pub created_ns: u64,
}

pub fn list_keys() -> Vec<ListedKey> {
    KEYS.with(|m| {
        m.borrow()
            .iter()
            .map(|(h, r)| ListedKey {
                label: r.label.clone(),
                key_prefix: format!("{}…", hex::encode(&h.0[..4])),
                active: r.active,
                created_ns: r.created_ns,
            })
            .collect()
    })
}

pub fn generate_key_material() -> String {
    let t = ic_cdk::api::time();
    let c = ic_cdk::caller();
    let mut h = Sha256::new();
    h.update(c.as_slice());
    h.update(t.to_le_bytes());
    h.update(b"trp-api-key-v1");
    format!("trp_{}", hex::encode(&h.finalize()[..24]))
}
