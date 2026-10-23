#include "pathc_icp_hooks.h"

#ifdef TRP_PATHC_ICP

#include <cstdarg>
#include <cstdio>
#include <cstring>

extern "C" __attribute__((import_module("ic0"), import_name("debug_print")))
void ic0_debug_print(const void *src, size_t size);

void pathc_icp_dbg(const char *msg) {
  if (msg == nullptr) {
    return;
  }
  const size_t n = std::strlen(msg);
  if (n > 0) {
    ic0_debug_print(msg, n);
  }
}

void pathc_icp_dbgf(const char *fmt, ...) {
  char buf[512];
  va_list args;
  va_start(args, fmt);
  std::vsnprintf(buf, sizeof(buf), fmt, args);
  va_end(args);
  pathc_icp_dbg(buf);
}

#endif
