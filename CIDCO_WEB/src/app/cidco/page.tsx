import type { Metadata } from 'next';
import CidcoWorkspace from '@/components/CidcoWorkspace';
import ChannelHeader from '@/components/ChannelHeader';

export const metadata: Metadata = {
  title: 'CIDCO Portal — AQI Compliance',
  description:
    'One desk for both channels: the SFTP deliveries architects send from the Windows agent, and the API integrations their stations post through.',
};

// Logs and readings change constantly, so never cache this page.
export const dynamic = 'force-dynamic';

export default function CidcoPortalPage() {
  return (
    <div className="flex min-h-screen flex-col overflow-hidden bg-slate-50 font-sans text-slate-900">
      <ChannelHeader
        badge="C"
        title="CIDCO"
        subtitle="AQI Compliance Portal"
        accent="cidco"
        links={[{ href: '/docs/architect', label: 'API docs' }, { href: '/docs/sftp', label: 'SFTP docs' }]}
      />
      <CidcoWorkspace landing="overview" />
    </div>
  );
}
