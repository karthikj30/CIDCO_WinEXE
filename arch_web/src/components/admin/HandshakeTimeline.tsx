'use client';

export type CommLogEntry = {
  id: string;
  direction: string;
  event: string;
  statusCode: number | null;
  detail: string | null;
  ip?: string | null;
  createdAt: string;
};

type Meta = { label: string; dot: string; ring: string; icon: React.ReactNode };

function icon(path: React.ReactNode) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      {path}
    </svg>
  );
}

const EVENT_META: Record<string, Meta> = {
  HANDSHAKE_ISSUED: {
    label: 'Credentials issued',
    dot: 'bg-slate-500 text-white',
    ring: 'ring-slate-100',
    icon: icon(<><path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h10" /></>),
  },
  ARCHITECT_VALIDATED: {
    label: 'Architect validated',
    dot: 'bg-emerald-500 text-white',
    ring: 'ring-emerald-100',
    icon: icon(<polyline points="20 6 9 17 4 12" />),
  },
  CHANNEL_ESTABLISHED: {
    label: 'Channel established',
    dot: 'bg-emerald-600 text-white',
    ring: 'ring-emerald-100',
    icon: icon(<><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" /><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" /></>),
  },
  VALIDATION_FAILED: {
    label: 'Validation failed',
    dot: 'bg-red-500 text-white',
    ring: 'ring-red-100',
    icon: icon(<><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>),
  },
  TOKEN_REQUESTED: {
    label: 'Token requested',
    dot: 'bg-blue-500 text-white',
    ring: 'ring-blue-100',
    icon: icon(<><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 15 14" /></>),
  },
  TOKEN_GENERATED: {
    label: 'Token generated',
    dot: 'bg-cidco-600 text-white',
    ring: 'ring-cidco-100',
    icon: icon(<><circle cx="7.5" cy="15.5" r="4.5" /><path d="m10.5 12.5 8-8" /><path d="m17 4 3 3" /><path d="m15 6 3 3" /></>),
  },
  TOKEN_REQUEST_REJECTED: {
    label: 'Token request rejected',
    dot: 'bg-red-500 text-white',
    ring: 'ring-red-100',
    icon: icon(<><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>),
  },
  DATA_RECEIVED: {
    label: 'AQI data received',
    dot: 'bg-green-600 text-white',
    ring: 'ring-green-100',
    icon: icon(<><path d="M22 12h-6l-2 3h-4l-2-3H2" /><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" /></>),
  },
  DATA_REJECTED: {
    label: 'Data rejected',
    dot: 'bg-red-500 text-white',
    ring: 'ring-red-100',
    icon: icon(<><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>),
  },
  HANDSHAKE_REVOKED: {
    label: 'Handshake revoked',
    dot: 'bg-red-600 text-white',
    ring: 'ring-red-100',
    icon: icon(<><circle cx="12" cy="12" r="9" /><line x1="5.6" y1="5.6" x2="18.4" y2="18.4" /></>),
  },
};

function metaFor(event: string): Meta {
  return (
    EVENT_META[event] ?? {
      label: event,
      dot: 'bg-slate-400 text-white',
      ring: 'ring-slate-100',
      icon: icon(<circle cx="12" cy="12" r="9" />),
    }
  );
}

function fmt(d: string) {
  return new Date(d).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/**
 * Chronological, top-to-bottom timeline of everything that happened during a
 * handshake — issuance, validation, tokens, data transfers and renewals.
 */
export default function HandshakeTimeline({ logs }: { logs: CommLogEntry[] }) {
  if (!logs.length) {
    return <p className="text-sm text-slate-400">No activity recorded yet.</p>;
  }

  // Oldest first, so it reads like a story from issuance onward.
  const ordered = [...logs].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );

  return (
    <ol className="relative space-y-0">
      {ordered.map((l, i) => {
        const meta = metaFor(l.event);
        const isLast = i === ordered.length - 1;
        const failed = l.statusCode != null && l.statusCode >= 400;
        return (
          <li key={l.id} className="relative flex gap-3 pb-5">
            {/* connector line */}
            {!isLast && <span className="absolute left-[13px] top-7 h-full w-px bg-slate-200" aria-hidden />}
            {/* node */}
            <span className={`z-10 mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-full ring-4 ${meta.dot} ${meta.ring}`}>
              {meta.icon}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-sm font-semibold text-slate-900">{meta.label}</span>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    l.direction === 'ARCHITECT_TO_ADMIN' ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {l.direction === 'ARCHITECT_TO_ADMIN' ? 'Architect → CIDCO' : 'CIDCO → Architect'}
                </span>
                {l.statusCode != null && (
                  <span className={`rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold ${failed ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}>
                    {l.statusCode}
                  </span>
                )}
                <span className="ml-auto whitespace-nowrap text-xs text-slate-400">{fmt(l.createdAt)}</span>
              </div>
              {l.detail && <p className="mt-0.5 text-xs text-slate-600">{l.detail}</p>}
              {l.ip && <p className="mt-0.5 text-[11px] text-slate-400">from {l.ip}</p>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
