'use client';

import { useEffect, useState } from 'react';
import AdminSignIn from './admin/AdminSignIn';
import { readJson } from '@/lib/fetchJson';

// --- API channel panels, unchanged ---
import DataTablePanel from './admin/DataTablePanel';
import HandshakesPanel from './admin/HandshakesPanel';
import ValidationRequestsPanel from './admin/ValidationRequestsPanel';
import TokenRequestsPanel from './admin/TokenRequestsPanel';
import CommLogsPanel from './admin/CommLogsPanel';

// --- SFTP channel panels, unchanged ---
import DashboardPanel from './admin/sftp/DashboardPanel';
import TransfersPanel from './admin/sftp/TransfersPanel';
import SftpDataPanel from './admin/sftp/SftpDataPanel';
import SftpCompaniesPanel from './admin/sftp/SftpCompaniesPanel';
import SftpAccountsPanel from './admin/sftp/SftpAccountsPanel';

/**
 * CIDCO's single workspace.
 *
 * An officer's job does not divide by transport. The same person approves an
 * architect on the API channel and reads the CSVs another one sends over SFTP,
 * and until now that meant two dashboards, two sidebars and two sign-ins that
 * happened to share a cookie. This is one screen with both, grouped by channel
 * so it is still obvious which half of the system a screen belongs to.
 *
 * Every panel below is the one that was already there, imported and rendered
 * as it was. Nothing about how the SFTP side behaves changes — this is the
 * furniture around it.
 *
 * The architect side stays two doors on purpose: an architect uses either the
 * API or the agent, never both, so putting both in front of them would be
 * offering a choice they have already made.
 */
type Tab =
  | 'dashboard'
  | 'transfers' | 'sftpData' | 'companies' | 'accounts'
  | 'apiData' | 'handshakes' | 'validations' | 'requests' | 'comm';

type AdminUser = { id: string; name: string; email: string; role: string };

/** Which tab a URL lands on, so existing links and bookmarks still work. */
export type Landing = 'overview' | 'sftp' | 'api';

const FIRST_TAB: Record<Landing, Tab> = {
  overview: 'dashboard',
  sftp: 'transfers',
  api: 'apiData',
};

const Icon = ({ d }: { d: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    dangerouslySetInnerHTML={{ __html: d }}
  />
);

const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>',
  folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
  building: '<path d="M3 21h18"/><path d="M5 21V7l7-4 7 4v14"/><path d="M9 21v-6h6v6"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  table: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/>',
  handshake: '<path d="M11 17a2 2 0 1 0 4 0 2 2 0 0 0-4 0z"/><path d="M2 12h3l3-3 4 4 3-3h5"/>',
  check: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  key: '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
} as const;

function NavButton({
  active, onClick, icon, children,
}: {
  active: boolean;
  onClick: () => void;
  icon: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        active ? 'bg-violet-50 text-violet-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
      }`}
    >
      <Icon d={icon} />
      {children}
    </button>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
      {children}
    </p>
  );
}

export default function CidcoWorkspace({ landing = 'overview' }: { landing?: Landing }) {
  const [tab, setTab] = useState<Tab>(FIRST_TAB[landing]);
  const [admin, setAdmin] = useState<AdminUser | null>(null);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? readJson(r) : null))
      .then((j) => {
        if (j?.success && j.data.user.role !== 'ARCHITECT') setAdmin(j.data.user);
      })
      .catch(() => {});
  }, []);

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    setAdmin(null);
    setTab(FIRST_TAB[landing]);
  }

  return (
    <div className="flex h-[calc(100vh-69px)] w-full overflow-hidden bg-slate-50">
      <aside className="flex w-64 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">CIDCO</p>
          <p className="mt-0.5 text-xs text-slate-400">Both channels, one desk</p>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto p-4">
          <NavButton active={tab === 'dashboard'} onClick={() => setTab('dashboard')} icon={ICONS.dashboard}>
            Monitoring dashboard
          </NavButton>

          {/* The SFTP half: the Windows agent's deliveries and the master. */}
          <GroupLabel>SFTP channel</GroupLabel>
          <NavButton active={tab === 'transfers'} onClick={() => setTab('transfers')} icon={ICONS.file}>
            Delivered transfers
          </NavButton>
          <NavButton active={tab === 'sftpData'} onClick={() => setTab('sftpData')} icon={ICONS.folder}>
            Data
          </NavButton>
          <NavButton active={tab === 'companies'} onClick={() => setTab('companies')} icon={ICONS.building}>
            Companies (master)
          </NavButton>
          <NavButton active={tab === 'accounts'} onClick={() => setTab('accounts')} icon={ICONS.lock}>
            SFTP accounts
          </NavButton>

          {/* The API half: token-authenticated stations posting readings. */}
          <GroupLabel>API channel</GroupLabel>
          <NavButton active={tab === 'apiData'} onClick={() => setTab('apiData')} icon={ICONS.table}>
            AQI data
          </NavButton>
          <NavButton active={tab === 'handshakes'} onClick={() => setTab('handshakes')} icon={ICONS.handshake}>
            Architect handshakes
          </NavButton>
          <NavButton active={tab === 'validations'} onClick={() => setTab('validations')} icon={ICONS.check}>
            Validation requests
          </NavButton>
          <NavButton active={tab === 'requests'} onClick={() => setTab('requests')} icon={ICONS.key}>
            Token requests
          </NavButton>
          <NavButton active={tab === 'comm'} onClick={() => setTab('comm')} icon={ICONS.message}>
            Communication logs
          </NavButton>
        </nav>

        <div className="border-t border-slate-200 p-4">
          <div className="mb-3 flex flex-col gap-1">
            <a href="/docs/sftp" target="_blank" rel="noreferrer" className="text-xs font-medium text-violet-700 hover:underline">
              → SFTP documentation
            </a>
            <a href="/docs/architect" target="_blank" rel="noreferrer" className="text-xs font-medium text-cidco-700 hover:underline">
              → API documentation
            </a>
          </div>
          {admin ? (
            <div className="flex items-center justify-between">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-900">{admin.name}</p>
                <p className="truncate text-xs text-slate-500">CIDCO officer</p>
              </div>
              <button onClick={signOut} className="text-xs font-semibold text-slate-500 hover:text-slate-900">
                Sign out
              </button>
            </div>
          ) : (
            <p className="text-xs text-slate-400">This portal requires officer sign-in.</p>
          )}
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-8">
        {/* One sign-in for the whole desk, whichever channel you came for. */}
        {!admin ? (
          <AdminSignIn onSignedIn={setAdmin} />
        ) : (
          <>
            {tab === 'dashboard' && <DashboardPanel />}

            {tab === 'transfers' && <TransfersPanel />}
            {tab === 'sftpData' && <SftpDataPanel />}
            {tab === 'companies' && <SftpCompaniesPanel />}
            {tab === 'accounts' && <SftpAccountsPanel />}

            {tab === 'apiData' && <DataTablePanel />}
            {tab === 'handshakes' && <HandshakesPanel />}
            {tab === 'validations' && <ValidationRequestsPanel />}
            {tab === 'requests' && <TokenRequestsPanel />}
            {tab === 'comm' && <CommLogsPanel />}
          </>
        )}
      </main>
    </div>
  );
}
