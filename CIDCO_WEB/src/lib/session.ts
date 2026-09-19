import { redirect } from 'next/navigation';
import { getSessionUser } from './auth';

/**
 * Guard for server components. The dashboard layout redirects too, but layouts
 * and pages render in parallel — each page needs its own check so it never
 * dereferences a null user first.
 */
export async function requireUser() {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  return user;
}
