// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SupporterSignatureField } from '../src/options/SupporterSignatureField.tsx'
import {
  DEFAULT_SIGNATURE_EMOTE,
  SIGNATURE_EMOTES,
  SUPPORTER_SIGNATURE_KEY,
  getSignatureEmote,
  normalizeSignatureEmote,
  setSignatureEmote,
  signatureEmoteFor,
} from '../src/shared/supporterSignature.ts'
import { KIT_EMOTES, kitEmoteSrc } from '../src/supporter/kit.ts'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/**
 * The signature emote: a Supporter perk kept in this profile's synced
 * settings, locked on the same rule as emote rain.
 */
let stored: Record<string, unknown> = {}
const set = vi.fn(async (items: Record<string, unknown>) => { Object.assign(stored, items) })

beforeEach(() => {
  stored = {}
  set.mockClear()
  vi.stubGlobal('chrome', {
    storage: {
      sync: { get: vi.fn(async (key: string) => (key in stored ? { [key]: stored[key] } : {})), set },
      onChanged: { addListener() {}, removeListener() {} },
    },
  })
  const matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: matchMedia })
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete (window as { matchMedia?: unknown }).matchMedia
  document.body.replaceChildren()
})

describe('signature emote storage', () => {
  it('offers the lab’s signature choices plus the wide emotes, all from 7TV, defaulting to wideSpeedLaugh4', () => {
    expect([...SIGNATURE_EMOTES]).toEqual(['wideSpeedLaugh4', 'wideReacting', 'wideSpeedNod', 'PepePls', 'peepoPls', 'PartyParrot', 'BillyApprove', 'PETPET', 'AlienDance'])
    expect(DEFAULT_SIGNATURE_EMOTE).toBe('wideSpeedLaugh4')
    for (const name of SIGNATURE_EMOTES) {
      expect(KIT_EMOTES[name].cdn).toBe('7tv')
      expect(kitEmoteSrc(name, false)).toMatch(/^https:\/\/cdn\.7tv\.app\/emote\/[0-9A-Z]{26}\/2x\.webp$/)
      expect(kitEmoteSrc(name, true)).toMatch(/\/2x_static\.webp$/)
    }
    expect(SUPPORTER_SIGNATURE_KEY).toBe('supporterSignatureEmote')
  })

  it('reads a stored choice, and the default for nothing or anything off the list', async () => {
    expect(await getSignatureEmote()).toBe('wideSpeedLaugh4')
    stored = { supporterSignatureEmote: 'PETPET' }
    expect(await getSignatureEmote()).toBe('PETPET')
    for (const value of [undefined, null, '', 'Kappa', 'LUL', 'wideSpeedLaugh', '__proto__', 'toString', 42, { name: 'PETPET' }]) {
      expect(normalizeSignatureEmote(value), String(value)).toBe('wideSpeedLaugh4')
    }
  })

  it('is locked without Supporter perks: nothing shows and nothing is written; a Supporter gets theirs', async () => {
    expect(signatureEmoteFor(false, 'PartyParrot')).toBeNull()
    expect(signatureEmoteFor(false, undefined)).toBeNull()
    expect(signatureEmoteFor(true, undefined)).toBe('wideSpeedLaugh4')
    expect(signatureEmoteFor(true, 'PartyParrot')).toBe('PartyParrot')
    stored = { supporterSignatureEmote: 'AlienDance' }
    expect(await setSignatureEmote(false, 'PartyParrot')).toBe(false)
    expect(set).not.toHaveBeenCalled()
    expect(stored).toEqual({ supporterSignatureEmote: 'AlienDance' })
    expect(await setSignatureEmote(true, 'Kappa' as never)).toBe(false)
    expect(await setSignatureEmote(true, 'PartyParrot')).toBe(true)
    expect(stored).toEqual({ supporterSignatureEmote: 'PartyParrot' })
  })
})

describe('signature emote picker (Account & Supporter → Paint & crest)', () => {
  async function mount(node: React.ReactNode) {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    await act(async () => root.render(node))
    for (let k = 0; k < 3; k++) await act(async () => { await Promise.resolve() })
    return { host, radios: () => [...host.querySelectorAll<HTMLInputElement>('input[name="supporter-signature"]')], rerender: (next: React.ReactNode) => act(async () => root.render(next)), unmount: () => act(() => root.unmount()) }
  }

  it('is locked like emote rain for a non-Supporter, keeping whatever was stored', async () => {
    stored = { supporterSignatureEmote: 'BillyApprove' }
    const view = await mount(<SupporterSignatureField allowed={false} unknown={false} />)
    const fieldset = view.host.querySelector('fieldset')!
    expect(fieldset.disabled).toBe(true)
    expect(fieldset.dataset.supporterPerks).toBe('locked')
    expect(view.radios()).toHaveLength(9)
    expect(view.radios().find(radio => radio.checked)?.getAttribute('aria-label')).toBe('BillyApprove')
    expect(view.host.querySelector('[data-supporter-perk="signature-emote"]')?.textContent).toBe('A signature emote is a Supporter perk. Only you see it.')
    // Even a forced change event writes nothing.
    act(() => { view.radios()[5].click() })
    await act(async () => { await Promise.resolve() })
    expect(set).not.toHaveBeenCalled()
    expect(stored).toEqual({ supporterSignatureEmote: 'BillyApprove' })
    await view.unmount()
  })

  it('waits, neutral, while membership is being checked', async () => {
    const view = await mount(<SupporterSignatureField allowed={false} unknown />)
    const fieldset = view.host.querySelector('fieldset')!
    expect(fieldset.dataset.supporterPerks).toBe('pending')
    expect(fieldset.getAttribute('aria-busy')).toBe('true')
    expect(view.host.querySelector('[data-supporter-perk="signature-emote"]')).toBeNull()
    await view.unmount()
  })

  it('lets a Supporter pick one, saved to synced settings at once, with the default checked until they do', async () => {
    const view = await mount(<SupporterSignatureField allowed unknown={false} />)
    expect(view.host.querySelector('fieldset')!.disabled).toBe(false)
    expect(view.radios().find(radio => radio.checked)?.getAttribute('aria-label')).toBe('wideSpeedLaugh4')
    for (const img of view.host.querySelectorAll('img')) expect(img.getAttribute('src')).toMatch(/^https:\/\/cdn\.7tv\.app\/emote\//)
    await act(async () => { view.radios().find(radio => radio.getAttribute('aria-label') === 'wideReacting')!.click() })
    await act(async () => { await Promise.resolve() })
    expect(stored).toEqual({ supporterSignatureEmote: 'wideReacting' })
    expect(view.radios().find(radio => radio.checked)?.getAttribute('aria-label')).toBe('wideReacting')
    expect(view.host.querySelector('[data-supporter-perk="signature-emote"]')?.textContent).toBe('Signature emote saved.')
    await view.unmount()
  })
})
