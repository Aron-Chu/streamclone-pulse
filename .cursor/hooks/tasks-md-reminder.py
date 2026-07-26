#!/usr/bin/env python3
"""Remind agent to update tasks.md only after acceptance criteria are met."""

from __future__ import annotations

import json
import subprocess
import sys


def changed_paths() -> list[str]:
    proc = subprocess.run(
        ["git", "diff", "--name-only", "HEAD"],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        proc = subprocess.run(["git", "status", "--porcelain"], capture_output=True, text=True, check=False)
    paths: list[str] = []
    for line in proc.stdout.splitlines():
        line = line.strip()
        if not line:
            continue
        if " -> " in line:
            line = line.split(" -> ", 1)[1]
        paths.append(line.split(maxsplit=1)[-1].replace("\\", "/"))
    return paths


def main() -> int:
    _ = json.load(sys.stdin) if not sys.stdin.isatty() else {}
    paths = changed_paths()
    tasks_touched = any(p.endswith("docs/website-portal/tasks.md") for p in paths)
    impl_touched = any(
        p.startswith(prefix)
        for p in paths
        for prefix in ("src/", "streampulse-web/", "internal/", "packages/")
    )

    if not impl_touched and not tasks_touched:
        return 0

    body = (
        "Before marking `docs/website-portal/tasks.md` checkboxes `- [x]`: "
        "confirm that task **acceptance criteria** and **Tests** sections passed. "
        "Do not check off for partial work or unverified hosted probes."
    )
    print(json.dumps({"followup_message": body}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
