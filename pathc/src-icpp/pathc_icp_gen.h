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

/** Resumable generate phases for step(1) (CONDITION → DENOISE → DECODE → DONE). */
enum class PathcGenPhase : uint8_t {
  Idle = 0,
  Condition = 1,
  Denoise = 2,
  Decode = 3,
  Done = 4,
};

void pathc_icp_gen_reset();
PathcGenPhase pathc_icp_gen_phase();
void pathc_icp_gen_set_phase(PathcGenPhase phase);

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
