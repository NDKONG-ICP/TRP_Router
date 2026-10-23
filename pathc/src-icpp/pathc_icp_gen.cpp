#include "pathc_icp_gen.h"

#ifdef TRP_PATHC_ICP

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

std::optional<Stash> g_stash;

}  // namespace

void pathc_icp_gen_reset() { g_stash.reset(); }

void pathc_icp_gen_save_after_embeds(sd::pipeline::ImageGenerationLatents latents,
                                     sd::pipeline::ImageGenerationEmbeds embeds,
                                     sd::pipeline::GenerationRequest request,
                                     sd::pipeline::SamplePlan plan,
                                     RefImageParams ref_image_params,
                                     int64_t t0) {
  g_stash.emplace(Stash{
      std::move(latents),
      std::move(embeds),
      std::move(request),
      std::move(plan),
      ref_image_params,
      t0,
  });
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
