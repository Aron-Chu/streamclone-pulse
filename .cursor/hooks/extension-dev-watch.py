#!/usr/bin/env python3
"""Ensure extension dev watch is running after src/ edits (auto-reload in Chrome)."""

from __future__ import annotations

import json
import subprocess
import sys
import urllib.error
import urllib.request
from pathlib import Path


RELOAD_HEALTH = "http://127.0.0.1:9876/health"
EXTENSION_PATH_PREFIXES = ("src/", "vite.config.ts", "manifest.json")


def reload_server_running() -> bool:
    try:
        with urllib.request.urlopen(RELOAD_HEALTH, timeout=0.4) as res:
            return res.status == 200
    except (urllib.error.URLError, TimeoutError, OSError):
        return False


def trigger_rebuild(root: Path) -> bool:
    node = "node.exe" if sys.platform == "win32" else "node"
    script = root / "scripts" / "trigger-extension-rebuild.mjs"
    proc = subprocess.run(
        [node, str(script)],
        cwd=root,
        capture_output=True,
        text=True,
        check=False,
    )
    return proc.returncode == 0


def start_dev_watch(root: Path) -> None:
    npm = "npm.cmd" if sys.platform == "win32" else "npm"
    kwargs: dict = {
        "cwd": root,
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
    }
    if sys.platform == "win32":
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.DETACHED_PROCESS
    else:
        kwargs["start_new_session"] = True
    subprocess.Popen([npm, "run", "dev"], **kwargs)


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError:
        return 0

    file_path = str(payload.get("file_path") or payload.get("path") or "").replace("\\", "/")
    if not any(file_path.startswith(prefix) for prefix in EXTENSION_PATH_PREFIXES):
        return 0

    root = Path.cwd()
    if not (root / "manifest.json").is_file() or not (root / "src").is_dir():
        return 0

    started = False
    rebuilt = False
    if not reload_server_running():
        start_dev_watch(root)
        started = True
    else:
        rebuilt = trigger_rebuild(root)

    note = (
        "Extension dist rebuilt and reload pinged. Twitch tab should refresh shortly."
        if rebuilt
        else "Extension dev watch is active (`npm run dev`). Saves rebuild dist and auto-reload."
        if reload_server_running() or started
        else "Could not confirm extension dev watch. Run `npm run dev` and load unpacked from `dist/`."
    )
    if started:
        note = "Started extension dev watch in the background. " + note

    print(json.dumps({"additional_context": note}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
