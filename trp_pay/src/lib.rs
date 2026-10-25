//! trp_pay — ICP (ICRC-2) payments -> generation credits for Raven Diffusion.
//!
//! Pure Internet Identity flow:
//!   1. The user signs an `icrc2_approve` on the ICP ledger (approving THIS
//!      canister as spender) with their II — same way the mint signs calls.
//!   2. The user calls `buy_credits(pack)`; this canister pulls the ICP with
//!      `icrc2_transfer_from` and grants credits.
//!   3. (Phase 2) the payment is split: a slice -> cycles via the CMC onto the
//!      diffusion canister (the "burn"), the remainder -> the treasury.
//!
//! Safety: ships `payments_enabled = false` and a configurable ledger, so
//! nothing moves real ICP until an admin configures and enables it. Test on
//! the mock ledger first.

use candid::{CandidType, Deserialize, Nat, Principal};
use ic_stable_structures::memory_manager::{MemoryId, MemoryManager, VirtualMemory};
use ic_stable_structures::{storable::Bound, DefaultMemoryImpl, StableBTreeMap, StableCell, Storable};
use std::borrow::Cow;
use std::cell::RefCell;

// ── Pack tiers (ICP e8s -> credits). One credit = one on-chain generation. ──
const PACKS: &[(u64, u64)] = &[
    (100_000_000, 1),      // 1 ICP   -> 1
    (500_000_000, 10),     // 5 ICP   -> 10
    (1_000_000_000, 22),   // 10 ICP  -> 22
    (2_500_000_000, 55),   // 25 ICP  -> 55
    (10_000_000_000, 210), // 100 ICP -> 210
];

// ── ICRC-2 types (ICP ledger) ──
#[derive(CandidType, Deserialize, Clone)]
struct Account {
    owner: Principal,
    subaccount: Option<Vec<u8>>,
}
#[derive(CandidType, Deserialize)]
struct TransferFromArgs {
    spender_subaccount: Option<Vec<u8>>,
    from: Account,
    to: Account,
    amount: Nat,
    fee: Option<Nat>,
    memo: Option<Vec<u8>>,
    created_at_time: Option<u64>,
}
#[derive(CandidType, Deserialize, Debug)]
enum TransferFromError {
    BadFee { expected_fee: Nat },
    BadBurn { min_burn_amount: Nat },
    InsufficientFunds { balance: Nat },
    InsufficientAllowance { allowance: Nat },
    TooOld,
    CreatedInFuture { ledger_time: u64 },
    Duplicate { duplicate_of: Nat },
    TemporarilyUnavailable,
    GenericError { error_code: Nat, message: String },
}
#[derive(CandidType, Deserialize)]
enum TransferFromResult {
    Ok(Nat),
    Err(TransferFromError),
}

// ── config + storage ──
#[derive(CandidType, Deserialize, Clone)]
struct Config {
    payments_enabled: bool,
    icp_ledger: Principal,
    treasury: Principal,
    diffusion_canister: Principal,
    cmc: Principal,
    router: Principal,
    admins: Vec<Principal>,
    /// ICP e8s per purchase routed to cycles (the CMC burn); rest -> treasury.
    cycles_slice_e8s: u64,
}
impl Default for Config {
    fn default() -> Self {
        let p = |t: &str| Principal::from_text(t).unwrap();
        Config {
            payments_enabled: false,
            icp_ledger: p("ryjl3-tyaaa-aaaaa-aaaba-cai"), // ICP ledger
            treasury: p("crpau-rqaaa-aaaao-a4neq-cai"),   // Raven treasury vault
            diffusion_canister: p("7chv3-5iaaa-aaaao-bbq3a-cai"),
            cmc: p("rkp4c-7iaaa-aaaaa-aaaca-cai"), // Cycles Minting Canister
            router: Principal::anonymous(),
            admins: Vec::new(),
            cycles_slice_e8s: 3_000_000, // ~0.03 ICP/image toward cycles (covers ~0.153 TC)
        }
    }
}
impl Storable for Config {
    fn to_bytes(&self) -> Cow<[u8]> {
        Cow::Owned(candid::encode_one(self).expect("encode Config"))
    }
    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        candid::decode_one(&bytes).expect("decode Config")
    }
    const BOUND: Bound = Bound::Unbounded;
}

#[derive(CandidType, Deserialize, Clone, PartialEq, Eq, PartialOrd, Ord)]
struct PrincipalKey(Principal);
impl Storable for PrincipalKey {
    fn to_bytes(&self) -> Cow<[u8]> {
        Cow::Owned(self.0.as_slice().to_vec())
    }
    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        PrincipalKey(Principal::from_slice(&bytes))
    }
    const BOUND: Bound = Bound::Bounded { max_size: 30, is_fixed_size: false };
}

#[derive(Clone, Copy, Default)]
struct CreditBal(u64);
impl Storable for CreditBal {
    fn to_bytes(&self) -> Cow<[u8]> {
        Cow::Owned(self.0.to_le_bytes().to_vec())
    }
    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        let mut a = [0u8; 8];
        a.copy_from_slice(&bytes[..8]);
        CreditBal(u64::from_le_bytes(a))
    }
    const BOUND: Bound = Bound::Bounded { max_size: 8, is_fixed_size: true };
}

type Memory = VirtualMemory<DefaultMemoryImpl>;
thread_local! {
    static MM: RefCell<MemoryManager<DefaultMemoryImpl>> =
        RefCell::new(MemoryManager::init(DefaultMemoryImpl::default()));
    static CONFIG: RefCell<StableCell<Config, Memory>> = RefCell::new(
        StableCell::init(MM.with(|m| m.borrow().get(MemoryId::new(0))), Config::default())
            .expect("init config"),
    );
    static CREDITS: RefCell<StableBTreeMap<PrincipalKey, CreditBal, Memory>> =
        RefCell::new(StableBTreeMap::init(MM.with(|m| m.borrow().get(MemoryId::new(1)))));
}

fn config() -> Config {
    CONFIG.with(|c| c.borrow().get().clone())
}
fn mutate_config(f: impl FnOnce(&mut Config)) {
    CONFIG.with(|c| {
        let mut cfg = c.borrow().get().clone();
        f(&mut cfg);
        c.borrow_mut().set(cfg).expect("set config");
    });
}
fn is_admin(p: &Principal) -> bool {
    config().admins.iter().any(|a| a == p)
}
fn require_admin() -> Result<(), String> {
    if is_admin(&ic_cdk::caller()) {
        Ok(())
    } else {
        Err("not authorized".to_string())
    }
}
fn credit_of(p: &Principal) -> u64 {
    CREDITS.with(|m| m.borrow().get(&PrincipalKey(*p)).map(|c| c.0).unwrap_or(0))
}
fn set_credit(p: &Principal, v: u64) {
    CREDITS.with(|m| m.borrow_mut().insert(PrincipalKey(*p), CreditBal(v)));
}

// ── lifecycle + admin ──
#[ic_cdk_macros::init]
fn init() {
    let caller = ic_cdk::caller();
    mutate_config(|c| {
        if !c.admins.iter().any(|a| a == &caller) {
            c.admins.push(caller);
        }
    });
}
#[ic_cdk_macros::post_upgrade]
fn post_upgrade() {}

#[derive(CandidType, Deserialize)]
struct ConfigUpdate {
    payments_enabled: Option<bool>,
    icp_ledger: Option<Principal>,
    treasury: Option<Principal>,
    diffusion_canister: Option<Principal>,
    cmc: Option<Principal>,
    router: Option<Principal>,
    cycles_slice_e8s: Option<u64>,
}
#[ic_cdk_macros::update]
fn set_config(u: ConfigUpdate) -> Result<(), String> {
    require_admin()?;
    mutate_config(|c| {
        if let Some(v) = u.payments_enabled { c.payments_enabled = v; }
        if let Some(v) = u.icp_ledger { c.icp_ledger = v; }
        if let Some(v) = u.treasury { c.treasury = v; }
        if let Some(v) = u.diffusion_canister { c.diffusion_canister = v; }
        if let Some(v) = u.cmc { c.cmc = v; }
        if let Some(v) = u.router { c.router = v; }
        if let Some(v) = u.cycles_slice_e8s { c.cycles_slice_e8s = v; }
    });
    Ok(())
}
#[ic_cdk_macros::update]
fn add_admin(p: Principal) -> Result<(), String> {
    require_admin()?;
    mutate_config(|c| {
        if !c.admins.iter().any(|a| a == &p) {
            c.admins.push(p);
        }
    });
    Ok(())
}
#[ic_cdk_macros::query]
fn get_config() -> Config {
    config()
}

// ── public ──
#[derive(CandidType)]
struct Pack {
    index: u32,
    icp_e8s: u64,
    credits: u64,
}
#[ic_cdk_macros::query]
fn quote() -> Vec<Pack> {
    PACKS
        .iter()
        .enumerate()
        .map(|(i, (e8s, cr))| Pack {
            index: i as u32,
            icp_e8s: *e8s,
            credits: *cr,
        })
        .collect()
}

#[ic_cdk_macros::query]
fn credit_balance(user: Principal) -> u64 {
    credit_of(&user)
}

/// Buy a credit pack: pulls ICP the caller has pre-approved to this canister.
#[ic_cdk_macros::update]
async fn buy_credits(pack_index: u32) -> Result<u64, String> {
    let cfg = config();
    if !cfg.payments_enabled {
        return Err("payments are not enabled yet".to_string());
    }
    let caller = ic_cdk::caller();
    if caller == Principal::anonymous() {
        return Err("sign in with Internet Identity first".to_string());
    }
    let (icp_e8s, credits) = *PACKS
        .get(pack_index as usize)
        .ok_or_else(|| "invalid pack index".to_string())?;

    // Pull the ICP the user approved (icrc2_approve) to this canister.
    let args = TransferFromArgs {
        spender_subaccount: None,
        from: Account { owner: caller, subaccount: None },
        to: Account { owner: ic_cdk::id(), subaccount: None },
        amount: Nat::from(icp_e8s),
        fee: None,
        memo: None,
        created_at_time: None,
    };
    let (res,): (TransferFromResult,) =
        ic_cdk::call(cfg.icp_ledger, "icrc2_transfer_from", (args,))
            .await
            .map_err(|e| format!("ledger call failed: {e:?}"))?;
    match res {
        TransferFromResult::Ok(_block) => {}
        TransferFromResult::Err(e) => return Err(format!("payment failed: {e:?}")),
    }

    // Grant credits.
    let new_bal = credit_of(&caller) + credits;
    set_credit(&caller, new_bal);

    // Phase 2 TODO: split the received ICP — route cfg.cycles_slice_e8s per
    // credit to the CMC to mint cycles onto cfg.diffusion_canister (the burn),
    // and forward the remainder to cfg.treasury. Until then the ICP is held in
    // this canister's own ledger account (admin can sweep it to treasury).
    Ok(new_bal)
}

/// Spend one credit for `user`. Callable by the router (or an admin) only.
#[ic_cdk_macros::update]
fn consume_credit(user: Principal) -> Result<u64, String> {
    let cfg = config();
    let caller = ic_cdk::caller();
    if caller != cfg.router && !is_admin(&caller) {
        return Err("only the router may consume credits".to_string());
    }
    let bal = credit_of(&user);
    if bal == 0 {
        return Err("no credits".to_string());
    }
    let left = bal - 1;
    set_credit(&user, left);
    Ok(left)
}

/// Admin: grant credits without payment (promos, support, testing).
#[ic_cdk_macros::update]
fn admin_grant_credits(user: Principal, amount: u64) -> Result<u64, String> {
    require_admin()?;
    let new_bal = credit_of(&user) + amount;
    set_credit(&user, new_bal);
    Ok(new_bal)
}

ic_cdk::export_candid!();
