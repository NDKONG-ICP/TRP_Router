//! IC HTTP outcall transform — strip volatile headers so replicas reach consensus.
use candid::CandidType;
use ic_cdk::query;
use serde::Deserialize;

#[derive(CandidType, Clone, Debug, Deserialize)]
pub struct HttpHeader {
    pub name: String,
    pub value: String,
}

#[derive(CandidType, Clone, Debug, Deserialize)]
pub struct HttpResponse {
    pub status: candid::Nat,
    pub headers: Vec<HttpHeader>,
    #[serde(with = "serde_bytes")]
    pub body: Vec<u8>,
}

#[derive(CandidType, Clone, Debug, Deserialize)]
pub struct TransformArgs {
    pub response: HttpResponse,
    #[serde(with = "serde_bytes")]
    pub context: Vec<u8>,
}

#[query]
fn transform(args: TransformArgs) -> HttpResponse {
    HttpResponse {
        status: args.response.status,
        body: args.response.body,
        headers: vec![],
    }
}

ic_cdk::export_candid!();
