/**
 * The dashboard used to be the SFTP channel's alone and lived here. It now
 * reads both channels from /api/admin/dashboard; this path stays so anything
 * still calling it gets the same answer.
 */
export const dynamic = 'force-dynamic';
export { GET } from '@/app/api/admin/dashboard/route';
