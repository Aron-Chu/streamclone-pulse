import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MorphPath } from '../src/ui/MorphPath.tsx'

const detail = 'M4 80 L156 40 L308 70'

function renderPath(inspecting: boolean, reducedMotion = false) {
  return renderToStaticMarkup(
    <MorphPath
      idleLineD="M4 80 C 50 80, 110 45, 156 40"
      detailLineD={detail}
      idleAreaD="M4 100 L4 80 L156 40 L308 100 Z"
      stroke="#14b8c8"
      afterCursorStroke="#5f8e95"
      strokeWidth={2.25}
      idleOpacity={inspecting ? 0 : 0.82}
      areaFill="#14b8c8"
      areaOpacity={0.2}
      inspecting={inspecting}
      beforeClipId="before"
      afterClipId="after"
      seriesKey="viewers"
      reducedMotion={reducedMotion}
    />,
  )
}

describe('MorphPath static inspection renderer', () => {
  it('mounts one idle/area/before/after layer without a morph animation loop', () => {
    const markup = renderPath(false)

    expect(markup.match(/data-morph-layer="idle"/g) ?? []).toHaveLength(1)
    expect(markup.match(/data-morph-layer="area"/g) ?? []).toHaveLength(1)
    expect(markup.match(/data-morph-layer="before-cursor"/g) ?? []).toHaveLength(1)
    expect(markup.match(/data-morph-layer="after-cursor"/g) ?? []).toHaveLength(1)
    expect(markup).toContain('opacity="0.82"')
    expect(markup).toContain('opacity="0"')
    expect(markup).not.toContain('requestAnimationFrame')
  })

  it('renders the same detail d twice with an obvious muted after-cursor opacity', () => {
    const markup = renderPath(true)
    const paths = [...markup.matchAll(/data-morph-layer="(before-cursor|after-cursor)"[^>]*d="([^"]+)"[^>]*>/g)]

    expect(paths).toHaveLength(2)
    expect(paths[0]?.[2]).toBe(detail)
    expect(paths[1]?.[2]).toBe(detail)
    expect(markup).toContain('stroke="#5f8e95"')
    expect(markup).toContain('opacity="0.22"')
    expect(markup).toContain('200ms cubic-bezier(0.4, 0, 0.2, 1)')
    expect(markup.match(/mask="url\(#/g) ?? []).toHaveLength(2)
  })

  it('keeps the calm path at rest and uses immutable detail geometry for inspection', () => {
    const markup = renderPath(false)
    const paths = [...markup.matchAll(
      /data-morph-layer="(idle|before-cursor|after-cursor)"[^>]*d="([^"]+)"/g,
    )]
    expect(paths).toHaveLength(3)
    expect(paths.find(path => path[1] === 'idle')?.[2]).toContain('C')
    expect(paths.find(path => path[1] === 'idle')?.[2]).not.toBe(detail)
    expect(paths.find(path => path[1] === 'before-cursor')?.[2]).toBe(detail)
    expect(paths.find(path => path[1] === 'after-cursor')?.[2]).toBe(detail)
  })

  it('disables inspection opacity motion when reduced motion is requested', () => {
    expect(renderPath(true, true)).toContain('style="transition:none"')
  })
})
