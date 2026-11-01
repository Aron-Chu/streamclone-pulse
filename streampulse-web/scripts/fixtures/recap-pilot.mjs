/** Synthetic test data only. Never imported by the production manifest. */
export function fixture(overrides = {}) {
  return { kind: 'stream', login: 'fixturechan', streamId: '123', displayName: 'Fixture Channel',
    title: 'Fixture Channel reaction recap — StreamPulse', description: 'A deliberately synthetic aggregate fixture for the recap tests.',
    summary: 'Synthetic fixture: the audience used LUL most often, with three measured chat reactions during this test session.',
    startedAt: '2026-10-30T12:00:00Z', durationSeconds: 7200, nonMissingRollupMinutes: 70,
    coverage: { state: 'partial', description: '70 measured minutes; the remaining minutes have no measurements.' },
    moments: [{ offsetSeconds: 100, score: 75, chatCount: 200 }, { offsetSeconds: 200, score: 72 }, { offsetSeconds: 300, score: 70 }],
    topEmotes: [{ code: 'LUL', count: 40 }],
    review: { approved: true, reviewedAt: '2026-10-31T17:00:00Z', expiresAt: '2026-11-02T17:00:00Z',
      sourceUrl: 'https://api.streampulse.stream/v1/portal/analytics/streams/123/recap', notes: 'Test fixture only; not production approval.' },
    replay: { state: 'available', vodId: '456', alignmentOffsetSeconds: -5, durationSeconds: 7200,
      checkedAt: '2026-10-31T17:00:00Z', expiresAt: '2026-11-01T17:00:00Z' }, ...overrides }
}
