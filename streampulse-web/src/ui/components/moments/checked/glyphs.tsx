import type { CheckLineLevel } from '../../../../lib/momentsChecked'
import { VERDICT_WORD } from '../../../../lib/momentsChecked'
import type { MomentVerdict } from '../../../../lib/momentsFeed'

/** The page's small glyphs (moments-r2 m2.js G): one stroke weight, currentColor. */
const ring = <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
export const VerdictGlyph = ({ level }: { level: CheckLineLevel }) => level === 'ok'
  ? <svg viewBox="0 0 16 16" aria-hidden="true">{ring}<path d="M5.1 8.3l2 2 3.9-4.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
  : level === 'warn'
    ? <svg viewBox="0 0 16 16" aria-hidden="true">{ring}<path d="M8 2.2a5.8 5.8 0 0 1 0 11.6z" fill="currentColor" /></svg>
    : level === 'bad'
      ? <svg viewBox="0 0 16 16" aria-hidden="true">{ring}<path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
      : <svg viewBox="0 0 16 16" aria-hidden="true">{ring}<path d="M5 8h5.2M8.4 5.6 10.8 8l-2.4 2.4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>

/** The verdict mark: a check, a half disc, a cross. */
export const VdMark = ({ v }: { v: MomentVerdict }) => <span className={`mk-vd mk-vd-${v}`} title={VERDICT_WORD[v]}><VerdictGlyph level={v} /></span>

export const PlayGlyph = () => <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 1.5v9l8-4.5z" fill="currentColor" /></svg>
export const ExtGlyph = () => <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9 3h4v4M13 3 7.5 8.5M11 9.5V13H3V5h3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
export const BookGlyph = () => <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5h8v11l-4-2.8-4 2.8z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>
export const LinkGlyph = () => <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2-2a2.6 2.6 0 0 0-3.7-3.7l-.8.8M9.2 6.8a2.6 2.6 0 0 0-3.7 0l-2 2a2.6 2.6 0 0 0 3.7 3.7l.8-.8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
export const XGlyph = () => <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
export const LtGlyph = () => <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
export const GtGlyph = () => <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
export const SearchGlyph = () => <svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
export const ReplayGlyph = () => <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8a5 5 0 1 0 1.6-3.7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /><path d="M3 2.5v3h3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
