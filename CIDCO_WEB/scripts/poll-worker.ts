/**
 * Background poll worker for the AQI SFTP Ingestion Service.
 *
 *   Poll 1 — inbox → company/month/date/timestamp/<file>
 *   Poll 2 — filed file → 10-step validate → DB → archive
 *
 * Run:  npm run poll
 * Interval: POLL_INTERVAL_MS (default 15000)
 */
import { runBothPolls } from '../src/lib/ingestionPoll';

const INTERVAL = Number(process.env.POLL_INTERVAL_MS || 15_000);

async function tick() {
  const started = new Date().toISOString();
  try {
    const result = await runBothPolls();
    console.log(
      `[poll ${started}] poll1 moved=${result.poll1.moved}` +
        (result.poll1.errors.length ? ` errors=${result.poll1.errors.join(' | ')}` : '') +
        ` | poll2 processed=${result.poll2.processed}` +
        (result.poll2.errors.length ? ` errors=${result.poll2.errors.join(' | ')}` : ''),
    );
  } catch (error) {
    console.error(`[poll ${started}] failed:`, error);
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
  console.log(`[poll] AQI SFTP Ingestion Service — every ${INTERVAL}ms`);
  for (;;) {
    await tick();
    await new Promise((resolve) => setTimeout(resolve, INTERVAL));
  }
}

void main();
