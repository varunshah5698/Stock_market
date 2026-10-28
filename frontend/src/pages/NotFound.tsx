import { Link } from 'react-router-dom'
import { Brand } from '../components/Brand'
import { useDocumentTitle } from '../lib/hooks'

export default function NotFound() {
  useDocumentTitle('Not found')
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 bg-ink-950 px-6 text-center">
      <Brand />
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-dimx">404 / route not found</div>
      <h1 className="display max-w-lg text-[2rem] font-semibold leading-tight tracking-[-0.03em] text-white">
        This workspace does not exist.
      </h1>
      <p className="max-w-md text-[12px] leading-relaxed text-mutedx">
        The link may be stale or the page may not be part of this research build. Return to the terminal or the landing page.
      </p>
      <div className="flex gap-2">
        <Link to="/app/overview" className="btn btn-primary">Open terminal</Link>
        <Link to="/" className="btn btn-outline">Landing page</Link>
      </div>
    </div>
  )
}
