#pragma once

#include <cstdint>

#ifdef TRP_PATHC_ICP

constexpr uint64_t kPathcInstrBudget = 35'000'000'000ULL;

void pathc_icp_reset_call(uint64_t budget = kPathcInstrBudget);
uint64_t pathc_icp_instr_this_call();
bool pathc_icp_budget_exceeded();
void pathc_icp_request_load_pause();
bool pathc_icp_load_pause_requested();
void pathc_icp_clear_load_pause();
uint32_t pathc_icp_tensors_loaded_count();
void pathc_icp_inc_tensors_loaded();
void pathc_icp_reset_tensors_loaded();

#else

inline void pathc_icp_reset_call(uint64_t = 0) {}
inline bool pathc_icp_budget_exceeded() { return false; }
inline void pathc_icp_request_load_pause() {}
inline bool pathc_icp_load_pause_requested() { return false; }
inline void pathc_icp_clear_load_pause() {}
inline uint32_t pathc_icp_tensors_loaded_count() { return 0; }
inline void pathc_icp_inc_tensors_loaded() {}

#endif
