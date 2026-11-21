use crate::{HeaderField, HttpResponse};
use candid::Principal;
use ic_stable_structures::{
    memory_manager::{MemoryId, MemoryManager, VirtualMemory},
    DefaultMemoryImpl, StableBTreeMap, Storable,
};
use sha2::{Digest, Sha256};
use std::borrow::Cow;
use std::cell::RefCell;

type Memory = VirtualMemory<DefaultMemoryImpl>;

#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, candid::CandidType, serde::Serialize, serde::Deserialize)]
struct KeyHash([u8; 32]);

impl Storable for KeyHash {
    fn to_bytes(&self) -> Cow<[u8]> {
        Cow::Owned(self.0.to_vec())
    }
    fn from_bytes(bytes: Cow<[u8]>) -> Self {
        let mut a = [0u8; 32];
        a.copy_from_slice(bytes.as_ref());
        KeyHash(a)
    }
    const BOUND: ic_stable_structures::storable::Bound =
        ic_stable_structures::storable::Bound::Bounded {
            max_size: 32,
            is_fixed_size: true,
        };
}

thread_local! {
    static MEMORY_MANAGER: RefCell<MemoryManager<DefaultMemoryImpl>> =
        RefCell::new(MemoryManager::init(DefaultMemoryImpl::default()));
    static ACCEPTED_API_KEY_HASHES: RefCell<StableBTreeMap<KeyHash, u8, Memory>> = RefCell::new(
        StableBTreeMap::init(MEMORY_MANAGER.with(|m| m.borrow().get(MemoryId::new(20))))
    );
}

fn hash_key(key: &str) -> [u8; 32] {
    Sha256::digest(key.as_bytes()).into()
}

fn header_value(headers: &[HeaderField], name: &str) -> Option<String> {
    let want = name.to_ascii_lowercase();
    headers
        .iter()
        .find(|h| h.0.to_ascii_lowercase() == want)
        .map(|h| h.1.trim().to_string())
        .filter(|v| !v.is_empty())
}

fn bearer_token(headers: &[HeaderField]) -> Option<String> {
    if let Some(auth) = header_value(headers, "authorization") {
        if let Some(rest) = auth.strip_prefix("Bearer ") {
            let t = rest.trim();
            if !t.is_empty() {
                return Some(t.to_string());
            }
        }
    }
    // Browser CORS: icp0.io boundary allows x-oc-api-key, not Authorization.
    header_value(headers, "x-oc-api-key")
}

fn unauthorized(msg: &str) -> HttpResponse {
    super::json_response(
        401,
        &format!(r#"{{"error":"{}"}}"#, msg.replace('"', "\\\"")),
    )
}

/// Who is making the request, and how far that claim can be trusted.
///
/// Trust matters because the HTTP gateway cannot prove an Internet Identity: an
/// `ii:<principal>` header is only an assertion. Anything that costs the operator
/// money (paid models) or spends a user's balance (credits) must therefore never be
/// keyed on an unverified principal.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ActorKind {
    /// II principal proven by the canister `caller()` (authenticated agent call).
    /// The only kind that may spend that principal's paid credits.
    InternetIdentity,
    /// `ii:<principal>` asserted with no proof (HTTP header, or a canister call whose
    /// caller does not match). Free tier only, on one shared quota bucket.
    InternetIdentityUnverified,
    /// Legacy shared Playground key — public in the Playground's config.js. Free tier only.
    ApiKeyShared,
    /// Admin-minted named key (`admin_create_api_key`). May use paid models.
    ApiKeyMinted,
}

impl ActorKind {
    /// Paid (non-free-tier) models are billed to the operator's provider accounts.
    pub fn may_use_paid_models(self) -> bool {
        matches!(self, ActorKind::ApiKeyMinted)
    }

    /// Spending `trp_pay` credits debits a specific principal, so it needs proof of identity.
    pub fn may_spend_credits(self) -> bool {
        matches!(self, ActorKind::InternetIdentity)
    }

    /// Operator-minted integrator keys may send large prompts (expert/system prompts
    /// that exceed the free-tier character cap).
    pub fn may_use_large_prompts(self) -> bool {
        matches!(self, ActorKind::ApiKeyMinted)
    }
}

#[derive(Clone, Copy)]
pub struct ActorDetail {
    /// Principal that quotas, rate limits and credits are keyed on.
    pub principal: Principal,
    pub kind: ActorKind,
}

/// Every unverified `ii:` claim shares this one bucket, so inventing principals
/// cannot multiply the free tier or touch a real user's quota and credits.
fn unverified_ii_bucket() -> Principal {
    Principal::self_authenticating(b"trp-unverified-ii")
}

/// Resolve the quota principal for a playground / image request.
pub fn resolve_actor(headers: &[HeaderField]) -> Result<Principal, HttpResponse> {
    resolve_actor_detail(headers).map(|d| d.principal)
}

/// HTTP requests: an `ii:` token here is never verified.
pub fn resolve_actor_detail(headers: &[HeaderField]) -> Result<ActorDetail, HttpResponse> {
    let Some(token) = bearer_token(headers) else {
        return Err(unauthorized(
            "missing Authorization: Bearer <API key>",
        ));
    };
    resolve_token(&token, None)
}

/// Canister update calls: `caller` is authenticated by the IC, so an `ii:<principal>`
/// token is verified when it matches a non-anonymous caller.
pub fn resolve_actor_for_call(
    token: &str,
    caller: Principal,
) -> Result<ActorDetail, HttpResponse> {
    let token = token.trim();
    if token.is_empty() {
        return Err(unauthorized("missing auth token"));
    }
    resolve_token(token, Some(caller))
}

fn resolve_token(token: &str, caller: Option<Principal>) -> Result<ActorDetail, HttpResponse> {
    if let Some(principal_text) = token.strip_prefix("ii:") {
        let claimed = Principal::from_text(principal_text.trim())
            .map_err(|_| unauthorized("invalid ii: principal in auth token"))?;
        let verified = caller
            .map(|c| c == claimed && c != Principal::anonymous())
            .unwrap_or(false);
        return Ok(if verified {
            ActorDetail {
                principal: claimed,
                kind: ActorKind::InternetIdentity,
            }
        } else {
            ActorDetail {
                principal: unverified_ii_bucket(),
                kind: ActorKind::InternetIdentityUnverified,
            }
        });
    }
    let h = hash_key(token);
    let legacy = ACCEPTED_API_KEY_HASHES.with(|m| m.borrow().contains_key(&KeyHash(h)));
    let named = crate::api_keys::is_active_key(token);
    if !legacy && !named {
        return Err(unauthorized("invalid API key"));
    }
    Ok(ActorDetail {
        principal: Principal::self_authenticating(format!("trp-key:{token}").as_bytes()),
        kind: if named {
            ActorKind::ApiKeyMinted
        } else {
            ActorKind::ApiKeyShared
        },
    })
}

/// Controller-only: register a shared beta API key (stored as SHA-256, not plaintext).
pub fn register_api_key(key: String) {
    assert_controller();
    let h = hash_key(key.trim());
    ACCEPTED_API_KEY_HASHES.with(|m| {
        m.borrow_mut().insert(KeyHash(h), 1);
    });
}

fn assert_controller() {
    let c = ic_cdk::caller();
    if !ic_cdk::api::is_controller(&c) {
        ic_cdk::trap("controller only");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hdr(v: &str) -> Vec<HeaderField> {
        vec![HeaderField("Authorization".into(), format!("Bearer {v}"))]
    }

    fn user(n: u8) -> Principal {
        Principal::self_authenticating([n; 32])
    }

    #[test]
    fn http_ii_claim_is_never_verified_and_shares_one_bucket() {
        let a = resolve_actor_detail(&hdr(&format!("ii:{}", user(1)))).ok().unwrap();
        let b = resolve_actor_detail(&hdr(&format!("ii:{}", user(2)))).ok().unwrap();
        assert_eq!(a.kind, ActorKind::InternetIdentityUnverified);
        // Quotas/credits must not be keyed on the claimed principal…
        assert_ne!(a.principal, user(1));
        // …and inventing principals must not multiply the free tier.
        assert_eq!(a.principal, b.principal);
        assert!(!a.kind.may_spend_credits());
        assert!(!a.kind.may_use_paid_models());
    }

    #[test]
    fn canister_call_verifies_ii_only_when_caller_matches() {
        let token = format!("ii:{}", user(7));
        let ok = resolve_actor_for_call(&token, user(7)).ok().unwrap();
        assert_eq!(ok.kind, ActorKind::InternetIdentity);
        assert_eq!(ok.principal, user(7));
        assert!(ok.kind.may_spend_credits());

        // Someone else claiming user 7's principal gets the shared bucket, not user 7.
        let spoof = resolve_actor_for_call(&token, user(8)).ok().unwrap();
        assert_eq!(spoof.kind, ActorKind::InternetIdentityUnverified);
        assert_ne!(spoof.principal, user(7));
        assert!(!spoof.kind.may_spend_credits());

        // The Playground's old anonymous-agent call is unverified too.
        let anon = resolve_actor_for_call(&token, Principal::anonymous()).ok().unwrap();
        assert_eq!(anon.kind, ActorKind::InternetIdentityUnverified);
        let anon_claim =
            resolve_actor_for_call("ii:2vxsx-fae", Principal::anonymous()).ok().unwrap();
        assert_eq!(anon_claim.kind, ActorKind::InternetIdentityUnverified);
    }

    #[test]
    fn only_minted_keys_may_use_paid_models() {
        // Legacy shared Playground key: valid, but free tier only.
        ACCEPTED_API_KEY_HASHES.with(|m| {
            m.borrow_mut().insert(KeyHash(hash_key("trp_pg_public")), 1);
        });
        let shared = resolve_actor_detail(&hdr("trp_pg_public")).ok().unwrap();
        assert_eq!(shared.kind, ActorKind::ApiKeyShared);
        assert!(!shared.kind.may_use_paid_models());
        assert!(!shared.kind.may_spend_credits());

        crate::api_keys::insert_key("trp_minted_1", "integrator".into(), 0);
        let minted = resolve_actor_detail(&hdr("trp_minted_1")).ok().unwrap();
        assert_eq!(minted.kind, ActorKind::ApiKeyMinted);
        assert!(minted.kind.may_use_paid_models());

        // Revoking a minted key shuts it out entirely.
        assert!(crate::api_keys::revoke_key("trp_minted_1"));
        assert!(resolve_actor_detail(&hdr("trp_minted_1")).is_err());
    }

    #[test]
    fn missing_or_unknown_credentials_are_rejected() {
        assert!(resolve_actor_detail(&[]).is_err());
        assert!(resolve_actor_detail(&hdr("sk-not-a-real-key")).is_err());
        assert!(resolve_actor_detail(&hdr("ii:not-a-principal")).is_err());
        assert!(resolve_actor_for_call("  ", user(1)).is_err());
    }
}
