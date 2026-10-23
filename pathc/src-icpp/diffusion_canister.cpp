#include "diffusion_canister.h"
#include "pathc_internal.h"
#include "pathc_parity.h"

#include <string>

static void wire_status(IC_API &ic_api, const char *phase, const char *msg,
                        bool wasm_linked) {
  CandidTypeRecord r;
  r.append("phase", CandidTypeVariant{phase, CandidTypeNull{}});
  r.append("message", CandidTypeText{std::string(msg)});
  r.append("sd_cpp_commit", CandidTypeText{std::string(kSdCppCommit)});
  std::string model_sha =
      "9ff4ce3072d47865547898947f2b4627e6153b933cca0bcb7a3c18dc614be2a5";
  r.append("model_sha256", CandidTypeOptText{model_sha});
  r.append("wasm_linked", CandidTypeBool{wasm_linked});
  ic_api.to_wire(r);
}

void status() {
  IC_API ic_api(CanisterQuery{std::string(__func__)}, false);
  if (g_sd_ctx != nullptr) {
    wire_status(ic_api, "c5_ready", "sd.cpp context loaded", true);
  } else if (g_weights_bytes > 0) {
    wire_status(ic_api, "c3_model_ready", "weights on VFS, ctx not loaded",
                true);
  } else {
    wire_status(ic_api, "c4_inference_pending", "awaiting GGUF upload", true);
  }
}

void begin() {
  IC_API ic_api(CanisterUpdate{std::string(__func__)}, false);
  Session s;
  CandidTypeRecord in;
  in.append("prompt", CandidTypeText{&s.prompt});
  in.append("seed", CandidTypeNat64{&s.seed});
  in.append("steps", CandidTypeNat32{&s.steps});
  in.append("height", CandidTypeNat32{&s.height});
  in.append("width", CandidTypeNat32{&s.width});
  uint32_t debug_flags = 0;
  in.append("debug_flags", CandidTypeNat32{&debug_flags});
  ic_api.from_wire(in);

  g_session = s;
  g_session.full_graph = (debug_flags & 1u) != 0;
  g_session.v_prediction = (debug_flags & 2u) != 0;
  // Default plain Euler (host parity). bit3 (8) = Euler ancestral for A/B.
  g_session.euler_ancestral = (debug_flags & 8u) != 0;
  g_session.parity_embeds = (debug_flags & 0x10000u) != 0;
  g_session.parity_unet = (debug_flags & 0x20000u) != 0;
  g_session.active = true;
  g_png.clear();
  g_timings.clear();
  pathc_apply_session_debug();
  pathc_on_begin();

  uint64_t session_id = 0;
  ic_api.to_wire(CandidTypeVariant{"ok", CandidTypeNat64{session_id}});
}

void step() {
  IC_API ic_api(CanisterUpdate{std::string(__func__)}, false);
  uint32_t step_index = 0;
  CandidTypeNat32 in{&step_index};
  ic_api.from_wire(in);

  const uint64_t t0 = pathc_now_ms();
  const uint64_t i0 = pathc_instr_start();

  std::string err;
  bool load_done = false;
  uint32_t tensors_this_call = 0;
  uint32_t tensors_loaded_total = 0;
  uint32_t tensors_total = 0;
  uint32_t gguf_tensors = 0;
  if (step_index == 0) {
    if (!pathc_step_load_model(err, load_done, tensors_this_call,
                               tensors_loaded_total, tensors_total)) {
      ic_api.to_wire(CandidTypeVariant{"err", CandidTypeText{err}});
      return;
    }
  } else if (step_index == 1) {
    bool generate_done = false;
    if (!pathc_run_generate(err, generate_done)) {
      ic_api.to_wire(CandidTypeVariant{"err", CandidTypeText{err}});
      return;
    }
    CandidTypeRecord ok;
    ok.append("step_index", CandidTypeNat32{step_index});
    ok.append("instructions", CandidTypeNat64{pathc_instr_delta(i0)});
    uint64_t wall = pathc_now_ms() - t0;
    if (wall == 0) {
      wall = 1;
    }
    ok.append("wall_ms", CandidTypeNat64{wall});
    ok.append("load_done", CandidTypeBool{true});
    ok.append("generate_done", CandidTypeBool{generate_done});
    uint32_t zero_u32 = 0;
    ok.append("tensors_this_call", CandidTypeNat32{&zero_u32});
    ok.append("tensors_loaded_total", CandidTypeNat32{&zero_u32});
    ok.append("tensors_total", CandidTypeNat32{&zero_u32});
    ok.append("gguf_tensors", CandidTypeNat32{&zero_u32});
    ok.append("bytes_loaded", CandidTypeNat64{g_weights_bytes});
    ic_api.to_wire(CandidTypeVariant{"ok", CandidTypeRecord{ok}});
    return;
  } else {
    ic_api.to_wire(CandidTypeVariant{
        "err", CandidTypeText{"only step 0 (load) and 1 (generate) supported"}});
    return;
  }

  CandidTypeRecord ok;
  ok.append("step_index", CandidTypeNat32{step_index});
  ok.append("instructions", CandidTypeNat64{pathc_instr_delta(i0)});
  uint64_t wall = pathc_now_ms() - t0;
  if (wall == 0) {
    wall = 1;
  }
  ok.append("wall_ms", CandidTypeNat64{wall});
  ok.append("load_done", CandidTypeBool{load_done});
  ok.append("generate_done", CandidTypeBool{false});
  ok.append("tensors_this_call", CandidTypeNat32{tensors_this_call});
  ok.append("tensors_loaded_total", CandidTypeNat32{tensors_loaded_total});
  ok.append("tensors_total", CandidTypeNat32{tensors_total});
  if (step_index == 0 && g_sd_ctx != nullptr) {
    gguf_tensors = pathc_sd_ctx_gguf_tensor_count(g_sd_ctx);
  }
  ok.append("gguf_tensors", CandidTypeNat32{gguf_tensors});
  ok.append("bytes_loaded", CandidTypeNat64{g_weights_bytes});
  ic_api.to_wire(CandidTypeVariant{"ok", CandidTypeRecord{ok}});
}

void finish() {
  IC_API ic_api(CanisterUpdate{std::string(__func__)}, false);
  if (!g_generate_done || g_png.empty()) {
    ic_api.to_wire(CandidTypeVariant{
        "err", CandidTypeText{"generate not complete — loop step(1) until generate_done"}});
    return;
  }

  CandidTypeRecord ok;
  ok.append("png_sha256", CandidTypeText{pathc_sha256_hex(g_png)});
  ok.append("bytes_len", CandidTypeNat64{g_png.size()});
  ic_api.to_wire(CandidTypeVariant{"ok", CandidTypeRecord{ok}});
}

void get_png() {
  IC_API ic_api(CanisterQuery{std::string(__func__)}, false);
  if (g_png.empty()) {
    ic_api.to_wire(CandidTypeVariant{
        "err", CandidTypeText{"no png — run step/finish first"}});
    return;
  }
  ic_api.to_wire(CandidTypeVariant{"ok", CandidTypeVecNat8{&g_png}});
}

void parity_status() {
  IC_API ic_api(CanisterQuery{std::string(__func__)}, false);
  CandidTypeRecord r;
  r.append("embeds_ready", CandidTypeBool{pathc_parity_has_blob("embeds")});
  r.append("unet_ready", CandidTypeBool{pathc_parity_has_blob("unet")});
  r.append("embeds_sha256", CandidTypeText{pathc_parity_blob_sha256("embeds")});
  r.append("unet_sha256", CandidTypeText{pathc_parity_blob_sha256("unet")});
  uint64_t resume_node =
      static_cast<uint64_t>(static_cast<int64_t>(pathc_parity_last_resume_node()));
  uint64_t trap_node =
      static_cast<uint64_t>(static_cast<int64_t>(pathc_parity_trap_node()));
  uint64_t trap_instr = pathc_parity_trap_instr();
  r.append("resume_node", CandidTypeNat64{&resume_node});
  r.append("trap_node", CandidTypeNat64{&trap_node});
  r.append("trap_instr", CandidTypeNat64{&trap_instr});
  ic_api.to_wire(r);
}

void get_parity_blob() {
  IC_API ic_api(CanisterQuery{std::string(__func__)}, false);
  std::string which;
  CandidTypeText in{&which};
  ic_api.from_wire(in);
  if (which != "embeds" && which != "unet") {
    ic_api.to_wire(CandidTypeVariant{
        "err", CandidTypeText{std::string("which must be 'embeds' or 'unet'")}});
    return;
  }
  if (!pathc_parity_has_blob(which)) {
    ic_api.to_wire(CandidTypeVariant{
        "err", CandidTypeText{std::string("parity blob not ready: ") + which}});
    return;
  }
  std::vector<uint8_t> blob = pathc_parity_blob(which);
  ic_api.to_wire(CandidTypeVariant{"ok", CandidTypeVecNat8{&blob}});
}

void last_timings() {
  IC_API ic_api(CanisterQuery{std::string(__func__)}, false);
  std::vector<std::string> stages;
  std::vector<uint64_t> instructions;
  std::vector<uint32_t> calls;
  std::vector<uint64_t> wall_ms;
  for (const auto &t : g_timings) {
    stages.push_back(t.stage);
    instructions.push_back(t.instructions);
    calls.push_back(t.update_calls);
    wall_ms.push_back(t.wall_ms);
  }
  CandidTypeRecord flat;
  flat.append("stage", CandidTypeVecText{&stages});
  flat.append("instructions", CandidTypeVecNat64{&instructions});
  flat.append("update_calls", CandidTypeVecNat32{&calls});
  flat.append("wall_ms", CandidTypeVecNat64{&wall_ms});
  ic_api.to_wire(flat);
}
