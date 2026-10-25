//! Single stable-memory MemoryManager for the whole canister.
//!
//! Every module MUST get its virtual memories through `vmem(id)` here. Having
//! more than one `MemoryManager::init(DefaultMemoryImpl::default())` in a
//! canister is a corruption bug: each manager caches bucket allocations
//! independently over the same underlying stable memory, so two managers can
//! hand out the same bucket to different maps. One manager, unique ids per map.
//!
//! MemoryId registry (keep unique):
//!   20 payments::LEDGER
//!   21 payments::STAKED
//!   22 payments::BYOK
//!   23 payments::HOLDER_FREE
//!   30 image_quota::DIFFUSION_DAILY
//!   31 image_quota::GEN_TOTAL (global generation counter)

use ic_stable_structures::memory_manager::{MemoryId, MemoryManager, VirtualMemory};
use ic_stable_structures::DefaultMemoryImpl;
use std::cell::RefCell;

pub type Memory = VirtualMemory<DefaultMemoryImpl>;

thread_local! {
    static MM: RefCell<MemoryManager<DefaultMemoryImpl>> =
        RefCell::new(MemoryManager::init(DefaultMemoryImpl::default()));
}

/// Virtual memory for a given MemoryId. Allocated from the one shared manager.
pub fn vmem(id: u8) -> Memory {
    MM.with(|m| m.borrow().get(MemoryId::new(id)))
}
