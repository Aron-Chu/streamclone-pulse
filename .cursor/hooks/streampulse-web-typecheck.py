#!/usr/bin/env python3
"""Run typecheck when streampulse-web files are edited (skip if dir missing)."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError:
        return 0

    file_path = str(payload.get("file_path") or payload.get("path") or "").replace("\\", "/")
    if not file_path.startswith("streampulse-web/"):
        return 0

    web_root = Path.cwd() / "streampulse-web"
    if not web_root.is_dir():
        return 0

    proc = subprocess.run(
        ["npm", "run", "typecheck"],
        cwd=web_root,
        capture_output=True,
        text=True,
        check=False,
    )
    errors: list[str] = []
    if proc.returncode != 0:
        errors.append(proc.stderr or proc.stdout or "typecheck failed")

    pkg = json.loads((web_root / "package.json").read_text(encoding="utf-8"))
    if "lint" in pkg.get("scripts", {}):
        lint = subprocess.run(
            ["npm", "run", "lint"],
            cwd=web_root,
            capture_output=True,
            text=True,
            check=False,
        )
        if lint.returncode != 0:
            errors.append(lint.stderr or lint.stdout or "lint failed")

    if not errors:
        return 0

    err = "\n---\n".join(e[-800:] for e in errors)
    print(json.dumps({"additional_context": f"streampulse-web lint/typecheck failed after edit:\n{err}"}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
