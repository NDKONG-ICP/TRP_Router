#!/usr/bin/env python3
"""Upload GGUF to llama_cpp_qwen25 via onicai scripts.upload + dfx local bridge."""
import sys
from pathlib import Path

TRP = Path(__file__).resolve().parent.parent
VENDOR = TRP / "vendor" / "llama_cpp_canister"
sys.path.insert(0, str(TRP / "scripts"))
sys.path.insert(0, str(VENDOR))

import scripts.ic_py_canister as ic_py_canister
import ic_dfx_bridge  # noqa: E402

ic_py_canister.get_agent = ic_dfx_bridge.get_agent
ic_py_canister.get_canister = ic_dfx_bridge.get_canister
ic_py_canister.run_icp_command = ic_dfx_bridge.run_icp_command

from scripts.upload import main

if __name__ == "__main__":
    sys.exit(main())
