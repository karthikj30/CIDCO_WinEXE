import type { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { authenticate } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { fail, handleError, ok, unauthorized } from '@/lib/api';
import { reportSchema } from '@/lib/validation';
import { createReport, logAudit, type PendingAttachment } from '@/lib/reports';
import {
  ALLOWED_DOCUMENT_TYPES,
  ALLOWED_IMAGE_TYPES,
  assertFileAllowed,
} from '@/lib/storage';

import { withLogging } from '@/lib/logger';

export const dynamic = 'force-dynamic';

const DOCUMENT_FIELDS = ['document', 'documents', 'report', 'file'];
const PHOTO_FIELDS = ['boardPhoto', 'boardPhotos', 'aqiBoardPhoto', 'aqiBoardPhotos', 'photo', 'photos', 'images'];

/**
 * POST /api/reports
 *
 * Channel 1 — the architect's system posts the AQI report straight to CIDCO.
 * Accepts multipart/form-data (report fields + the signed document + photos of
 * the on-site AQI board) or a plain JSON body when there is nothing to attach.
 */
export async function POST(req: NextRequest) {
  return withLogging(req, async (req) => {
  try {
    const auth = await authenticate(req);
    if (!auth) return unauthorized();

    const contentType = req.headers.get('content-type') || '';
    let fields: Record<string, unknown> = {};
    const attachments: PendingAttachment[] = [];

    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      for (const [key, value] of form.entries()) {
        if (typeof value === 'string') {
          fields[key] = value;
          continue;
        }
        const file = value as File;
        if (DOCUMENT_FIELDS.includes(key)) {
          assertFileAllowed(file, [...ALLOWED_DOCUMENT_TYPES, ...ALLOWED_IMAGE_TYPES], 'Document');
          attachments.push({ file, kind: 'DOCUMENT' });
        } else if (PHOTO_FIELDS.includes(key)) {
          assertFileAllowed(file, ALLOWED_IMAGE_TYPES, 'AQI board photo');
          attachments.push({ file, kind: 'AQI_BOARD_PHOTO' });
        } else {
          assertFileAllowed(file, [...ALLOWED_DOCUMENT_TYPES, ...ALLOWED_IMAGE_TYPES], 'Attachment');
          attachments.push({ file, kind: 'OTHER' });
        }
      }
    } else if (contentType.includes('application/json')) {
      fields = await req.json();
    } else {
      return fail(
        'Send multipart/form-data (with document and boardPhotos files) or application/json.',
        415,
      );
    }

    const input = reportSchema.parse(fields);

    if (!attachments.some((a) => a.kind === 'AQI_BOARD_PHOTO') && contentType.includes('multipart')) {
      return fail('At least one AQI board photograph is required (field name: boardPhotos)', 422);
    }

    const report = await createReport({
      userId: auth.user.id,
      source: auth.via === 'api-key' ? 'API' : 'WEB',
      input,
      attachments,
    });

    await logAudit('report.create', {
      userId: auth.user.id,
      detail: `${report.referenceNo} via ${auth.via}`,
      ip: req.headers.get('x-forwarded-for') ?? undefined,
    });

    return ok(
      {
        message: 'AQI report received by CIDCO',
        report: {
          id: report.id,
          referenceNo: report.referenceNo,
          status: report.status,
          source: report.source,
          siteName: report.siteName,
          aqiValue: report.aqiValue,
          measuredAt: report.measuredAt,
          attachments: report.attachments.map((a) => ({
            id: a.id,
            kind: a.kind,
            fileName: a.fileName,
            sizeBytes: a.sizeBytes,
            downloadUrl: `/api/files/${a.id}`,
          })),
        },
      },
      201,
    );
  } catch (error) {
    if (error instanceof Error && /exceeds|unsupported type|is empty|Invalid file/.test(error.message)) {
      return fail(error.message, 422);
    }
    return handleError(error);
  }
  });
}

/** GET /api/reports — architects see their own; CIDCO officers see everything. */
export async function GET(req: NextRequest) {
  return withLogging(req, async (req) => {
  try {
    const auth = await authenticate(req);
    if (!auth) return unauthorized();

    const url = new URL(req.url);
    const page = Math.max(1, Number(url.searchParams.get('page') ?? 1));
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize') ?? 20)));
    const status = url.searchParams.get('status');
    const source = url.searchParams.get('source');
    const search = url.searchParams.get('q');

    const where: Prisma.ReportWhereInput = {};
    if (auth.user.role === 'ARCHITECT') where.userId = auth.user.id;
    if (status) where.status = status as Prisma.ReportWhereInput['status'];
    if (source) where.source = source as Prisma.ReportWhereInput['source'];
    if (search) {
      where.OR = [
        { siteName: { contains: search, mode: 'insensitive' } },
        { location: { contains: search, mode: 'insensitive' } },
        { referenceNo: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [total, reports] = await Promise.all([
      prisma.report.count({ where }),
      prisma.report.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          attachments: { select: { id: true, kind: true, fileName: true, sizeBytes: true } },
          user: { select: { id: true, name: true, email: true, firmName: true } },
        },
      }),
    ]);

    return ok({ page, pageSize, total, totalPages: Math.ceil(total / pageSize) || 1, reports });
  } catch (error) {
    return handleError(error);
  }
  });
}
