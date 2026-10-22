#include "diffusion_canister.h"
#include "pathc_internal.h"
#include "pathc_stable.h"

#include <cstdio>
#include <string>

static bool write_chunk(const std::string &path, uint64_t offset,
                        const std::vector<uint8_t> &chunk, std::string &err) {
  const char *mode = (offset == 0) ? "wb" : "r+b";
  FILE *f = std::fopen(path.c_str(), mode);
  if (f == nullptr && offset > 0) {
    f = std::fopen(path.c_str(), "w+b");
  }
  if (f == nullptr) {
    err = "failed to fopen " + path;
    return false;
  }
  if (std::fseek(f, static_cast<long>(offset), SEEK_SET) != 0) {
    std::fclose(f);
    err = "fseek failed " + path;
    return false;
  }
  const size_t n =
      std::fwrite(chunk.data(), 1, chunk.size(), f);
  std::fflush(f);
  std::fclose(f);
  if (n != chunk.size()) {
    err = "short fwrite " + path;
    return false;
  }
  return true;
}

void upload_weights_chunk() {
  IC_API ic_api(CanisterUpdate{std::string(__func__)}, false);
  uint64_t offset = 0;
  std::vector<uint8_t> chunk;
  CandidTypeRecord in;
  in.append("offset", CandidTypeNat64{&offset});
  in.append("chunk", CandidTypeVecNat8{&chunk});
  ic_api.from_wire(in);

  std::string err;
  // Stable mirror (P2): disabled until sub-chunk stable_write is validated on replica.
  // Weights load from WASI VFS `model.gguf`; stable size query stays 0 until enabled.
  (void)offset;
  if (!write_chunk(kModelGgufPath, offset, chunk, err)) {
    ic_api.to_wire(CandidTypeVariant{
        "err", CandidTypeText{err}});
    return;
  }
  g_weights_bytes = std::max(g_weights_bytes, offset + chunk.size());
  ic_api.to_wire(CandidTypeVariant{"ok", CandidTypeNull{}});
}

void upload_taesd_chunk() {
  IC_API ic_api(CanisterUpdate{std::string(__func__)}, false);
  uint64_t offset = 0;
  std::vector<uint8_t> chunk;
  CandidTypeRecord in;
  in.append("offset", CandidTypeNat64{&offset});
  in.append("chunk", CandidTypeVecNat8{&chunk});
  ic_api.from_wire(in);

  std::string err;
  if (!write_chunk(kTaesdPath, offset, chunk, err)) {
    ic_api.to_wire(CandidTypeVariant{
        "err", CandidTypeText{err}});
    return;
  }
  g_taesd_bytes = std::max(g_taesd_bytes, offset + chunk.size());
  ic_api.to_wire(CandidTypeVariant{"ok", CandidTypeNull{}});
}

void weights_bytes_loaded() {
  IC_API ic_api(CanisterQuery{std::string(__func__)}, false);
  pathc_refresh_vfs_sizes();
  ic_api.to_wire(CandidTypeNat64{g_weights_bytes});
}

void taesd_bytes_loaded() {
  IC_API ic_api(CanisterQuery{std::string(__func__)}, false);
  pathc_refresh_vfs_sizes();
  ic_api.to_wire(CandidTypeNat64{g_taesd_bytes});
}
