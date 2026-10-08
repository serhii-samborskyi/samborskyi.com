import { setTimeout } from 'node:timers/promises';
import { drainQueue } from '../lib/releases';
import { db } from '../lib/db';
const stop = new AbortController();
process.on('SIGINT', () => stop.abort());
process.on('SIGTERM', () => stop.abort());
console.log('Notification worker is running.');
let lastCleanup = 0;
while (!stop.signal.aborted) {
  try {
    const result = await drainQueue(1);
    if (result.processed)
      console.log(`Deliveries: ${result.sent} sent, ${result.failed} deferred or failed.`);
    const now = Date.now();
    if (now - lastCleanup > 3600000) {
      await db()
        .prepare('DELETE FROM events WHERE created_at < ?')
        .run(now - 90 * 86400000);
      await db().prepare('DELETE FROM event_dedupe WHERE expires_at < ?').run(now);
      await db().prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
      await db().prepare('DELETE FROM rate_limits WHERE resets_at < ?').run(now);
      await db()
        .prepare(
          "DELETE FROM subscribers WHERE status='pending' AND created_at < ? AND id NOT IN (SELECT subscriber_id FROM deliveries)",
        )
        .run(now - 7 * 86400000);
      lastCleanup = now;
    }
    if (result.processed) continue;
  } catch {
    console.error('Queue temporarily unavailable. Retrying.');
  }
  await setTimeout(5000, undefined, { signal: stop.signal }).catch(() => {});
}
await db().close();
