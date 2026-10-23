#pragma once

#include <cstdint>
#include <string>
#include <vector>

struct SDCondition;

namespace sd {
template <typename T>
class Tensor;
namespace pipeline {
struct ImageGenerationEmbeds;
struct ImageGenerationLatents;
}  // namespace pipeline
}  // namespace sd

/** Wire record stage ids (PATHCPAR1 container). */
enum PathcParityStage : uint32_t {
  PATHC_PARITY_META = 0,
  PATHC_PARITY_COND_CROSS = 1,
  PATHC_PARITY_UNCOND_CROSS = 2,
  PATHC_PARITY_COND_VECTOR = 3,
  PATHC_PARITY_UNCOND_VECTOR = 4,
  PATHC_PARITY_X_T = 10,
  PATHC_PARITY_SIGMA0 = 11,
  PATHC_PARITY_UNET_COND = 12,
  PATHC_PARITY_UNET_UNCOND = 13,
  PATHC_PARITY_VAE_RGB = 20,
};

/** 8-byte magic + u32 version 1 == "PATHCPAR1" on disk. */
constexpr char kPathcParityMagic[8] = {'P', 'A', 'T', 'H', 'C', 'P', 'A', 'R'};
constexpr uint32_t kPathcParityVersion = 1;

struct PathcParityMeta {
  uint64_t seed = 0;
  uint32_t width = 0;
  uint32_t height = 0;
  float sigma0 = 0.f;
  float cfg = 1.f;
  uint32_t prediction_eps = 1;  // 1=eps 0=v
  uint32_t euler_ancestral = 0;
  char model_sha256[65] = {};
  char prompt_hash[65] = {};
};

void pathc_parity_reset();
bool pathc_parity_enabled();
bool pathc_parity_capture_embeds();
bool pathc_parity_capture_unet();

void pathc_parity_set_session_flags(bool capture_embeds, bool capture_unet);
PathcParityMeta pathc_parity_meta_from_session(float sigma0);
#if defined(TRP_PATHC_PARITY)
PathcParityMeta pathc_parity_meta_from_env(float sigma0);
#endif
void pathc_parity_note_resume_node(int node);
void pathc_parity_note_trap(int node, uint64_t instr);
int pathc_parity_last_resume_node();
int pathc_parity_trap_node();
uint64_t pathc_parity_trap_instr();

bool pathc_parity_has_blob(const std::string& which);
const std::vector<uint8_t>& pathc_parity_blob(const std::string& which);
std::string pathc_parity_blob_sha256(const std::string& which);

void pathc_parity_store_blob(std::string which, std::vector<uint8_t> data);

void pathc_parity_append_tensor(std::vector<uint8_t>& out, PathcParityStage stage,
                                const sd::Tensor<float>& tensor);
void pathc_parity_append_meta(std::vector<uint8_t>& out, const PathcParityMeta& meta);
void pathc_parity_append_condition(std::vector<uint8_t>& out, PathcParityStage cross_stage,
                                     PathcParityStage vector_stage, const SDCondition& cond);

void pathc_parity_capture_embeds_bundle(const sd::pipeline::ImageGenerationEmbeds& embeds,
                                        const PathcParityMeta& meta);
void pathc_parity_capture_unet_bundle(const sd::Tensor<float>& x_t, float sigma0,
                                      const sd::Tensor<float>& unet_cond,
                                      const sd::Tensor<float>& unet_uncond,
                                      const PathcParityMeta& meta);

#ifdef TRP_PATHC_PARITY
void pathc_parity_write_file_or_store(const char* path, const std::string& which,
                                      std::vector<uint8_t> data);
#endif
