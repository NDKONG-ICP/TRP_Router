#include "pathc_icp_hooks.h"
#include "pathc_icp_gen.h"
#include "pathc_parity.h"

#ifdef TRP_PATHC_ICP

#include "core/ggml_extend_backend.h"
#include "core/ggml_runner.h"
#include "ggml.h"
#include "ic_api.h"

#include <unordered_map>
#include <unordered_set>

static uint64_t g_call_instr_start = 0;
static uint64_t g_call_instr_budget = kPathcInstrBudget;
static bool g_load_pause = false;
static uint32_t g_tensors_loaded = 0;
static std::unordered_map<std::string, size_t> g_param_bytes_loaded;
static std::unordered_set<std::string> g_finished_params;
static std::string g_last_load_error;
static bool g_infer_pause = false;
static ggml_cgraph* g_graph_resume_target = nullptr;
static int g_graph_resume_node = 0;
static GGMLRunner* g_suspended_runner = nullptr;

const char* pathc_icp_last_load_error() {
  return g_last_load_error.empty() ? nullptr : g_last_load_error.c_str();
}

void pathc_icp_set_load_error(const char* message) {
  g_last_load_error = message != nullptr ? message : "";
}

void pathc_icp_reset_call(uint64_t budget) {
  g_call_instr_budget = budget;
  g_call_instr_start = IC_API::performance_counter(
      IC_API::PerformanceCounterType::Instructions);
  g_load_pause = false;
  g_last_load_error.clear();
}

uint64_t pathc_icp_instr_this_call() {
  return IC_API::performance_counter(
             IC_API::PerformanceCounterType::Instructions) -
         g_call_instr_start;
}

bool pathc_icp_budget_exceeded() {
  return pathc_icp_instr_this_call() >= g_call_instr_budget;
}

void pathc_icp_request_load_pause() { g_load_pause = true; }
bool pathc_icp_load_pause_requested() { return g_load_pause; }
void pathc_icp_clear_load_pause() { g_load_pause = false; }
uint32_t pathc_icp_tensors_loaded_count() { return g_tensors_loaded; }
void pathc_icp_inc_tensors_loaded() { g_tensors_loaded++; }
void pathc_icp_reset_tensors_loaded() { g_tensors_loaded = 0; }

size_t pathc_icp_param_bytes_loaded(const std::string& tensor_name) {
  auto it = g_param_bytes_loaded.find(tensor_name);
  if (it == g_param_bytes_loaded.end()) {
    return 0;
  }
  return it->second;
}

void pathc_icp_set_param_bytes_loaded(const std::string& tensor_name,
                                      size_t bytes) {
  g_param_bytes_loaded[tensor_name] = bytes;
}

void pathc_icp_clear_param_bytes_loaded(const std::string& tensor_name) {
  g_param_bytes_loaded.erase(tensor_name);
}

void pathc_icp_reset_param_load_progress() {
  g_param_bytes_loaded.clear();
  g_finished_params.clear();
}

void pathc_icp_mark_param_finished(const std::string& tensor_name) {
  g_finished_params.insert(tensor_name);
  g_param_bytes_loaded.erase(tensor_name);
}

bool pathc_icp_param_is_finished(const std::string& tensor_name) {
  return g_finished_params.find(tensor_name) != g_finished_params.end();
}

void pathc_icp_clear_finished_params() { g_finished_params.clear(); }

bool pathc_icp_param_load_complete(const std::string& tensor_name) {
  return g_param_bytes_loaded.find(tensor_name) == g_param_bytes_loaded.end();
}

void pathc_icp_request_infer_pause() { g_infer_pause = true; }
bool pathc_icp_infer_pause_requested() { return g_infer_pause; }
void pathc_icp_clear_infer_pause() { g_infer_pause = false; }

void pathc_icp_graph_clear_resume_force();

static void pathc_icp_mark_graph_run_complete(ggml_cgraph* graph) {
  if (g_graph_resume_target != nullptr && graph != nullptr &&
      g_graph_resume_target != graph) {
    return;
  }
  ggml_cgraph* g = g_graph_resume_target != nullptr ? g_graph_resume_target : graph;
  if (g != nullptr) {
    pathc_icp_dbgf("PATHC graph run complete (cursor=%d n_nodes=%d)\n",
                    g_graph_resume_node, ggml_graph_n_nodes(g));
  } else {
    pathc_icp_dbg("PATHC graph run complete\n");
  }
  pathc_icp_graph_clear_resume_force();
  pathc_icp_clear_infer_pause();
  if (GGMLRunner* runner = g_suspended_runner) {
    runner->pathc_try_stash_phase_output();
  }
  switch (pathc_icp_gen_phase()) {
    case PathcGenPhase::Condition:
      // Only declare CLIP finished once the hidden states are actually captured.
      if (pathc_icp_gen_has_pending_clip_hidden()) {
        pathc_icp_gen_set_condition_clip_graph_finished(true);
        pathc_icp_dbg("PATHC condition CLIP graph finished; finish embeds on pipeline entry\n");
      } else {
        pathc_icp_dbg("PATHC condition complete but CLIP hidden NOT captured; will retry\n");
      }
      break;
    case PathcGenPhase::Denoise:
      if (pathc_icp_gen_has_pending_unet_output()) {
        pathc_icp_dbg("PATHC denoise UNet graph output captured at completion\n");
      } else {
        pathc_icp_dbg("PATHC denoise complete but UNet output NOT captured; will retry\n");
      }
      break;
    case PathcGenPhase::Decode:
      if (pathc_icp_gen_has_pending_vae_output()) {
        pathc_icp_gen_set_decode_vae_graph_finished(true);
        pathc_icp_dbg("PATHC decode VAE graph output captured at completion\n");
      } else {
        pathc_icp_gen_set_decode_vae_graph_finished(false);
        pathc_icp_dbg("PATHC decode complete but VAE output NOT captured; will retry\n");
      }
      break;
    default:
      break;
  }
  if (GGMLRunner* runner = g_suspended_runner) {
    runner->pathc_release_graph_suspend_latch();
  }
}

static bool pathc_icp_graph_cursor_past_end(const ggml_cgraph* graph) {
  if (g_graph_resume_target == nullptr) {
    return false;
  }
  if (graph != nullptr && g_graph_resume_target != graph) {
    return false;
  }
  return g_graph_resume_node >=
         ggml_graph_n_nodes(g_graph_resume_target);
}

void pathc_icp_graph_set_resume(ggml_cgraph* graph, int next_node) {
  if (graph != nullptr && next_node >= ggml_graph_n_nodes(graph)) {
    pathc_icp_mark_graph_run_complete(graph);
    return;
  }
  g_graph_resume_target = graph;
  g_graph_resume_node = next_node;
}

int pathc_icp_graph_node_index(const ggml_cgraph* graph, const ggml_tensor* node) {
  if (graph == nullptr || node == nullptr) {
    return -1;
  }
  const int n_nodes = ggml_graph_n_nodes(const_cast<ggml_cgraph*>(graph));
  for (int i = 0; i < n_nodes; ++i) {
    if (ggml_graph_node(const_cast<ggml_cgraph*>(graph), i) == node) {
      return i;
    }
  }
  return -1;
}

void pathc_icp_enter_graph_suspend_after(const ggml_cgraph* graph,
                                         const ggml_tensor* last_node,
                                         GGMLRunner* runner) {
  const int last = pathc_icp_graph_node_index(graph, last_node);
  const int next = last >= 0 ? last + 1 : 0;
  pathc_icp_enter_graph_suspend(const_cast<ggml_cgraph*>(graph), next, runner);
}

void pathc_icp_checkpoint_graph_progress(const ggml_cgraph* graph,
                                         const ggml_tensor* last_node) {
  if (graph == nullptr || last_node == nullptr) {
    return;
  }
  const int last = pathc_icp_graph_node_index(graph, last_node);
  if (last < 0) {
    return;
  }
  const int next = last + 1;
  const int n_nodes = ggml_graph_n_nodes(const_cast<ggml_cgraph*>(graph));
  if (next >= n_nodes) {
    pathc_icp_mark_graph_run_complete(const_cast<ggml_cgraph*>(graph));
    return;
  }
  if (g_graph_resume_target != graph) {
    if (GGMLRunner* runner = g_suspended_runner) {
      ggml_cgraph* session = runner->pathc_suspended_graph_ptr();
      if (session != nullptr && graph == session) {
        pathc_icp_graph_set_resume(const_cast<ggml_cgraph*>(graph), next);
      } else {
        pathc_icp_dbgf("PATHC checkpoint: ignore cursor on graph=%p (session=%p resume=%p)\n",
                       static_cast<void*>(const_cast<ggml_cgraph*>(graph)),
                       static_cast<void*>(session),
                       static_cast<void*>(g_graph_resume_target));
      }
    } else {
      pathc_icp_graph_set_resume(const_cast<ggml_cgraph*>(graph), next);
    }
  } else if (next > g_graph_resume_node) {
    g_graph_resume_node = next;
  }
}

int pathc_icp_graph_resume_node(ggml_cgraph* graph) {
  if (g_graph_resume_target == nullptr) {
    return 0;
  }
  if (graph != nullptr && graph != g_graph_resume_target) {
    if (GGMLRunner* runner = g_suspended_runner) {
      ggml_cgraph* session = runner->pathc_suspended_graph_ptr();
      if (session != nullptr &&
          (graph == session || graph == g_graph_resume_target)) {
        g_graph_resume_target = graph;
      } else {
        pathc_icp_dbgf("PATHC resume_node: graph mismatch cur=%p target=%p session=%p -> 0\n",
                       static_cast<void*>(graph),
                       static_cast<void*>(g_graph_resume_target),
                       static_cast<void*>(session));
        return 0;
      }
    }
  }
  return g_graph_resume_node;
}

void pathc_icp_graph_clear_resume() {
  if (g_suspended_runner != nullptr) {
    return;
  }
  g_graph_resume_target = nullptr;
  g_graph_resume_node = 0;
}

void pathc_icp_graph_clear_resume_force() {
  g_graph_resume_target = nullptr;
  g_graph_resume_node = 0;
}

void pathc_icp_clear_workspace_pin() {}

ggml_cgraph* pathc_icp_peek_resume_graph() { return g_graph_resume_target; }

void pathc_icp_set_suspended_runner(GGMLRunner* runner) {
  g_suspended_runner = runner;
}

GGMLRunner* pathc_icp_peek_suspended_runner() { return g_suspended_runner; }

void pathc_icp_clear_suspended_runner() { g_suspended_runner = nullptr; }

bool pathc_icp_mid_graph_suspend(const GGMLRunner* runner) {
  if (pathc_icp_graph_cursor_past_end(nullptr)) {
    pathc_icp_mark_graph_run_complete(nullptr);
  }
  if (g_graph_resume_target != nullptr) {
    return true;
  }
  if (g_suspended_runner != nullptr) {
    return true;
  }
  if (runner != nullptr && runner->pathc_compute_suspended()) {
    return true;
  }
  // Budget latch set in eval callback; resume cursor written in same backend slice.
  if (g_infer_pause) {
    return true;
  }
  return false;
}

bool pathc_icp_graph_pause_active() { return pathc_icp_mid_graph_suspend(nullptr); }

bool pathc_icp_should_defer_runner_teardown(const GGMLRunner* runner) {
  return pathc_icp_mid_graph_suspend(runner);
}

bool pathc_icp_workspace_allocation_pinned() {
  return pathc_icp_peek_resume_graph() != nullptr;
}

void pathc_icp_set_workspace_allocation_pinned(bool) {}

extern "C" bool pathc_icp_no_intermediate_galloc_reuse(void) {
  // Pinning workspace is the critical fix; full no-reuse planning blows UNet
  // compute buffer on WASM for large graphs — enable only for tiny probe graphs.
  return false;
}

void pathc_icp_enter_graph_suspend(ggml_cgraph* graph, int next_node,
                                   GGMLRunner* runner) {
  if (graph != nullptr && runner == nullptr) {
    if (GGMLRunner* suspended = g_suspended_runner) {
      if (ggml_cgraph* session = suspended->pathc_suspended_graph_ptr()) {
        graph = session;
      }
    }
  }
  if (graph != nullptr && next_node >= ggml_graph_n_nodes(graph)) {
    pathc_icp_mark_graph_run_complete(graph);
    pathc_icp_dbgf("PATHC graph at end (next=%d n=%d); no pause\n", next_node,
                    ggml_graph_n_nodes(graph));
    return;
  }
  pathc_icp_request_infer_pause();
  pathc_icp_graph_set_resume(graph, next_node);
  pathc_parity_note_resume_node(next_node);
  if (runner != nullptr) {
    pathc_icp_set_suspended_runner(runner);
  }
  pathc_icp_dbgf("PATHC graph suspend next_node=%d runner=%p\n", next_node,
                  static_cast<void*>(runner));
}

PathcRunnerEndOnExit::~PathcRunnerEndOnExit() {
  if (runner != nullptr && !pathc_icp_should_defer_runner_teardown(runner)) {
    runner->runner_end();
  }
}

bool pathc_icp_graph_eval_callback(ggml_tensor* t, bool ask, void* user_data) {
  (void)user_data;
  // Force one graph node per batch so we can pause between nodes (avoid running
  // the whole graph when ask=false for every node).
  if (ask) {
    return true;
  }
  if (pathc_icp_budget_exceeded()) {
    pathc_icp_request_infer_pause();
    if (t != nullptr) {
      pathc_icp_dbgf("PATHC graph pause after node budget=%llu\n",
                      static_cast<unsigned long long>(pathc_icp_instr_this_call()));
    }
    return false;
  }
  pathc_icp_gen_inc_graph_slice_count();
  return true;
}

void pathc_icp_note_graph_pause(ggml_cgraph* graph, int next_node) {
  pathc_icp_enter_graph_suspend(graph, next_node, nullptr);
}

bool pathc_icp_run_graph_chunked(ggml_backend_t backend, ggml_cgraph* graph,
                                 PathcGraphChunkState* state) {
  if (graph == nullptr || backend == nullptr) {
    return false;
  }
  const int resume_before = pathc_icp_graph_resume_node(graph);
  ggml_status st = sd_backend_graph_compute_with_eval_callback(
      backend, graph, pathc_icp_graph_eval_callback, nullptr);
  if (state != nullptr) {
    state->node_cursor = pathc_icp_graph_resume_node(graph);
    state->done = (st == GGML_STATUS_SUCCESS);
  }
  if (st == GGML_STATUS_ABORTED && pathc_icp_mid_graph_suspend(nullptr)) {
    pathc_icp_dbgf("PATHC run_graph_chunked paused cursor=%d was=%d\n",
                    pathc_icp_graph_resume_node(graph), resume_before);
    return false;
  }
  return st == GGML_STATUS_SUCCESS;
}

#endif
