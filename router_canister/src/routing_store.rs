//! Stable config for payment/meter canister ids (survives wasm upgrade).

use candid::Principal;
use ic_stable_structures::{StableCell, Storable};
use std::borrow::Cow;
use std::cell::RefCell;

use crate::mem::{vmem, Memory};

#[derive(Clone, Default, candid::CandidType, serde::Serialize, serde::Deserialize)]
struct PayCanister(pub Option<Principal>);

impl Storable for PayCanister {
    fn to_bytes(&self) -> Cow<[u8]> {
        Cow::Owned(candid::encode_one(self).expect("encode PayCanister"))
    }
    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        candid::decode_one(bytes.as_ref()).expect("decode PayCanister")
    }
    const BOUND: ic_stable_structures::storable::Bound =
        ic_stable_structures::storable::Bound::Unbounded;
}

thread_local! {
    static TRP_PAY_CELL: RefCell<StableCell<PayCanister, Memory>> = RefCell::new(
        StableCell::init(vmem(32), PayCanister(None)).expect("init trp_pay cell"),
    );
}

pub fn trp_pay_canister() -> Option<Principal> {
    TRP_PAY_CELL.with(|c| c.borrow().get().0)
}

pub fn set_trp_pay_canister(pay: Principal) {
    TRP_PAY_CELL.with(|c| {
        let _ = c.borrow_mut().set(PayCanister(Some(pay)));
    });
}

pub fn clear_trp_pay_canister() {
    TRP_PAY_CELL.with(|c| {
        let _ = c.borrow_mut().set(PayCanister(None));
    });
}
