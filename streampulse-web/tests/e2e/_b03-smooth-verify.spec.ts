// B-03 verify: confirm chart line paths are now straight M…L…L segments.

import { test, expect } from '@playwright/test'

test('B-03 line paths are linear', async ({ page }) => {
  await page.goto('/analytics', { waitUntil: 'networkidle' })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(2_500)

  const result = await page.evaluate(() => {
    const paths = Array.from(document.querySelectorAll('.hx-chart2 svg .hx-chart-line'))
    return paths.map((p) => ({
      d: p.getAttribute('d') ?? '',
      cls: p.getAttribute('class') ?? '',
    }))
  })
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ count: result.length, samples: result.slice(0, 3) }, null, 2))

  // Verify no 'C' (cubic) or 'S'/'Q' (smooth/quadratic) commands remain.
  for (const r of result) {
    expect(r.d, `line ${r.cls} should not contain a C/Q/S command`).not.toMatch(/[CQS]/)
    expect(r.d, `line ${r.cls} should start with M`).toMatch(/^M /)
  }
})
