#!/usr/bin/env bash
# Snapshot canister logs for in-flight generate (resume node, traps, phase).
set -euo pipefail
CID="${CANISTER_ID_DIFFUSION_CANISTER:-uxrrr-q7777-77774-qaaaq-cai}"
dfx canister logs "$CID" 2>&1 | rg -i "TRAP|GGML_ABORT|denoise|Decode|parity|resume_paused|partial return|node=" | tail -40
