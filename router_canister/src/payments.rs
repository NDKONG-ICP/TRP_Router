//! M5/M6 staged — backend-authoritative credits; PAYMENTS_ENABLED=false by default.

use candid::{Nat, Principal};
use ic_stable_structures::{
    memory_manager::{MemoryId, MemoryManager, VirtualMemory},
    DefaultMemoryImpl, StableBTreeMap, Storable,
};
use std::borrow::Cow;
use std::cell::RefCell;

pub const PAYMENTS_ENABLED: bool = false;

type Memory = VirtualMemory<DefaultMemoryImpl>;

#[derive(Clone, candid::CandidType, serde::Serialize, serde::Deserialize)]
struct Credits {
    free: u128,
    paid: u128,
}

impl Storable for Credits {
    fn to_bytes(&self) -> Cow<[u8]> {
        Cow::Owned(candid::encode_one(self).expect("encode Credits"))
    }
    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        candid::decode_one(bytes.as_ref()).expect("decode Credits")
    }
    const BOUND: ic_stable_structures::storable::Bound =
        ic_stable_structures::storable::Bound::Unbounded;
}

thread_local! {
    static MEMORY_MANAGER: RefCell<MemoryManager<DefaultMemoryImpl>> =
        RefCell::new(MemoryManager::init(DefaultMemoryImpl::default()));
    static LEDGER: RefCell<StableBTreeMap<Principal, Credits, Memory>> = RefCell::new(
        StableBTreeMap::init(MEMORY_MANAGER.with(|m| m.borrow().get(MemoryId::new(20))))
    );
}

pub fn caller_credits(p: Principal) -> u128 {
    LEDGER.with(|l| {
        l.borrow()
            .get(&p)
            .map(|c| c.free + c.paid)
            .unwrap_or(0)
    })
}

#[allow(dead_code)]
pub fn add_paid_credits(p: Principal, amount: u128) {
    if !PAYMENTS_ENABLED {
        return;
    }
    LEDGER.with(|l| {
        let mut map = l.borrow_mut();
        let mut c = map.get(&p).unwrap_or(Credits { free: 0, paid: 0 });
        c.paid += amount;
        map.insert(p, c);
    });
}

#[allow(dead_code)]
pub fn _quote_mock_trp(amount_e8: Nat) -> Result<Nat, String> {
    if !PAYMENTS_ENABLED {
        return Err("payments disabled".into());
    }
    let base = u128::try_from(amount_e8.0).map_err(|_| "amount overflow")?;
    Ok(Nat::from(base * 105 / 100))
}
