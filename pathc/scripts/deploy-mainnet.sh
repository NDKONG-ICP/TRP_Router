#!/usr/bin/env bash
# Path C — mainnet deploy. Spends REAL cycles. Nothing runs without CONFIRM_MAINNET=1.
# Keyring-free: uses the PLAINTEXT ic_deploy_plain identity + suppresses dfx's mainnet-plaintext
# warning (same approach as the ICSPICY project). No Keychain unlock required.
set -euo pipefail
cd "$(dirname "$0")/.."

export DFX_WARNING=-mainnet_plaintext_identity   # <-- the keyring bypass
# dfx 0.28+ panics with TERM=dumb on some subcommands; xterm-256color is safe in CI/agents.
export TERM="${TERM:-xterm-256color}"
NET=ic
DEPLOY_IDENTITY=${DEPLOY_IDENTITY:-ic_deploy_plain}
export DFX_IDENTITY="$DEPLOY_IDENTITY"            # node scripts (upload/load/generate) read this
EXPECT_WASM=2cb663998b68a49039f4882075c5d94f71a6d7a186f4dfc788d47a5c6bdb816a
WASM=build/diffusion_canister.wasm
MODEL=models/sd_turbo-f16-q4_0.gguf
MEM_LIMIT=4026531840   # 3.75 GB, set BEFORE load
MIN_TC=${MIN_TC:-1.5}  # refuse below this many TC. 1.5 = tight proof-of-life; ~3+ for real runway.
# dfx default create tries ~2 TC from wallet; with ~1.6 TC available use explicit deposit (500B create fee from deposit).
CREATE_CYCLES=${CREATE_CYCLES:-1100000000000}

# --- Controllers: deployer (needed to install) + your II + secure identity ---
CONTROLLERS=(
  "gqkko-43bbx-nwsp4-it2rg-pc2dy-w2pt2-fa5om-4y6es-oyhz2-5i5oh-5ae"   # ic_deploy_plain (the deployer — must be a controller to install)
  "ucw6l-apn5m-ycnrv-s7xtt-lvchu-jz5f3-3oeq7-ttuhk-rjvjp-sdnbj-lqe"   # Internet Identity (you) — manage from NNS/UI, no dfx
  "xx6vh-r5j7z-ujant-uvv2w-anfdf-jtyus-2t5xx-joumb-d2j5s-haivw-tae"   # ic_deploy (secure identity)
)

say(){ printf '\n=== %s ===\n' "$*"; }
die(){ printf '\nABORT: %s\n' "$*" >&2; exit 1; }
d(){ dfx "$@" --network "$NET" --identity "$DEPLOY_IDENTITY"; }

# --- Gates ---------------------------------------------------------------------
[ "${CONFIRM_MAINNET:-}" = "1" ] || die "set CONFIRM_MAINNET=1 to run (spends real cycles)"
say "identity: $DEPLOY_IDENTITY (keyring bypass active)"

say "mainnet wallet balance"
BAL=$(dfx wallet balance --network "$NET" --identity "$DEPLOY_IDENTITY") || die "cannot read wallet balance"
echo "$BAL"
TC=$(echo "$BAL" | grep -oE '[0-9]+(\.[0-9]+)?' | head -1)
awk -v b="$TC" -v m="$MIN_TC" 'BEGIN{ if (b+0 < m+0) exit 1 }' || die "balance ${TC} TC < MIN_TC=${MIN_TC}. Top up (dfx ledger top-up / dfx wallet send) or lower MIN_TC."

# --- Verify artifacts ----------------------------------------------------------
say "verify wasm hash"
GOT=$(shasum -a 256 "$WASM" | awk '{print $1}')
[ "$GOT" = "$EXPECT_WASM" ] || die "wasm hash $GOT != expected $EXPECT_WASM (rebuild the deterministic winner)"
[ -f "$MODEL" ] || die "model $MODEL missing"
echo "wasm ok ($GOT), model $(stat -f%z "$MODEL" 2>/dev/null) bytes"

# --- Create + size + install ---------------------------------------------------
say "create diffusion_canister on $NET"
CTRL_ARGS=(); for c in "${CONTROLLERS[@]}"; do CTRL_ARGS+=(--controller "$c"); done
d canister create diffusion_canister --with-cycles "$CREATE_CYCLES" "${CTRL_ARGS[@]}"
CID=$(d canister id diffusion_canister)
say "canister id: $CID"

say "set wasm_memory_limit to $MEM_LIMIT (before load)"
d canister update-settings diffusion_canister --wasm-memory-limit "$MEM_LIMIT"

say "install wasm"
d canister install diffusion_canister --mode install --wasm "$WASM"
d canister info diffusion_canister | grep -i "module hash"

# --- Upload model, load, generate (env-parameterized project scripts) ----------
export DFX_NETWORK="$NET"
export CANISTER_ID_DIFFUSION_CANISTER="$CID"
say "upload model (chunked, ~1.73 GB)"
echo "If upload hits IC0207, deposit cycles onto \$CID (freezing headroom grows with VFS size), then re-run upload_model.mjs."
PATHC_MODEL_GGUF="$MODEL" node scripts/upload_model.mjs "$MODEL"
say "resumable load"
node scripts/run_load_loop.mjs
say "first MAINNET generate"
PATHC_DEBUG_FLAGS=0 node scripts/onchain_generate.mjs

say "DONE — mainnet canister: $CID"
echo "Record $CID + image SHA + REAL cycles (d canister status) in BENCHMARKS.md / VERSIONS.md, and commit."
echo "Optional hardening: once you confirm control via II, remove the plaintext deployer as controller:"
echo "  dfx canister update-settings $CID --network ic --remove-controller gqkko-43bbx-nwsp4-it2rg-pc2dy-w2pt2-fa5om-4y6es-oyhz2-5i5oh-5ae"
echo "Do NOT expose via the public router until the metering/gate layer is in front (docs/TRP-Router-Metering-Gate-Spec.md)."
