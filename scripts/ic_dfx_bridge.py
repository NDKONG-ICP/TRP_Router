"""Use dfx local replica + default identity for onicai upload scripts."""
import json
import os
import subprocess
from pathlib import Path
from typing import Any, List, Optional

from icp_core import Agent, Client, Identity

ROOT = Path(__file__).resolve().parent.parent
TRP_ROOT = ROOT


def dfx(cmd: str) -> str:
    env = {**os.environ, "NO_COLOR": "1"}
    dfx_bin = os.environ.get(
        "DFX",
        os.path.expanduser("~/.cache/dfinity/versions/0.29.2/dfx"),
    )
    out = subprocess.run(
        [dfx_bin, *cmd.split()],
        cwd=str(TRP_ROOT),
        capture_output=True,
        text=True,
        env=env,
        check=True,
    )
    return out.stdout.strip()


def get_agent(_network: str = "local") -> Agent:
    host = os.environ.get("DFX_HOST", "http://127.0.0.1:8000").rstrip("/")
    whoami = dfx("identity whoami")
    pem = dfx(f"identity export {whoami}")
    identity = Identity.from_pem(pem)
    client = Client(url=host)
    return Agent(identity, client)


def get_canister(
    canister_name: str,
    candid_path: Path,
    network: str = "local",
    canister_id: Optional[str] = "",
) -> Any:
    from icp_core import Canister

    if not canister_id:
        canister_id = dfx(f"canister id {canister_name}")
    agent = get_agent(network)
    with open(candid_path, "r", encoding="utf-8") as f:
        candid_src = f.read()
    return Canister(agent, canister_id, candid_src)


def extract_variant(response: List[Any]) -> Any:
    item = response[0]
    if isinstance(item, dict) and "value" in item:
        return item["value"]
    return item


def run_icp_command(cmd: str, quiet: bool = False) -> Optional[str]:
    # Used only for canister id lookup in upload.py — redirect to dfx.
    if "canister status" in cmd and "--id-only" in cmd:
        name = cmd.split("canister status")[1].split("-e")[0].strip()
        return dfx(f"canister id {name}")
    if not quiet:
        print(f"ic_dfx_bridge: unsupported icp command: {cmd}")
    return None
