#!/usr/bin/env python3
"""Block git commit --trailer "Co-authored-by: Cursor <cursoragent@cursor.com>" when staged files likely contain secrets. Never echo secret values."""

from __future__ import annotations

import json
import re
import subprocess
import sys

PATTERNS = [
    (re.compile(r"PULSE_BETA_KEYS\s*=\s*[^\s#,]+", re.I), "PULSE_BETA_KEYS"),
    (re.compile(r"(?i)(api[_-]?key|secret|token|password)\s*=\s*['\"]?[A-Za-z0-9_\-]{16,}"), "credential_assignment"),
    (re.compile(r"(?i)CLOUDFLARE_API_TOKEN\s*=\s*\S+"), "CLOUDFLARE_API_TOKEN"),
    (re.compile(r"(?i)SENTRY_AUTH_TOKEN\s*=\s*\S+"), "SENTRY_AUTH_TOKEN"),
    (re.compile(r"-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----"), "private_key_pem"),
    (re.compile(r"(?i)gh[pousr]_[A-Za-z0-9_]{20,}"), "github_token"),
]
SKIP_PREFIXES = (".env.example", "deploy/env/", "docs/", ".cursor/hooks/")


def staged_files() -> list[str]:
    proc = subprocess.run(["git", "diff", "--cached", "--name-only"], capture_output=True, text=True, check=False)
    return [p.strip().replace("\\", "/") for p in proc.stdout.splitlines() if p.strip()]


def staged_diff() -> str:
    proc = subprocess.run(["git", "diff", "--cached"], capture_output=True, text=True, check=False)
    return proc.stdout


def main() -> int:
    try:
        payload = json.load(sys.stdin)
    except json.JSONDecodeError:
        return 0

    command = str(payload.get("command") or "")
    if "git commit --trailer "Co-authored-by: Cursor <cursoragent@cursor.com>"" not in command:
        return 0

    diff = staged_diff()
    hits: list[str] = []
    for pattern, label in PATTERNS:
        for match in pattern.finditer(diff):
            snippet = match.group(0)[:80]
            if any(x in snippet.lower() for x in ("example", "replace-with", "set-on-vps", "redacted", "your-")):
                continue
            hits.append(f"{label}@diff")

    for path in staged_files():
        if path.startswith(SKIP_PREFIXES):
            continue
        if path.endswith((".env", ".env.local", "oauth-bundle.env", "pulse-beta.env")):
            hits.append(f"staged_secret_file:{path}")

    if not hits:
        return 0

    # Redacted: pattern labels + paths only — never raw match text.
    msg = "Possible secret in staged changes (redacted): " + "; ".join(hits[:8])
    print(
        json.dumps(
            {
                "permission": "deny",
                "user_message": msg,
                "agent_message": "Remove secrets from staged files before committing. Use .env.example placeholders only. Hook output is redacted.",
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())