#pragma once

#include "wasm_symbol.h"

void status() WASM_SYMBOL_EXPORTED("canister_query status");
void weights_bytes_loaded() WASM_SYMBOL_EXPORTED("canister_query weights_bytes_loaded");
void taesd_bytes_loaded() WASM_SYMBOL_EXPORTED("canister_query taesd_bytes_loaded");
void get_png() WASM_SYMBOL_EXPORTED("canister_query get_png");
void last_timings() WASM_SYMBOL_EXPORTED("canister_query last_timings");

void upload_weights_chunk()
    WASM_SYMBOL_EXPORTED("canister_update upload_weights_chunk");
void upload_taesd_chunk() WASM_SYMBOL_EXPORTED("canister_update upload_taesd_chunk");
void begin() WASM_SYMBOL_EXPORTED("canister_update begin");
void step() WASM_SYMBOL_EXPORTED("canister_update step");
void finish() WASM_SYMBOL_EXPORTED("canister_update finish");
