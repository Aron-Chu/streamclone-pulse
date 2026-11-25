import { describe, expect, it } from 'vitest'
import { EMOTE_NAMES } from '../src/routes/public/brainchatEmotes'
import {
  answerQuestion,
  BIN_SECONDS,
  DEMO,
  emotesIn,
  formatClock,
  parseTalk,
  QUESTIONS,
  WINDOW_BINS,
  WINDOW_SECONDS,
} from '../src/routes/public/brainchatDemoData'

// The /brainchat demo is made up, but every number it shows comes from its own made-up lines.
describe('BrainChat demo data', () => {
  it('counts each moment from its lines', () => {
    for (const moment of DEMO.moments) {
      expect(moment.bins).toHaveLength(WINDOW_BINS)
      // Each 10 s bin is the number of different people who spoke in it.
      moment.bins.forEach((people, j) => {
        const inBin = moment.lines.filter(line => line.t >= j * BIN_SECONDS && line.t < (j + 1) * BIN_SECONDS)
        expect(new Set(inBin.map(line => line.who)).size).toBe(people)
      })
      expect(moment.lines.every(line => line.t >= 0 && line.t < WINDOW_SECONDS)).toBe(true)
      expect(moment.people).toBe(new Set(moment.lines.map(line => line.who)).size)
      expect(moment.busiest).toBe(Math.max(...moment.bins))
      expect(moment.pace).toBe(Math.round((moment.busiest / DEMO.usual) * 10) / 10)
      for (const said of moment.saidMost) {
        expect(said.lines).toBe(moment.lines.filter(line => line.text === said.text).length)
      }
      expect(moment.saidMost.map(said => said.lines)).toEqual([...moment.saidMost.map(said => said.lines)].sort((a, b) => b - a))
      if (moment.face) {
        const withFace = moment.lines.filter(line => emotesIn(line.text).includes(moment.face!.name))
        expect(moment.face.lines).toBe(withFace.length)
        expect(moment.face.people).toBe(new Set(withFace.map(line => line.who)).size)
      }
    }
  })

  it('keeps the series and the windows in step', () => {
    for (const moment of DEMO.moments) {
      const first = moment.windowStart / BIN_SECONDS
      expect(moment.bins).toEqual(DEMO.series.slice(first, first + WINDOW_BINS))
    }
  })

  it('ranks the busiest three by their busiest 10 s', () => {
    const ranked = [...DEMO.moments].sort((a, b) => b.busiest - a.busiest || a.at - b.at).slice(0, 3).map(m => m.n)
    expect(DEMO.busiestThree).toEqual(ranked)
    expect(DEMO.busiestThree.every(n => DEMO.moments[n - 1]!.face !== null)).toBe(true)
  })

  it('has one quiet moment it is not sure about, with no face and no reading', () => {
    const unsure = DEMO.moments.filter(m => m.doing === null)
    expect(unsure).toHaveLength(1)
    expect(unsure[0]!.face).toBeNull()
    expect(unsure[0]!.notSure).toBe('Too few messages to tell.')
    // Too few messages: under a fifth of the busiest moment's lines.
    const most = Math.max(...DEMO.moments.map(m => m.lines.length))
    expect(unsure[0]!.lines.length).toBeLessThan(most / 5)
  })

  it('answers each question from the readings, leaving out the unsure moment', () => {
    for (const question of QUESTIONS) {
      const answer = answerQuestion(question)
      expect(answer.matches.length).toBeGreaterThan(0)
      expect(answer.matches.every(m => m.doing !== null && question.match(m))).toBe(true)
      expect(answer.leftOut.map(m => m.n)).toEqual(DEMO.moments.filter(m => m.doing === null).map(m => m.n))
      expect(answer.lead).toBe(`${answer.matches.length} of ${DEMO.moments.length} moments`)
    }
  })

  it('uses only the placeholder emotes and no names in chat lines', () => {
    for (const moment of DEMO.moments) {
      for (const line of moment.lines) {
        for (const part of parseTalk(line.text)) {
          if (part.kind === 'emote') expect(EMOTE_NAMES).toContain(part.name)
          else expect(part.text).not.toMatch(/:\w+:|@\w/)
        }
      }
    }
  })

  it('writes stream times as h:mm:ss', () => {
    expect(formatClock(5047)).toBe('1:24:07')
    expect(formatClock(42)).toBe('0:00:42')
  })
})
