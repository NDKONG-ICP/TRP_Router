//! Per-principal HTTP rate limits (API key pseudo-principal or II principal).

use crate::mem;
use candid::Principal;
use ic_stable_structures::{StableBTreeMap, Storable};
use std::borrow::Cow;
use std::cell::RefCell;

const PER_MINUTE: u32 = 60;
const PER_DAY: u32 = 2_000;
const MAX_PROMPT_CHARS: usize = 8_000;

#[derive(Clone, Default, serde::Serialize, serde::Deserialize)]
struct Window {
    minute_ts: u64,
    minute_count: u32,
    day_ts: u64,
    day_count: u32,
}

impl Storable for Window {
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
    static WINDOWS: RefCell<StableBTreeMap<Principal, Window, mem::Memory>> =
        RefCell::new(StableBTreeMap::init(mem::vmem(35)));
}

fn minute_bucket(now_ns: u64) -> u64 {
    now_ns / 60_000_000_000
}

fn day_bucket(now_ns: u64) -> u64 {
    now_ns / 86_400_000_000_000
}

pub fn check_prompt_len(prompt: &str) -> Result<(), String> {
    if prompt.chars().count() > MAX_PROMPT_CHARS {
        return Err(format!(
            "prompt exceeds {MAX_PROMPT_CHARS} characters"
        ));
    }
    Ok(())
}

pub fn check_and_bump(principal: Principal, now_ns: u64) -> Result<(), String> {
    let mb = minute_bucket(now_ns);
    let db = day_bucket(now_ns);
    WINDOWS.with(|w| {
        let mut map = w.borrow_mut();
        let mut win = map.get(&principal).unwrap_or_default();
        if win.minute_ts != mb {
            win.minute_ts = mb;
            win.minute_count = 0;
        }
        if win.day_ts != db {
            win.day_ts = db;
            win.day_count = 0;
        }
        win.minute_count += 1;
        win.day_count += 1;
        if win.minute_count > PER_MINUTE {
            return Err("rate limit exceeded (per-minute); retry later".into());
        }
        if win.day_count > PER_DAY {
            return Err("rate limit exceeded (daily cap)".into());
        }
        map.insert(principal, win);
        Ok(())
    })
}
