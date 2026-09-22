import type { Metadata } from 'next';
import { SHEET_COLUMNS } from '@/lib/sftp';

export const metadata: Metadata = {
  title: 'SFTP Channel — CIDCO AQI Portal',
  description: 'How an architect uploads an Excel workbook of AQI readings to CIDCO over SFTP.',
};

function Code({ children }: { children: string }) {
  return (
    <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-900 p-4 text-xs leading-relaxed text-slate-100">
      {children}
    </pre>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6">
      <h2 className="text-xl font-bold text-slate-900">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-slate-700">{children}</div>
    </section>
  );
}

const K = 'rounded bg-slate-100 px-1 font-mono';

export default function SftpDocs() {
  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3 px-6 py-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-600 font-bold text-white">C</div>
            <div>
              <p className="text-sm font-semibold leading-tight">CIDCO</p>
              <p className="text-xs text-slate-500">SFTP channel</p>
            </div>
          </div>
          <a href="/docs/architect" className="text-xs font-medium text-slate-500 hover:text-slate-900">
            API channel docs →
          </a>
        </div>
      </header>

      <div className="mx-auto max-w-4xl px-6 py-10">
        <h1 className="text-3xl font-bold text-slate-900">Sending AQI data over SFTP</h1>
        <p className="mt-2 text-slate-600">
          The second delivery channel: your system exports a CSV of readings and sends it to CIDCO over
          SFTP, automatically. It is entirely separate from the API channel — different credentials, a
          different dashboard. Your SFTP user id will not open the API.
        </p>

        <div className="mt-6 rounded-xl border border-violet-200 bg-violet-50 p-5 text-sm text-violet-900">
          <p className="font-semibold">CIDCO validates every single transfer</p>
          <p className="mt-1">
            Before you get any credentials, CIDCO registers your company by hand — your site name,
            your server&rsquo;s IP address, and the file path your CSV is exported to. On every transfer
            those three are compared against that registration. If any one of them does not match, the
            file is refused and <strong>nothing is stored</strong>.
          </p>
        </div>

        <div className="mt-8 rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-bold text-slate-900">The flow at a glance</h2>
          <ol className="mt-3 space-y-2 text-sm text-slate-700">
            <li><strong>i. CIDCO registers your company</strong> — company name, site name, your server&rsquo;s IP address, and the file path your CSV is taken from. This happens before any credentials exist.</li>
            <li><strong>1. CIDCO emails you</strong> a user id, a password and the <strong>designated IP address</strong> to send to.</li>
            <li><strong>2. You send automatically</strong> — your server takes the CSV from the registered path and puts it on the designated address, on a schedule.</li>
            <li><strong>✓ CIDCO validates the transfer</strong> — site name and file path, both against the registration. Only then are the readings stored.</li>
            <li><strong>Both sides see the result</strong> — the comparison field by field, how many rows became readings, and which rows were rejected and why.</li>
          </ol>
          <p className="mt-3 text-xs text-slate-500">
            There is no separate approval step: registering your company <em>is</em> CIDCO&rsquo;s manual
            check, so your credentials work as soon as they arrive.
          </p>
        </div>

        <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
          <p className="font-semibold">Designated IP</p>
          <p className="mt-2">
            The <strong>designated IP</strong> is CIDCO&rsquo;s — emailed to you, the address you send <em>to</em>.
            Your own machine IP is not stored or checked.
          </p>
        </div>

        <div className="mt-10 space-y-10">
          <Section id="connect" title="1. Connecting">
            <p>Any SFTP client works — FileZilla, WinSCP, or the command line:</p>
            <Code>{`sftp -P 2222 <your user id>@<designated IP>
# password: the one CIDCO emailed you`}</Code>
            <p>
              Password is the only accepted authentication method. Connecting drops you straight into
              your registered file path, so a bare <code className={K}>put readings.csv</code> lands in
              the right place.
            </p>
            <p className="text-xs text-slate-500">
              Your exact designated IP, port, user id and file path are on your dashboard at{' '}
              <code className={K}>/architect/sftp</code>.
            </p>
          </Section>

          <Section id="automatic" title="1a. Sending automatically">
            <p>
              This channel is meant to run unattended: your server exports the CSV to the registered path
              and an SFTP client sends it on a schedule. The repo ships one:
            </p>
            <Code>{`SFTP_USER=<your user id> \\
SFTP_PASSWORD=<your password> \\
SFTP_DESIGNATED_IP=<designated IP> \\
SFTP_FILE_PATH=/var/aqi/exports \\
SFTP_EVERY_MINUTES=180 \\
npx tsx scripts/architect-sender.ts`}</Code>
            <p>
              It takes the newest <code className={K}>.csv</code> from that path and sends it every three
              hours. Add <code className={K}>--once</code> for a single run. Any cron job or scheduler
              that can drive an SFTP client works the same way.
            </p>
          </Section>

          <Section id="portal" title="1b. Sending by hand, from the portal">
            <p>
              <code className={K}>/architect/sftp</code> also gives you a WinSCP-style pair of panes:
              your own files on the left, CIDCO on the right at your registered path. Enter the user id,
              password and designated IP CIDCO emailed you, open the folder your exports are written to,
              and drag a CSV across — or press <strong>Send →</strong>.
            </p>
            <p className="text-xs text-slate-500">
              Transfers sent this way are marked <code className={K}>PORTAL</code> rather than{' '}
              <code className={K}>DIRECT_SFTP</code> on CIDCO&rsquo;s dashboard, and go through exactly
              the same validation — the address checked is the one your browser is connecting from.
            </p>
          </Section>

          <Section id="workbook" title="2. The file">
            <p>
              Download the template from your dashboard, or take the{' '}
              <a href="/api/architect/sftp/template" className="font-semibold text-violet-700 hover:underline">
                CSV
              </a>{' '}
              or the{' '}
              <a href="/api/architect/sftp/template?format=xlsx" className="font-semibold text-violet-700 hover:underline">
                Excel version
              </a>{' '}
              here. <strong>Row 1 is the header; every row after it is one reading.</strong> These are the
              columns CIDCO reads:
            </p>
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-slate-200 bg-slate-50 uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Column</th>
                    <th className="px-3 py-2 font-medium">Example</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {SHEET_COLUMNS.map((c) => (
                    <tr key={c.key}>
                      <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-800">
                        {c.header}
                        {c.key === 'aqiValue' && <span className="ml-2 text-[10px] font-bold uppercase text-red-600">required</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-slate-600">{String(c.example)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              Common alternative spellings are accepted — <code className={K}>PM 2.5</code>,{' '}
              <code className={K}>NO₂</code>, <code className={K}>AQI</code>, <code className={K}>Timestamp</code>,{' '}
              <code className={K}>Site</code> — so a sheet you already keep will usually import as-is. Dates
              can be ISO 8601 text or real Excel date cells.
            </p>
          </Section>

          <Section id="upload" title="3. What happens when it arrives">
            <Code>{`sftp> put september-readings.csv /var/aqi/exports/`}</Code>
            <p>
              Only <code className={K}>.csv</code> and <code className={K}>.xlsx</code> files are accepted;
              anything else is refused at the open. Files up to 25 MB are taken.
            </p>
            <p>
              <strong>CIDCO validates first.</strong> Your site name, the address the transfer came from,
              and the path it was written to are each compared against your registration. Any mismatch and
              the transfer is marked <code className={K}>REJECTED</code> — nothing is parsed, nothing is
              stored — with the failing field named on both dashboards.
            </p>
            <p>
              <strong>Rows are independent.</strong> If one row fails validation it is recorded with its
              sheet row number and the reason, and every other row still imports — one typo never costs
              you the whole upload. Your dashboard then shows the upload as:
            </p>
            <ul className="list-disc space-y-1 pl-6">
              <li><code className={K}>PARSED</code> — validated; every row became a reading.</li>
              <li><code className={K}>PARTIAL</code> — validated; some rows imported, some were rejected (each one named).</li>
              <li><code className={K}>FAILED</code> — validated, but nothing could be imported.</li>
              <li><code className={K}>REJECTED</code> — <strong>failed validation; nothing was stored.</strong></li>
            </ul>
          </Section>

          <Section id="status" title="4. When a transfer is refused">
            <p>Three things can stop a transfer, and each says so plainly:</p>
            <ul className="list-disc space-y-1 pl-6">
              <li>
                <strong>The file path.</strong> Writing to a path other than the registered one is accepted
                by the transport but refused on validation — the file is kept for the record and marked{' '}
                <code className={K}>REJECTED</code>, and no readings are stored.
              </li>
              <li>
                <strong>The credentials.</strong> Expired or revoked, or a registration CIDCO has
                deactivated — ask CIDCO to issue new ones.
              </li>
            </ul>
            <p>
              Every connection and every file is written to your activity log, which both you and CIDCO
              can read.
            </p>
          </Section>
        </div>
      </div>
    </main>
  );
}
