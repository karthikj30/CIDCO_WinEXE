'use client';

import { useEffect, useState } from 'react';
import AdminSignIn from '../AdminSignIn';
import SftpAccountsPanel from './SftpAccountsPanel';
import SftpCompaniesPanel from './SftpCompaniesPanel';
import SftpDataPanel from './SftpDataPanel';
import SftpUploadsPanel from './SftpUploadsPanel';
import { readJson } from '@/lib/fetchJson';

/**
 * CIDCO's SFTP workspace: the company register, the credentials issued against
 * it, and every transfer that has arrived with its validation result. The API
 * channel lives at /cidco.
 */
type Tab = 'uploads' | 'data' | 'companies' | 'accounts';
type AdminUser = { id: string; name: string; email: string; role: string };

function NavButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
        active ? 'bg-violet-50 text-violet-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
      }`}
    >
      {children}
    </button>
  );
}

export default function SftpPortalWorkspace() {
  const [tab, setTab] = useState<Tab>('uploads');
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
    setTab('uploads');
  }

  return (
    <div className="flex h-[calc(100vh-69px)] w-full overflow-hidden bg-slate-50">
      <aside className="flex w-64 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">CIDCO · SFTP</p>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-4">
          <NavButton active={tab === 'uploads'} onClick={() => setTab('uploads')}>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
            Delivered transfers
          </NavButton>
          <NavButton active={tab === 'data'} onClick={() => setTab('data')}>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
            Data
          </NavButton>
          <NavButton active={tab === 'companies'} onClick={() => setTab('companies')}>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18"></path><path d="M5 21V7l7-4 7 4v14"></path><path d="M9 21v-6h6v6"></path></svg>
            Companies (master)
          </NavButton>
          <NavButton active={tab === 'accounts'} onClick={() => setTab('accounts')}>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
            SFTP accounts
          </NavButton>
        </nav>

        <div className="border-t border-slate-200 p-4">
          <a href="/docs/sftp" target="_blank" rel="noreferrer" className="mb-3 block text-xs font-medium text-violet-700 hover:underline">
            → SFTP documentation
          </a>
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
        {!admin ? (
          <AdminSignIn onSignedIn={setAdmin} />
        ) : (
          <>
            {tab === 'uploads' && <SftpUploadsPanel />}
            {tab === 'data' && <SftpDataPanel />}
            {tab === 'companies' && <SftpCompaniesPanel />}
            {tab === 'accounts' && <SftpAccountsPanel />}
          </>
        )}
      </main>
    </div>
  );
}
