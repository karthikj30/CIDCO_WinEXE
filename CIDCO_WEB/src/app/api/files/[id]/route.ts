import type { NextRequest } from 'next/server';
import { authenticate } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { fail, forbidden, handleError, unauthorized } from '@/lib/api';
import { readUpload } from '@/lib/storage';

export const dynamic = 'force-dynamic';

/** GET /api/files/:attachmentId — serves an attachment to its owner or a CIDCO officer. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await authenticate(req);
    if (!auth) return unauthorized();
    const { id } = await params;

    const attachment = await prisma.attachment.findUnique({
      where: { id },
      include: { report: { select: { userId: true } } },
    });
    if (!attachment) return fail('File not found', 404);
    if (auth.user.role === 'ARCHITECT' && attachment.report.userId !== auth.user.id) return forbidden();

    const buffer = await readUpload(attachment.storedName);
    const isInline = attachment.mimeType.startsWith('image/') || attachment.mimeType === 'application/pdf';

    return new Response(new Uint8Array(buffer), {
      headers: {
        'content-type': attachment.mimeType,
        'content-length': String(attachment.sizeBytes),
        'content-disposition': `${isInline ? 'inline' : 'attachment'}; filename="${attachment.fileName.replace(/"/g, '')}"`,
        'cache-control': 'private, max-age=0, no-store',
      },
    });
  } catch (error) {
    return handleError(error);
  }
}
