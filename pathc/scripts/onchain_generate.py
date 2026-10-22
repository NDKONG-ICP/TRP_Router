#!/usr/bin/env python3
"""Run begin/step/finish on local replica and write pathc/tmp/onchain-0.png."""
from __future__ import annotations

import hashlib
import os
import re
import subprocess
import sys
from pathlib import Path


def dfx_call(canister: str, network: str, method: str, arg: str = "()") -> str:
    r = subprocess.run(
        ["dfx", "canister", "call", canister, method, arg, "--network", network],
        check=True,
        capture_output=True,
        text=True,
    )
    return r.stdout.strip()


def parse_blob_ok(text: str) -> bytes:
    if "err" in text and "ok" not in text.split("err")[0]:
        raise RuntimeError(text)
    # vec { 137; 80; ... }
    m = re.search(r"vec\s*\{\s*([^}]+)\}", text)
    if not m:
        raise RuntimeError(f"no blob in: {text[:200]}")
    nums = [int(x.strip()) for x in m.group(1).split(";") if x.strip()]
    return bytes(nums)


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    env = root / ".env.pathc"
    if env.exists():
        for line in env.read_text().splitlines():
            if "=" in line and not line.startswith("#"):
                k, v = line.split("=", 1)
                os.environ.setdefault(k, v.strip("'\""))

    canister = os.environ.get("CANISTER_ID_DIFFUSION_CANISTER", "diffusion_canister")
    network = os.environ.get("DFX_NETWORK", "local")
    prompt = os.environ.get("PATHC_PROMPT", "a raven, pixel art")
    seed = os.environ.get("PATHC_SEED", "42")
    w = os.environ.get("PATHC_WIDTH", "128")
    h = os.environ.get("PATHC_HEIGHT", "128")

    print("status:", dfx_call(canister, network, "status"))
    begin_arg = (
        f'(record {{ prompt = "{prompt}"; seed = {seed} : nat64; steps = 1 : nat32; '
        f"height = {h} : nat32; width = {w} : nat32 }})"
    )
    print("begin:", dfx_call(canister, network, "begin", begin_arg))
    print("step:", dfx_call(canister, network, "step", "(0 : nat32)"))
    print("finish:", dfx_call(canister, network, "finish"))
    print("timings:", dfx_call(canister, network, "last_timings"))

    png_text = dfx_call(canister, network, "get_png")
    png = parse_blob_ok(png_text)
    out = root / "tmp/onchain-0.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(png)
    sha = hashlib.sha256(png).hexdigest()
    print(f"Wrote {out} ({len(png)} bytes) sha256={sha}")

    # determinism check
    dfx_call(canister, network, "begin", begin_arg)
    dfx_call(canister, network, "step", "(0 : nat32)")
    dfx_call(canister, network, "finish")
    png2 = parse_blob_ok(dfx_call(canister, network, "get_png"))
    print("deterministic:", png == png2)


if __name__ == "__main__":
    main()
