#include "pathc_icp_hooks.h"

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

void pathc_icp_graph_set_resume(ggml_cgraph* graph, int next_node) {
  g_graph_resume_target = graph;
  g_graph_resume_node = next_node;
}

int pathc_icp_graph_resume_node(ggml_cgraph* graph) {
  (void)graph;
  if (g_graph_resume_target == nullptr) {
    return 0;
  }
  return g_graph_resume_node;
}

void pathc_icp_graph_clear_resume() {
  g_graph_resume_target = nullptr;
  g_graph_resume_node = 0;
}

ggml_cgraph* pathc_icp_peek_resume_graph() { return g_graph_resume_target; }

void pathc_icp_set_suspended_runner(GGMLRunner* runner) {
  g_suspended_runner = runner;
}

GGMLRunner* pathc_icp_peek_suspended_runner() { return g_suspended_runner; }

void pathc_icp_clear_suspended_runner() { g_suspended_runner = nullptr; }

bool pathc_icp_graph_pause_active() {
  return g_graph_resume_target != nullptr && g_suspended_runner != nullptr;
}

bool pathc_icp_should_defer_runner_teardown(const GGMLRunner* runner) {
  if (pathc_icp_infer_pause_requested()) {
    return true;
  }
  if (pathc_icp_peek_resume_graph() != nullptr) {
    return true;
  }
  if (runner == nullptr) {
    return pathc_icp_peek_suspended_runner() != nullptr;
  }
  if (pathc_icp_peek_suspended_runner() == runner) {
    return true;
  }
  if (runner->pathc_compute_suspended()) {
    return true;
  }
  if (runner->graph_active()) {
    return true;
  }
  return false;
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
  return true;
}

void pathc_icp_note_graph_pause(ggml_cgraph* graph, int next_node) {
  pathc_icp_graph_set_resume(graph, next_node);
  pathc_icp_dbgf("PATHC graph resume next_node=%d\n", next_node);
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
  if (st == GGML_STATUS_ABORTED && pathc_icp_infer_pause_requested()) {
    pathc_icp_dbgf("PATHC run_graph_chunked paused cursor=%d was=%d\n",
                    pathc_icp_graph_resume_node(graph), resume_before);
    return false;
  }
  return st == GGML_STATUS_SUCCESS;
}

#endif
