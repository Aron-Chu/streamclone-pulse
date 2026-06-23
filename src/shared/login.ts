const LOGIN_RE = /^[a-z0-9][a-z0-9_]{2,24}$/

export function normalizeLogin(value: string): string | null {
  const login = value.trim().toLowerCase()
  return LOGIN_RE.test(login) ? login : null
}
