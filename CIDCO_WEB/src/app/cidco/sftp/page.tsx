import type { Metadata } from 'next';
import CidcoWorkspace from '@/components/CidcoWorkspace';
import ChannelHeader from '@/components/ChannelHeader';

export const metadata: Metadata = {
  title: 'CIDCO Portal — SFTP channel',
  description: 'The SFTP half of the CIDCO desk: deliveries, the site master, and the accounts issued against it.',
};

export const dynamic = 'force-dynamic';

/**
 * The SFTP channel now lives in the one CIDCO workspace along with the API
 * channel. This route stays because it is what is bookmarked, linked from the
 * docs and written in the runbook — it opens the same desk with the SFTP group
 * already selected, so nobody who had the old URL lands somewhere unfamiliar.
 */
export default function CidcoSftpPortalPage() {
  return (
    <div className="flex min-h-screen flex-col overflow-hidden bg-slate-50 font-sans text-slate-900">
      <ChannelHeader
        badge="C"
        title="CIDCO"
        subtitle="AQI Compliance Portal"
        accent="violet"
        links={[{ href: '/', label: 'Switch channel' }]}
      />
      <CidcoWorkspace landing="sftp" />
    </div>
  );
}
