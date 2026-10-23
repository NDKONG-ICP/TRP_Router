#pragma once

#include <cstdint>

#ifdef TRP_PATHC_ICP

namespace sd::pipeline {
struct ImageGenerationLatents;
struct ImageGenerationEmbeds;
struct GenerationRequest;
struct SamplePlan;
}  // namespace sd::pipeline

struct RefImageParams;

void pathc_icp_gen_reset();
bool pathc_icp_gen_try_resume(sd::pipeline::ImageGenerationLatents& latents,
                              sd::pipeline::ImageGenerationEmbeds& embeds,
                              sd::pipeline::GenerationRequest& request,
                              sd::pipeline::SamplePlan& plan,
                              RefImageParams& ref_image_params,
                              int64_t& t0);
void pathc_icp_gen_save_after_embeds(sd::pipeline::ImageGenerationLatents latents,
                                     sd::pipeline::ImageGenerationEmbeds embeds,
                                     sd::pipeline::GenerationRequest request,
                                     sd::pipeline::SamplePlan plan,
                                     RefImageParams ref_image_params,
                                     int64_t t0);

#else

inline void pathc_icp_gen_reset() {}

#endif
