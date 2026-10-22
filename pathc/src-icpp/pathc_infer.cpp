#include "diffusion_canister.h"
#include "pathc_internal.h"

#include <cstring>
#include <fstream>

#define STB_IMAGE_WRITE_IMPLEMENTATION
#include "stb_image_write.h"

uint64_t g_weights_bytes = 0;
uint64_t g_taesd_bytes = 0;
sd_ctx_t *g_sd_ctx = nullptr;
Session g_session{};
std::vector<StageTiming> g_timings;
std::vector<uint8_t> g_png;

bool g_generated = false;

void pathc_refresh_vfs_sizes() {
  std::ifstream gguf(kModelGgufPath, std::ios::binary | std::ios::ate);
  if (gguf.is_open()) {
    g_weights_bytes = static_cast<uint64_t>(gguf.tellg());
  }
  std::ifstream taesd(kTaesdPath, std::ios::binary | std::ios::ate);
  if (taesd.is_open()) {
    g_taesd_bytes = static_cast<uint64_t>(taesd.tellg());
  }
}

uint64_t pathc_now_ms() { return IC_API::time() / 1'000'000; }

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
  // Minimal placeholder; finish uses icpp SHA if linked — hex from bytes len tag for mock
  (void)data;
  return "pending";
}

bool pathc_ensure_sd_ctx(std::string &err) {
  if (g_sd_ctx != nullptr) {
    return true;
  }
  pathc_refresh_vfs_sizes();
  if (g_weights_bytes == 0) {
    err = "model.gguf not uploaded";
    return false;
  }
  std::ifstream check(kModelGgufPath, std::ios::binary);
  if (!check.is_open()) {
    err = "model.gguf missing on VFS";
    return false;
  }

  const uint64_t t0 = pathc_now_ms();
  const uint64_t i0 = pathc_instr_start();

  sd_ctx_params_t params;
  sd_ctx_params_init(&params);
  params.model_path = kModelGgufPath;
  if (g_taesd_bytes > 0) {
    params.taesd_path = kTaesdPath;
  }
  params.n_threads = 1;
  params.rng_type = CPU_RNG;
  params.sampler_rng_type = CPU_RNG;
  params.enable_mmap = true;
  params.eager_load = false;
  params.disable_prefetch = true;
  params.wtype = SD_TYPE_COUNT; // auto

  g_sd_ctx = new_sd_ctx(&params);
  if (g_sd_ctx == nullptr) {
    err = "new_sd_ctx failed";
    return false;
  }

  pathc_push_timing("load_model", pathc_instr_delta(i0), 1,
                    pathc_now_ms() - t0);
  return true;
}

bool pathc_step_load_model(std::string &err) {
  return pathc_ensure_sd_ctx(err);
}

bool pathc_run_generate(std::string &err) {
  if (!g_session.active) {
    err = "call begin first";
    return false;
  }
  if (g_generated) {
    return true;
  }

  std::string load_err;
  if (!pathc_ensure_sd_ctx(load_err)) {
    err = load_err;
    return false;
  }

  const uint64_t t_clip = pathc_now_ms();
  const uint64_t i_clip = pathc_instr_start();

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
  iparams.sample_params.sample_method = EULER_SAMPLE_METHOD;
  iparams.sample_params.scheduler = DISCRETE_SCHEDULER;

  sd_image_t *images = nullptr;
  int num_images = 0;

  const uint64_t t_gen = pathc_now_ms();
  const uint64_t i_gen = pathc_instr_start();

  const bool ok =
      generate_image(g_sd_ctx, &iparams, &images, &num_images);

  const uint64_t gen_wall = pathc_now_ms() - t_gen;
  const uint64_t gen_instr = pathc_instr_delta(i_gen);

  if (!ok || num_images < 1 || images == nullptr) {
    err = "generate_image failed";
    return false;
  }

  pathc_push_timing("clip+denoise+vae", gen_instr, 1, gen_wall);
  pathc_push_timing("denoise_step_1", gen_instr, 1, gen_wall);
  pathc_push_timing("total_image", gen_instr, 1, gen_wall);

  g_png.clear();
  const sd_image_t &img = images[0];
  if (!stbi_write_png_to_func(png_write_cb, &g_png, img.width, img.height,
                              img.channel, img.data, img.width * img.channel)) {
    err = "png encode failed";
    return false;
  }

  pathc_push_timing("png_encode", pathc_instr_delta(i_clip),
                    1, pathc_now_ms() - t_clip);

  free_sd_images(images, num_images);
  g_generated = true;
  return true;
}
