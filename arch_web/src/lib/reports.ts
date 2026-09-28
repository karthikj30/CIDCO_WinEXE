import type { AttachmentKind, Prisma, ReportSource } from '@prisma/client';
import { prisma } from './prisma';
import type { ReportInput } from './validation';
import { saveUpload, type StoredFile } from './storage';

/**
 * Reference numbers are derived from the highest serial already issued this
 * year rather than from a row count, so withdrawing a report can never make
 * the next submission reuse its number.
 */
export async function nextReferenceNo() {
  const year = new Date().getFullYear();
  const prefix = `CIDCO/AQI/${year}/`;
  const latest = await prisma.report.findFirst({
    where: { referenceNo: { startsWith: prefix } },
    orderBy: { referenceNo: 'desc' },
    select: { referenceNo: true },
  });
  const lastSerial = latest ? Number(latest.referenceNo.slice(prefix.length)) : 0;
  const serial = String((Number.isNaN(lastSerial) ? 0 : lastSerial) + 1).padStart(5, '0');
  return `${prefix}${serial}`;
}

async function resolveProjectId(projectCode: string | null) {
  if (!projectCode) return null;
  const project = await prisma.project.findUnique({ where: { code: projectCode } });
  return project?.id ?? null;
}

export type PendingAttachment = { file: File; kind: AttachmentKind };

/**
 * Single write path for all three intake channels (API, CSV, web form) so a
 * report looks identical regardless of how it arrived.
 */
export async function createReport(params: {
  userId: string;
  source: ReportSource;
  input: ReportInput;
  /** The registered company that delivered this reading (SFTP channel). */
  companyRecordId?: string | null;
  attachments?: PendingAttachment[];
  preStored?: Array<StoredFile & { kind: AttachmentKind }>;
}) {
  const { userId, source, input, companyRecordId = null, attachments = [], preStored = [] } = params;

  const stored: Array<StoredFile & { kind: AttachmentKind }> = [...preStored];
  for (const item of attachments) {
    const saved = await saveUpload(item.file);
    stored.push({ ...saved, kind: item.kind });
  }

  const projectId = await resolveProjectId(input.projectCode);

  // Two concurrent submissions can compute the same serial; the unique index
  // catches it and we simply take the next one.
  for (let attempt = 0; ; attempt++) {
    try {
      return await writeReport();
    } catch (error) {
      const isDuplicateReference =
        typeof error === 'object' &&
        error !== null &&
        (error as { code?: string }).code === 'P2002' &&
        String((error as { meta?: { target?: unknown } }).meta?.target).includes('referenceNo');
      if (!isDuplicateReference || attempt >= 5) throw error;
    }
  }

  async function writeReport() {
    return prisma.report.create({
      data: {
        referenceNo: await nextReferenceNo(),
        userId,
        projectId,
        companyRecordId,
        source,
        siteName: input.siteName,
        location: input.location,
        latitude: input.latitude,
        longitude: input.longitude,
        measuredAt: input.measuredAt,
        aqiValue: input.aqiValue,
        pm25: input.pm25,
        pm10: input.pm10,
        so2: input.so2,
        no2: input.no2,
        co: input.co,
        ozone: input.ozone,
        remarks: input.remarks,
        projectSiteId: input.projectSiteId,
        monitoringStationId: input.monitoringStationId,
        oem: input.oem,
        deviceModel: input.deviceModel,
        temperature: input.temperature,
        humidity: input.humidity,
        integrationMethod: input.integrationMethod,
        otherParams: input.otherParams == null ? undefined : (input.otherParams as Prisma.InputJsonValue),
        attachments: {
          create: stored.map((s) => ({
            kind: s.kind,
            fileName: s.fileName,
            storedName: s.storedName,
            mimeType: s.mimeType,
            sizeBytes: s.sizeBytes,
          })),
        },
      },
      include: { attachments: true, project: true },
    });
  }
}

export async function logAudit(action: string, opts: { userId?: string; detail?: string; ip?: string } = {}) {
  try {
    await prisma.auditLog.create({
      data: { action, userId: opts.userId ?? null, detail: opts.detail ?? null, ip: opts.ip ?? null },
    });
  } catch (error) {
    // Auditing must never break the request it is describing.
    console.error('[audit] failed to record', action, error);
  }
}
