#include "pathc_internal.h"

#include <string>

static void wire_status(IC_API &ic_api, const char *phase, const char *msg,
                        bool wasm_linked) {
  CandidTypeRecord r;
  r.append("phase", CandidTypeVariant{phase, CandidTypeNull{}});
  r.append("message", CandidTypeText{std::string(msg)});
  r.append("sd_cpp_commit", CandidTypeText{std::string(kSdCppCommit)});
  std::string model_sha =
      "d50be7655f0a554cf8041c145d88b210bd5f3c545423119dee62ae08cae51580";
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
  ic_api.from_wire(in);

  g_session = s;
  g_session.active = true;
  g_generated = false;
  g_png.clear();
  g_timings.clear();

  ic_api.to_wire(CandidTypeVariant{"ok", CandidTypeNat64{0}});
}

void step() {
  IC_API ic_api(CanisterUpdate{std::string(__func__)}, false);
  uint32_t step_index = 0;
  CandidTypeNat32 in{&step_index};
  ic_api.from_wire(in);

  const uint64_t t0 = pathc_now_ms();
  const uint64_t i0 = pathc_instr_start();

  std::string err;
  if (step_index == 0) {
    if (!pathc_run_generate(err)) {
      ic_api.to_wire(CandidTypeVariant{"err", CandidTypeText{err}});
      return;
    }
  }

  CandidTypeRecord ok;
  ok.append("step_index", CandidTypeNat32{step_index});
  ok.append("instructions", CandidTypeNat64{pathc_instr_delta(i0)});
  ok.append("wall_ms", CandidTypeNat64{pathc_now_ms() - t0});
  ic_api.to_wire(CandidTypeVariant{"ok", CandidTypeRecord{ok}});
}

void finish() {
  IC_API ic_api(CanisterUpdate{std::string(__func__)}, false);
  std::string err;
  if (!pathc_run_generate(err)) {
    ic_api.to_wire(CandidTypeVariant{"err", CandidTypeText{err}});
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
