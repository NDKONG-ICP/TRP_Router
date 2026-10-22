#include "pathc_stable.h"

#include "ic0.h"

#include <algorithm>
#include <cstring>
#include <string>

static uint64_t g_stable_model_bytes = 0;

static void ensure_stable_capacity(uint64_t need_end) {
  const uint32_t page = 65536;
  const uint64_t need_pages = (need_end + page - 1) / page;
  const uint64_t have_pages = ic0_stable_size();
  if (need_pages > have_pages) {
    ic0_stable_grow(static_cast<uint32_t>(need_pages - have_pages));
  }
}

bool pathc_stable_write_chunk(uint64_t offset,
                              const std::vector<uint8_t> &chunk,
                              std::string &err) {
  if (chunk.empty()) {
    return true;
  }
  const uint64_t end = offset + chunk.size();
  ensure_stable_capacity(end);
  ic0_stable_write(
      static_cast<uint32_t>(offset),
      static_cast<uint32_t>(reinterpret_cast<uintptr_t>(chunk.data())),
      static_cast<uint32_t>(chunk.size()));
  g_stable_model_bytes = std::max(g_stable_model_bytes, end);
  return true;
}

const uint8_t *pathc_stable_model_data() {
  // Stable memory is directly addressable in canister WASM.
  return reinterpret_cast<const uint8_t *>(0);
}

uint64_t pathc_stable_model_size() { return g_stable_model_bytes; }

void pathc_stable_reset() { g_stable_model_bytes = 0; }
