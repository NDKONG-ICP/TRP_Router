#!/usr/bin/env python3
"""Emit icpp.effective.toml with absolute -include preamble on every TU (mine + icpp runtime)."""
from __future__ import annotations

import pathlib
import sys

try:
    import tomllib
except ImportError:
    import tomli as tomllib  # type: ignore

try:
    import tomli_w
except ImportError:
    tomli_w = None  # type: ignore


def strip_include(flags: list) -> list:
    out: list = []
    skip = False
    for f in flags:
        if skip:
            skip = False
            continue
        if f == "-include":
            skip = True
            continue
        if isinstance(f, str) and f.endswith("icp_preamble.h"):
            continue
        out.append(f)
    return out


def prepend_include(flags: list, preamble: str) -> list:
    base = strip_include(flags)
    return ["-include", preamble, *base]


def main() -> None:
    root = pathlib.Path(sys.argv[1]).resolve()
    src = tomllib.loads((root / "icpp.toml").read_text())
    preamble = str((root / "wasi-shims" / "icp_preamble.h").resolve())
    bw = src["build-wasm"]

    bw["cpp_compile_flags"] = prepend_include(
        list(bw.get("cpp_compile_flags", [])), preamble
    )
    # C TUs do not pull libc++ locale; keep c flags unchanged.
    # icpp runtime (__ic_candid__ library) uses cpp_compile_flags_defaults when set.
    bw["cpp_compile_flags_defaults"] = ["-include", preamble]
    src["build-wasm"] = bw

    out = root / "icpp.effective.toml"
    if tomli_w is None:
        # Fallback: copy icpp.toml + rely on build-icpp.sh python inject (legacy)
        out.write_text((root / "icpp.toml").read_text())
        print("WARN: tomli_w missing; wrote icpp.toml copy only", file=sys.stderr)
        sys.exit(0)

    with out.open("wb") as f:
        tomli_w.dump(src, f)
    print(f"Wrote {out} with universal -include {preamble}")


if __name__ == "__main__":
    main()
