use std::cell::RefCell;
use std::collections::HashMap;

const IDEMPOTENCY_WINDOW_NS: u64 = 300 * 1_000_000_000; // 5 minutes

#[derive(Clone)]
pub struct CachedImageResponse {
    pub json_body: String,
    pub created_at: u64,
}

thread_local! {
    static CACHE: RefCell<HashMap<String, CachedImageResponse>> = RefCell::new(HashMap::new());
}

fn cache_key(actor: &str, prompt: &str, seed: u64) -> String {
    format!("{actor}|{seed}|{prompt}")
}

pub fn get(actor: &str, prompt: &str, seed: u64, now: u64) -> Option<String> {
    let key = cache_key(actor, prompt, seed);
    CACHE.with(|c| {
        let map = c.borrow();
        let entry = map.get(&key)?;
        if now.saturating_sub(entry.created_at) > IDEMPOTENCY_WINDOW_NS {
            return None;
        }
        Some(entry.json_body.clone())
    })
}

pub fn put(actor: &str, prompt: &str, seed: u64, now: u64, json_body: String) {
    let key = cache_key(actor, prompt, seed);
    CACHE.with(|c| {
        let mut map = c.borrow_mut();
        if map.len() > 64 {
            map.clear();
        }
        map.insert(
            key,
            CachedImageResponse {
                json_body,
                created_at: now,
            },
        );
    });
}
