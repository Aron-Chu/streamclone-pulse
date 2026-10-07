import { FINISHES, LINES, NAME_COLORS, NAMES, TENURES, clamp, finishVars, kitCrest, kitEmote, kitEmoteSrc, kitName, pick, rand, renderWords, tenureIndex, type Kit, type KitEmoteName } from './kit.ts'
import { mountStage, runStage, type StageContext, type StageModel } from './stage.ts'
import { CHAT_STACK_CSS } from './styles.ts'

/**
 * "Your Line": a Twitch-style chat column where your line arrives with your
 * crest, painted name and signature emote. Ported from the lab's
 * `ChatStack(stage, o, mode)` in its narrow (sidebar card) form.
 *
 * - `anatomy` (the lab's sidebar pick, for people who are not Supporters):
 *   every sixth line is yours and gets a spotlight; hover labels the crest, the
 *   paint and the signature emote; at a peak, three quick lines then yours,
 *   labelled for a few seconds.
 * - `tenure` (Tenure Climb, for people who already support): every fourth
 *   line is yours and its crest pops up one stage, with a chip naming the
 *   stage. The lab cycles all five stages; here the climb stops at the stage
 *   the server reports for this Supporter and stays there. Hover brings your
 *   next line right away.
 *
 * Every other line is canned, neutral chatter; never real chat.
 */
export type ChatMode = 'anatomy' | 'tenure'

const YOURS_LINES: Record<ChatMode, ReadonlyArray<string>> = {
  anatomy: ['saved that moment', 'that peak was mine', 'called it', 'clip it'],
  tenure: ['gg', 'still here', 'here again', 'run it back', 'day one'],
}

export interface ChatStack extends StageModel { setEmote(name: KitEmoteName): void }

export function ChatStack(stage: HTMLElement, context: StageContext, kit: Kit, mode: ChatMode): ChatStack {
  stage.classList.add('spk-chat')
  const { still } = context
  const LH = 18
  const YOURS = YOURS_LINES[mode]
  const every = mode === 'anatomy' ? 6 : 4
  // The Supporter's own stage: the climb never shows a crest they have not earned.
  const top = mode === 'tenure' ? tenureIndex(kit.tenure) : 0
  let lines: HTMLElement[] = []
  let t = 0
  let nextAt = 0.3
  let count = every - 3
  let H = 0
  let W = 0
  let lastYours: HTMLElement | null = null
  let calloutsUntil = 0
  // A still frame shows the crest the Supporter has, not the bottom of the climb.
  let tenureIdx = still ? top : 0
  let co: HTMLElement | null = null
  const chatBottom = () => H - 3

  function layout() {
    const bottom = chatBottom()
    lines = lines.filter((ln, i) => {
      const y = bottom - LH * (lines.length - i)
      if (y < -LH * 2) { ln.remove(); return false }
      return true
    })
    lines.forEach((ln, i) => {
      const y = bottom - LH * (lines.length - i)
      ln.style.transform = `translateY(${y}px)`
      ln.style.opacity = y < -2 ? '0' : '1'
    })
  }
  function push(el: HTMLElement) {
    el.style.transform = `translateY(${chatBottom()}px)`
    el.style.opacity = '0'
    stage.insertBefore(el, co)
    lines.push(el)
    el.getBoundingClientRect()
    layout()
  }
  function addOther() {
    const el = document.createElement('div')
    el.className = 'spk-cl'
    const b = document.createElement('b')
    b.textContent = pick(NAMES)
    b.style.color = pick(NAME_COLORS)
    el.append(b, ': ', renderWords(pick(LINES), LH, still))
    push(el)
  }
  function addYours(text?: string | null) {
    const el = document.createElement('div')
    el.className = 'spk-cl spk-sup'
    const tn = mode === 'tenure' ? TENURES[tenureIdx] : null
    const crest = kitCrest(kit, LH - 4, tn ? tn.id : kit.tenure)
    const emote = kitEmote(kit, LH, still)
    el.append(crest, kitName(kit), ': ', renderWords(text || pick(YOURS), LH, still), emote)
    let chip: HTMLSpanElement | null = null
    if (tn) {
      chip = document.createElement('span')
      chip.className = 'spk-chip'
      chip.textContent = `${tn.title} · ${tn.short}`
      el.append(chip)
      tenureIdx = Math.min(tenureIdx + 1, top)
      if (!still) context.later(() => crest.animate?.([{ transform: 'scale(1.9) rotate(-12deg)', filter: 'brightness(2)' }, { transform: 'scale(1)', filter: 'none' }], { duration: 520, easing: 'cubic-bezier(.2,.8,.3,1.3)' }), 260)
    }
    push(el)
    // A wide signature emote can reach the stage chip; then the chip keeps only its length ("6 mo").
    if (chip && tn) {
      const chipBox = chip.getBoundingClientRect()
      if (chipBox.width > 0 && emote.getBoundingClientRect().right > chipBox.left - 4) chip.textContent = tn.short
    }
    lastYours = el
    if (mode === 'anatomy') spotlight(el)
  }
  function spotlight(el: HTMLElement) {
    if (still) return
    lines.forEach(ln => { if (ln !== el) ln.classList.add('spk-dim') })
    el.classList.add('spk-sheen')
    context.later(() => { lines.forEach(ln => ln.classList.remove('spk-dim')); el.classList.remove('spk-sheen') }, 1500)
  }
  function updateCallouts(show: boolean) {
    if (!co) {
      co = document.createElement('div')
      co.className = 'spk-callouts'
      co.innerHTML = '<span class="spk-co" data-k="crest"></span><span class="spk-co" data-k="name"></span><span class="spk-co" data-k="emote"></span>'
      stage.append(co)
    }
    const row = lastYours && lastYours.isConnected ? lastYours : null
    if (!show || !row) { co.classList.remove('spk-on'); return }
    const sr = stage.getBoundingClientRect()
    const rr = row.getBoundingClientRect()
    if (rr.top < sr.top - 1) { co.classList.remove('spk-on'); return }
    const parts: Record<string, Element | null> = { crest: row.querySelector('.spk-crest'), name: row.querySelector('.spk-name'), emote: row.querySelector('.spk-kit-emote') }
    const texts: Record<string, string> = {
      crest: `Crest · ${TENURES[tenureIndex(kit.tenure)].label}`,
      name: kit.finish ? `${FINISHES[kit.finish].label} paint` : 'Your name',
      emote: 'Signature emote',
    }
    const above = rr.top - sr.top > 24
    const tierRight = [-1e9, -1e9]
    for (const k of ['crest', 'name', 'emote']) {
      const label = co.querySelector<HTMLElement>(`[data-k="${k}"]`)!
      if (label.textContent !== texts[k]) label.textContent = texts[k]
      const pr = parts[k]?.getBoundingClientRect()
      if (!pr) continue
      const cx = pr.left + pr.width / 2 - sr.left
      const lw = label.offsetWidth
      let lx = clamp(cx - lw / 2, 4, W - lw - 4)
      const tier = lx >= tierRight[0] + 4 ? 0 : 1
      if (tier === 1 && lx < tierRight[1] + 4) lx = tierRight[1] + 4
      tierRight[tier] = lx + lw
      const lh = 5 + tier * 16
      const ly = above ? rr.top - sr.top - 15 - lh : rr.bottom - sr.top + lh
      label.style.transform = `translate(${lx}px, ${ly}px)`
      label.style.setProperty('--lx', `${clamp(cx - lx, 3, lw - 3)}px`)
      label.style.setProperty('--lh', `${lh}px`)
      label.classList.toggle('spk-below', !above)
    }
    co.classList.add('spk-on')
  }
  function onHot() {
    if (mode !== 'anatomy' || lastYours !== lines[lines.length - 1]) addYours()
  }
  function tick(dt: number) {
    if (!H) { H = stage.clientHeight; W = stage.clientWidth }
    t += dt
    const p = context.pace()
    const frozen = mode === 'anatomy' && context.hot()
    if (t >= nextAt && !frozen) {
      count++
      if (count % every === 0) addYours(); else addOther()
      nextAt = t + (1.7 - p * 1.45) * rand(0.6, 1.3)
    }
    if (mode === 'anatomy') updateCallouts(context.hot() || t < calloutsUntil)
  }
  function peak() {
    for (const d of [0, 140, 280]) context.later(addOther, d)
    context.later(() => { addYours(mode === 'anatomy' ? 'that peak was mine' : null); calloutsUntil = t + 2.6 }, 420)
  }
  return {
    tick,
    peak,
    onHot,
    resize: () => { H = 0 },
    // A still frame always ends on your line, where hover labels it, so it still explains the kit.
    settle: () => { if (lastYours !== lines[lines.length - 1]) addYours() },
    setEmote(name) {
      kit.emote = name
      stage.querySelectorAll<HTMLImageElement>('img.spk-kit-emote').forEach(img => { img.dataset.em = name; img.src = kitEmoteSrc(name, still) })
    },
  }
}

export interface ChatStackOptions { mode: ChatMode; kit: Kit }
export interface MountedChatStack { stop(): void; setEmote(name: KitEmoteName): void }

/** Draws "Your Line" into `stage` until `stop()`. */
export function mountChatStack(stage: HTMLElement, { mode, kit }: ChatStackOptions): MountedChatStack {
  const own: Kit = { ...kit }
  let model: ChatStack | null = null
  for (const [name, value] of Object.entries(finishVars(own.finish))) stage.style.setProperty(name, value)
  stage.dataset.mode = mode
  const stop = mountStage(stage, CHAT_STACK_CSS, still => {
    const halt = runStage(stage, still, context => (model = ChatStack(stage, context, own, mode)))
    return () => { halt(); model = null }
  })
  return {
    stop,
    setEmote(name) {
      if (own.emote === name) return
      if (model) model.setEmote(name); else own.emote = name
    },
  }
}
