#include "pathc_icp_gen.h"

#ifdef TRP_PATHC_ICP

#include "core/ggml_runner.h"
#include "pathc_icp_hooks.h"
#include "pathc_parity.h"
#include "conditioning/conditioner.hpp"
#include "core/tensor_ggml.hpp"
#include "pipeline/generation.h"
#include "pipeline/request.h"
#include "model/diffusion/model.hpp"

#include <optional>

namespace {

struct Stash {
  sd::pipeline::ImageGenerationLatents latents;
  sd::pipeline::ImageGenerationEmbeds embeds;
  sd::pipeline::GenerationRequest request;
  sd::pipeline::SamplePlan plan;
  RefImageParams ref_image_params;
  int64_t t0 = 0;
};

struct CondStash {
  sd::pipeline::ImageGenerationLatents latents;
  sd::pipeline::GenerationRequest request;
  sd::pipeline::SamplePlan plan;
  RefImageParams ref_image_params;
  int64_t t0 = 0;
};

struct DecodeStash {
  std::vector<sd::Tensor<float>> final_latents;
  sd::pipeline::GenerationRequest request;
  int64_t t0 = 0;
};

std::optional<Stash> g_stash;
std::optional<CondStash> g_cond_stash;
std::optional<DecodeStash> g_decode_stash;
PathcGenPhase g_phase = PathcGenPhase::Idle;
bool g_expect_partial = false;
std::optional<SDCondition> g_prompt_cond_stash;
std::optional<sd::Tensor<float>> g_pending_clip_hidden;
std::optional<sd::Tensor<float>> g_pending_unet_output;
std::optional<sd::Tensor<float>> g_pending_vae_output;
std::optional<sd::Tensor<float>> g_denoise_x_t_stash;
uint32_t g_graph_slices_phase = 0;
bool g_condition_clip_graph_finished = false;

}  // namespace

void pathc_icp_gen_abort_suspended() {
  if (GGMLRunner* runner = pathc_icp_peek_suspended_runner()) {
    runner->pathc_abort_suspended_session();
  }
  pathc_icp_clear_suspended_runner();
  pathc_icp_graph_clear_resume_force();
}

void pathc_icp_gen_reset() {
  pathc_icp_gen_abort_suspended();
  g_stash.reset();
  g_cond_stash.reset();
  g_decode_stash.reset();
  g_expect_partial = false;
  g_prompt_cond_stash.reset();
  g_pending_clip_hidden.reset();
  g_pending_unet_output.reset();
  g_pending_vae_output.reset();
  g_denoise_x_t_stash.reset();
  g_graph_slices_phase = 0;
  g_condition_clip_graph_finished = false;
  g_phase = PathcGenPhase::Idle;
}

PathcGenPhase pathc_icp_gen_phase() { return g_phase; }

void pathc_icp_gen_set_phase(PathcGenPhase phase) { g_phase = phase; }

void pathc_icp_gen_save_after_embeds(const sd::pipeline::ImageGenerationLatents& latents,
                                     const sd::pipeline::ImageGenerationEmbeds& embeds,
                                     sd::pipeline::GenerationRequest request,
                                     sd::pipeline::SamplePlan plan,
                                     RefImageParams ref_image_params,
                                     int64_t t0) {
  g_stash.emplace(Stash{
      latents,
      embeds,
      std::move(request),
      std::move(plan),
      ref_image_params,
      t0,
  });
  g_phase = PathcGenPhase::Denoise;
  g_cond_stash.reset();
  g_prompt_cond_stash.reset();
  g_condition_clip_graph_finished = false;
  pathc_icp_gen_reset_graph_slice_count();
  pathc_icp_graph_clear_resume_force();
  pathc_icp_dbg("PATHC enter Denoise (embeds stashed)\n");
  if (pathc_parity_capture_embeds()) {
    pathc_parity_capture_embeds_bundle(embeds, pathc_parity_meta_from_session(0.f));
    pathc_icp_dbg("PATHC parity: embeds blob captured\n");
  }
}

bool pathc_icp_gen_has_condition_snapshot() { return g_cond_stash.has_value(); }

void pathc_icp_gen_save_in_condition(sd::pipeline::ImageGenerationLatents latents,
                                     sd::pipeline::GenerationRequest request,
                                     sd::pipeline::SamplePlan plan,
                                     RefImageParams ref_image_params,
                                     int64_t t0) {
  g_cond_stash.emplace(CondStash{
      std::move(latents),
      std::move(request),
      std::move(plan),
      ref_image_params,
      t0,
  });
  g_phase = PathcGenPhase::Condition;
  pathc_icp_gen_reset_graph_slice_count();
}

bool pathc_icp_gen_take_condition_snapshot(
    sd::pipeline::ImageGenerationLatents& latents,
    sd::pipeline::GenerationRequest& request,
    sd::pipeline::SamplePlan& plan,
    RefImageParams& ref_image_params,
    int64_t& t0) {
  if (!g_cond_stash.has_value()) {
    return false;
  }
  latents          = std::move(g_cond_stash->latents);
  request          = std::move(g_cond_stash->request);
  plan             = std::move(g_cond_stash->plan);
  ref_image_params = g_cond_stash->ref_image_params;
  t0               = g_cond_stash->t0;
  g_cond_stash.reset();
  return true;
}

bool pathc_icp_gen_try_resume(sd::pipeline::ImageGenerationLatents& latents,
                              sd::pipeline::ImageGenerationEmbeds& embeds,
                              sd::pipeline::GenerationRequest& request,
                              sd::pipeline::SamplePlan& plan,
                              RefImageParams& ref_image_params,
                              int64_t& t0) {
  if (!g_stash.has_value()) {
    return false;
  }
  latents          = g_stash->latents;
  embeds           = g_stash->embeds;
  request          = g_stash->request;
  plan             = g_stash->plan;
  ref_image_params = g_stash->ref_image_params;
  t0               = g_stash->t0;
  return true;
}

bool pathc_icp_gen_load_condition_snapshot(
    sd::pipeline::ImageGenerationLatents& latents,
    sd::pipeline::GenerationRequest& request,
    sd::pipeline::SamplePlan& plan,
    RefImageParams& ref_image_params,
    int64_t& t0) {
  if (!g_cond_stash.has_value()) {
    return false;
  }
  latents          = g_cond_stash->latents;
  request          = g_cond_stash->request;
  plan             = g_cond_stash->plan;
  ref_image_params = g_cond_stash->ref_image_params;
  t0               = g_cond_stash->t0;
  return true;
}

bool pathc_icp_gen_save_decode_stash(
    const std::vector<sd::Tensor<float>>& final_latents,
    const sd::pipeline::GenerationRequest& request,
    int64_t t0) {
  g_decode_stash.emplace(DecodeStash{final_latents, request, t0});
  g_stash.reset();
  g_phase = PathcGenPhase::Decode;
  pathc_icp_gen_reset_graph_slice_count();
  pathc_icp_graph_clear_resume_force();
  pathc_icp_dbg("PATHC enter Decode (latents stashed)\n");
  return true;
}

bool pathc_icp_gen_load_decode_stash(
    sd::pipeline::GenerationRequest& request,
    std::vector<sd::Tensor<float>>& final_latents,
    int64_t& t0) {
  if (!g_decode_stash.has_value()) {
    return false;
  }
  request       = g_decode_stash->request;
  final_latents = g_decode_stash->final_latents;
  t0            = g_decode_stash->t0;
  return true;
}

void pathc_icp_gen_clear_decode_stash() { g_decode_stash.reset(); }

void pathc_icp_gen_set_expect_partial(bool expect) { g_expect_partial = expect; }

bool pathc_icp_gen_expect_partial_return() { return g_expect_partial; }

void pathc_icp_gen_clear_expect_partial() { g_expect_partial = false; }

void pathc_icp_gen_stash_prompt_cond(SDCondition cond) {
  g_prompt_cond_stash.emplace(std::move(cond));
}

bool pathc_icp_gen_has_stashed_prompt_cond() {
  return g_prompt_cond_stash.has_value();
}

bool pathc_icp_gen_load_stashed_prompt_cond(SDCondition& cond) {
  if (!g_prompt_cond_stash.has_value()) {
    return false;
  }
  cond = *g_prompt_cond_stash;
  return true;
}

bool pathc_icp_gen_stash_pending_clip_hidden(sd::Tensor<float> tensor) {
  if (tensor.empty()) {
    return false;
  }
  g_pending_clip_hidden.emplace(std::move(tensor));
  return true;
}

bool pathc_icp_gen_has_pending_clip_hidden() {
  return g_pending_clip_hidden.has_value();
}

bool pathc_icp_gen_take_pending_clip_hidden(sd::Tensor<float>& tensor) {
  if (!g_pending_clip_hidden.has_value()) {
    return false;
  }
  tensor = std::move(*g_pending_clip_hidden);
  g_pending_clip_hidden.reset();
  return true;
}

bool pathc_icp_gen_stash_pending_unet_output(sd::Tensor<float> tensor) {
  if (tensor.empty()) {
    return false;
  }
  g_pending_unet_output.emplace(std::move(tensor));
  return true;
}

bool pathc_icp_gen_has_pending_unet_output() {
  return g_pending_unet_output.has_value();
}

bool pathc_icp_gen_take_pending_unet_output(sd::Tensor<float>& tensor) {
  if (!g_pending_unet_output.has_value()) {
    return false;
  }
  tensor = std::move(*g_pending_unet_output);
  g_pending_unet_output.reset();
  return true;
}

bool pathc_icp_gen_stash_pending_vae_output(sd::Tensor<float> tensor) {
  if (tensor.empty()) {
    return false;
  }
  g_pending_vae_output.emplace(std::move(tensor));
  return true;
}

bool pathc_icp_gen_has_pending_vae_output() {
  return g_pending_vae_output.has_value();
}

bool pathc_icp_gen_take_pending_vae_output(sd::Tensor<float>& tensor) {
  if (!g_pending_vae_output.has_value()) {
    return false;
  }
  tensor = std::move(*g_pending_vae_output);
  g_pending_vae_output.reset();
  return true;
}

void pathc_icp_gen_save_denoise_x_t(sd::Tensor<float> x_t) {
  if (!x_t.empty()) {
    g_denoise_x_t_stash.emplace(std::move(x_t));
  }
}

bool pathc_icp_gen_take_denoise_x_t(sd::Tensor<float>& x_t) {
  if (!g_denoise_x_t_stash.has_value()) {
    return false;
  }
  x_t = std::move(*g_denoise_x_t_stash);
  g_denoise_x_t_stash.reset();
  return true;
}

void pathc_icp_gen_clear_denoise_x_t() { g_denoise_x_t_stash.reset(); }

uint32_t pathc_icp_gen_graph_slices_this_phase() { return g_graph_slices_phase; }

void pathc_icp_gen_reset_graph_slice_count() { g_graph_slices_phase = 0; }

void pathc_icp_gen_inc_graph_slice_count() { g_graph_slices_phase++; }

void pathc_icp_gen_set_condition_clip_graph_finished(bool finished) {
  g_condition_clip_graph_finished = finished;
}

bool pathc_icp_gen_condition_clip_graph_finished() {
  return g_condition_clip_graph_finished;
}

void pathc_icp_gen_clear_condition_clip_graph_finished() {
  g_condition_clip_graph_finished = false;
}

bool pathc_icp_gen_phase_output_already_pending() {
  switch (g_phase) {
    case PathcGenPhase::Condition:
      return g_pending_clip_hidden.has_value();
    case PathcGenPhase::Denoise:
      return g_pending_unet_output.has_value();
    case PathcGenPhase::Decode:
      return g_pending_vae_output.has_value();
    default:
      return false;
  }
}

#endif
