//! $TRP utility hooks (ledger-gated). No-ops until `set_trp_ledger` is called.

use candid::Principal;
use ic_stable_structures::{StableCell, Storable};
use std::borrow::Cow;
use std::cell::RefCell;

use crate::mem::vmem;

#[derive(Clone, Default, candid::CandidType, serde::Serialize, serde::Deserialize)]
struct LedgerCfg {
    ledger: Option<Principal>,
    /// Extra free raven-diffusion slots per day when balance >= min_hold_e8s.
    bonus_daily: u32,
    min_hold_e8s: u64,
}

impl Storable for LedgerCfg {
    fn to_bytes(&self) -> Cow<[u8]> {
        Cow::Owned(serde_json::to_vec(self).unwrap_or_default())
    }
    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        serde_json::from_slice(bytes.as_ref()).unwrap_or_default()
    }
    const BOUND: ic_stable_structures::storable::Bound =
        ic_stable_structures::storable::Bound::Unbounded;
}

thread_local! {
    static CFG: RefCell<StableCell<LedgerCfg, crate::mem::Memory>> =
        RefCell::new(StableCell::init(vmem(36), LedgerCfg::default()).expect("trp ledger cfg"));
}

pub fn set_trp_ledger(ledger: Option<Principal>, bonus_daily: u32, min_hold_e8s: u64) {
    CFG.with(|c| {
        c.borrow_mut()
            .set(LedgerCfg {
                ledger,
                bonus_daily,
                min_hold_e8s,
            })
            .expect("set trp ledger cfg");
    });
}

pub fn get_trp_ledger() -> Option<Principal> {
    CFG.with(|c| c.borrow().get().ledger)
}

/// When ledger unset, returns 0. When set, queries ICRC balance (future) — stub returns 0 until wired.
pub async fn bonus_daily_generations(_holder: Principal) -> u32 {
    let cfg = CFG.with(|c| c.borrow().get().clone());
    let Some(_ledger) = cfg.ledger else {
        return 0;
    };
    // TODO: icrc1_balance_of(holder) >= cfg.min_hold_e8s → cfg.bonus_daily
    0
}

pub fn fee_rebate_bps(_holder: Principal) -> u16 {
    if get_trp_ledger().is_none() {
        return 0;
    }
    // TODO: tier from stake/balance
    0
}
