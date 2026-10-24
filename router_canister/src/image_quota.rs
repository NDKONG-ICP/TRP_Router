use candid::Principal;
use ic_stable_structures::{
    memory_manager::{MemoryId, MemoryManager, VirtualMemory},
    DefaultMemoryImpl, StableBTreeMap, Storable,
};
use std::borrow::Cow;
use std::cell::RefCell;

type Memory = VirtualMemory<DefaultMemoryImpl>;

/// Free tier for on-chain Raven Diffusion (BETA — Phase 2: trp_meter prepaid credits).
pub const RAVEN_DIFFUSION_DAILY_MAX: u32 = 10;

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

thread_local! {
    static MEMORY_MANAGER: RefCell<MemoryManager<DefaultMemoryImpl>> =
        RefCell::new(MemoryManager::init(DefaultMemoryImpl::default()));
    static DIFFUSION_DAILY: RefCell<StableBTreeMap<Principal, DayCount, Memory>> = RefCell::new(
        StableBTreeMap::init(MEMORY_MANAGER.with(|m| m.borrow().get(MemoryId::new(21))))
    );
}

fn utc_day_ns() -> u64 {
    ic_cdk::api::time() / 86_400_000_000_000
}

pub fn consume_raven_diffusion_slot(actor: Principal) -> Result<(), String> {
    let day = utc_day_ns();
    let ok = DIFFUSION_DAILY.with(|m| {
        let mut map = m.borrow_mut();
        let mut row = map
            .get(&actor)
            .unwrap_or(DayCount { day, count: 0 });
        if row.day != day {
            row = DayCount { day, count: 0 };
        }
        if row.count >= RAVEN_DIFFUSION_DAILY_MAX {
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
            "raven-diffusion daily quota ({RAVEN_DIFFUSION_DAILY_MAX}/day) exceeded"
        ))
    }
}
