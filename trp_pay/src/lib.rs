//! trp_pay — ICP (ICRC-2) payments -> generation credits for Raven Diffusion.
//!
//! Pure Internet Identity flow:
//!   1. The user signs an `icrc2_approve` on the ICP ledger (approving THIS
//!      canister as spender) with their II — same way the mint signs calls.
//!   2. The user calls `buy_credits(pack)`; this canister pulls the ICP with
//!      `icrc2_transfer_from` and grants credits.
//!   3. The payment is split: `cycles_slice_e8s * credits` -> CMC top-up on the
//!      diffusion canister (burn); remainder -> treasury (best-effort).
//!
//! Safety: ships `payments_enabled = false` and a configurable ledger, so
//! nothing moves real ICP until an admin configures and enables it. Test on
//! the mock ledger first.

mod auto_settle;
mod icpswap_convert;
mod icpswap_quote;
mod payment_route;
mod token_payments;

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
#[derive(CandidType, Deserialize, Clone, Debug)]
pub(crate) struct Account {
    owner: Principal,
    subaccount: Option<Vec<u8>>,
}

#[derive(CandidType, Deserialize, Debug)]
enum NatResult {
    Ok(u64),
    Err(String),
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
/// Admin-configured alt-token payment (Phase A).
#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct TokenCfg {
    pub symbol: String,
    pub ledger: Principal,
    pub decimals: u8,
    pub icpswap_pool: Principal,
    /// If null, inferred from pool metadata at quote/buy time.
    pub sell_zero_for_one: Option<bool>,
    pub enabled: bool,
    /// Test/local only when `icpswap_pool` is anonymous.
    pub stub_token_base_per_icp_e8: u64,
}

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
            // Default until set_config; production treasury = admin II ledger account (not Plug).
            treasury: p("72w3b-oy3is-urqu2-sjyxa-oh5nc-lfs2i-p3mzm-tq3j5-pokxx-hc7ym-wqe"),
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
    static PURCHASES: RefCell<StableBTreeMap<u64, PurchaseRecord, Memory>> =
        RefCell::new(StableBTreeMap::init(MM.with(|m| m.borrow().get(MemoryId::new(2)))));
    static NEXT_PURCHASE_ID: RefCell<StableCell<PurchaseId, Memory>> = RefCell::new(
        StableCell::init(
            MM.with(|m| m.borrow().get(MemoryId::new(3))),
            PurchaseId(0),
        )
        .expect("init purchase id"),
    );
    static PAYMENT_TOKENS: RefCell<StableBTreeMap<SymbolKey, TokenCfg, Memory>> =
        RefCell::new(StableBTreeMap::init(
            MM.with(|m| m.borrow().get(MemoryId::new(4))),
        ));
    static PENDING: RefCell<StableBTreeMap<u64, auto_settle::PendingConversion, Memory>> =
        RefCell::new(StableBTreeMap::init(
            MM.with(|m| m.borrow().get(MemoryId::new(5))),
        ));
    static NEXT_PENDING_ID: RefCell<StableCell<PurchaseId, Memory>> = RefCell::new(
        StableCell::init(
            MM.with(|m| m.borrow().get(MemoryId::new(6))),
            PurchaseId(0),
        )
        .expect("init pending id"),
    );
    static CONVERT_CFG: RefCell<StableCell<ConvertConfig, Memory>> = RefCell::new(
        StableCell::init(
            MM.with(|m| m.borrow().get(MemoryId::new(7))),
            ConvertConfig::default(),
        )
        .expect("init convert config"),
    );
}

#[derive(CandidType, Deserialize, Clone)]
struct ConvertConfig {
    auto_convert_enabled: bool,
    slippage_bps: u32,
    liquidity_share_bps: u32,
    liquidity_add_enabled: bool,
    trp_liquidity_pool: Principal,
}
impl Default for ConvertConfig {
    fn default() -> Self {
        ConvertConfig {
            auto_convert_enabled: false,
            slippage_bps: 100,
            liquidity_share_bps: 0,
            liquidity_add_enabled: false,
            trp_liquidity_pool: Principal::anonymous(),
        }
    }
}
impl Storable for ConvertConfig {
    fn to_bytes(&self) -> Cow<[u8]> {
        Cow::Owned(candid::encode_one(self).expect("encode ConvertConfig"))
    }
    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        candid::decode_one(&bytes).expect("decode ConvertConfig")
    }
    const BOUND: Bound = Bound::Unbounded;
}

impl Storable for auto_settle::PendingConversion {
    fn to_bytes(&self) -> Cow<[u8]> {
        Cow::Owned(candid::encode_one(self).expect("encode PendingConversion"))
    }
    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        candid::decode_one(&bytes).expect("decode PendingConversion")
    }
    const BOUND: Bound = Bound::Unbounded;
}

fn convert_config() -> ConvertConfig {
    CONVERT_CFG.with(|c| c.borrow().get().clone())
}

fn insert_pending(mut p: auto_settle::PendingConversion) -> u64 {
    let id = NEXT_PENDING_ID.with(|n| {
        let cur = n.borrow().get().0;
        let _ = n.borrow_mut().set(PurchaseId(cur.saturating_add(1)));
        cur
    });
    p.id = id;
    PENDING.with(|m| m.borrow_mut().insert(id, p));
    id
}

#[derive(Clone, PartialEq, Eq, PartialOrd, Ord)]
struct SymbolKey(String);
impl Storable for SymbolKey {
    fn to_bytes(&self) -> Cow<[u8]> {
        Cow::Owned(self.0.as_bytes().to_vec())
    }
    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        SymbolKey(String::from_utf8(bytes.into_owned()).unwrap_or_default())
    }
    const BOUND: Bound = Bound::Unbounded;
}
impl Storable for TokenCfg {
    fn to_bytes(&self) -> Cow<[u8]> {
        Cow::Owned(candid::encode_one(self).expect("encode TokenCfg"))
    }
    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        candid::decode_one(&bytes).expect("decode TokenCfg")
    }
    const BOUND: Bound = Bound::Unbounded;
}

fn norm_symbol(s: &str) -> String {
    s.trim().to_uppercase()
}

fn payment_tokens_vec() -> Vec<TokenCfg> {
    PAYMENT_TOKENS.with(|m| m.borrow().iter().map(|(_, v)| v.clone()).collect())
}

fn get_payment_token(symbol: &str) -> Option<TokenCfg> {
    PAYMENT_TOKENS.with(|m| m.borrow().get(&SymbolKey(norm_symbol(symbol))))
}

fn set_payment_token_cfg(cfg: TokenCfg) -> Result<(), String> {
    if cfg.symbol.trim().is_empty() {
        return Err("symbol required".to_string());
    }
    let sym = norm_symbol(&cfg.symbol);
    if cfg.enabled && (sym == "TRP" || sym == "$TRP") && cfg.ledger == Principal::anonymous() {
        return Err("$TRP ledger not configured".to_string());
    }
    PAYMENT_TOKENS.with(|m| {
        m.borrow_mut()
            .insert(SymbolKey(norm_symbol(&cfg.symbol)), cfg);
    });
    Ok(())
}

fn remove_payment_token_cfg(symbol: &str) -> Result<(), String> {
    PAYMENT_TOKENS.with(|m| {
        m.borrow_mut()
            .remove(&SymbolKey(norm_symbol(symbol)));
    });
    Ok(())
}

#[derive(Clone, Copy, Default)]
struct PurchaseId(u64);
impl Storable for PurchaseId {
    fn to_bytes(&self) -> Cow<[u8]> {
        Cow::Owned(self.0.to_le_bytes().to_vec())
    }
    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        let mut a = [0u8; 8];
        a.copy_from_slice(&bytes[..8]);
        PurchaseId(u64::from_le_bytes(a))
    }
    const BOUND: Bound = Bound::Bounded { max_size: 8, is_fixed_size: true };
}

#[derive(Clone, candid::CandidType, serde::Serialize, serde::Deserialize)]
struct PurchaseRecord {
    user: Principal,
    pack_index: u32,
    icp_e8s: u64,
    credits: u64,
    at_ns: u64,
}

impl Storable for PurchaseRecord {
    fn to_bytes(&self) -> Cow<[u8]> {
        Cow::Owned(candid::encode_one(self).expect("encode PurchaseRecord"))
    }
    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        candid::decode_one(bytes.as_ref()).expect("decode PurchaseRecord")
    }
    const BOUND: Bound = Bound::Unbounded;
}

fn log_purchase(user: Principal, pack_index: u32, icp_e8s: u64, credits: u64) {
    let id = NEXT_PURCHASE_ID.with(|n| {
        let cur = n.borrow().get().0;
        let _ = n.borrow_mut().set(PurchaseId(cur.saturating_add(1)));
        cur
    });
    let rec = PurchaseRecord {
        user,
        pack_index,
        icp_e8s,
        credits,
        at_ns: ic_cdk::api::time(),
    };
    PURCHASES.with(|m| m.borrow_mut().insert(id, rec));
}

fn require_admin_query() -> Result<(), String> {
    require_admin()
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
    auto_convert_enabled: Option<bool>,
    slippage_bps: Option<u32>,
    liquidity_share_bps: Option<u32>,
    liquidity_add_enabled: Option<bool>,
    trp_liquidity_pool: Option<Principal>,
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
    CONVERT_CFG.with(|cell| {
        let mut cc = cell.borrow().get().clone();
        if let Some(v) = u.auto_convert_enabled { cc.auto_convert_enabled = v; }
        if let Some(v) = u.slippage_bps { cc.slippage_bps = v; }
        if let Some(v) = u.liquidity_share_bps { cc.liquidity_share_bps = v; }
        if let Some(v) = u.liquidity_add_enabled { cc.liquidity_add_enabled = v; }
        if let Some(v) = u.trp_liquidity_pool { cc.trp_liquidity_pool = v; }
        cell.borrow_mut().set(cc).expect("set convert config");
    });
    Ok(())
}
/// Route future pack remainders to this principal's ICP ledger account (admin-controlled).
#[ic_cdk_macros::update]
fn admin_set_treasury(treasury: Principal) -> Result<(), String> {
    require_admin()?;
    mutate_config(|c| c.treasury = treasury);
    Ok(())
}

#[ic_cdk_macros::update]
async fn admin_treasury_icp_balance_e8s() -> Result<u64, String> {
    require_admin()?;
    let cfg = config();
    let acct = Account {
        owner: cfg.treasury,
        subaccount: None,
    };
    let (bal,): (Nat,) = ic_cdk::call(cfg.icp_ledger, "icrc1_balance_of", (acct,))
        .await
        .map_err(|e| format!("treasury balance: {e:?}"))?;
    Ok(bal.0.try_into().unwrap_or(0))
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

#[derive(CandidType)]
struct ConvertConfigView {
    auto_convert_enabled: bool,
    slippage_bps: u32,
    liquidity_share_bps: u32,
    liquidity_add_enabled: bool,
    trp_liquidity_pool: Principal,
}

#[ic_cdk_macros::query]
fn get_convert_config() -> ConvertConfigView {
    let c = convert_config();
    ConvertConfigView {
        auto_convert_enabled: c.auto_convert_enabled,
        slippage_bps: c.slippage_bps,
        liquidity_share_bps: c.liquidity_share_bps,
        liquidity_add_enabled: c.liquidity_add_enabled,
        trp_liquidity_pool: c.trp_liquidity_pool,
    }
}

#[ic_cdk_macros::query]
fn list_payment_tokens() -> Vec<TokenCfg> {
    payment_tokens_vec()
}

#[ic_cdk_macros::update]
fn set_payment_token(token: TokenCfg) -> Result<(), String> {
    require_admin()?;
    set_payment_token_cfg(token)
}

#[ic_cdk_macros::update]
fn remove_payment_token(symbol: String) -> Result<(), String> {
    require_admin()?;
    remove_payment_token_cfg(&symbol)
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
async fn buy_credits(pack_index: u32) -> NatResult {
    match buy_credits_inner(pack_index).await {
        Ok(b) => NatResult::Ok(b),
        Err(e) => NatResult::Err(e),
    }
}

async fn buy_credits_inner(pack_index: u32) -> Result<u64, String> {
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

    log_purchase(caller, pack_index, icp_e8s, credits);

    payment_route::split_purchase_icp(
        cfg.icp_ledger,
        cfg.cmc,
        cfg.treasury,
        cfg.diffusion_canister,
        icp_e8s,
        credits,
        cfg.cycles_slice_e8s,
    )
    .await;

    Ok(new_bal)
}

#[derive(CandidType, Deserialize)]
struct TokenQuote {
    token_amount: Nat,
    icp_value_e8s: u64,
    ts: u64,
}

#[derive(CandidType, Deserialize)]
enum QuoteTokenResult {
    Ok(TokenQuote),
    Err(String),
}

/// Update (not composite query): ICPSwap pools are not reachable from composite queries on all subnets.
#[ic_cdk_macros::update]
async fn quote_token(pack_index: u32, symbol: String) -> QuoteTokenResult {
    match quote_token_inner(pack_index, &symbol).await {
        Ok(q) => QuoteTokenResult::Ok(q),
        Err(e) => QuoteTokenResult::Err(e),
    }
}

async fn quote_token_inner(pack_index: u32, symbol: &str) -> Result<TokenQuote, String> {
    if norm_symbol(symbol) == "ICP" {
        return Err("use quote() for ICP packs".to_string());
    }
    let tok = get_payment_token(symbol).ok_or_else(|| "unknown payment token".to_string())?;
    if !tok.enabled {
        return Err("token not enabled for payments".to_string());
    }
    let (icp_e8s, _credits) = *PACKS
        .get(pack_index as usize)
        .ok_or_else(|| "invalid pack index".to_string())?;
    let amount = token_payments::compute_token_price(&token_payments::TokenCfg {
        symbol: tok.symbol.clone(),
        ledger: tok.ledger,
        decimals: tok.decimals,
        icpswap_pool: tok.icpswap_pool,
        sell_zero_for_one: tok.sell_zero_for_one,
        enabled: tok.enabled,
        stub_token_base_per_icp_e8: tok.stub_token_base_per_icp_e8,
    }, icp_e8s)
    .await?;
    Ok(TokenQuote {
        token_amount: Nat::from(amount),
        icp_value_e8s: icp_e8s,
        ts: ic_cdk::api::time(),
    })
}

#[ic_cdk_macros::update]
async fn buy_credits_token(pack_index: u32, symbol: String) -> NatResult {
    match buy_credits_token_inner(pack_index, &symbol).await {
        Ok(b) => NatResult::Ok(b),
        Err(e) => NatResult::Err(e),
    }
}

async fn buy_credits_token_inner(pack_index: u32, symbol: &str) -> Result<u64, String> {
    let cfg = config();
    if !cfg.payments_enabled {
        return Err("payments are not enabled yet".to_string());
    }
    let caller = ic_cdk::caller();
    if caller == Principal::anonymous() {
        return Err("sign in with Internet Identity first".to_string());
    }
    if norm_symbol(symbol) == "ICP" {
        return Err("use buy_credits for ICP".to_string());
    }
    let tok = get_payment_token(symbol).ok_or_else(|| "unknown payment token".to_string())?;
    if !tok.enabled {
        return Err("token not enabled for payments".to_string());
    }
    let (icp_e8s, credits) = *PACKS
        .get(pack_index as usize)
        .ok_or_else(|| "invalid pack index".to_string())?;

    let tp = token_payments::TokenCfg {
        symbol: tok.symbol.clone(),
        ledger: tok.ledger,
        decimals: tok.decimals,
        icpswap_pool: tok.icpswap_pool,
        sell_zero_for_one: tok.sell_zero_for_one,
        enabled: tok.enabled,
        stub_token_base_per_icp_e8: tok.stub_token_base_per_icp_e8,
    };
    let token_amount = token_payments::compute_token_price(&tp, icp_e8s).await?;

    token_payments::pull_token_from_user(tok.ledger, caller, token_amount).await?;

    let new_bal = credit_of(&caller) + credits;
    set_credit(&caller, new_bal);
    log_purchase(caller, pack_index, icp_e8s, credits);

    let cc = convert_config();
    let tp2 = token_payments::TokenCfg {
        symbol: tok.symbol.clone(),
        ledger: tok.ledger,
        decimals: tok.decimals,
        icpswap_pool: tok.icpswap_pool,
        sell_zero_for_one: tok.sell_zero_for_one,
        enabled: tok.enabled,
        stub_token_base_per_icp_e8: tok.stub_token_base_per_icp_e8,
    };
    auto_settle::settle_after_token_pull(
        &cfg,
        &auto_settle::ConvertConfig {
            auto_convert_enabled: cc.auto_convert_enabled,
            slippage_bps: cc.slippage_bps,
            liquidity_share_bps: cc.liquidity_share_bps,
            liquidity_add_enabled: cc.liquidity_add_enabled,
            trp_liquidity_pool: cc.trp_liquidity_pool,
        },
        &tp2,
        caller,
        token_amount,
        pack_index,
        icp_e8s,
        credits,
        |p| {
            insert_pending(p);
        },
    )
    .await;

    Ok(new_bal)
}

#[ic_cdk_macros::query]
fn admin_list_pending(limit: u32) -> Result<Vec<auto_settle::PendingConversion>, String> {
    require_admin_query()?;
    let cap = limit.max(1).min(200) as usize;
    let mut rows: Vec<_> = PENDING.with(|m| m.borrow().iter().map(|(_, v)| v.clone()).collect());
    rows.sort_by_key(|p| std::cmp::Reverse(p.id));
    rows.truncate(cap);
    Ok(rows)
}

#[ic_cdk_macros::update]
async fn admin_retry_conversion(pending_id: u64) -> Result<(), String> {
    require_admin()?;
    let pending = PENDING.with(|m| {
        m.borrow()
            .get(&pending_id)
            .ok_or_else(|| "pending id not found".to_string())
    })?;
    let sym = PAYMENT_TOKENS.with(|m| {
        m.borrow()
            .iter()
            .find(|(_, t)| t.ledger == pending.token_ledger)
            .map(|(_, t)| t.symbol.clone())
            .ok_or_else(|| "token not in payment_tokens".to_string())
    })?;
    let tok = get_payment_token(&sym).ok_or_else(|| "token config missing".to_string())?;
    let cfg = config();
    let cc = convert_config();
    let tp = token_payments::TokenCfg {
        symbol: tok.symbol.clone(),
        ledger: tok.ledger,
        decimals: tok.decimals,
        icpswap_pool: tok.icpswap_pool,
        sell_zero_for_one: tok.sell_zero_for_one,
        enabled: tok.enabled,
        stub_token_base_per_icp_e8: tok.stub_token_base_per_icp_e8,
    };
    auto_settle::retry_pending_conversion(
        &cfg,
        &auto_settle::ConvertConfig {
            auto_convert_enabled: cc.auto_convert_enabled,
            slippage_bps: cc.slippage_bps,
            liquidity_share_bps: cc.liquidity_share_bps,
            liquidity_add_enabled: cc.liquidity_add_enabled,
            trp_liquidity_pool: cc.trp_liquidity_pool,
        },
        &pending,
        &tp,
    )
    .await?;
    PENDING.with(|m| {
        let mut p = pending;
        p.status = auto_settle::PendingStatus::Converted;
        p.last_error = String::new();
        m.borrow_mut().insert(pending_id, p);
    });
    Ok(())
}

#[ic_cdk_macros::update]
async fn admin_refund_pending(pending_id: u64) -> Result<(), String> {
    require_admin()?;
    let pending = PENDING.with(|m| {
        m.borrow()
            .get(&pending_id)
            .ok_or_else(|| "pending id not found".to_string())
    })?;
    let cfg = config();
    auto_settle::refund_token_to_user(
        &cfg,
        pending.token_ledger,
        pending.user,
        pending.token_amount,
    )
    .await?;
    PENDING.with(|m| {
        let mut p = pending;
        p.status = auto_settle::PendingStatus::Refunded;
        m.borrow_mut().insert(pending_id, p);
    });
    Ok(())
}

#[derive(candid::CandidType, serde::Serialize)]
struct CreditRow {
    user: Principal,
    credits: u64,
}

#[ic_cdk_macros::query]
fn admin_list_credit_balances(limit: u32) -> Result<Vec<CreditRow>, String> {
    require_admin_query()?;
    let cap = limit.max(1).min(500) as usize;
    let rows = CREDITS.with(|m| {
        m.borrow()
            .iter()
            .take(cap)
            .map(|(k, v)| CreditRow {
                user: k.0,
                credits: v.0,
            })
            .collect()
    });
    Ok(rows)
}

#[derive(candid::CandidType, serde::Serialize)]
struct PurchaseRow {
    id: u64,
    user: Principal,
    pack_index: u32,
    icp_e8s: u64,
    credits: u64,
    at_ns: u64,
}

#[ic_cdk_macros::query]
fn admin_list_recent_purchases(limit: u32) -> Result<Vec<PurchaseRow>, String> {
    require_admin_query()?;
    let cap = limit.max(1).min(200) as usize;
    let rows = PURCHASES.with(|m| {
        let map = m.borrow();
        let mut ids: Vec<u64> = map.iter().map(|(id, _)| id).collect();
        ids.sort_unstable();
        ids.reverse();
        ids.into_iter()
            .take(cap)
            .filter_map(|id| {
                map.get(&id).map(|rec| PurchaseRow {
                    id,
                    user: rec.user,
                    pack_index: rec.pack_index,
                    icp_e8s: rec.icp_e8s,
                    credits: rec.credits,
                    at_ns: rec.at_ns,
                })
            })
            .collect()
    });
    Ok(rows)
}

#[derive(candid::CandidType, serde::Serialize)]
struct TreasuryView {
    payments_enabled: bool,
    treasury: Principal,
    pay_canister_icp_e8s: u64,
    cycles_slice_e8s: u64,
}

#[ic_cdk_macros::update]
async fn admin_treasury_view() -> Result<TreasuryView, String> {
    require_admin()?;
    let cfg = config();
    let self_acct = Account {
        owner: ic_cdk::id(),
        subaccount: None,
    };
    let (bal,): (Nat,) = ic_cdk::call(cfg.icp_ledger, "icrc1_balance_of", (self_acct,))
        .await
        .map_err(|e| format!("balance_of: {e:?}"))?;
    let bal_u64: u64 = bal.0.try_into().unwrap_or(0);
    Ok(TreasuryView {
        payments_enabled: cfg.payments_enabled,
        treasury: cfg.treasury,
        pay_canister_icp_e8s: bal_u64,
        cycles_slice_e8s: cfg.cycles_slice_e8s,
    })
}

/// Refund ICP held on this canister (e.g. split failed) back to a user ledger account.
#[ic_cdk_macros::update]
async fn admin_refund_icp(to: Principal, amount_e8s: u64) -> NatResult {
    if let Err(e) = require_admin() {
        return NatResult::Err(e);
    }
    let cfg = config();
    match payment_route::route_treasury(cfg.icp_ledger, to, amount_e8s).await {
        Ok(()) => NatResult::Ok(amount_e8s),
        Err(e) => NatResult::Err(e),
    }
}

/// Spend one credit for `user`. Callable by the router (or an admin) only.
#[ic_cdk_macros::update]
fn consume_credit(user: Principal) -> NatResult {
    match consume_credit_inner(user) {
        Ok(b) => NatResult::Ok(b),
        Err(e) => NatResult::Err(e),
    }
}

fn consume_credit_inner(user: Principal) -> Result<u64, String> {
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
fn admin_grant_credits(user: Principal, amount: u64) -> NatResult {
    match admin_grant_credits_inner(user, amount) {
        Ok(b) => NatResult::Ok(b),
        Err(e) => NatResult::Err(e),
    }
}

fn admin_grant_credits_inner(user: Principal, amount: u64) -> Result<u64, String> {
    require_admin()?;
    let new_bal = credit_of(&user) + amount;
    set_credit(&user, new_bal);
    Ok(new_bal)
}

/// Admin fallback: move all ICP on this canister (minus fee) to treasury.
#[ic_cdk_macros::update]
async fn sweep_to_treasury() -> NatResult {
    if let Err(e) = require_admin() {
        return NatResult::Err(e);
    }
    let cfg = config();
    match payment_route::sweep_icp_balance_to_treasury(cfg.icp_ledger, cfg.treasury).await {
        Ok(n) => NatResult::Ok(n),
        Err(e) => NatResult::Err(e),
    }
}

ic_cdk::export_candid!();
