#!/usr/bin/env python3
"""Chunk-upload GGUF / TAESD to diffusion_canister on local replica."""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path


def candid_blob(data: bytes) -> str:
    inner = "; ".join(str(b) for b in data)
    return f"vec {{{inner}}}"


def upload(canister: str, network: str, method: str, path: Path, chunk: int) -> None:
    size = path.stat().st_size
    print(f"Upload {path.name}: {size} bytes -> {method}")
    with path.open("rb") as f:
        offset = 0
        while offset < size:
            block = f.read(chunk)
            if not block:
                break
            arg = f"(record {{ offset = {offset} : nat64; chunk = {candid_blob(block)} }})"
            subprocess.run(
                ["dfx", "canister", "call", canister, method, arg, "--network", network],
                check=True,
                capture_output=True,
                text=True,
            )
            offset += len(block)
            print(f"  {offset}/{size}")


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    env = root / ".env.pathc"
    if env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("CANISTER_ID_DIFFUSION_CANISTER="):
                os.environ.setdefault(
                    "CANISTER_ID_DIFFUSION_CANISTER", line.split("=", 1)[1].strip("'\"")
                )
            if line.startswith("DFX_NETWORK="):
                os.environ.setdefault("DFX_NETWORK", line.split("=", 1)[1].strip("'\""))

    canister = os.environ.get("CANISTER_ID_DIFFUSION_CANISTER", "diffusion_canister")
    network = os.environ.get("DFX_NETWORK", "local")
    chunk = int(os.environ.get("CHUNK_BYTES", "1900000"))

    model = Path(sys.argv[1] if len(sys.argv) > 1 else root / "models/sd_turbo-f16-q8_0.gguf")
    taesd = Path(sys.argv[2] if len(sys.argv) > 2 else root / "models/taesd.safetensors")

    upload(canister, network, "upload_weights_chunk", model, chunk)
    if taesd.is_file():
        upload(canister, network, "upload_taesd_chunk", taesd, chunk)

    for q in ("weights_bytes_loaded", "taesd_bytes_loaded"):
        out = subprocess.run(
            ["dfx", "canister", "call", canister, q, "--network", network],
            check=True,
            capture_output=True,
            text=True,
        )
        print(q, out.stdout.strip())


if __name__ == "__main__":
    main()
