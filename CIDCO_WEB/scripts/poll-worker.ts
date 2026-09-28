/**
 * Background poll worker for the AQI SFTP Ingestion Service.
 *
 *   Poll 1 — inbox → siteName/dd_mm_yyyy/hh-mm-ss.csv
 *   Poll 2 — filed file → 10-step validate → DB → archive
 *
 * Run both on one schedule (the default, and what most sites want):
 *
 *   npm run poll
 *
 * Or run them apart, on their own schedules — poll1 is cheap and often wants
 * to be quick, so a delivery is filed the moment it lands, while poll2 parses
 * whole spreadsheets and is happy to run less often:
 *
 *   POLL1_INTERVAL_MS=5000   npm run poll -- --only=1
 *   POLL2_INTERVAL_MS=60000  npm run poll -- --only=2
 *
 * Interval, most specific first:
 *   --interval=<ms>                        on the command line
 *   POLL1_INTERVAL_MS / POLL2_INTERVAL_MS  per poll
 *   POLL_INTERVAL_MS                       both (default 15000)
 */
import { runBothPolls, runPoll1, runPoll2 } from '../src/lib/ingestionPoll';

type Which = '1' | '2' | 'both';

function arg(name: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit?.split('=')[1];
}

const which: Which = (() => {
  const value = arg('only');
  return value === '1' || value === '2' ? value : 'both';
})();

const INTERVAL = (() => {
  const onCommandLine = Number(arg('interval'));
  if (Number.isFinite(onCommandLine) && onCommandLine > 0) return onCommandLine;

  const perPoll =
    which === '1' ? process.env.POLL1_INTERVAL_MS :
    which === '2' ? process.env.POLL2_INTERVAL_MS :
    undefined;

  return Number(perPoll || process.env.POLL_INTERVAL_MS || 15_000);
})();

const label = which === 'both' ? 'poll' : `poll${which}`;

async function tick() {
  const started = new Date().toISOString();
  try {
    if (which === '1') {
      const r = await runPoll1();
      console.log(
        `[${label} ${started}] moved=${r.moved}` +
          (r.errors.length ? ` errors=${r.errors.join(' | ')}` : ''),
      );
      return;
    }

    if (which === '2') {
      const r = await runPoll2();
      console.log(
        `[${label} ${started}] processed=${r.processed}` +
          (r.errors.length ? ` errors=${r.errors.join(' | ')}` : ''),
      );
      return;
    }

    const result = await runBothPolls();
    console.log(
      `[${label} ${started}] poll1 moved=${result.poll1.moved}` +
        (result.poll1.errors.length ? ` errors=${result.poll1.errors.join(' | ')}` : '') +
        ` | poll2 processed=${result.poll2.processed}` +
        (result.poll2.errors.length ? ` errors=${result.poll2.errors.join(' | ')}` : ''),
    );
  } catch (error) {
    console.error(`[${label} ${started}] failed:`, error);
  }
}

/**
 * One tick at a time.
 *
 * setInterval would start a second tick while the first is still reading a
 * large file, and two runs racing over the same inbox is exactly the way to
 * ingest one delivery twice. Scheduling the next tick only once the current
 * one has finished costs nothing and makes that impossible.
 */
async function main() {
  console.log(`[${label}] AQI SFTP Ingestion Service — every ${INTERVAL}ms`);
  for (;;) {
    await tick();
    await new Promise((resolve) => setTimeout(resolve, INTERVAL));
  }
}

void main();
