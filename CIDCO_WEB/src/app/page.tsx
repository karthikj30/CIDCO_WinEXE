import Gateway from '@/components/Gateway';

// The sign-in state decides what renders, so never cache this page.
export const dynamic = 'force-dynamic';

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-slate-50 font-sans text-slate-900">
      <header className="flex-none border-b border-slate-200 bg-white">
        <div className="mx-auto flex w-full items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cidco-700 font-bold text-white">
              C
            </div>
            <div>
              <p className="text-sm font-semibold leading-tight">CIDCO</p>
              <p className="text-xs text-slate-500">AQI Compliance Portal</p>
            </div>
          </div>
          <nav className="flex items-center gap-4">
            <a href="/docs/architect" className="text-xs font-medium text-slate-500 hover:text-slate-900">
              API docs →
            </a>
            <a href="/docs/sftp" className="text-xs font-medium text-slate-500 hover:text-slate-900">
              SFTP docs →
            </a>
          </nav>
        </div>
      </header>

      <Gateway />
    </div>
  );
}
