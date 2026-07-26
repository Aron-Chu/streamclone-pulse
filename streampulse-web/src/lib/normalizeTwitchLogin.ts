/** Normalize user-entered Twitch login for routes and API calls. */
export function normalizeTwitchLogin(raw: string): string {
  const trimmed = raw.trim().replace(/^@+/, '')
  return trimmed.toLowerCase()
}

/** Twitch login charset (simplified — backend validates on fetch). */
export function isPlausibleTwitchLogin(login: string): boolean {
  return /^[a-z0-9_]{2,25}$/.test(login)
}
