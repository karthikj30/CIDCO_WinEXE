'use client';

import { useCallback, useEffect, useState } from 'react';

export type StoredTokens = {
  clientId?: string;
  accessToken?: string;
  refreshToken?: string;
  accessExpiresAt?: string;
  refreshExpiresAt?: string;
};

const KEY = 'cidco.architect.tokens';

/**
 * The architect's tokens live in this browser only — the portal holds them the
 * same way an external system would, and every protocol call it makes is a
 * normal token-authenticated request. CIDCO never hands them back out, so the
 * dashboard is not a way around the handshake.
 */
export function useTokens() {
  const [tokens, setTokens] = useState<StoredTokens>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) setTokens(JSON.parse(raw) as StoredTokens);
    } catch {
      /* private mode / cleared storage — start empty */
    }
    setLoaded(true);
  }, []);

  const save = useCallback((next: StoredTokens) => {
    setTokens((prev) => {
      const merged = { ...prev, ...next };
      try {
        localStorage.setItem(KEY, JSON.stringify(merged));
      } catch {
        /* ignore quota / disabled storage */
      }
      return merged;
    });
  }, []);

  const clear = useCallback(() => {
    setTokens({});
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }, []);

  return { tokens, save, clear, loaded };
}

/** "in 6 days", "in 3 h", "expired 2 h ago" — for expiry countdowns. */
export function relativeTime(iso?: string | null) {
  if (!iso) return '—';
  const ms = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(ms);
  const mins = Math.round(abs / 60000);
  const hrs = Math.round(abs / 3600000);
  const days = Math.round(abs / 86400000);
  const span = days >= 1 ? `${days} day${days === 1 ? '' : 's'}` : hrs >= 1 ? `${hrs} h` : `${mins} min`;
  return ms >= 0 ? `in ${span}` : `expired ${span} ago`;
}

export function fmt(iso?: string | null) {
  return iso ? new Date(iso).toLocaleString('en-IN') : '—';
}
