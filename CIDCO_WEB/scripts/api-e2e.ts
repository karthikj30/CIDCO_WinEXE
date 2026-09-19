/**
 * End-to-end drive of the API channel: CIDCO issues credentials -> the
 * architect presents them -> CIDCO approves -> tokens and endpoints are
 * delivered to the architect's dashboard -> the architect creates their own
 * login -> a reading is sent with the access token.
 *
 * Needs the web server running:  npm start
 */
import { prisma } from '../src/lib/prisma';

const BASE = process.env.BASE_URL || 'http://localhost:3000';

const fails: string[] = [];
const check = (ok: boolean, label: string) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
  if (!ok) fails.push(label);
};

/** Each jar is one browser: officers and architects hold separate cookies. */
function jar() {
  let cookie = '';
  return async (path: string, init: RequestInit = {}) => {
    const res = await fetch(BASE + path, {
      ...init,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(init.headers ?? {}) },
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    return { status: res.status, json: await res.json().catch(() => null) };
  };
}

async function main() {
  const stamp = Date.now();
  const officer = jar();
  const architect = jar();

  console.log('== 1. CIDCO issues credentials ==');
  const login = await officer('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'officer@cidco.example', password: 'Password123' }),
  });
  check(login.status === 200, 'officer signed in');

  const placeholderEmail = `api-arch-${stamp}@cidco.local`;
  await officer('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email: placeholderEmail, password: 'Placeholder123', name: 'Pending architect', role: 'ARCHITECT' }),
  });
  // Registering signs the new user in on that jar; put the officer back.
  await officer('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'officer@cidco.example', password: 'Password123' }),
  });

  const issued = await officer('/api/admin/handshakes', {
    method: 'POST',
    body: JSON.stringify({ architectEmail: placeholderEmail, expiresInDays: 30 }),
  });
  check(issued.status === 201, 'credentials issued');
  const cred = issued.json.data.credential;
  check(
    JSON.stringify(Object.keys(cred).sort()) === JSON.stringify(['clientId', 'clientSecret', 'expiryDate']),
    'credential payload is exactly {clientId, clientSecret, expiryDate}',
  );

  console.log('== 2. the architect presents them ==');
  const validated = await architect('/api/architect/validate', {
    method: 'POST',
    body: JSON.stringify({ clientId: cred.clientId, clientSecret: cred.clientSecret, deviceInfo: 'api-e2e' }),
  });
  check(validated.status === 202, `validate answers 202 awaiting approval (got ${validated.status})`);

  const wrong = await architect('/api/architect/validate', {
    method: 'POST',
    body: JSON.stringify({ clientId: cred.clientId, clientSecret: 'wrong-secret' }),
  });
  check(wrong.status === 504, `a wrong password answers 504 (got ${wrong.status})`);

  const status = await architect('/api/architect/handshake-status', {
    method: 'POST',
    body: JSON.stringify({ clientId: cred.clientId, clientSecret: cred.clientSecret }),
  });
  check(status.json.data.approved === false, 'status reports not yet approved');

  console.log('== 3. CIDCO approves and delivers the tokens ==');
  const queue = await officer('/api/admin/validation-requests?status=PENDING');
  const mine = queue.json.data.requests.find(
    (r: { handshake: { clientId: string } }) => r.handshake.clientId === cred.clientId,
  );
  check(!!mine, 'the request is on the API approval queue');

  const approved = await officer(`/api/admin/validation-requests/${mine.id}/approve`, { method: 'POST', body: '{}' });
  check(approved.status === 200, 'officer approved');

  const delivery = await prisma.tokenDelivery.findFirst({
    where: { handshake: { clientId: cred.clientId } },
    orderBy: { createdAt: 'desc' },
  });
  check(!!delivery?.accessToken && !!delivery?.refreshToken, 'both tokens delivered to the dashboard');
  const endpoints = delivery?.endpoints as Record<string, string> | null;
  check(
    !!endpoints && ['sendDataUrl', 'requestTokenUrl', 'validateUrl', 'logsUrl', 'docsUrl'].every((k) => k in endpoints),
    'the endpoint URLs are delivered with the tokens',
  );

  console.log('== 4. the architect creates their own login ==');
  const myEmail = `architect-${stamp}@studio.in`;
  const registered = await architect('/api/architect/register', {
    method: 'POST',
    body: JSON.stringify({
      clientId: cred.clientId,
      clientSecret: cred.clientSecret,
      email: myEmail,
      password: 'MyOwnPass123',
      name: 'Ar. Rhea Nair',
      firmName: 'Nair Design Studio',
      councilRegNo: 'CA/2019/12345',
      designation: 'Principal Architect',
    }),
  });
  check(registered.status === 201, `account created (got ${registered.status})`);

  const officerStillOk = await officer('/api/admin/handshakes');
  check(officerStillOk.status === 200, 'the officer session survives the architect signing in');

  const hsList = await officer('/api/admin/handshakes');
  const hs = hsList.json.data.handshakes.find((h: { clientId: string }) => h.clientId === cred.clientId);
  const detail = await officer(`/api/admin/handshakes/${hs.id}`);
  check(
    detail.json.data.handshake.architect.email === myEmail &&
      detail.json.data.handshake.architect.firmName === 'Nair Design Studio',
    'CIDCO sees the details the architect entered',
  );

  console.log('== 5. the architect sends a reading ==');
  const sent = await fetch(`${BASE}/api/architect/data`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${delivery!.accessToken}` },
    body: JSON.stringify({
      projectSiteId: 'CIDCO-API-E2E',
      monitoringStationId: 'STN-API-01',
      siteName: 'Belapur Node',
      location: 'CBD Belapur',
      measuredAt: '2026-09-11T03:00:00Z',
      aqiValue: 97,
      pm25: 38.2,
      pm10: 72.4,
      temperature: 29.4,
      humidity: 71,
      integrationMethod: 'Automated API (3h)',
    }),
  });
  check(sent.status === 201, `reading stored (got ${sent.status})`);

  console.log('== 6. the two channels stay apart ==');
  const sftpAccounts = await officer('/api/admin/sftp/accounts');
  check(
    !sftpAccounts.json.data.accounts.some((a: { username: string }) => a.username === cred.clientId),
    'the API handshake does NOT appear among the SFTP accounts',
  );

  console.log(fails.length ? `\nFAILED: ${fails.join(' | ')}` : '\nALL API CHANNEL CHECKS PASSED');
  await prisma.$disconnect();
  process.exit(fails.length ? 1 : 0);
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
