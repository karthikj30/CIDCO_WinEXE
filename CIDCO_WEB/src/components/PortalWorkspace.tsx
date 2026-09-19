'use client';

import { useEffect, useState } from 'react';
import AdminSignIn from './admin/AdminSignIn';
import HandshakesPanel from './admin/HandshakesPanel';
import TokenRequestsPanel from './admin/TokenRequestsPanel';
import CommLogsPanel from './admin/CommLogsPanel';
import ValidationRequestsPanel from './admin/ValidationRequestsPanel';
import DataTablePanel from './admin/DataTablePanel';
import { readJson } from '@/lib/fetchJson';

type Tab = 'data' | 'handshakes' | 'validations' | 'requests' | 'comm';
type AdminUser = { id: string; name: string; email: string; role: string };

// Every tab in this portal is officer-only.
const ADMIN_TABS: Tab[] = ['data', 'handshakes', 'validations', 'requests', 'comm'];

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
        active ? 'bg-cidco-50 text-cidco-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
      }`}
    >
      {children}
    </button>
  );
}

export default function PortalWorkspace() {
  const [activeTab, setActiveTab] = useState<Tab>('data');
  const [admin, setAdmin] = useState<AdminUser | null>(null);

  // Detect an existing CIDCO officer session (cookie) so admin tabs open directly.
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
    setActiveTab('data');
  }

  const needsAdmin = ADMIN_TABS.includes(activeTab) && !admin;

  return (
    <div className="flex h-[calc(100vh-69px)] w-full overflow-hidden bg-slate-50">
      {/* Sidebar */}
      <aside className="flex w-64 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">CIDCO Admin</p>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-4">
          <NavButton active={activeTab === 'data'} onClick={() => setActiveTab('data')}>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path></svg>
            AQI Data
          </NavButton>
          <NavButton active={activeTab === 'handshakes'} onClick={() => setActiveTab('handshakes')}>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 17a4 4 0 0 1-8 0V7a4 4 0 0 1 8 0"></path><path d="M13 7a4 4 0 0 1 8 0v10a4 4 0 0 1-8 0"></path></svg>
            Architect Handshakes
          </NavButton>
          <NavButton active={activeTab === 'validations'} onClick={() => setActiveTab('validations')}>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 12l2 2 4-4"></path><path d="M21 12c0 4.97-4.03 9-9 9s-9-4.03-9-9 4.03-9 9-9c1.66 0 3.22.45 4.56 1.24"></path></svg>
            Validation Requests
          </NavButton>
          <NavButton active={activeTab === 'requests'} onClick={() => setActiveTab('requests')}>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="12" y1="18" x2="12" y2="12"></line><line x1="9" y1="15" x2="15" y2="15"></line></svg>
            Token Requests
          </NavButton>
          <NavButton active={activeTab === 'comm'} onClick={() => setActiveTab('comm')}>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
            Communication Logs
          </NavButton>
        </nav>

        <div className="border-t border-slate-200 p-4">
          <a
            href="/docs/architect"
            target="_blank"
            rel="noreferrer"
            className="mb-3 block text-xs font-medium text-cidco-700 hover:underline"
          >
            → Architect API documentation
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
            <p className="text-xs text-slate-400">Admin tabs require officer sign-in.</p>
          )}
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto p-8">
        {needsAdmin ? (
          <AdminSignIn onSignedIn={setAdmin} />
        ) : (
          <>
            {activeTab === 'data' && <DataTablePanel />}
            {activeTab === 'handshakes' && <HandshakesPanel />}
            {activeTab === 'validations' && <ValidationRequestsPanel />}
            {activeTab === 'requests' && <TokenRequestsPanel />}
            {activeTab === 'comm' && <CommLogsPanel />}
          </>
        )}
      </main>
    </div>
  );
}
