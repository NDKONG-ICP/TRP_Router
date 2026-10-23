#include "diffusion_canister.h"
#include "pathc_internal.h"
#include "pathc_icp_gen.h"
#include "pathc_icp_hooks.h"
#include "pathc_parity.h"
#include <cstdint>
#include <cstring>
#include <fstream>
#include <limits>

#include <sys/stat.h>

#include "ic0.h"

#ifdef TRP_PATHC_ICP
#include "ggml.h"

static void pathc_ggml_abort_hook(const char *message) {
  pathc_icp_dbg("GGML_ABORT: ");
  if (message != nullptr) {
    pathc_icp_dbg(message);
  }
  pathc_icp_dbg("\n");
  pathc_parity_note_trap(pathc_icp_graph_resume_node(nullptr),
                          pathc_icp_instr_this_call());
}

static const bool pathc_ggml_abort_registered = []() {
  ggml_set_abort_callback(pathc_ggml_abort_hook);
  return true;
}();
#endif

#define STB_IMAGE_WRITE_IMPLEMENTATION
#include "stb_image_write.h"

uint64_t g_weights_bytes = 0;
uint64_t g_taesd_bytes = 0;
sd_ctx_t *g_sd_ctx = nullptr;
Session g_session{};
std::vector<StageTiming> g_timings;
std::vector<uint8_t> g_png;

bool g_generated = false;
bool g_generate_done = false;
static uint32_t g_generate_update_calls = 0;
bool g_pathc_resume_load = false;

#ifdef TRP_PATHC_ICP
bool pathc_icp_force_v_prediction() { return g_session.v_prediction; }
#endif
static bool g_sd_load_complete = false;
static uint32_t g_load_update_calls = 0;

void pathc_refresh_vfs_sizes() {
  struct stat st {};
  if (stat(kModelGgufPath, &st) == 0) {
    g_weights_bytes = static_cast<uint64_t>(st.st_size);
  }
  if (stat(kTaesdPath, &st) == 0) {
    g_taesd_bytes = static_cast<uint64_t>(st.st_size);
  }
}

void pathc_apply_session_debug() {
#ifdef TRP_PATHC_ICP
  static bool last_v_prediction = false;
  if (g_sd_ctx != nullptr && g_session.v_prediction != last_v_prediction) {
    pathc_sd_invalidate_denoiser(g_sd_ctx);
    last_v_prediction = g_session.v_prediction;
  }
#endif
}

void pathc_on_begin() {
  // Keep partial or complete sd_ctx across begin(); step(0) resumes load.
  g_generated = false;
  g_generate_done = false;
#ifdef TRP_PATHC_ICP
  pathc_icp_gen_reset();
  pathc_icp_graph_clear_resume();
  pathc_parity_reset();
  pathc_parity_set_session_flags(g_session.parity_embeds, g_session.parity_unet);
#endif
}

uint64_t pathc_now_ms() { return static_cast<uint64_t>(ic0_time() / 1'000'000); }

uint64_t pathc_instr_start() {
  return IC_API::performance_counter(
      IC_API::PerformanceCounterType::Instructions);
}

uint64_t pathc_instr_delta(uint64_t start) {
  return IC_API::performance_counter(
             IC_API::PerformanceCounterType::Instructions) -
         start;
}

void pathc_push_timing(const std::string &stage, uint64_t instr,
                       uint32_t calls, uint64_t wall_ms) {
  g_timings.push_back({stage, instr, calls, wall_ms});
}

static void png_write_cb(void *context, void *data, int size) {
  auto *out = static_cast<std::vector<uint8_t> *>(context);
  const auto *p = static_cast<const uint8_t *>(data);
  out->insert(out->end(), p, p + size);
}

std::string pathc_sha256_hex(const std::vector<uint8_t> &data) {
  (void)data;
  return "pending";
}

static void pathc_fill_sd_params(sd_ctx_params_t &params) {
  sd_ctx_params_init(&params);
  params.model_path = kModelGgufPath;
  if (g_taesd_bytes > 0) {
    params.taesd_path = kTaesdPath;
  }
  params.n_threads = 1;
  params.rng_type = CPU_RNG;
  params.sampler_rng_type = CPU_RNG;
  params.enable_mmap = false;
  params.eager_load = true;
  params.disable_prefetch = true;
  params.wtype = SD_TYPE_COUNT;
}

bool pathc_ensure_sd_ctx(std::string &err) {
  if (g_sd_ctx != nullptr && g_sd_load_complete) {
    return true;
  }
  err = "model load incomplete — call step(0) until load_done";
  return false;
}

bool pathc_step_load_model(std::string &err, bool &load_done,
                           uint32_t &tensors_this_call,
                           uint32_t &tensors_loaded_total,
                           uint32_t &tensors_total) {
  tensors_this_call = 0;
  tensors_loaded_total = 0;
  tensors_total = 0;
  load_done = false;

  pathc_refresh_vfs_sizes();
  if (g_weights_bytes == 0) {
    err = "model weights not uploaded";
    return false;
  }

  if (g_sd_load_complete && g_sd_ctx != nullptr) {
    load_done = true;
    return true;
  }

  pathc_icp_reset_call();
  pathc_icp_dbgf("PATHC step_load call=%u resume=%d\n", g_load_update_calls + 1,
                  g_pathc_resume_load ? 1 : 0);
  const uint64_t t0 = pathc_now_ms();
  const uint64_t i0 = pathc_instr_start();
  uint32_t loaded_before = 0;
  uint32_t total_before = 0;
  if (g_sd_ctx != nullptr) {
    pathc_sd_ctx_weight_stats(g_sd_ctx, &total_before, &loaded_before);
  }

  if (g_sd_ctx == nullptr) {
    pathc_icp_reset_tensors_loaded();
    pathc_icp_reset_param_load_progress();
    g_sd_ctx = pathc_sd_ctx_alloc_shell();
    if (g_sd_ctx == nullptr) {
      err = "pathc_sd_ctx_alloc_shell failed";
      return false;
    }
  }

  sd_ctx_params_t params;
  pathc_fill_sd_params(params);

#ifdef TRP_PATHC_ICP
  try {
    const bool load_ok =
        (g_pathc_resume_load && g_sd_ctx != nullptr)
            ? pathc_sd_ctx_continue_load(g_sd_ctx)
            : pathc_sd_ctx_step_init(g_sd_ctx, &params);
    if (!load_ok) {
      if (!pathc_icp_load_pause_requested()) {
        free_sd_ctx(g_sd_ctx);
        g_sd_ctx = nullptr;
        g_pathc_resume_load = false;
        pathc_icp_reset_param_load_progress();
      }
      const char *detail = pathc_icp_last_load_error();
      err = detail != nullptr ? detail : "pathc_sd_ctx load step failed";
      return false;
    }
  } catch (const std::exception &e) {
    err = e.what();
    return false;
  }
  if (pathc_sd_ctx_load_complete(g_sd_ctx)) {
    g_sd_load_complete = true;
    g_pathc_resume_load = false;
    load_done = true;
  } else {
    g_pathc_resume_load = true;
  }
#else
  if (!pathc_sd_ctx_step_init(g_sd_ctx, &params)) {
    err = "new_sd_ctx failed";
    return false;
  }
  g_sd_load_complete = true;
  load_done = true;
#endif

  if (g_sd_ctx != nullptr) {
    pathc_sd_ctx_weight_stats(g_sd_ctx, &tensors_total, &tensors_loaded_total);
  }
  if (tensors_loaded_total >= loaded_before) {
    tensors_this_call = tensors_loaded_total - loaded_before;
  } else {
    tensors_this_call = pathc_icp_tensors_loaded_count();
  }
  g_load_update_calls++;
  const uint64_t instr = pathc_instr_delta(i0);
  uint64_t wall = pathc_now_ms() - t0;
  if (wall == 0) {
    wall = 1;
  }
  pathc_push_timing(load_done ? "load_model_done" : "load_model_partial", instr,
                    1, wall);
  return true;
}

bool pathc_run_generate(std::string &err, bool &generate_done) {
  generate_done = g_generate_done;
  if (!g_session.active) {
    err = "call begin first";
    return false;
  }
  if (g_generate_done) {
    return true;
  }

  std::string load_err;
  if (!pathc_ensure_sd_ctx(load_err)) {
    err = load_err;
    return false;
  }

#ifdef TRP_PATHC_ICP
  {
    sd_ctx_params_t params;
    pathc_fill_sd_params(params);
    if (!pathc_sd_ctx_finish_init(g_sd_ctx, &params)) {
      err = "pathc_sd_ctx_finish_init failed";
      return false;
    }
    if (!pathc_sd_ctx_load_complete(g_sd_ctx)) {
      generate_done = false;
      return true;
    }
  }
  const uint64_t infer_budget = g_session.full_graph
                                    ? std::numeric_limits<uint64_t>::max()
                                    : kPathcInferInstrBudget;
  pathc_icp_reset_call(infer_budget);
  pathc_icp_clear_infer_pause();
  if (g_session.full_graph) {
    sd_set_backend_eval_callback(nullptr, nullptr);
    pathc_icp_dbg("PATHC full_graph: eval callback disabled\n");
  } else {
    sd_set_backend_eval_callback(pathc_icp_graph_eval_callback, nullptr);
  }
  if (pathc_icp_gen_phase() == PathcGenPhase::Idle) {
    pathc_icp_gen_reset_graph_slice_count();
  }
#endif

  const uint64_t t_gen = pathc_now_ms();
  const uint64_t i_gen = pathc_instr_start();
  g_generate_update_calls++;

  sd_img_gen_params_t iparams;
  sd_img_gen_params_init(&iparams);
  iparams.prompt = g_session.prompt.c_str();
  iparams.negative_prompt = "";
  iparams.width = static_cast<int>(g_session.width);
  iparams.height = static_cast<int>(g_session.height);
  iparams.seed = static_cast<int64_t>(g_session.seed);
  iparams.batch_count = 1;
  iparams.sample_params.sample_steps = static_cast<int>(g_session.steps);
  iparams.sample_params.guidance.txt_cfg = 1.0f;
  iparams.sample_params.sample_method =
      g_session.euler_ancestral ? EULER_A_SAMPLE_METHOD : EULER_SAMPLE_METHOD;
  iparams.sample_params.scheduler = DISCRETE_SCHEDULER;

  sd_image_t *images = nullptr;
  int num_images = 0;

#ifdef TRP_PATHC_ICP
  pathc_icp_dbgf("PATHC generate_image %dx%d seed=%lld\n", iparams.width,
                  iparams.height, static_cast<long long>(iparams.seed));
#endif
  const bool ok =
#ifdef TRP_PATHC_ICP
      pathc_generate_image_step(g_sd_ctx, &iparams, &images, &num_images);
#else
      generate_image(g_sd_ctx, &iparams, &images, &num_images);
#endif
#ifdef TRP_PATHC_ICP
  pathc_icp_dbgf("PATHC generate_image ok=%d num=%d\n", ok ? 1 : 0, num_images);
#endif

  const uint64_t gen_wall = pathc_now_ms() - t_gen;
  const uint64_t gen_instr = pathc_instr_delta(i_gen);

#ifdef TRP_PATHC_ICP
  sd_set_backend_eval_callback(nullptr, nullptr);
#endif

  if (!ok || num_images < 1 || images == nullptr) {
#ifdef TRP_PATHC_ICP
    // (a) mid-graph suspend, or (b) phase handoff (Condition→Denoise→Decode)
    if (pathc_icp_mid_graph_suspend() ||
        pathc_icp_gen_expect_partial_return()) {
      pathc_icp_clear_infer_pause();
      pathc_icp_gen_clear_expect_partial();
      const uint32_t slices = pathc_icp_gen_graph_slices_this_phase();
      const char* phase = "unknown";
      switch (pathc_icp_gen_phase()) {
        case PathcGenPhase::Condition:
          phase = "condition";
          break;
        case PathcGenPhase::Denoise:
          phase = "denoise";
          break;
        case PathcGenPhase::Decode:
          phase = "decode";
          break;
        default:
          break;
      }
      pathc_icp_dbgf("PATHC partial return phase=%s slices=%u instr=%llu\n", phase,
                      slices, static_cast<unsigned long long>(gen_instr));
      pathc_push_timing(std::string("generate_partial_") + phase, gen_instr, slices,
                        gen_wall);
      pathc_icp_gen_reset_graph_slice_count();
      generate_done = false;
      return true;
    }
#endif
    err = "generate_image failed";
    return false;
  }

  pathc_push_timing("clip+denoise+taesd", gen_instr, 1, gen_wall);

  g_png.clear();
  const sd_image_t &img = images[0];
  const uint64_t t_png = pathc_instr_start();
  if (!stbi_write_png_to_func(png_write_cb, &g_png, img.width, img.height,
                              img.channel, img.data, img.width * img.channel)) {
    err = "png encode failed";
    return false;
  }
  pathc_push_timing("png_encode", pathc_instr_delta(t_png), 1, 0);

  free_sd_images(images, num_images);
  g_generated = true;
  g_generate_done = true;
  generate_done = true;
  return true;
}
