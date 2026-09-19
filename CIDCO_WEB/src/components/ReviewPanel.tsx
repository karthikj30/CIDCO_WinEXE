'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { readJson } from '@/lib/fetchJson';

const STATUSES = ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED'] as const;

export default function ReviewPanel({ reportId, currentStatus }: { reportId: string; currentStatus: string }) {
  const router = useRouter();
  const [status, setStatus] = useState(currentStatus);
  const [reviewNote, setReviewNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/reports/${reportId}/review`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status, reviewNote }),
      });
      const json = await readJson(res);
      if (!res.ok) throw new Error(json.error ?? 'Review failed');
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="card space-y-4 p-5">
      <h2 className="text-sm font-semibold text-slate-900">CIDCO review</h2>
      {error && <div className="alert-error">{error}</div>}
      <div>
        <label className="label" htmlFor="reviewStatus">
          Status
        </label>
        <select id="reviewStatus" name="status" className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace('_', ' ')}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="label" htmlFor="reviewNote">
          Review note
        </label>
        <textarea id="reviewNote" name="reviewNote" className="input" rows={3} value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} />
      </div>
      <button type="submit" className="btn-primary" disabled={loading}>
        {loading ? 'Saving…' : 'Save review'}
      </button>
    </form>
  );
}
