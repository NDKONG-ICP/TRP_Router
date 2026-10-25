use crate::mem::{vmem, Memory};
use crate::playground_auth::ActorKind;
use candid::Principal;
use ic_stable_structures::{StableBTreeMap, StableCell, Storable};
use std::borrow::Cow;
use std::cell::RefCell;

/// Free tier: II-authenticated users (via `Authorization: Bearer ii:…`).
pub const RAVEN_DIFFUSION_DAILY_MAX_II: u32 = 2;
/// Shared playground API-key bucket (legacy beta).
pub const RAVEN_DIFFUSION_DAILY_MAX_API_KEY: u32 = 50;

pub fn daily_max_for(kind: ActorKind) -> u32 {
    match kind {
        ActorKind::InternetIdentity => RAVEN_DIFFUSION_DAILY_MAX_II,
        ActorKind::ApiKeyShared => RAVEN_DIFFUSION_DAILY_MAX_API_KEY,
    }
}

#[derive(Clone, candid::CandidType, serde::Serialize, serde::Deserialize)]
struct DayCount {
    day: u64,
    count: u32,
}

impl Storable for DayCount {
    fn to_bytes(&self) -> Cow<[u8]> {
        Cow::Owned(candid::encode_one(self).expect("encode DayCount"))
    }
    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        candid::decode_one(bytes.as_ref()).expect("decode DayCount")
    }
    const BOUND: ic_stable_structures::storable::Bound =
        ic_stable_structures::storable::Bound::Unbounded;
}

#[derive(Clone, Copy, Default, candid::CandidType, serde::Serialize, serde::Deserialize)]
struct GenTotal(u64);
impl Storable for GenTotal {
    fn to_bytes(&self) -> Cow<[u8]> {
        Cow::Owned(self.0.to_le_bytes().to_vec())
    }
    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        let mut a = [0u8; 8];
        a.copy_from_slice(&bytes[..8]);
        GenTotal(u64::from_le_bytes(a))
    }
    const BOUND: ic_stable_structures::storable::Bound =
        ic_stable_structures::storable::Bound::Bounded { max_size: 8, is_fixed_size: true };
}

thread_local! {
    // MemoryId 30 (was 21, which collided with payments::STAKED under a second
    // MemoryManager); now from the single shared manager in crate::mem.
    static DIFFUSION_DAILY: RefCell<StableBTreeMap<Principal, DayCount, Memory>> =
        RefCell::new(StableBTreeMap::init(vmem(30)));
    // Global lifetime counter of on-chain Raven Diffusion generations served.
    static GEN_TOTAL: RefCell<StableCell<GenTotal, Memory>> =
        RefCell::new(StableCell::init(vmem(31), GenTotal(0)).expect("init gen total"));
}

/// Record one successful on-chain generation (cache miss that burned cycles).
pub fn record_generation() {
    GEN_TOTAL.with(|c| {
        let next = c.borrow().get().0.saturating_add(1);
        let _ = c.borrow_mut().set(GenTotal(next));
    });
}

/// Lifetime count of on-chain generations served.
pub fn generation_total() -> u64 {
    GEN_TOTAL.with(|c| c.borrow().get().0)
}

fn utc_day_ns() -> u64 {
    ic_cdk::api::time() / 86_400_000_000_000
}

pub fn consume_raven_diffusion_slot(actor: Principal, daily_max: u32) -> Result<(), String> {
    let day = utc_day_ns();
    let ok = DIFFUSION_DAILY.with(|m| {
        let mut map = m.borrow_mut();
        let mut row = map
            .get(&actor)
            .unwrap_or(DayCount { day, count: 0 });
        if row.day != day {
            row = DayCount { day, count: 0 };
        }
        if row.count >= daily_max {
            return false;
        }
        row.count += 1;
        map.insert(actor, row);
        true
    });
    if ok {
        Ok(())
    } else {
        Err(format!(
            "raven-diffusion daily quota ({daily_max}/day) exceeded"
        ))
    }
}
