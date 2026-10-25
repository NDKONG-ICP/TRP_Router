//! M5/M6 — backend-authoritative credits (PAYMENTS_ENABLED=false on mainnet).

use candid::{Nat, Principal};
use ic_cdk::api::time;
use crate::mem::{vmem, Memory};
use ic_stable_structures::{StableBTreeMap, Storable};
use std::borrow::Cow;
use std::cell::RefCell;
use std::collections::HashMap;

pub const PAYMENTS_ENABLED: bool = false;

/// Oracle staleness: fail-closed after 1h without refresh (local tests call refresh_oracle).
const ORACLE_TTL_NS: u64 = 3_600_000_000_000;


#[derive(Clone, candid::CandidType, serde::Serialize, serde::Deserialize)]
struct Credits {
    free: u128,
    paid: u128,
}

#[derive(Clone, candid::CandidType, serde::Serialize, serde::Deserialize)]
pub struct OracleState {
    pub usd_per_credit_micro: u64,
    pub trp_usd_micro: u64,
    pub updated_at_ns: u64,
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

#[derive(Clone, candid::CandidType, serde::Serialize, serde::Deserialize)]
struct StakeAmt(u128);

#[derive(Clone, Copy, candid::CandidType, serde::Serialize, serde::Deserialize)]
struct FlagByte(u8);

#[derive(Clone, Copy, candid::CandidType, serde::Serialize, serde::Deserialize)]
struct HolderDaily(u32);

macro_rules! storable_wrapper {
    ($t:ty) => {
        impl Storable for $t {
            fn to_bytes(&self) -> Cow<[u8]> {
                Cow::Owned(candid::encode_one(self).expect("encode"))
            }
            fn from_bytes(bytes: Cow<[u8]>) -> Self {
                candid::decode_one(bytes.as_ref()).expect("decode")
            }
            const BOUND: ic_stable_structures::storable::Bound =
                ic_stable_structures::storable::Bound::Unbounded;
        }
    };
}

storable_wrapper!(StakeAmt);
storable_wrapper!(FlagByte);
storable_wrapper!(HolderDaily);

thread_local! {
    static LEDGER: RefCell<StableBTreeMap<Principal, Credits, Memory>> = RefCell::new(
        StableBTreeMap::init(vmem(20))
    );
    static ORACLE: RefCell<OracleState> = RefCell::new(OracleState {
        usd_per_credit_micro: 10_000, // $0.01 per credit (utility unit, not a price claim)
        trp_usd_micro: 0,
        updated_at_ns: 0,
    });
    static STAKED: RefCell<StableBTreeMap<Principal, StakeAmt, Memory>> = RefCell::new(
        StableBTreeMap::init(vmem(21))
    );
    static BYOK: RefCell<StableBTreeMap<Principal, FlagByte, Memory>> = RefCell::new(
        StableBTreeMap::init(vmem(22))
    );
    static HOLDER_FREE: RefCell<StableBTreeMap<Principal, HolderDaily, Memory>> =
        RefCell::new(StableBTreeMap::init(
            vmem(23),
        ));
    static ANTHROPIC_BYOK: RefCell<HashMap<Principal, String>> = RefCell::new(HashMap::new());
}

pub fn caller_credits(p: Principal) -> u128 {
    LEDGER.with(|l| {
        l.borrow()
            .get(&p)
            .map(|c| c.free + c.paid)
            .unwrap_or(0)
    })
}

pub fn oracle_fresh() -> Result<OracleState, String> {
    ORACLE.with(|o| {
        let s = o.borrow().clone();
        if s.updated_at_ns == 0 {
            return Err("oracle stale: never updated".into());
        }
        let now = time();
        if now.saturating_sub(s.updated_at_ns) > ORACLE_TTL_NS {
            return Err("oracle stale: fail-closed".into());
        }
        Ok(s)
    })
}

pub fn refresh_oracle(trp_usd_micro: u64) {
    ORACLE.with(|o| {
        *o.borrow_mut() = OracleState {
            usd_per_credit_micro: 10_000,
            trp_usd_micro,
            updated_at_ns: time(),
        };
    });
}

/// Server-side quote: mock TRP e8 → paid credits (+5% when paid in TRP).
pub fn quote_mock_trp_credits(amount_e8: u128) -> Result<u128, String> {
    let o = oracle_fresh()?;
    if o.trp_usd_micro == 0 {
        return Err("oracle missing TRP/USD".into());
    }
    let usd_micro = amount_e8
        .saturating_mul(u128::from(o.trp_usd_micro))
        .checked_div(100_000_000)
        .unwrap_or(0);
    let credits = usd_micro
        .checked_div(u128::from(o.usd_per_credit_micro))
        .unwrap_or(0);
    Ok(credits * 105 / 100)
}

pub fn apply_mock_payment(p: Principal, amount_e8: u128, quoted: u128) -> Result<(), String> {
    if !PAYMENTS_ENABLED {
        return Err("PAYMENTS_ENABLED=false".into());
    }
    let expect = quote_mock_trp_credits(amount_e8)?;
    if expect != quoted {
        return Err("client quote mismatch: fail-closed".into());
    }
    LEDGER.with(|l| {
        let mut map = l.borrow_mut();
        let mut c = map.get(&p).unwrap_or(Credits { free: 0, paid: 0 });
        c.paid += expect;
        map.insert(p, c);
    });
    Ok(())
}

pub fn stake_accrue(p: Principal, amount_e8: u128) -> u128 {
    STAKED.with(|s| {
        let mut map = s.borrow_mut();
        let prev = map.get(&p).map(|x| x.0).unwrap_or(0);
        let next = prev + amount_e8;
        map.insert(p, StakeAmt(next));
        (amount_e8 / 10_000_000_000).min(1000)
    })
}

pub fn grant_stake_credits(p: Principal, credits: u128) {
    LEDGER.with(|l| {
        let mut map = l.borrow_mut();
        let mut c = map.get(&p).unwrap_or(Credits { free: 0, paid: 0 });
        c.free += credits;
        map.insert(p, c);
    });
}

pub fn set_byok(p: Principal, enabled: bool) {
    BYOK.with(|b| b.borrow_mut().insert(p, FlagByte(if enabled { 1 } else { 0 })));
}

pub fn byok_active(p: Principal) -> bool {
    BYOK.with(|b| b.borrow().get(&p).map(|f| f.0 == 1).unwrap_or(false))
}

pub fn set_byok_anthropic(p: Principal, key: Option<String>) {
    ANTHROPIC_BYOK.with(|m| {
        let mut map = m.borrow_mut();
        match key {
            Some(k) if !k.is_empty() => {
                map.insert(p, k);
            }
            _ => {
                map.remove(&p);
            }
        }
    });
}

pub fn byok_anthropic(p: Principal) -> Option<String> {
    ANTHROPIC_BYOK.with(|m| m.borrow().get(&p).cloned())
}

pub fn holder_fee_bps(p: Principal) -> u16 {
    if HOLDER_FREE.with(|h| h.borrow().get(&p).unwrap_or(HolderDaily(0)).0 > 0) {
        0
    } else if byok_active(p) {
        0
    } else {
        100
    }
}

pub fn register_mock_holder(p: Principal, daily_free: u32) {
    HOLDER_FREE.with(|h| h.borrow_mut().insert(p, HolderDaily(daily_free)));
}

pub fn consume_holder_free(p: Principal) -> bool {
    HOLDER_FREE.with(|h| {
        let mut map = h.borrow_mut();
        let Some(n) = map.get(&p).map(|x| x.0) else {
            return false;
        };
        if n == 0 {
            return false;
        }
        map.insert(p, HolderDaily(n - 1));
        true
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
