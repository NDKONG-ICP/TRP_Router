#include "pathc_icp_gen.h"

#ifdef TRP_PATHC_ICP

#include "core/ggml_runner.h"
#include "pathc_icp_hooks.h"
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

std::optional<Stash> g_stash;
std::optional<CondStash> g_cond_stash;
PathcGenPhase g_phase = PathcGenPhase::Idle;

}  // namespace

void pathc_icp_gen_abort_suspended() {
  if (GGMLRunner* runner = pathc_icp_peek_suspended_runner()) {
    runner->pathc_abort_suspended_session();
  }
  pathc_icp_clear_suspended_runner();
  pathc_icp_graph_clear_resume();
}

void pathc_icp_gen_reset() {
  pathc_icp_gen_abort_suspended();
  g_stash.reset();
  g_cond_stash.reset();
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

#endif
