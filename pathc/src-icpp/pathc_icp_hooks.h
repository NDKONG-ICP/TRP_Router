#pragma once

#include <cstdint>
#include <string>

#ifdef TRP_PATHC_ICP

// Leave headroom below the 40B/update subnet cap (validation + denoiser setup).
constexpr uint64_t kPathcInstrBudget = 8'000'000'000ULL;
// Headroom below the 40B/update subnet cap for CLIP / UNet / VAE graphs.
constexpr uint64_t kPathcInferInstrBudget = 35'000'000'000ULL;

struct ggml_backend;
typedef struct ggml_backend* ggml_backend_t;

/** Resumable chunked graph execution (node cursor persisted in hooks). */
struct PathcGraphChunkState {
  bool done = false;
  int node_cursor = 0;
};

struct ggml_cgraph;
struct ggml_tensor;
class GGMLRunner;

void pathc_icp_reset_call(uint64_t budget = kPathcInstrBudget);
uint64_t pathc_icp_instr_this_call();
bool pathc_icp_budget_exceeded();
void pathc_icp_request_load_pause();
bool pathc_icp_load_pause_requested();
void pathc_icp_clear_load_pause();
uint32_t pathc_icp_tensors_loaded_count();
void pathc_icp_inc_tensors_loaded();
void pathc_icp_reset_tensors_loaded();

/** Resumable byte offset within a single param tensor (VFS → ggml buffer). */
size_t pathc_icp_param_bytes_loaded(const std::string& tensor_name);
void pathc_icp_set_param_bytes_loaded(const std::string& tensor_name, size_t bytes);
void pathc_icp_clear_param_bytes_loaded(const std::string& tensor_name);
void pathc_icp_reset_param_load_progress();
bool pathc_icp_param_load_complete(const std::string& tensor_name);
const char* pathc_icp_last_load_error();
void pathc_icp_set_load_error(const char* message);
void pathc_icp_dbg(const char* message);
void pathc_icp_dbgf(const char* fmt, ...);
void pathc_icp_mark_param_finished(const std::string& tensor_name);
bool pathc_icp_param_is_finished(const std::string& tensor_name);
void pathc_icp_clear_finished_params();

void pathc_icp_request_infer_pause();
bool pathc_icp_infer_pause_requested();
void pathc_icp_clear_infer_pause();
void pathc_icp_graph_set_resume(ggml_cgraph* graph, int next_node);
/** Advance resume cursor after a node batch completes (avoids replay livelock). */
void pathc_icp_checkpoint_graph_progress(const ggml_cgraph* graph, const ggml_tensor* last_node);
int pathc_icp_graph_node_index(const ggml_cgraph* graph, const ggml_tensor* node);
void pathc_icp_enter_graph_suspend_after(const ggml_cgraph* graph, const ggml_tensor* last_node,
                                         GGMLRunner* runner);
int pathc_icp_graph_resume_node(ggml_cgraph* graph);
void pathc_icp_graph_clear_resume();
void pathc_icp_graph_clear_resume_force();
ggml_cgraph* pathc_icp_peek_resume_graph();
bool pathc_icp_graph_eval_callback(ggml_tensor* t, bool ask, void* user_data);
/** Run one instruction-bounded slice of graph; false = paused (resume next update). */
bool pathc_icp_run_graph_chunked(ggml_backend_t backend, ggml_cgraph* graph,
                                 PathcGraphChunkState* state);

/** Record in-flight chunked graph (resume cursor + pause latch). Call before stack unwind. */
void pathc_icp_enter_graph_suspend(ggml_cgraph* graph, int next_node, GGMLRunner* runner);
void pathc_icp_note_graph_pause(ggml_cgraph* graph, int next_node);
void pathc_icp_set_suspended_runner(GGMLRunner* runner);
GGMLRunner* pathc_icp_peek_suspended_runner();
void pathc_icp_clear_suspended_runner();
/** True while a graph slice is paused (resume cursor, suspended runner, or budget latch). */
bool pathc_icp_mid_graph_suspend(const GGMLRunner* runner = nullptr);
bool pathc_icp_graph_pause_active();
/** True → do not runner_end / free compute_ctx (infer graph paused mid-forward). */
bool pathc_icp_should_defer_runner_teardown(const GGMLRunner* runner);
/** Keep sched/gallocr compute buffers across chunked pause (no reset/realloc). */
bool pathc_icp_workspace_allocation_pinned();
void pathc_icp_set_workspace_allocation_pinned(bool pinned);
void pathc_icp_clear_workspace_pin();

#ifdef __cplusplus
extern "C" {
#endif
/** Do not recycle intermediate tensor offsets in ggml_gallocr planning (ICP chunked). */
bool pathc_icp_no_intermediate_galloc_reuse(void);
#ifdef __cplusplus
}
#endif

/** RAII: calls runner->runner_end() unless infer pause / suspended graph. */
struct PathcRunnerEndOnExit {
  GGMLRunner* runner = nullptr;
  ~PathcRunnerEndOnExit();
};

#else

class GGMLRunner;

inline void pathc_icp_reset_call(uint64_t = 0) {}
inline bool pathc_icp_budget_exceeded() { return false; }
inline void pathc_icp_request_load_pause() {}
inline bool pathc_icp_load_pause_requested() { return false; }
inline void pathc_icp_clear_load_pause() {}
inline uint32_t pathc_icp_tensors_loaded_count() { return 0; }
inline void pathc_icp_inc_tensors_loaded() {}
inline size_t pathc_icp_param_bytes_loaded(const std::string&) { return 0; }
inline void pathc_icp_set_param_bytes_loaded(const std::string&, size_t) {}
inline void pathc_icp_clear_param_bytes_loaded(const std::string&) {}
inline void pathc_icp_reset_param_load_progress() {}
inline bool pathc_icp_param_load_complete(const std::string&) { return true; }
inline const char* pathc_icp_last_load_error() { return nullptr; }
inline void pathc_icp_set_load_error(const char*) {}
inline void pathc_icp_dbg(const char*) {}
inline void pathc_icp_dbgf(const char*, ...) {}
inline void pathc_icp_mark_param_finished(const std::string&) {}
inline bool pathc_icp_param_is_finished(const std::string&) { return false; }
inline void pathc_icp_clear_finished_params() {}
inline void pathc_icp_request_infer_pause() {}
inline bool pathc_icp_infer_pause_requested() { return false; }
inline void pathc_icp_clear_infer_pause() {}
inline void pathc_icp_enter_graph_suspend(ggml_cgraph*, int, GGMLRunner*) {}
inline void pathc_icp_graph_set_resume(ggml_cgraph*, int) {}
inline void pathc_icp_checkpoint_graph_progress(const ggml_cgraph*, const ggml_tensor*) {}
inline int pathc_icp_graph_node_index(const ggml_cgraph*, const ggml_tensor*) { return -1; }
inline void pathc_icp_enter_graph_suspend_after(const ggml_cgraph*, const ggml_tensor*, GGMLRunner*) {}
inline int pathc_icp_graph_resume_node(ggml_cgraph*) { return 0; }
inline void pathc_icp_graph_clear_resume() {}
inline void pathc_icp_graph_clear_resume_force() {}
inline ggml_cgraph* pathc_icp_peek_resume_graph() { return nullptr; }
inline bool pathc_icp_mid_graph_suspend(const GGMLRunner* = nullptr) {
  return false;
}
inline bool pathc_icp_graph_eval_callback(ggml_tensor*, bool, void*) { return true; }

struct PathcRunnerEndOnExit {
  explicit PathcRunnerEndOnExit(GGMLRunner* = nullptr) {}
  ~PathcRunnerEndOnExit() = default;
};

#endif
