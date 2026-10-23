#pragma once

#include <cstdint>
#include <vector>

#ifdef TRP_PATHC_ICP

namespace sd {
template <typename T>
class Tensor;
}

namespace sd::pipeline {
struct ImageGenerationLatents;
struct ImageGenerationEmbeds;
struct GenerationRequest;
struct SamplePlan;
}  // namespace sd::pipeline

struct SDCondition;

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
void pathc_icp_gen_save_after_embeds(const sd::pipeline::ImageGenerationLatents& latents,
                                     const sd::pipeline::ImageGenerationEmbeds& embeds,
                                     sd::pipeline::GenerationRequest request,
                                     sd::pipeline::SamplePlan plan,
                                     RefImageParams ref_image_params,
                                     int64_t t0);

bool pathc_icp_gen_has_condition_snapshot();
void pathc_icp_gen_save_in_condition(sd::pipeline::ImageGenerationLatents latents,
                                     sd::pipeline::GenerationRequest request,
                                     sd::pipeline::SamplePlan plan,
                                     RefImageParams ref_image_params,
                                     int64_t t0);
bool pathc_icp_gen_take_condition_snapshot(sd::pipeline::ImageGenerationLatents& latents,
                                           sd::pipeline::GenerationRequest& request,
                                           sd::pipeline::SamplePlan& plan,
                                           RefImageParams& ref_image_params,
                                           int64_t& t0);
/** Copy condition stash for embed work without consuming it. */
bool pathc_icp_gen_load_condition_snapshot(sd::pipeline::ImageGenerationLatents& latents,
                                           sd::pipeline::GenerationRequest& request,
                                           sd::pipeline::SamplePlan& plan,
                                           RefImageParams& ref_image_params,
                                           int64_t& t0);
bool pathc_icp_gen_save_decode_stash(const std::vector<sd::Tensor<float>>& final_latents,
                                     const sd::pipeline::GenerationRequest& request,
                                     int64_t t0);
bool pathc_icp_gen_load_decode_stash(sd::pipeline::GenerationRequest& request,
                                     std::vector<sd::Tensor<float>>& final_latents,
                                     int64_t& t0);
void pathc_icp_gen_clear_decode_stash();
void pathc_icp_gen_set_expect_partial(bool expect);
bool pathc_icp_gen_expect_partial_return();
void pathc_icp_gen_clear_expect_partial();
void pathc_icp_gen_stash_prompt_cond(SDCondition cond);
bool pathc_icp_gen_has_stashed_prompt_cond();
bool pathc_icp_gen_load_stashed_prompt_cond(SDCondition& cond);
bool pathc_icp_gen_stash_pending_clip_hidden(sd::Tensor<float> tensor);
bool pathc_icp_gen_has_pending_clip_hidden();
bool pathc_icp_gen_take_pending_clip_hidden(sd::Tensor<float>& tensor);
bool pathc_icp_gen_stash_pending_unet_output(sd::Tensor<float> tensor);
bool pathc_icp_gen_take_pending_unet_output(sd::Tensor<float>& tensor);
bool pathc_icp_gen_stash_pending_vae_output(sd::Tensor<float> tensor);
bool pathc_icp_gen_take_pending_vae_output(sd::Tensor<float>& tensor);
void pathc_icp_gen_save_denoise_x_t(sd::Tensor<float> x_t);
bool pathc_icp_gen_take_denoise_x_t(sd::Tensor<float>& x_t);
void pathc_icp_gen_clear_denoise_x_t();
uint32_t pathc_icp_gen_graph_slices_this_phase();
void pathc_icp_gen_reset_graph_slice_count();
void pathc_icp_gen_inc_graph_slice_count();
void pathc_icp_gen_abort_suspended();

/** CLIP text-encoder graph reached n_nodes (prompt forward done; finish embeds next). */
void pathc_icp_gen_set_condition_clip_graph_finished(bool finished);
bool pathc_icp_gen_condition_clip_graph_finished();
void pathc_icp_gen_clear_condition_clip_graph_finished();

#else

inline void pathc_icp_gen_reset() {}

#endif
