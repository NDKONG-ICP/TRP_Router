//! Local-only mock TRP ICRC ledger for M5/M6 tests. NOT FOR MAINNET.

use candid::{CandidType, Deserialize, Nat, Principal};
use ic_cdk::{caller, query, update};
use ic_stable_structures::{
    memory_manager::{MemoryId, MemoryManager, VirtualMemory},
    DefaultMemoryImpl, StableBTreeMap,
};
use std::cell::RefCell;

type Memory = VirtualMemory<DefaultMemoryImpl>;

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct Account {
    pub owner: Principal,
    pub subaccount: Option<Vec<u8>>,
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct TransferArg {
    pub from_subaccount: Option<Vec<u8>>,
    pub to: Account,
    pub amount: Nat,
    pub fee: Option<Nat>,
    pub memo: Option<Vec<u8>>,
    pub created_at_time: Option<u64>,
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub enum TransferError {
    InsufficientFunds { balance: Nat },
    BadFee { expected_fee: Nat },
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub enum TransferResult {
    Ok(Nat),
    Err(TransferError),
}

fn account_key(acct: &Account) -> String {
    let sub = acct
        .subaccount
        .as_ref()
        .map(hex::encode)
        .unwrap_or_default();
    format!("{}:{}", acct.owner, sub)
}

thread_local! {
    static MEMORY_MANAGER: RefCell<MemoryManager<DefaultMemoryImpl>> =
        RefCell::new(MemoryManager::init(DefaultMemoryImpl::default()));
    static BALANCES: RefCell<StableBTreeMap<String, u128, Memory>> = RefCell::new(
        StableBTreeMap::init(MEMORY_MANAGER.with(|m| m.borrow().get(MemoryId::new(0))))
    );
    static ALLOWANCES: RefCell<StableBTreeMap<String, u128, Memory>> = RefCell::new(
        StableBTreeMap::init(MEMORY_MANAGER.with(|m| m.borrow().get(MemoryId::new(1))))
    );
}

const FEE: u128 = 10_000;
const INITIAL_MINT: u128 = 1_000_000_000_000_000;

#[update]
fn init_test_balances(recipient: Principal) {
    let key = account_key(&Account {
        owner: recipient,
        subaccount: None,
    });
    BALANCES.with(|b| b.borrow_mut().insert(key, INITIAL_MINT));
}

#[query]
fn icrc1_balance_of(account: Account) -> Nat {
    let bal = BALANCES
        .with(|b| b.borrow().get(&account_key(&account)))
        .unwrap_or(0);
    Nat::from(bal)
}

#[query]
fn icrc1_fee() -> Nat {
    Nat::from(FEE)
}

#[update]
fn icrc1_transfer(arg: TransferArg) -> TransferResult {
    let from = Account {
        owner: caller(),
        subaccount: arg.from_subaccount.clone(),
    };
    let fee = arg.fee.map(|f| u128::try_from(f.0).unwrap_or(FEE)).unwrap_or(FEE);
    let amount = u128::try_from(arg.amount.0).unwrap_or(0);
    let total = amount + fee;
    let from_key = account_key(&from);
    let to_key = account_key(&arg.to);
    let from_bal = BALANCES.with(|b| b.borrow().get(&from_key)).unwrap_or(0);
    if from_bal < total {
        return TransferResult::Err(TransferError::InsufficientFunds {
            balance: Nat::from(from_bal),
        });
    }
    BALANCES.with(|b| {
        let mut map = b.borrow_mut();
        map.insert(from_key, from_bal - total);
        let to_bal = map.get(&to_key).unwrap_or(0);
        map.insert(to_key, to_bal + amount);
    });
    TransferResult::Ok(Nat::from(0u64))
}


fn allow_key(owner: &Account, spender: &Account) -> String {
    format!("{}|{}", account_key(owner), account_key(spender))
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct ApproveArgs {
    pub from_subaccount: Option<Vec<u8>>,
    pub spender: Account,
    pub amount: Nat,
    pub expected_allowance: Option<Nat>,
    pub expires_at: Option<u64>,
    pub fee: Option<Nat>,
    pub memo: Option<Vec<u8>>,
    pub created_at_time: Option<u64>,
}
#[derive(CandidType, Deserialize, Clone, Debug)]
pub enum ApproveError {
    InsufficientFunds { balance: Nat },
    GenericError { error_code: Nat, message: String },
}
#[derive(CandidType, Deserialize, Clone, Debug)]
pub enum ApproveResult { Ok(Nat), Err(ApproveError) }

#[update]
fn icrc2_approve(arg: ApproveArgs) -> ApproveResult {
    let owner = Account { owner: caller(), subaccount: arg.from_subaccount.clone() };
    let amount = u128::try_from(arg.amount.0).unwrap_or(0);
    ALLOWANCES.with(|a| a.borrow_mut().insert(allow_key(&owner, &arg.spender), amount));
    ApproveResult::Ok(Nat::from(1u64))
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct AllowanceArgs { pub account: Account, pub spender: Account }
#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct Allowance { pub allowance: Nat, pub expires_at: Option<u64> }

#[query]
fn icrc2_allowance(arg: AllowanceArgs) -> Allowance {
    let a = ALLOWANCES.with(|m| m.borrow().get(&allow_key(&arg.account, &arg.spender))).unwrap_or(0);
    Allowance { allowance: Nat::from(a), expires_at: None }
}

#[derive(CandidType, Deserialize, Clone, Debug)]
pub struct TransferFromArgs {
    pub spender_subaccount: Option<Vec<u8>>,
    pub from: Account,
    pub to: Account,
    pub amount: Nat,
    pub fee: Option<Nat>,
    pub memo: Option<Vec<u8>>,
    pub created_at_time: Option<u64>,
}
#[derive(CandidType, Deserialize, Clone, Debug)]
pub enum TransferFromError {
    InsufficientFunds { balance: Nat },
    InsufficientAllowance { allowance: Nat },
    BadFee { expected_fee: Nat },
    GenericError { error_code: Nat, message: String },
}
#[derive(CandidType, Deserialize, Clone, Debug)]
pub enum TransferFromResult { Ok(Nat), Err(TransferFromError) }

#[update]
fn icrc2_transfer_from(arg: TransferFromArgs) -> TransferFromResult {
    let spender = Account { owner: caller(), subaccount: arg.spender_subaccount.clone() };
    let amount = u128::try_from(arg.amount.0).unwrap_or(0);
    let fee = arg.fee.map(|f| u128::try_from(f.0).unwrap_or(FEE)).unwrap_or(FEE);
    let total = amount + fee;
    let akey = allow_key(&arg.from, &spender);
    let allowance = ALLOWANCES.with(|m| m.borrow().get(&akey)).unwrap_or(0);
    if allowance < total {
        return TransferFromResult::Err(TransferFromError::InsufficientAllowance { allowance: Nat::from(allowance) });
    }
    let from_key = account_key(&arg.from);
    let from_bal = BALANCES.with(|b| b.borrow().get(&from_key)).unwrap_or(0);
    if from_bal < total {
        return TransferFromResult::Err(TransferFromError::InsufficientFunds { balance: Nat::from(from_bal) });
    }
    BALANCES.with(|b| {
        let mut map = b.borrow_mut();
        map.insert(from_key, from_bal - total);
        let to_key = account_key(&arg.to);
        let to_bal = map.get(&to_key).unwrap_or(0);
        map.insert(to_key, to_bal + amount);
    });
    ALLOWANCES.with(|a| a.borrow_mut().insert(akey, allowance - total));
    TransferFromResult::Ok(Nat::from(0u64))
}

ic_cdk::export_candid!();
