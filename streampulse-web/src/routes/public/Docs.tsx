import { PublicLayout } from '../../ui/components/PublicLayout'

export default function Docs() {
  return (
    <PublicLayout>
      <section className="panel">
        <h1>Docs</h1>
        <p className="muted">
          Setup guides and API reference will live here. For now, start with the{' '}
          <a href="/setup">extension setup flow</a>.
        </p>
      </section>
    </PublicLayout>
  )
}
