'use client';

import HandshakeTimeline from '../admin/HandshakeTimeline';
import type { MeData } from './ArchitectWorkspace';

export default function ActivityPanel({ me }: { me: MeData }) {
  // One combined, chronological view across all of this architect's handshakes.
  const logs = me.handshakes.flatMap((h) => h.commLogs);

  return (
    <div className="w-full space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-900">Activity log</h2>
        <p className="mt-1 text-sm text-slate-500">
          Your timestamped exchange with CIDCO — validation, tokens, data transfers and any refusals.
        </p>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <HandshakeTimeline logs={logs} />
      </div>
    </div>
  );
}
