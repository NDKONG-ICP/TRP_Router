#include "diffusion_canister.h"
#include "pathc_internal.h"

#include <cerrno>
#include <cstdio>
#include <cstring>
#include <string>

#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>

static uint64_t vfs_file_size(const std::string &path) {
  struct stat st {};
  if (stat(path.c_str(), &st) != 0) {
    return 0;
  }
  return static_cast<uint64_t>(st.st_size);
}

static bool write_chunk(const std::string &path, uint64_t offset,
                        const std::vector<uint8_t> &chunk, std::string &err) {
  if (chunk.empty()) {
    return true;
  }

  int fd = -1;
  if (offset == 0) {
    fd = open(path.c_str(), O_CREAT | O_TRUNC | O_RDWR, 0644);
  } else {
    const uint64_t cur = vfs_file_size(path);
    if (cur == offset) {
      fd = open(path.c_str(), O_WRONLY | O_APPEND);
    } else {
      fd = open(path.c_str(), O_RDWR);
      if (fd >= 0 &&
          lseek(fd, static_cast<off_t>(offset), SEEK_SET) == static_cast<off_t>(-1)) {
        close(fd);
        fd = -1;
      }
    }
  }
  if (fd < 0) {
    err = std::string("open failed ") + path + " errno=" + std::to_string(errno);
    return false;
  }

  ssize_t written = 0;
  while (written < static_cast<ssize_t>(chunk.size())) {
    const ssize_t n = write(fd, chunk.data() + written,
                            chunk.size() - static_cast<size_t>(written));
    if (n <= 0) {
      close(fd);
      err = std::string("write failed ") + path + " errno=" + std::to_string(errno);
      return false;
    }
    written += n;
  }
  close(fd);
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
    ic_api.to_wire(CandidTypeVariant{"err", CandidTypeText{err}});
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
    ic_api.to_wire(CandidTypeVariant{"err", CandidTypeText{err}});
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

void weights_vfs_probe() {
  IC_API ic_api(CanisterQuery{std::string(__func__)}, false);
  pathc_refresh_vfs_sizes();
  const uint64_t vfs_size = vfs_file_size(kModelGgufPath);
  char head[4] = {};
  int fd = open(kModelGgufPath, O_RDONLY);
  if (fd >= 0) {
    read(fd, head, 4);
    close(fd);
  }
  char hex[9] = {};
  std::snprintf(hex, sizeof(hex), "%02x%02x%02x%02x",
                static_cast<unsigned char>(head[0]),
                static_cast<unsigned char>(head[1]),
                static_cast<unsigned char>(head[2]),
                static_cast<unsigned char>(head[3]));
  CandidTypeRecord r;
  r.append("vfs_size", CandidTypeNat64{vfs_size});
  r.append("counter_bytes", CandidTypeNat64{g_weights_bytes});
  r.append("head_hex", CandidTypeText{std::string(hex)});
  ic_api.to_wire(r);
}
