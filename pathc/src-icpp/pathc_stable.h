#pragma once

#include <cstdint>
#include <vector>

constexpr const char *kPathcStableModelUri = "pathc://stable/model.gguf";

bool pathc_stable_write_chunk(uint64_t offset, const std::vector<uint8_t> &chunk,
                              std::string &err);
const uint8_t *pathc_stable_model_data();
uint64_t pathc_stable_model_size();
void pathc_stable_reset();
