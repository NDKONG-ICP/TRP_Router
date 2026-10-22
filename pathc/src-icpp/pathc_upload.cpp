#include "pathc_internal.h"

#include <fstream>
#include <string>

static bool write_chunk(const std::string &path, uint64_t offset,
                        const std::vector<uint8_t> &chunk, std::string &err) {
  std::ios_base::openmode mode = std::ios::binary;
  if (offset == 0) {
    mode |= std::ios::trunc;
  }
  std::ofstream out(path, mode);
  if (!out.is_open()) {
    err = "failed to open " + path;
    return false;
  }
  out.seekp(static_cast<std::streamoff>(offset));
  out.write(reinterpret_cast<const char *>(chunk.data()),
              static_cast<std::streamsize>(chunk.size()));
  if (!out) {
    err = "short write " + path;
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
  ic_api.to_wire(CandidTypeNat64{g_weights_bytes});
}

void taesd_bytes_loaded() {
  IC_API ic_api(CanisterQuery{std::string(__func__)}, false);
  ic_api.to_wire(CandidTypeNat64{g_taesd_bytes});
}
