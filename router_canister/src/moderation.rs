use candid::Principal;
use ic_stable_structures::{
    memory_manager::{MemoryId, MemoryManager, VirtualMemory},
    DefaultMemoryImpl, StableBTreeMap, Storable,
};
use std::borrow::Cow;
use std::cell::RefCell;

type Memory = VirtualMemory<DefaultMemoryImpl>;

const DENY: &[&str] = &[
    "child sexual",
    "csam",
    "underage nude",
    "terrorist bomb recipe",
];

const PER_PRINCIPAL_DAILY_MAX: u32 = 200;
const GLOBAL_DAILY_MAX: u32 = 10_000;

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
    static PRINCIPAL_COUNTS: RefCell<StableBTreeMap<Principal, DayCount, Memory>> = RefCell::new(
        StableBTreeMap::init(MEMORY_MANAGER.with(|m| m.borrow().get(MemoryId::new(10))))
    );
    static GLOBAL_COUNT: RefCell<DayCount> = RefCell::new(DayCount { day: 0, count: 0 });
}

fn utc_day_ns() -> u64 {
    ic_cdk::api::time() / 86_400_000_000_000
}

pub fn check_prompt_policy(prompt: &str) -> Result<(), String> {
    let lower = prompt.to_lowercase();
    for bad in DENY {
        if lower.contains(bad) {
            return Err("prompt blocked by content policy (fail-closed)".into());
        }
    }
    Ok(())
}

pub fn check_prompt(caller: Principal, prompt: &str) -> Result<(), String> {
    check_prompt_policy(prompt)?;
    let day = utc_day_ns();
    let principal_ok = PRINCIPAL_COUNTS.with(|m| {
        let mut map = m.borrow_mut();
        let mut row = map.get(&caller).unwrap_or(DayCount { day, count: 0 });
        if row.day != day {
            row = DayCount { day, count: 0 };
        }
        if row.count >= PER_PRINCIPAL_DAILY_MAX {
            return false;
        }
        row.count += 1;
        map.insert(caller, row);
        true
    });
    if !principal_ok {
        return Err(format!(
            "per-principal daily ceiling ({PER_PRINCIPAL_DAILY_MAX}) reached"
        ));
    }
    let global_ok = GLOBAL_COUNT.with(|g| {
        let mut row = g.borrow_mut();
        if row.day != day {
            *row = DayCount { day, count: 0 };
        }
        if row.count >= GLOBAL_DAILY_MAX {
            return false;
        }
        row.count += 1;
        true
    });
    if !global_ok {
        return Err(format!("global daily ceiling ({GLOBAL_DAILY_MAX}) reached"));
    }
    Ok(())
}

pub async fn maybe_enhance_prompt(prompt: &str) -> String {
    // M4: on-chain enhance STAGED — pass-through until onicai tier is live.
    prompt.to_string()
}
