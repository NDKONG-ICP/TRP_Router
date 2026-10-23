#include "pathc_parity.h"

#include "conditioning/conditioner.hpp"
#include "core/tensor.hpp"
#include "pipeline/generation.h"

#ifdef TRP_PATHC_ICP
#include "pathc_internal.h"
#endif

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <sstream>

namespace {

struct ParityState {
  bool capture_embeds = false;
  bool capture_unet = false;
  std::vector<uint8_t> embeds;
  std::vector<uint8_t> unet;
  int last_resume_node = -1;
  int trap_node = -1;
  uint64_t trap_instr = 0;
};

ParityState g_parity;

void append_u32(std::vector<uint8_t>& out, uint32_t v) {
  out.push_back(static_cast<uint8_t>(v & 0xff));
  out.push_back(static_cast<uint8_t>((v >> 8) & 0xff));
  out.push_back(static_cast<uint8_t>((v >> 16) & 0xff));
  out.push_back(static_cast<uint8_t>((v >> 24) & 0xff));
}

void append_u64(std::vector<uint8_t>& out, uint64_t v) {
  for (int i = 0; i < 8; ++i) {
    out.push_back(static_cast<uint8_t>((v >> (8 * i)) & 0xff));
  }
}

void append_i64(std::vector<uint8_t>& out, int64_t v) {
  append_u64(out, static_cast<uint64_t>(v));
}

void append_f32(std::vector<uint8_t>& out, float v) {
  uint32_t bits = 0;
  static_assert(sizeof(bits) == sizeof(v));
  std::memcpy(&bits, &v, sizeof(v));
  append_u32(out, bits);
}

void append_bytes(std::vector<uint8_t>& out, const void* data, size_t n) {
  const auto* p = static_cast<const uint8_t*>(data);
  out.insert(out.end(), p, p + n);
}

void finalize_container(std::vector<uint8_t>& out) {
  if (out.size() < 16) {
    return;
  }
  const uint32_t count = *reinterpret_cast<uint32_t*>(&out[12]);
  (void)count;
}

}  // namespace

void pathc_parity_reset() {
  g_parity = ParityState{};
}

bool pathc_parity_enabled() {
  return g_parity.capture_embeds || g_parity.capture_unet;
}

bool pathc_parity_capture_embeds() { return g_parity.capture_embeds; }
bool pathc_parity_capture_unet() { return g_parity.capture_unet; }

void pathc_parity_set_session_flags(bool capture_embeds, bool capture_unet) {
  g_parity.capture_embeds = capture_embeds;
  g_parity.capture_unet = capture_unet;
}

PathcParityMeta pathc_parity_meta_from_session(float sigma0) {
  PathcParityMeta meta{};
#ifdef TRP_PATHC_ICP
  meta.seed = g_session.seed;
  meta.width = g_session.width;
  meta.height = g_session.height;
  meta.sigma0 = sigma0;
  meta.cfg = 1.f;
  meta.prediction_eps = g_session.v_prediction ? 0u : 1u;
  meta.euler_ancestral = g_session.euler_ancestral ? 1u : 0u;
  std::strncpy(meta.model_sha256,
               "9ff4ce3072d47865547898947f2b4627e6153b933cca0bcb7a3c18dc614be2a5",
               sizeof(meta.model_sha256) - 1);
  meta.prompt_hash[0] = '\0';
  const std::vector<uint8_t> prompt_bytes(g_session.prompt.begin(), g_session.prompt.end());
  const std::string ph = pathc_sha256_hex(prompt_bytes);
  std::strncpy(meta.prompt_hash, ph.c_str(), sizeof(meta.prompt_hash) - 1);
#else
  (void)sigma0;
#endif
  return meta;
}

#if defined(TRP_PATHC_PARITY)
PathcParityMeta pathc_parity_meta_from_env(float sigma0) {
  PathcParityMeta meta{};
  const char* seed_env = std::getenv("PATHC_SEED");
  const char* w_env = std::getenv("PATHC_WIDTH");
  const char* h_env = std::getenv("PATHC_HEIGHT");
  meta.seed = seed_env != nullptr ? std::strtoull(seed_env, nullptr, 10) : 4242ULL;
  meta.width = w_env != nullptr ? static_cast<uint32_t>(std::strtoul(w_env, nullptr, 10)) : 16U;
  meta.height = h_env != nullptr ? static_cast<uint32_t>(std::strtoul(h_env, nullptr, 10)) : 16U;
  meta.sigma0 = sigma0;
  meta.cfg = 1.f;
  meta.prediction_eps = 1u;
  meta.euler_ancestral = 0u;
  const char* model_sha = std::getenv("PATHC_MODEL_SHA256");
  std::strncpy(meta.model_sha256,
               model_sha != nullptr
                   ? model_sha
                   : "9ff4ce3072d47865547898947f2b4627e6153b933cca0bcb7a3c18dc614be2a5",
               sizeof(meta.model_sha256) - 1);
  const char* prompt = std::getenv("PATHC_PROMPT");
  if (prompt != nullptr) {
    const std::vector<uint8_t> prompt_bytes(prompt, prompt + std::strlen(prompt));
#ifdef TRP_PATHC_ICP
    const std::string ph = pathc_sha256_hex(prompt_bytes);
#else
    std::string ph;
    for (unsigned char c : prompt_bytes) {
      char buf[3];
      std::snprintf(buf, sizeof(buf), "%02x", c);
      ph += buf;
    }
#endif
    std::strncpy(meta.prompt_hash, ph.c_str(), sizeof(meta.prompt_hash) - 1);
  }
  return meta;
}
#endif

void pathc_parity_note_resume_node(int node) { g_parity.last_resume_node = node; }

void pathc_parity_note_trap(int node, uint64_t instr) {
  g_parity.trap_node = node;
  g_parity.trap_instr = instr;
}

int pathc_parity_last_resume_node() { return g_parity.last_resume_node; }
int pathc_parity_trap_node() { return g_parity.trap_node; }
uint64_t pathc_parity_trap_instr() { return g_parity.trap_instr; }

bool pathc_parity_has_blob(const std::string& which) {
  if (which == "embeds") {
    return !g_parity.embeds.empty();
  }
  if (which == "unet") {
    return !g_parity.unet.empty();
  }
  return false;
}

const std::vector<uint8_t>& pathc_parity_blob(const std::string& which) {
  static const std::vector<uint8_t> empty;
  if (which == "embeds") {
    return g_parity.embeds;
  }
  if (which == "unet") {
    return g_parity.unet;
  }
  return empty;
}

std::string pathc_parity_blob_sha256(const std::string& which) {
#ifdef TRP_PATHC_ICP
  return pathc_sha256_hex(pathc_parity_blob(which));
#else
  (void)which;
  return {};
#endif
}

void pathc_parity_store_blob(std::string which, std::vector<uint8_t> data) {
  if (which == "embeds") {
    g_parity.embeds = std::move(data);
  } else if (which == "unet") {
    g_parity.unet = std::move(data);
  }
}

void pathc_parity_append_tensor(std::vector<uint8_t>& out, PathcParityStage stage,
                                const sd::Tensor<float>& tensor) {
  if (tensor.empty()) {
    return;
  }
  const auto& shape = tensor.shape();
  append_u32(out, static_cast<uint32_t>(stage));
  const uint32_t ndim = static_cast<uint32_t>(std::min<size_t>(shape.size(), 8));
  append_u32(out, ndim);
  for (uint32_t i = 0; i < 8; ++i) {
    append_i64(out, i < ndim ? shape[i] : 1);
  }
  const auto& values = tensor.values();
  append_u32(out, static_cast<uint32_t>(values.size() * sizeof(float)));
  append_bytes(out, values.data(), values.size() * sizeof(float));
}

void pathc_parity_append_meta(std::vector<uint8_t>& out, const PathcParityMeta& meta) {
  append_u32(out, PATHC_PARITY_META);
  append_u32(out, 0);
  for (int i = 0; i < 8; ++i) {
    append_i64(out, 0);
  }
  std::ostringstream oss;
  oss << "seed=" << meta.seed << "\n"
      << "width=" << meta.width << "\n"
      << "height=" << meta.height << "\n"
      << "sigma0=" << meta.sigma0 << "\n"
      << "cfg=" << meta.cfg << "\n"
      << "prediction_eps=" << meta.prediction_eps << "\n"
      << "euler_ancestral=" << meta.euler_ancestral << "\n"
      << "model_sha256=" << meta.model_sha256 << "\n"
      << "prompt_hash=" << meta.prompt_hash << "\n";
  const std::string text = oss.str();
  append_u32(out, static_cast<uint32_t>(text.size()));
  append_bytes(out, text.data(), text.size());
}

void pathc_parity_append_condition(std::vector<uint8_t>& out, PathcParityStage cross_stage,
                                   PathcParityStage vector_stage, const SDCondition& cond) {
  pathc_parity_append_tensor(out, cross_stage, cond.c_crossattn);
  pathc_parity_append_tensor(out, vector_stage, cond.c_vector);
}

static std::vector<uint8_t> make_container_prefix(size_t record_count_placeholder) {
  std::vector<uint8_t> out;
  out.insert(out.end(), kPathcParityMagic, kPathcParityMagic + 8);
  append_u32(out, kPathcParityVersion);
  append_u32(out, static_cast<uint32_t>(record_count_placeholder));
  return out;
}

static void patch_record_count(std::vector<uint8_t>& out, uint32_t count) {
  if (out.size() >= 16) {
    std::memcpy(out.data() + 12, &count, sizeof(count));
  }
}

void pathc_parity_capture_embeds_bundle(const sd::pipeline::ImageGenerationEmbeds& embeds,
                                        const PathcParityMeta& meta) {
  std::vector<uint8_t> body;
  uint32_t records = 0;
  pathc_parity_append_meta(body, meta);
  ++records;
  if (!embeds.cond.c_crossattn.empty()) {
    pathc_parity_append_tensor(body, PATHC_PARITY_COND_CROSS, embeds.cond.c_crossattn);
    ++records;
  }
  if (!embeds.cond.c_vector.empty()) {
    pathc_parity_append_tensor(body, PATHC_PARITY_COND_VECTOR, embeds.cond.c_vector);
    ++records;
  }
  if (!embeds.uncond.c_crossattn.empty()) {
    pathc_parity_append_tensor(body, PATHC_PARITY_UNCOND_CROSS, embeds.uncond.c_crossattn);
    ++records;
  }
  if (!embeds.uncond.c_vector.empty()) {
    pathc_parity_append_tensor(body, PATHC_PARITY_UNCOND_VECTOR, embeds.uncond.c_vector);
    ++records;
  }
  std::vector<uint8_t> out = make_container_prefix(records);
  out.insert(out.end(), body.begin(), body.end());
  patch_record_count(out, records);
  pathc_parity_store_blob("embeds", std::move(out));
#ifdef TRP_PATHC_PARITY
  const char* path = std::getenv("PATHC_PARITY_EMBEDS_OUT");
  if (path != nullptr && path[0] != '\0') {
    pathc_parity_write_file_or_store(path, "embeds", pathc_parity_blob("embeds"));
  }
#endif
}

void pathc_parity_capture_unet_bundle(const sd::Tensor<float>& x_t, float sigma0,
                                      const sd::Tensor<float>& unet_cond,
                                      const sd::Tensor<float>& unet_uncond,
                                      const PathcParityMeta& meta) {
  PathcParityMeta m = meta;
  m.sigma0 = sigma0;
  std::vector<uint8_t> body;
  uint32_t records = 0;
  pathc_parity_append_meta(body, m);
  ++records;
  if (!x_t.empty()) {
    pathc_parity_append_tensor(body, PATHC_PARITY_X_T, x_t);
    ++records;
  }
  {
    sd::Tensor<float> sigma_tensor({1}, std::vector<float>{sigma0});
    pathc_parity_append_tensor(body, PATHC_PARITY_SIGMA0, sigma_tensor);
    ++records;
  }
  if (!unet_cond.empty()) {
    pathc_parity_append_tensor(body, PATHC_PARITY_UNET_COND, unet_cond);
    ++records;
  }
  if (!unet_uncond.empty()) {
    pathc_parity_append_tensor(body, PATHC_PARITY_UNET_UNCOND, unet_uncond);
    ++records;
  }
  std::vector<uint8_t> out = make_container_prefix(records);
  out.insert(out.end(), body.begin(), body.end());
  patch_record_count(out, records);
  pathc_parity_store_blob("unet", std::move(out));
#ifdef TRP_PATHC_PARITY
  const char* path = std::getenv("PATHC_PARITY_UNET_OUT");
  if (path != nullptr && path[0] != '\0') {
    pathc_parity_write_file_or_store(path, "unet", pathc_parity_blob("unet"));
  }
#endif
}

#ifdef TRP_PATHC_PARITY
void pathc_parity_write_file_or_store(const char* path, const std::string& which,
                                      std::vector<uint8_t> data) {
  (void)which;
  FILE* f = std::fopen(path, "wb");
  if (f == nullptr) {
    return;
  }
  if (!data.empty()) {
    std::fwrite(data.data(), 1, data.size(), f);
  }
  std::fclose(f);
}
#endif
