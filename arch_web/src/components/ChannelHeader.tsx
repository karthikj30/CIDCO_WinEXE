/**
 * The bar at the top of every channel dashboard. It names the channel you are
 * in and gives one click back to the chooser, so the API and SFTP workspaces
 * never get mistaken for each other.
 */
const ACCENTS = {
  cidco: 'bg-cidco-700',
  emerald: 'bg-emerald-600',
  violet: 'bg-violet-600',
} as const;

export default function ChannelHeader({
  badge,
  title,
  subtitle,
  accent,
  links,
}: {
  badge: string;
  title: string;
  subtitle: string;
  accent: keyof typeof ACCENTS;
  links: Array<{ href: string; label: string }>;
}) {
  return (
    <header className="flex-none border-b border-slate-200 bg-white">
      <div className="mx-auto flex w-full items-center justify-between gap-4 px-6 py-4">
        <div className="flex items-center gap-3">
          <div className={`flex h-9 w-9 items-center justify-center rounded-lg font-bold text-white ${ACCENTS[accent]}`}>
            {badge}
          </div>
          <div>
            <p className="text-sm font-semibold leading-tight">{title}</p>
            <p className="text-xs text-slate-500">{subtitle}</p>
          </div>
        </div>
        <nav className="flex items-center gap-4">
          {links.map((l) => (
            <a key={l.href} href={l.href} className="text-xs font-medium text-slate-500 hover:text-slate-900">
              {l.label} →
            </a>
          ))}
        </nav>
      </div>
    </header>
  );
}
