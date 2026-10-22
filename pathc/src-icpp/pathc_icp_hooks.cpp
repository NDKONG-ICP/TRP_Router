#include "pathc_icp_hooks.h"

#ifdef TRP_PATHC_ICP

#include "ic_api.h"

static uint64_t g_call_instr_start = 0;
static uint64_t g_call_instr_budget = kPathcInstrBudget;
static bool g_load_pause = false;
static uint32_t g_tensors_loaded = 0;

void pathc_icp_reset_call(uint64_t budget) {
  g_call_instr_budget = budget;
  g_call_instr_start = IC_API::performance_counter(
      IC_API::PerformanceCounterType::Instructions);
  g_load_pause = false;
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

#endif
