#pragma once

#include "__mutex/once_flag.h"
#include "ic_api.h"
#include "mutex"

#include "stable-diffusion.h"

#include <cstdint>
#include <string>
#include <vector>

constexpr const char *kModelGgufPath = "model.gguf";
constexpr const char *kTaesdPath = "taesd.safetensors";
constexpr const char *kSdCppCommit =
    "a77d3623180b2bc1886f3dd04c0aa04156a987ef";

struct StageTiming {
  std::string stage;
  uint64_t instructions = 0;
  uint32_t update_calls = 0;
  uint64_t wall_ms = 0;
};

struct Session {
  std::string prompt;
  uint64_t seed = 0;
  uint32_t steps = 1;
  uint32_t height = 128;
  uint32_t width = 128;
  bool active = false;
};

extern uint64_t g_weights_bytes;
extern uint64_t g_taesd_bytes;
extern sd_ctx_t *g_sd_ctx;
extern Session g_session;
extern std::vector<StageTiming> g_timings;
extern std::vector<uint8_t> g_png;
extern bool g_generated;
extern bool g_generate_done;
extern bool g_pathc_resume_load;

uint64_t pathc_now_ms();
uint64_t pathc_instr_start();
uint64_t pathc_instr_delta(uint64_t start);
void pathc_push_timing(const std::string &stage, uint64_t instr,
                       uint32_t calls, uint64_t wall_ms);
std::string pathc_sha256_hex(const std::vector<uint8_t> &data);

void pathc_refresh_vfs_sizes();
void pathc_on_begin();
bool pathc_ensure_sd_ctx(std::string &err);
bool pathc_step_load_model(std::string &err, bool &load_done,
                           uint32_t &tensors_this_call,
                           uint32_t &tensors_loaded_total,
                           uint32_t &tensors_total);
bool pathc_run_generate(std::string &err, bool &generate_done);
