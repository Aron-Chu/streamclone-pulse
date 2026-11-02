/**
 * What the extension does, under the hub search (direction A of the 11-01 board, "Beside chat"): a
 * sample stream with the Pulse tab beside it plays five beats (chat goes wild, Pulse marks the
 * spike, Top moments, open one and press Jump, the player lands on that second), at most twice
 * while half of it is on screen, then rests on the last. Hover plays it once more; reduced motion
 * and a hidden tab show the last beat still. The panel pictures are 2× captures of the real panel
 * (the sandbox /extension demo); the stream is drawn sample art. One install button, for the
 * visitor's own browser; phones get the panel alone and a line that it is a desktop extension.
 */
import { forwardRef, useLayoutEffect, useRef } from 'react'
import blocksCave from '../../../../demo/pictures/blocks-cave.svg'
import blocksDay from '../../../../demo/pictures/blocks-day.svg'
import sceneCard from '../../../../demo/pictures/panel-scene-card-2x.webp'
import sceneChart from '../../../../demo/pictures/panel-scene-chart-2x.webp'
import sceneMoments from '../../../../demo/pictures/panel-scene-moments-2x.webp'
import { useMatchMedia } from '../../../hooks/useMatchMedia'
import { InstallCta } from '../../InstallCta'

/** Twitch global emotes, by id. */
const EMOTES = { PogChamp: 305954156, LUL: 425618, Kreygasm: 41, WutFace: 28087 } as const
type Emote = keyof typeof EMOTES
const emoteUrl = (name: Emote) => `https://static-cdn.jtvnw.net/emoticons/v2/${EMOTES[name]}/default/dark/2.0`

const CHAT: ReadonlyArray<readonly [color: string, name: string, says: string | readonly Emote[]]> = [
  ['#f472b6', 'pixelmoth', ['LUL']], ['#60a5fa', 'kayto', 'no way'], ['#34d399', 'gr4vy', ['PogChamp', 'PogChamp']], ['#fbbf24', 'nub_irl', 'CAVE FIGHT'],
  ['#a78bfa', 'zeph', ['PogChamp']], ['#f87171', 'motoko', ['Kreygasm']], ['#60a5fa', 'kayto', ['PogChamp', 'LUL']], ['#34d399', 'wisp', 'clip it'],
  ['#f472b6', 'pixelmoth', ['PogChamp', 'PogChamp', 'PogChamp']], ['#fbbf24', 'lumen', ['WutFace']], ['#a78bfa', 'zeph', ['LUL', 'LUL']], ['#f87171', 'arro', ['PogChamp']],
]
const CALM: ReadonlyArray<readonly [string, string, string]> = [
  ['#94a3b8', 'quietfox', 'gg that run'], ['#60a5fa', 'kayto', 'what seed is this'], ['#34d399', 'wisp', 'cave next?'],
]

const BEATS = ['Chat goes wild', 'Pulse marks the spike', 'Top moments, ranked', 'Open it, press Jump', 'Lands on that second'] as const
const LAST = BEATS.length - 1
/** The marks on the replay's timeline, as % of 3:00:00; the hot one is 2:18:20. */
const TICKS = [16.9, 28.5, 52.9, 77.2, 89.4] as const
const HOT = 77.2
const FROM_S = 3080
const TO_S = 8300
const LOOP_MS = 12200
const MAX_LOOPS = 2
/** The panel pictures are 338 px wide at 1×; the card's Jump button sits at (58, 385). */
const PANEL_W = 338
const JUMP = { x: 58, y: 385 }

function clock(s: number): string {
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function chatLine([color, name, says]: readonly [string, string, string | readonly Emote[]]): HTMLElement {
  const line = document.createElement('div')
  line.className = 'hv5-pr-cl'
  const who = document.createElement('b')
  who.style.color = color
  who.textContent = name
  line.append(who)
  if (typeof says === 'string') {
    const text = document.createElement('span')
    text.textContent = says
    line.append(text)
  } else {
    for (const e of says) {
      const img = document.createElement('img')
      img.src = emoteUrl(e)
      img.alt = ''
      img.width = 20
      img.height = 20
      line.append(img)
    }
  }
  return line
}

export const HubV5Promo = forwardRef<HTMLDivElement>(function HubV5Promo(_props, ref) {
  const reduce = useMatchMedia('(prefers-reduced-motion: reduce)')
  const stageRef = useRef<HTMLDivElement>(null)

  // The beats run on timers that write to the stage directly: nothing re-renders while it plays.
  useLayoutEffect(() => {
    const stage = stageRef.current
    const card = stage?.parentElement
    const side = stage?.querySelector<HTMLElement>('.hv5-pr-side')
    const vp = stage?.querySelector<HTMLElement>('.hv5-pr-vp')
    const lines = stage?.querySelector<HTMLElement>('.hv5-pr-lines')
    const cursor = stage?.querySelector<SVGElement>('.hv5-pr-cursor')
    const capN = stage?.querySelector<HTMLElement>('.hv5-pr-n')
    const capTx = stage?.querySelector<HTMLElement>('.hv5-pr-tx')
    const dots = stage ? [...stage.querySelectorAll<HTMLElement>('.hv5-pr-dots i')] : []
    const time = stage?.querySelector<HTMLElement>('.hv5-pr-t')
    if (!stage || !card || !side || !vp || !lines || !cursor || !capN || !capTx || !time) return undefined

    let timers: number[] = []
    let chatTimer = 0
    let clockTimer = 0
    let loops = 0
    let running = false
    const at = (ms: number, fn: () => void) => { timers.push(window.setTimeout(fn, ms)) }
    const halt = () => {
      timers.forEach((t) => window.clearTimeout(t))
      timers = []
      window.clearInterval(chatTimer)
      window.clearInterval(clockTimer)
      running = false
    }
    const setBeat = (b: number) => {
      stage.dataset.beat = String(b)
      capN.textContent = String(b + 1)
      capTx.textContent = BEATS[b]!
      dots.forEach((d, i) => d.classList.toggle('on', i <= b))
    }
    /** No transitions for one frame: a jump back to the start, or the still. */
    const snap = (b: number) => {
      stage.classList.add('hv5-pr-snap')
      setBeat(b)
      requestAnimationFrame(() => requestAnimationFrame(() => stage.classList.remove('hv5-pr-snap')))
    }
    // No line leaves while chat plays: dropping the oldest would move the others up in layout, which counts as
    // layout shift. A loop adds about 20, out of sight above the top, and the next loop starts afresh.
    const chat = (everyMs: number) => {
      window.clearInterval(chatTimer)
      let i = 0
      chatTimer = window.setInterval(() => lines.append(chatLine(CHAT[i++ % CHAT.length]!)), everyMs)
    }
    const click = () => {
      cursor.classList.remove('hv5-pr-click')
      void cursor.getBoundingClientRect()
      cursor.classList.add('hv5-pr-click')
    }

    const still = () => {
      halt()
      lines.replaceChildren()
      cursor.style.opacity = '0'
      time.textContent = clock(TO_S)
      snap(LAST)
    }

    const play = () => {
      halt()
      running = true
      // Where things are this time round: the panel pictures scale with the side's width.
      const k = side.clientWidth / PANEL_W
      const top = side.offsetTop + vp.offsetTop
      const shift = Math.max(0, Math.round(JUMP.y * k + 52 - vp.clientHeight))
      stage.style.setProperty('--hv5-pr-shift', `${-shift}px`)
      const to = (x: number, y: number) => { cursor.style.transform = `translate(${Math.round(side.offsetLeft + x)}px, ${Math.round(top + y)}px)` }

      lines.replaceChildren(...CALM.map(chatLine))
      time.textContent = clock(FROM_S)
      cursor.style.opacity = '0'
      to(side.clientWidth * 0.45, vp.clientHeight * 0.8)
      snap(0)
      chat(420)
      at(900, () => chat(160))
      at(1500, () => chat(70))
      at(700, () => { cursor.style.opacity = '1' })
      at(1300, () => to(side.clientWidth * 0.7, -vp.offsetTop / 2 - 1))
      at(2300, click)
      at(2600, () => {
        window.clearInterval(chatTimer)
        setBeat(1)
        to(side.clientWidth * 0.74, 228 * k)
      })
      at(5200, () => { setBeat(2); to(150 * k, 95 * k) })
      at(6900, click)
      at(7200, () => { setBeat(3); to(JUMP.x * k, JUMP.y * k - shift) })
      at(8900, click)
      at(9200, () => {
        setBeat(4)
        cursor.style.opacity = '0'
        let step = 0
        clockTimer = window.setInterval(() => {
          step += 1
          time.textContent = clock(FROM_S + Math.round((TO_S - FROM_S) * Math.min(1, step / 14)))
          if (step >= 14) window.clearInterval(clockTimer)
        }, 55)
      })
      at(LOOP_MS, () => {
        loops += 1
        if (loops < MAX_LOOPS) play()
        else running = false
      })
    }

    if (reduce || typeof IntersectionObserver === 'undefined') {
      still()
      return halt
    }

    // Ready at the first beat, so the stage never flashes the last one before it plays.
    lines.replaceChildren(...CALM.map(chatLine))
    time.textContent = clock(FROM_S)
    snap(0)

    const io = new IntersectionObserver(([entry]) => {
      if (!entry) return
      if (entry.isIntersecting && !running && loops === 0 && !document.hidden) play()
      else if (!entry.isIntersecting && running) {
        halt()
        loops = 0
      }
    }, { threshold: 0.5 })
    io.observe(stage)
    const onVisibility = () => {
      if (document.hidden && running) {
        loops = MAX_LOOPS
        still()
      }
    }
    const onEnter = () => {
      if (running) return
      loops = MAX_LOOPS - 1
      play()
    }
    document.addEventListener('visibilitychange', onVisibility)
    card.addEventListener('pointerenter', onEnter)
    return () => {
      io.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      card.removeEventListener('pointerenter', onEnter)
      halt()
    }
  }, [reduce])

  return (
    <div className="hv5-promo" ref={ref}>
      <div className="hv5-pr-stage" ref={stageRef} data-beat={LAST} aria-hidden="true">
        <div className="hv5-pr-player">
          <img className="hv5-pr-scene" src={blocksDay} alt="" width={320} height={180} decoding="async" />
          <img className="hv5-pr-scene hv5-pr-cave" src={blocksCave} alt="" width={320} height={180} decoding="async" />
          <div className="hv5-pr-ptop"><span className="hv5-pr-ch">sample_streamer</span><span className="hv5-pr-rp">REPLAY</span></div>
          <div className="hv5-pr-toast">▶ Jumped to 2:18:20</div>
          <div className="hv5-pr-pbot">
            <div className="hv5-pr-tl">
              <i className="hv5-pr-fill" />
              {TICKS.map((p) => <i key={p} className={p === HOT ? 'hv5-pr-tick hv5-pr-hot' : 'hv5-pr-tick'} style={{ left: `${p}%` }} />)}
            </div>
            <div className="hv5-pr-time"><span className="hv5-pr-t">{clock(TO_S)}</span><span>3:00:00</span></div>
          </div>
        </div>
        <div className="hv5-pr-side">
          <div className="hv5-pr-tabs">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="5" width="12" height="14" rx="2" /><path d="M15 12h6m-3-3 3 3-3 3" /></svg>
            <span className="hv5-pr-pills"><span className="hv5-pr-chat-t">CHAT</span><span className="hv5-pr-pulse-t">PULSE</span></span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="9" cy="9" r="3" /><circle cx="17" cy="10" r="2.5" /><path d="M3 19c1-3 3.5-4.5 6-4.5s5 1.5 6 4.5M15 15.5c1.5-.6 3.5-.3 5 1.5" /></svg>
          </div>
          <div className="hv5-pr-vp">
            <div className="hv5-pr-ly hv5-pr-chat"><div className="hv5-pr-lines" /></div>
            <div className="hv5-pr-ly hv5-pr-chart"><img src={sceneChart} alt="" width={338} height={390} decoding="async" /><span className="hv5-pr-hl" /></div>
            <div className="hv5-pr-ly hv5-pr-mom"><img src={sceneMoments} alt="" width={338} height={415} decoding="async" /></div>
            <div className="hv5-pr-ly hv5-pr-card"><img src={sceneCard} alt="" width={338} height={500} decoding="async" /></div>
          </div>
        </div>
        <div className="hv5-pr-cap">
          <span className="hv5-pr-n">{BEATS.length}</span>
          <span className="hv5-pr-tx">{BEATS[LAST]}</span>
          <span className="hv5-pr-dots">{BEATS.map((b) => <i key={b} className="on" />)}</span>
        </div>
        <svg className="hv5-pr-cursor" viewBox="0 0 24 24"><path d="M4 2l15 11-6.5 1 3.6 7.2-2.7 1.3-3.6-7.2L5 20z" fill="#fff" stroke="#111" strokeWidth="1.2" strokeLinejoin="round" /></svg>
      </div>
      <div className="hv5-pr-copy">
        <p className="hv5-pr-h">See chat's big moments on Twitch</p>
        <p className="hv5-pr-p">The Pulse tab sits beside Twitch chat. It marks every spike and jumps you to the second it happened.</p>
        <InstallCta className="hv5-hero-install" label="short" icon="mark" data-cta="chrome-install-hub-hero" />
        <p className="hv5-pr-desk">Desktop extension for Chrome, Edge and Firefox</p>
        <p className="hv5-pr-free">Free · no account</p>
      </div>
    </div>
  )
})
