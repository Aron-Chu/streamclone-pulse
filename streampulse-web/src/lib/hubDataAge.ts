/** A browser-clock anchor for the oldest displayed hub component; null means unknown. */
export function hubDataAsOf(
  raw: { generatedAt?: unknown; snapshot?: { ageSeconds?: unknown } },
  receipt: { receivedAt?: number; hubCopyAge?: string | null; responseAge?: string | null; responseDate?: string | null; responseCacheControl?: string | null },
): number | null {
  const receivedAt = receipt.receivedAt ?? Date.now()
  if (!Number.isFinite(receivedAt) || receivedAt <= 0) return null
  const integer = (s: string | null | undefined): number | null => {
    if (typeof s !== 'string' || !/^\d+$/.test(s)) return null
    const n = Number(s)
    return Number.isSafeInteger(n) ? n : null
  }
  // Age may be hidden by CORS. Without a visible value, only the explicit
  // no-store response contract permits assuming no intermediary residence.
  const noStore = receipt.responseCacheControl?.split(',').some((directive) => directive.trim().toLowerCase() === 'no-store') ?? false
  if (receipt.responseAge == null && !noStore) return null
  // A malformed age header is not proof of zero intermediary residence.
  const residence = receipt.responseAge == null ? 0 : integer(receipt.responseAge)
  if (residence === null) return null
  const copyAge = integer(receipt.hubCopyAge)
  if (receipt.hubCopyAge != null && copyAge === null) return null
  const snapshot = raw.snapshot?.ageSeconds
  const snapshotAge = typeof snapshot === 'number' && Number.isFinite(snapshot) && snapshot >= 0 ? snapshot : null
  let age = copyAge ?? snapshotAge
  if (age === null) {
    if (typeof raw.generatedAt !== 'string') return null
    const generated = Date.parse(raw.generatedAt)
    const serverDate = receipt.responseDate ? Date.parse(receipt.responseDate) : NaN
    // A cross-origin Date is frequently not exposed. The browser clock can be
    // wrong in either direction, so it cannot establish data age by itself.
    if (!Number.isFinite(serverDate) || !Number.isFinite(generated) || generated > serverDate) return null
    age = (serverDate - generated) / 1000
  }
  const asOf = receivedAt - (age + residence) * 1000
  return Number.isFinite(asOf) && asOf > 0 && asOf <= receivedAt ? asOf : null
}

/** A mixed response is only as fresh as its oldest component. */
export function olderHubDataAsOf(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : Math.min(a, b)
}
