import type { Metadata } from 'next';
import ArchitectWorkspace from '@/components/architect/ArchitectWorkspace';
import ChannelHeader from '@/components/ChannelHeader';
import { cidcoWebUrl } from '@/lib/cidcoWeb';

export const metadata: Metadata = {
  title: 'Architect API Portal — CIDCO AQI',
  description: 'Validate with CIDCO, manage your tokens and send AQI data over the API.',
};

export const dynamic = 'force-dynamic';

export default function ArchitectApiPortalPage() {
  // Resolved on the server for each request, so moving the CIDCO portal is
  // an .env change rather than a rebuild.
  const cidco = cidcoWebUrl();

  return (
    <div className="flex min-h-screen flex-col overflow-hidden bg-slate-50 font-sans text-slate-900">
      <ChannelHeader
        badge="A"
        title="Architect Portal"
        subtitle="API integration"
        accent="emerald"
        links={[
          // Both live on the CIDCO portal, which is usually another port.
          { href: `${cidco}/architect/sftp`, label: 'SFTP portal' },
          { href: `${cidco}/`, label: 'Switch channel' },
        ]}
      />
      <ArchitectWorkspace />
    </div>
  );
}
