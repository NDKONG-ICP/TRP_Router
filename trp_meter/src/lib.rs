//! TRP metering gate (Phase 2): reserve / settle / release per job. ICP deposit later.
use candid::{CandidType, Nat, Principal};
use ic_cdk::{api::time, caller, query, update};
use ic_stable_structures::{
    memory_manager::{MemoryId, MemoryManager, VirtualMemory},
    DefaultMemoryImpl, StableBTreeMap, Storable,
};
use std::borrow::Cow;
use std::cell::RefCell;

type Memory = VirtualMemory<DefaultMemoryImpl>;

const JOB_TTL_NS: u64 = 600 * 1_000_000_000; // 10 min
const TIER_IMG_64: &str = "img-64-1";
const CREDITS_IMG_64: u64 = 1;

#[derive(Clone, CandidType, serde::Serialize, serde::Deserialize)]
struct JobRecord {
    owner: Principal,
    tier: String,
    reserved: u64,
    started_at: u64,
    expires_at: u64,
    settled: bool,
}

impl Storable for JobRecord {
    fn to_bytes(&self) -> Cow<[u8]> {
        Cow::Owned(candid::encode_one(self).expect("job"))
    }
    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        candid::decode_one(bytes.as_ref()).expect("job")
    }
    const BOUND: ic_stable_structures::storable::Bound =
        ic_stable_structures::storable::Bound::Unbounded;
}

#[derive(Clone, CandidType, serde::Serialize, serde::Deserialize)]
struct DayCount {
    day: u64,
    count: u32,
}

impl Storable for DayCount {
    fn to_bytes(&self) -> Cow<[u8]> {
        Cow::Owned(candid::encode_one(self).expect("day"))
    }
    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        candid::decode_one(bytes.as_ref()).expect("day")
    }
    const BOUND: ic_stable_structures::storable::Bound =
        ic_stable_structures::storable::Bound::Unbounded;
}

#[derive(Clone, CandidType, serde::Serialize, serde::Deserialize)]
struct Credits(u64);

impl Storable for Credits {
    fn to_bytes(&self) -> Cow<[u8]> {
        Cow::Owned(candid::encode_one(self).expect("credits"))
    }
    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        candid::decode_one(bytes.as_ref()).expect("credits")
    }
    const BOUND: ic_stable_structures::storable::Bound =
        ic_stable_structures::storable::Bound::Unbounded;
}

thread_local! {
    static MEMORY_MANAGER: RefCell<MemoryManager<DefaultMemoryImpl>> =
        RefCell::new(MemoryManager::init(DefaultMemoryImpl::default()));
    static JOBS: RefCell<StableBTreeMap<u64, JobRecord, Memory>> = RefCell::new(
        StableBTreeMap::init(MEMORY_MANAGER.with(|m| m.borrow().get(MemoryId::new(0))))
    );
    static BALANCES: RefCell<StableBTreeMap<Principal, Credits, Memory>> = RefCell::new(
        StableBTreeMap::init(MEMORY_MANAGER.with(|m| m.borrow().get(MemoryId::new(1))))
    );
    static FREE_DAILY: RefCell<StableBTreeMap<Principal, DayCount, Memory>> = RefCell::new(
        StableBTreeMap::init(MEMORY_MANAGER.with(|m| m.borrow().get(MemoryId::new(2))))
    );
    static NEXT_JOB: RefCell<u64> = RefCell::new(1);
    static ROUTER: RefCell<Option<Principal>> = RefCell::new(None);
    static FREE_PER_DAY: RefCell<u32> = RefCell::new(10);
    static FREE_BUDGET_TC: RefCell<u64> = RefCell::new(1); // TC units for global cap
    static GLOBAL_FREE_TC_SPENT: RefCell<u64> = RefCell::new(0);
    static GLOBAL_FREE_DAY: RefCell<u64> = RefCell::new(0);
}

fn utc_day() -> u64 {
    time() / 86_400_000_000_000
}

fn assert_controller() {
    if !ic_cdk::api::is_controller(&caller()) {
        ic_cdk::trap("controller only");
    }
}

fn assert_router_or_controller() {
    let c = caller();
    if ic_cdk::api::is_controller(&c) {
        return;
    }
    let router = ROUTER.with(|r| r.borrow().clone());
    if router == Some(c) {
        return;
    }
    ic_cdk::trap("router or controller only");
}

fn tier_credits(tier: &str) -> u64 {
    match tier {
        TIER_IMG_64 => CREDITS_IMG_64,
        _ => 1,
    }
}

fn try_free_slot(p: Principal) -> bool {
    let day = utc_day();
    let limit = FREE_PER_DAY.with(|f| *f.borrow());
    FREE_DAILY.with(|m| {
        let mut map = m.borrow_mut();
        let mut row = map.get(&p).unwrap_or(DayCount { day, count: 0 });
        if row.day != day {
            row = DayCount { day, count: 0 };
        }
        if row.count >= limit {
            return false;
        }
        row.count += 1;
        map.insert(p, row);
        true
    })
}

fn global_free_ok(cost_tc_estimate: u64) -> bool {
    let day = utc_day();
    GLOBAL_FREE_DAY.with(|d| {
        let mut gd = d.borrow_mut();
        if *gd != day {
            *gd = day;
            GLOBAL_FREE_TC_SPENT.with(|s| *s.borrow_mut() = 0);
        }
    });
    let budget = FREE_BUDGET_TC.with(|b| *b.borrow());
    let spent = GLOBAL_FREE_TC_SPENT.with(|s| *s.borrow());
    spent.saturating_add(cost_tc_estimate) <= budget
}

fn charge_global_free(cost_tc_estimate: u64) {
    GLOBAL_FREE_TC_SPENT.with(|s| *s.borrow_mut() += cost_tc_estimate);
}

#[update]
fn init_meter(free_images_per_day: u32, free_budget_tc_per_day: u64) {
    assert_controller();
    FREE_PER_DAY.with(|f| *f.borrow_mut() = free_images_per_day);
    FREE_BUDGET_TC.with(|b| *b.borrow_mut() = free_budget_tc_per_day);
}

#[update]
fn set_router(router: Principal) {
    assert_controller();
    ROUTER.with(|r| *r.borrow_mut() = Some(router));
}

#[update]
fn deposit_cycles() -> Nat {
    let cycles = ic_cdk::api::call::msg_cycles_available();
    let accepted = ic_cdk::api::call::msg_cycles_accept(cycles.min(cycles));
    let credits = accepted / 1_000_000_000_000; // 1 credit ~ 1T cycles (tunable)
    let p = caller();
    BALANCES.with(|b| {
        let mut map = b.borrow_mut();
        let cur = map.get(&p).map(|c| c.0).unwrap_or(0);
        map.insert(p, Credits(cur + credits));
    });
    Nat::from(credits)
}

#[query]
fn credit_balance() -> Nat {
    credit_balance_of(caller())
}

#[query]
fn credit_balance_of(owner: Principal) -> Nat {
    Nat::from(
        BALANCES
            .with(|b| b.borrow().get(&owner).map(|c| c.0).unwrap_or(0)),
    )
}

#[derive(CandidType)]
struct Quote {
    credits: Nat,
    tier: String,
}

#[query]
fn quote(tier: String) -> Quote {
    Quote {
        credits: Nat::from(tier_credits(&tier)),
        tier,
    }
}

#[derive(CandidType)]
enum JobResult {
    ok(u64),
    err(String),
}

#[derive(CandidType)]
enum MeterResult {
    ok,
    err(String),
}

#[update]
fn begin_job(owner: Principal, tier: String) -> JobResult {
    assert_router_or_controller();
    let now = time();
    let cost = tier_credits(&tier);

    // Idempotency: return open job for same owner
    let existing = JOBS.with(|j| {
        j.borrow().iter().find_map(|(id, rec)| {
            if rec.owner == owner && !rec.settled && rec.expires_at > now {
                Some(id)
            } else {
                None
            }
        })
    });
    if let Some(id) = existing {
        return JobResult::ok(id);
    }

    let mut reserved = 0u64;
    if cost > 0 {
        let bal = BALANCES.with(|b| b.borrow().get(&owner).map(|c| c.0).unwrap_or(0));
        if bal >= cost {
            BALANCES.with(|b| {
                let mut map = b.borrow_mut();
                map.insert(owner, Credits(bal - cost));
            });
            reserved = cost;
        } else if try_free_slot(owner) && global_free_ok(1) {
            charge_global_free(1);
            reserved = 0;
        } else {
            return JobResult::err(
                "insufficient credits and free tier exhausted (quota or global faucet)".into(),
            );
        }
    }

    let id = NEXT_JOB.with(|n| {
        let mut x = n.borrow_mut();
        let id = *x;
        *x += 1;
        id
    });
    JOBS.with(|j| {
        j.borrow_mut().insert(
            id,
            JobRecord {
                owner,
                tier: tier.clone(),
                reserved,
                started_at: now,
                expires_at: now + JOB_TTL_NS,
                settled: false,
            },
        );
    });
    JobResult::ok(id)
}

#[update]
fn settle_job(job_id: u64) -> MeterResult {
    assert_router_or_controller();
    let now = time();
    JOBS.with(|j| {
        let mut map = j.borrow_mut();
        let Some(mut rec) = map.get(&job_id) else {
            return MeterResult::err("unknown job".into());
        };
        if rec.settled {
            return MeterResult::ok;
        }
        if rec.expires_at < now {
            return MeterResult::err("job expired".into());
        }
        rec.settled = true;
        map.insert(job_id, rec);
        MeterResult::ok
    })
}

#[update]
fn release_job(job_id: u64) -> MeterResult {
    assert_router_or_controller();
    JOBS.with(|j| {
        let mut map = j.borrow_mut();
        let Some(rec) = map.get(&job_id) else {
            return MeterResult::err("unknown job".into());
        };
        if rec.settled {
            return MeterResult::ok;
        }
        if rec.reserved > 0 {
            let owner = rec.owner;
            let refund = rec.reserved;
            BALANCES.with(|b| {
                let mut bal = b.borrow_mut();
                let cur = bal.get(&owner).map(|c| c.0).unwrap_or(0);
                bal.insert(owner, Credits(cur + refund));
            });
        }
        map.remove(&job_id);
        MeterResult::ok
    })
}

#[derive(CandidType)]
struct MeterStatus {
    free_budget_tc_remaining: u64,
    global_free_spent_tc: u64,
}

#[query]
fn meter_status() -> MeterStatus {
    let budget = FREE_BUDGET_TC.with(|b| *b.borrow());
    let spent = GLOBAL_FREE_TC_SPENT.with(|s| *s.borrow());
    MeterStatus {
        free_budget_tc_remaining: budget.saturating_sub(spent),
        global_free_spent_tc: spent,
    }
}

ic_cdk::export_candid!();
