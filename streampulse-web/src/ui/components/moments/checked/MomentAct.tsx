import { emoteImage, type MomentAct as Act } from '../../../../lib/momentsChecked'

/** What happened, in the feed's words: "chat spammed" and the emote, "emote burst" with the minute's emotes, "chat burst". */
export function MomentAct({ act }: { act: Act }) {
  if (act.type === 'spammed') {
    const src = emoteImage(act.emote)
    return <><span className="mk-r-act">chat spammed</span><span className="mk-r-em">{src ? <img src={src} alt="" /> : null}<span>{act.emote.name}</span></span></>
  }
  if (act.type === 'emotes') {
    return <><span className="mk-r-act">emote burst</span>
      {act.emotes.length ? <span className="mk-r-ems" title={act.emotes.map(e => e.name).join(', ')}>{act.emotes.map(e => <img key={e.name} src={emoteImage(e)} alt="" />)}</span> : null}</>
  }
  return <span className="mk-r-act">chat burst</span>
}
