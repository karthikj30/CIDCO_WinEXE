import type { Metadata } from 'next';
import PortalWorkspace from '@/components/PortalWorkspace';
import ChannelHeader from '@/components/ChannelHeader';

export const metadata: Metadata = {
  title: 'CIDCO API Portal — AQI Compliance',
  description: 'Approve architect integrations, issue tokens and watch the API data feed.',
};

// Logs and readings change constantly, so never cache this page.
export const dynamic = 'force-dynamic';

export default function CidcoApiPortalPage() {
  return (
    <div className="flex min-h-screen flex-col overflow-hidden bg-slate-50 font-sans text-slate-900">
      <ChannelHeader
        badge="C"
        title="CIDCO"
        subtitle="API Portal"
        accent="cidco"
        links={[
          { href: '/cidco/sftp', label: 'SFTP portal' },
          { href: '/', label: 'Switch channel' },
        ]}
      />
      <PortalWorkspace />
    </div>
  );
}
