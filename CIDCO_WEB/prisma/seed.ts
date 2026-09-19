import { createHash } from 'crypto';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/** Fixed local-dev handshake credentials for Connect with CIDCO demos. */
const DEMO_HANDSHAKES = [
  {
    n: 1,
    clientId: 'ARCH-DEMO00000001',
    clientSecret: 'hs_sec_demo_local_dev_only_0001',
    label: 'Demo Architect 1',
  },
  {
    n: 2,
    clientId: 'ARCH-DEMO00000002',
    clientSecret: 'hs_sec_demo_local_dev_only_0002',
    label: 'Demo Architect 2',
  },
  {
    n: 3,
    clientId: 'ARCH-DEMO00000003',
    clientSecret: 'hs_sec_demo_local_dev_only_0003',
    label: 'Demo Architect 3',
  },
  {
    n: 4,
    clientId: 'ARCH-DEMO00000004',
    clientSecret: 'hs_sec_demo_local_dev_only_0004',
    label: 'Demo Architect 4',
  },
  {
    n: 5,
    clientId: 'ARCH-DEMO00000005',
    clientSecret: 'hs_sec_demo_local_dev_only_0005',
    label: 'Demo Architect 5',
  },
] as const;

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

async function main() {
  const passwordHash = await bcrypt.hash('Password123', 10);

  const architect = await prisma.user.upsert({
    where: { email: 'architect@example.com' },
    update: {},
    create: {
      email: 'architect@example.com',
      name: 'Anita Deshmukh',
      passwordHash,
      role: 'ARCHITECT',
      firmName: 'Deshmukh Associates',
      councilRegNo: 'CA/2019/12345',
      phone: '+91 98200 11223',
      accountSetupAt: new Date(),
    },
  });

  // The one login CIDCO hands to every architect. They sign in with this, then
  // identify their company with the SFTP user id and password CIDCO issued.
  await prisma.user.upsert({
    where: { email: 'cidco@gmail.com' },
    update: { passwordHash: await bcrypt.hash('123456', 10) },
    create: {
      email: 'cidco@gmail.com',
      name: 'CIDCO Architect Access',
      passwordHash: await bcrypt.hash('123456', 10),
      role: 'ARCHITECT',
    },
  });

  await prisma.user.upsert({
    where: { email: 'officer@cidco.example' },
    update: {},
    create: {
      email: 'officer@cidco.example',
      name: 'R. K. Patil',
      passwordHash,
      role: 'CIDCO_OFFICER',
    },
  });

  const officer = await prisma.user.findUnique({ where: { email: 'officer@cidco.example' } });
  const credentialExpiresAt = new Date();
  credentialExpiresAt.setFullYear(credentialExpiresAt.getFullYear() + 1);

  // One placeholder architect + PENDING handshake per demo credential.
  // accountSetupAt stays null until they register after CIDCO approval.
  for (const demo of DEMO_HANDSHAKES) {
    const email = `pending-demo-${demo.n}@cidco.local`;
    const pendingArchitect = await prisma.user.upsert({
      where: { email },
      update: { name: `${demo.label} (pending setup)` },
      create: {
        email,
        name: `${demo.label} (pending setup)`,
        passwordHash: await bcrypt.hash(`unused-${demo.clientId}`, 10),
        role: 'ARCHITECT',
      },
    });

    await prisma.architectHandshake.upsert({
      where: { clientId: demo.clientId },
      update: {
        architectId: pendingArchitect.id,
        secretHash: sha256(demo.clientSecret),
        secretPrefix: demo.clientSecret.slice(0, 14),
        credentialExpiresAt,
        status: 'PENDING',
        architectValidatedAt: null,
        establishedAt: null,
        lastValidatedIp: null,
        whitelistedIp: null,
        deviceInfo: null,
        deviceFingerprint: null,
        whitelistedAt: null,
        enforceWhitelist: false,
        revokedAt: null,
      },
      create: {
        architectId: pendingArchitect.id,
        clientId: demo.clientId,
        secretHash: sha256(demo.clientSecret),
        secretPrefix: demo.clientSecret.slice(0, 14),
        credentialExpiresAt,
        status: 'PENDING',
        createdById: officer?.id,
        enforceWhitelist: false,
      },
    });
  }

  const projects = [
    { code: 'CIDCO-KHR-012', name: 'Kharghar Sector 12 Township', node: 'Kharghar', plotNumber: '12/A' },
    { code: 'CIDCO-ULW-045', name: 'Ulwe Node Residential Plot 45', node: 'Ulwe', plotNumber: '45' },
    { code: 'CIDCO-PNV-003', name: 'Panvel Commercial Complex', node: 'Panvel', plotNumber: '3' },
  ];
  for (const project of projects) {
    await prisma.project.upsert({ where: { code: project.code }, update: {}, create: project });
  }

  const existingReports = await prisma.report.count();
  if (existingReports === 0) {
    const kharghar = await prisma.project.findUnique({ where: { code: 'CIDCO-KHR-012' } });
    await prisma.report.createMany({
      data: [
        {
          referenceNo: 'CIDCO/AQI/2026/00001',
          userId: architect.id,
          projectId: kharghar?.id,
          source: 'WEB',
          status: 'APPROVED',
          siteName: 'Kharghar Sector 12 Site',
          location: 'Kharghar, Navi Mumbai',
          latitude: 19.033,
          longitude: 73.063,
          measuredAt: new Date('2026-07-28T09:30:00Z'),
          aqiValue: 148,
          pm25: 62.4,
          pm10: 120.5,
          remarks: 'Morning reading, construction active',
          reviewedBy: 'R. K. Patil',
          reviewNote: 'Verified against board photograph',
          reviewedAt: new Date('2026-07-29T06:00:00Z'),
        },
        {
          referenceNo: 'CIDCO/AQI/2026/00002',
          userId: architect.id,
          source: 'CSV',
          status: 'SUBMITTED',
          siteName: 'Ulwe Node Plot 45',
          location: 'Ulwe, Navi Mumbai',
          measuredAt: new Date('2026-08-02T10:00:00Z'),
          aqiValue: 96,
          pm25: 38.2,
          pm10: 80.1,
        },
      ],
    });
  }

  // The demo company the Windows agent ships pointed at.
  await prisma.company.upsert({
    where: { companyId: 'ABCD123' },
    update: {},
    create: {
      companyId: 'ABCD123',
      companyName: 'Demo Architect Firm',
      // Local by default so the agent works against a dev server out of the box.
      architectServerIp: process.env.DEMO_COMPANY_IP || '127.0.0.1',
      filePath: process.env.DEMO_COMPANY_PATH || 'C:/CIDCO/exports',
      contactEmail: 'demo@architect.example',
      notes: 'Seeded for the CIDCO_WinEXE Windows agent.',
    },
  });

  console.log('Seed complete.');
  console.log('  Architect login : cidco@gmail.com / 123456   (shared, for every architect)');
  console.log('  Demo architect  : architect@example.com / Password123');
  console.log('  Officer login   : officer@cidco.example / Password123');
  console.log('  Windows agent   : cidco@example.com / 123456  ·  company ABCD123');
  console.log('  Connect demos   :');
  for (const demo of DEMO_HANDSHAKES) {
    console.log(`    ${demo.clientId} / ${demo.clientSecret}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
