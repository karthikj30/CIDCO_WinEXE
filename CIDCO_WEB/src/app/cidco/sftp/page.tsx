import type { Metadata } from 'next';
import SftpPortalWorkspace from '@/components/admin/sftp/SftpPortalWorkspace';
import ChannelHeader from '@/components/ChannelHeader';

export const metadata: Metadata = {
  title: 'CIDCO SFTP Portal — AQI Compliance',
  description: 'Approve SFTP handshakes and preview the Excel workbooks architects deliver.',
};

export const dynamic = 'force-dynamic';

export default function CidcoSftpPortalPage() {
  return (
    <div className="flex min-h-screen flex-col overflow-hidden bg-slate-50 font-sans text-slate-900">
      <ChannelHeader
        badge="C"
        title="CIDCO"
        subtitle="SFTP Portal"
        accent="violet"
        links={[
          { href: '/cidco', label: 'API portal' },
          { href: '/', label: 'Switch channel' },
        ]}
      />
      <SftpPortalWorkspace />
    </div>
  );
}
