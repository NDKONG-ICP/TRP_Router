// Ingress drain protection: reject non-owner updates before execution (no cycle burn).
#include "diffusion_canister.h"
#include "ic_api.h"
#include "canister.h"
#include "wasm_symbol.h"

#include <string>
#include <unordered_set>

namespace {

bool is_mutating_update(const std::string &method) {
  static const std::unordered_set<std::string> kMutating = {
      "begin",
      "step",
      "finish",
      "upload_weights_chunk",
      "upload_taesd_chunk",
  };
  return kMutating.find(method) != kMutating.end();
}

bool principal_bytes_equal(const CandidTypePrincipal &a,
                           const CandidTypePrincipal &b) {
  return a.get_v_bytes().vec_uint8_t() == b.get_v_bytes().vec_uint8_t();
}

bool caller_is_allowlisted(IC_API &ic_api) {
  const CandidTypePrincipal caller = ic_api.get_caller();
  if (ic_api.is_controller(caller)) {
    return true;
  }
  static const char *const kOwnerAllowlist[] = {
      // Internet Identity (owner)
      "ucw6l-apn5m-ycnrv-s7xtt-lvchu-jz5f3-3oeq7-ttuhk-rjvjp-sdnbj-lqe",
      // ic_deploy secure identity (controller)
      "xx6vh-r5j7z-ujant-uvv2w-anfdf-jtyus-2t5xx-joumb-d2j5s-haivw-tae",
      // TRP router_canister (mainnet) — orchestrates diffusion for playground/API
      "5723t-oaaaa-aaaao-bbquq-cai",
  };
  for (const char *text : kOwnerAllowlist) {
    if (principal_bytes_equal(caller, CandidTypePrincipal(text))) {
      return true;
    }
  }
  return false;
}

}  // namespace

void canister_inspect_message() {
  IC_API ic_api(CanisterInspectMessage{std::string(__func__)}, false);
  const std::string method = ic_api.get_msg_method_name();
  if (!is_mutating_update(method)) {
    ic_api.accept_message();
    return;
  }
  if (caller_is_allowlisted(ic_api)) {
    ic_api.accept_message();
  }
}
