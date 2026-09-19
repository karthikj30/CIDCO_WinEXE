import type { Metadata } from 'next';
import ArchitectWorkspace from '@/components/architect/ArchitectWorkspace';
import ChannelHeader from '@/components/ChannelHeader';

export const metadata: Metadata = {
  title: 'Architect API Portal — CIDCO AQI',
  description: 'Validate with CIDCO, manage your tokens and send AQI data over the API.',
};

export const dynamic = 'force-dynamic';

export default function ArchitectApiPortalPage() {
  return (
    <div className="flex min-h-screen flex-col overflow-hidden bg-slate-50 font-sans text-slate-900">
      <ChannelHeader
        badge="A"
        title="Architect Portal"
        subtitle="API integration"
        accent="emerald"
        links={[
          { href: '/architect/sftp', label: 'SFTP portal' },
          { href: '/', label: 'Switch channel' },
        ]}
      />
      <ArchitectWorkspace />
    </div>
  );
}
