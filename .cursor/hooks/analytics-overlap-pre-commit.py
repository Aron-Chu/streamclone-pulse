#!/usr/bin/env python3
"""Block git commit when analytics overlap guard fails on staged portal/console files."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

TRIGGER_PREFIXES = (
    "streampulse-web/",
    "packages/analytics-console/",
    "../streampulse-backend/packages/analytics-console/",
)


def staged_files() -> list[str]:
    proc = subprocess.run(
        ["git", "diff", "--cached", "--name-only"],
        capture_output=True,
        text=True,
        check=False,
    )
    return [p.strip().replace("\\", "/") for p in proc.stdout.splitlines() if p.strip()]


def touches_analytics(paths: list[str]) -> bool:
    for path in paths:
        if any(path.startswith(prefix) for prefix in TRIGGER_PREFIXES):
            return True
        if "analytics-console" in path or "HubActivityChart" in path:
            return True
    return False


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError:
        return 0

    command = str(payload.get("command") or "")
    if "git commit" not in command:
        return 0

    if not touches_analytics(staged_files()):
        return 0

    web_root = Path.cwd() / "streampulse-web"
    if not web_root.is_dir():
        return 0

    proc = subprocess.run(
        ["npm", "run", "check:analytics-overlap"],
        cwd=web_root,
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode == 0:
        return 0

    out = (proc.stdout or proc.stderr or "check:analytics-overlap failed")[-1200:]
    print(
        json.dumps(
            {
                "permission": "deny",
                "user_message": "Analytics overlap guard failed — delete or gate the old UI before committing.",
                "agent_message": f"Run npm run check:analytics-overlap in streampulse-web and fix regressions:\n{out}",
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
