import type { Metadata } from 'next';
import ArchitectSftpWorkspace from '@/components/architect/sftp/ArchitectSftpWorkspace';
import ChannelHeader from '@/components/ChannelHeader';

export const metadata: Metadata = {
  title: 'Architect SFTP Portal — CIDCO AQI',
  description: 'Connect to CIDCO over SFTP and upload your AQI readings as an Excel workbook.',
};

export const dynamic = 'force-dynamic';

export default function ArchitectSftpPortalPage() {
  return (
    <div className="flex min-h-screen flex-col overflow-hidden bg-slate-50 font-sans text-slate-900">
      <ChannelHeader
        badge="A"
        title="Architect Portal"
        subtitle="SFTP file transfer"
        accent="violet"
        links={[
          { href: '/architect', label: 'API portal' },
          { href: '/', label: 'Switch channel' },
        ]}
      />
      <ArchitectSftpWorkspace />
    </div>
  );
}
