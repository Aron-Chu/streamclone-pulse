export function MomentLoadingSkeleton({ sessions = false }: { sessions?: boolean }) {
  return <div className={`moments-loading${sessions ? ' moments-loading--sessions' : ''}`} aria-hidden="true">
    {Array.from({ length: 6 }, (_, i) => <div className="moments-loading__card" key={i}>
      {!sessions ? <div className="moments-loading__preview" /> : null}
      <div className="moments-loading__identity"><span /><i /></div>
      <div className="moments-loading__line" /><div className="moments-loading__line moments-loading__line--short" />
    </div>)}
  </div>
}
