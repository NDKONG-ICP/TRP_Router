#include "pathc_parity.h"
#include "stable-diffusion.h"

#include <cstdlib>
#include <cstring>
#include <iostream>
#include <string>

static void fill_params(sd_ctx_params_t& cp, sd_img_gen_params_t& ip) {
  sd_ctx_params_init(&cp);
  sd_img_gen_params_init(&ip);
  const char* model = std::getenv("PATHC_MODEL");
  if (model == nullptr) {
    model = "models/sd_turbo-f16-q4_0.gguf";
  }
  cp.model_path = model;
  const char* taesd = std::getenv("PATHC_TAESD");
  cp.taesd_path = taesd != nullptr ? taesd : "models/taesd.safetensors";
  // CPU RNG + EPS + Euler like the canister; native host uses lazy mmap load because
  // eager_load + full CPU backend hits f32-q8_0 binary ops on this GGUF (WASM differs).
  cp.rng_type = CPU_RNG;
  cp.sampler_rng_type = CPU_RNG;
  cp.wtype = SD_TYPE_COUNT;
  cp.n_threads = 1;
  cp.enable_mmap = true;
  cp.eager_load = false;
  // Default Metal+CPU sched on macOS (full --backend cpu hits q8_0 binary-op gaps on host).
  cp.prediction = EPS_PRED;

  ip.prompt = std::getenv("PATHC_PROMPT");
  if (ip.prompt == nullptr) {
    ip.prompt = "a black raven on a branch, silhouette, minimal";
  }
  ip.negative_prompt = "";
  ip.width = static_cast<int>(std::strtoul(std::getenv("PATHC_WIDTH") ?: "16", nullptr, 10));
  ip.height = static_cast<int>(std::strtoul(std::getenv("PATHC_HEIGHT") ?: "16", nullptr, 10));
  ip.seed = static_cast<int64_t>(std::strtoull(std::getenv("PATHC_SEED") ?: "4242", nullptr, 10));
  ip.batch_count = 1;
  ip.sample_params.sample_steps = 1;
  ip.sample_params.guidance.txt_cfg = 1.0f;
  ip.sample_params.sample_method = EULER_SAMPLE_METHOD;
  ip.sample_params.scheduler = DISCRETE_SCHEDULER;
}

int main(int argc, char** argv) {
  if (argc < 2) {
    std::cerr << "Usage: pathc-parity embeds|unet\n";
    return 2;
  }
  const std::string mode = argv[1];
  sd_ctx_params_t cp{};
  sd_img_gen_params_t ip{};
  fill_params(cp, ip);

  if (mode == "embeds") {
    pathc_parity_set_session_flags(true, false);
    setenv("PATHC_PARITY_EMBEDS_ONLY", "1", 1);
  } else if (mode == "unet") {
    pathc_parity_set_session_flags(true, true);
  } else {
    std::cerr << "unknown mode: " << mode << "\n";
    return 2;
  }

  sd_ctx_t* ctx = new_sd_ctx(&cp);
  if (ctx == nullptr) {
    std::cerr << "new_sd_ctx failed\n";
    return 1;
  }

  sd_image_t* images = nullptr;
  int num = 0;
  const bool ok = generate_image(ctx, &ip, &images, &num);
  if (images != nullptr) {
    free_sd_images(images, num);
  }
  free_sd_ctx(ctx);

  if (!ok && mode == "embeds" && pathc_parity_has_blob("embeds")) {
    std::cout << "embeds captured (generate short-circuited)\n";
    return 0;
  }
  if (!ok) {
    std::cerr << "generate_image failed\n";
    return 1;
  }
  std::cout << "ok\n";
  return 0;
}
