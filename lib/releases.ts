import { randomUUID } from 'node:crypto';
import { db, transaction } from './db';
import { HttpError } from './security';
import { sendRelease } from './integrations';
import type { Job, Release, Subscriber } from './types';
export const publicReleases = async () =>
  (
    await db()
      .prepare("SELECT * FROM releases WHERE status='published' ORDER BY published_at DESC")
      .all()
  ).map((row) => ({ ...row })) as Release[];
export async function publishRelease(id: string, notify: boolean) {
  return transaction(async () => {
    await db().lock(824762002);
    const release = (await db().prepare('SELECT * FROM releases WHERE id=?').get(id)) as
      Release | undefined;
    if (!release) throw new HttpError(404, 'Release not found.');
    if (release.status === 'published')
      return { published: true, queued: 0, alreadyPublished: true };
    await db()
      .prepare("UPDATE releases SET status='published',published_at=? WHERE id=?")
      .run(Date.now(), id);
    let queued = 0;
    if (notify) {
      const subscribers = (await db()
        .prepare("SELECT id FROM subscribers WHERE status='active'")
        .all()) as {
        id: string;
      }[];
      const insert = db().prepare(
        'INSERT OR IGNORE INTO deliveries(id,release_id,subscriber_id) VALUES(?,?,?)',
      );
      for (const subscriber of subscribers)
        queued += Number((await insert.run(randomUUID(), id, subscriber.id)).changes);
    }
    return { published: true, queued };
  });
}
export async function drainQueue(batch = 10) {
  // Claim each job under SQLite's write lock; multiple worker processes cannot send the same lease.
  const jobs = await transaction(async () => {
    await db().lock(824762003);
    const now = Date.now();
    await db()
      .prepare("UPDATE deliveries SET status='pending' WHERE status='sending' AND next_attempt < ?")
      .run(now);
    const rows = (await db()
      .prepare(
        "SELECT * FROM deliveries WHERE status='pending' AND next_attempt<=? ORDER BY next_attempt,id LIMIT ?",
      )
      .all(now, batch)) as Job[];
    for (const j of rows)
      await db()
        .prepare(
          "UPDATE deliveries SET status='sending',attempts=attempts+1,next_attempt=? WHERE id=?",
        )
        .run(now + 300000, j.id);
    return rows;
  });
  let sent = 0,
    failed = 0;
  for (const job of jobs) {
    const subscriber = (await db()
      .prepare('SELECT * FROM subscribers WHERE id=?')
      .get(job.subscriber_id)) as Subscriber | undefined;
    const release = (await db()
      .prepare('SELECT * FROM releases WHERE id=?')
      .get(job.release_id)) as Release | undefined;
    if (!subscriber || subscriber.status !== 'active' || release?.status !== 'published') {
      await db().prepare("UPDATE deliveries SET status='skipped' WHERE id=?").run(job.id);
      continue;
    }
    try {
      await sendRelease(subscriber, release, job.id);
      await db()
        .prepare("UPDATE deliveries SET status='sent',sent_at=?,last_error=NULL WHERE id=?")
        .run(Date.now(), job.id);
      sent++;
    } catch (error) {
      const e = error as HttpError;
      const dead = e.status === 410;
      const exhausted = job.attempts + 1 >= 5;
      await db()
        .prepare('UPDATE deliveries SET status=?,next_attempt=?,last_error=? WHERE id=?')
        .run(
          dead || exhausted ? 'failed' : 'pending',
          Date.now() + 60000 * 2 ** job.attempts,
          e instanceof HttpError ? e.message : 'Delivery failed. The worker will retry.',
          job.id,
        );
      if (dead)
        await db()
          .prepare("UPDATE subscribers SET status='unsubscribed' WHERE id=?")
          .run(subscriber.id);
      failed++;
    }
  }
  return { processed: jobs.length, sent, failed };
}
