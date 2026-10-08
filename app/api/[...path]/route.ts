import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { db, dataDir } from '@/lib/db';
import {
  HttpError,
  constantEqual,
  hash,
  jsonBody,
  origin,
  rateLimit,
  requireAdmin,
  sameOrigin,
  sessionCookie,
  sessionValue,
  signedLink,
  textField,
  token,
  verifyLink,
  verifyPassword,
} from '@/lib/security';
import { configuration, sendEmail, telegram, validatePush } from '@/lib/integrations';
import { drainQueue, publicReleases, publishRelease } from '@/lib/releases';
import type { Subscriber, Upload } from '@/lib/types';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
async function getSubscriber(value: string, purpose: string) {
  const { id, extra } = verifyLink(purpose, value);
  const row = (await db().prepare('SELECT * FROM subscribers WHERE id=?').get(id)) as
    Subscriber | undefined;
  if (!row) throw new HttpError(400, 'This link is no longer valid.');
  return { row, extra };
}
async function unsubscribe(value: string) {
  const { row, extra } = await getSubscriber(value, 'unsubscribe');
  if (extra !== row.confirm_nonce) throw new HttpError(400, 'This link is no longer valid.');
  await db().prepare("UPDATE subscribers SET status='unsubscribed' WHERE id=?").run(row.id);
  return json({ message: 'You’re unsubscribed. Thanks for listening.' });
}
async function route(req: Request) {
  const url = new URL(req.url),
    p = url.pathname.replace(/^\/api\/?/, '');
  const method = req.method;
  if (p === 'health' && method === 'GET') {
    try {
      await db().prepare('SELECT 1 AS ok').get();
      return json({ status: 'ok' });
    } catch {
      return json({ status: 'unavailable' }, 503);
    }
  }
  if (p === 'config' && method === 'GET') return json(configuration());
  if (p === 'releases' && method === 'GET') return json({ releases: await publicReleases() });
  if (p.startsWith('media/') && method === 'GET') {
    const id = p.slice(6);
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new HttpError(404, 'Audio not found.');
    const file = (await db()
      .prepare(
        'SELECT id,filename,mime,size,kind,content IS NOT NULL AS stored FROM uploads WHERE id=?',
      )
      .get(id)) as (Upload & { stored: boolean | number }) | undefined;
    if (!file) throw new HttpError(404, 'Audio not found.');
    const published = await db()
      .prepare(
        "SELECT id FROM releases WHERE status='published' AND (audio_id=? OR artwork_id=?) LIMIT 1",
      )
      .get(id, id);
    if (!published) await requireAdmin(req);
    const disk = path.join(dataDir(), 'uploads', id);
    const { size } = file;
    const headers: Record<string, string> = {
      'Content-Type': file.mime,
      'Accept-Ranges': 'bytes',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': published ? 'public, max-age=3600' : 'private, no-store',
      'Content-Disposition': 'inline',
    };
    let start = 0,
      end = size - 1,
      status = 200;
    const range = req.headers.get('range');
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2]))
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
      if (match[1]) {
        start = Number(match[1]);
        end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
      } else {
        start = Math.max(0, size - Number(match[2]));
      }
      if (start > end || start >= size)
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
      headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
      status = 206;
    }
    headers['Content-Length'] = String(end - start + 1);
    if (file.stored) {
      const row = await db()
        .prepare('SELECT substr(content,?,?) AS bytes FROM uploads WHERE id=?')
        .get(start + 1, end - start + 1, id);
      return new Response(new Uint8Array(row!.bytes as Uint8Array), { status, headers });
    }
    // Existing local SQLite uploads remain readable without a destructive migration.
    return new Response(Readable.toWeb(createReadStream(disk, { start, end })) as ReadableStream, {
      status,
      headers,
    });
  }
  if (p === 'telegram/webhook' && method === 'POST') {
    if (
      !process.env.TELEGRAM_WEBHOOK_SECRET ||
      !constantEqual(
        req.headers.get('x-telegram-bot-api-secret-token') || '',
        process.env.TELEGRAM_WEBHOOK_SECRET,
      )
    )
      throw new HttpError(403, 'Invalid webhook.');
    const body = await jsonBody(req),
      message = body.message;
    if (!message || message.chat?.type !== 'private' || !Number.isSafeInteger(message.chat.id))
      return json({ ok: true });
    const address = String(message.chat.id),
      command = String(message.text || '')
        .split(/\s/)[0]
        .split('@')[0];
    if (command === '/start') {
      await db()
        .prepare(
          "INSERT INTO subscribers(id,channel,address,status,confirm_nonce,created_at,confirmed_at) VALUES(?,'telegram',?,'active',?,?,?) ON CONFLICT(channel,address) DO UPDATE SET status='active',confirmed_at=excluded.confirmed_at",
        )
        .run(randomUUID(), address, token(), Date.now(), Date.now());
      await telegram(
        address,
        'You’re in. I’ll send new music here when it’s ready.\n\n— Serhii Samborskyi\n\nSend /stop anytime to unsubscribe.',
      );
    } else if (command === '/stop') {
      await db()
        .prepare(
          "UPDATE subscribers SET status='unsubscribed' WHERE channel='telegram' AND address=?",
        )
        .run(address);
      await telegram(
        address,
        'You’re unsubscribed. Thanks for listening. Send /start if you’d like to return.',
      );
    } else if (command === '/help')
      await telegram(
        address,
        '/start — subscribe to new music\n/stop — unsubscribe\n\n' + origin(),
      );
    return json({ ok: true });
  }
  // RFC 8058 mail clients intentionally post without a browser Origin header.
  if (p === 'unsubscribe/one-click' && method === 'POST') {
    if ((await req.text()) !== 'List-Unsubscribe=One-Click')
      throw new HttpError(400, 'Invalid unsubscribe request.');
    return unsubscribe(url.searchParams.get('token') || '');
  }
  if (!['GET', 'HEAD'].includes(method)) sameOrigin(req);
  if (p === 'login' && method === 'POST') {
    await rateLimit(req, 'login', 8, 15 * 60000);
    const { password } = await jsonBody(req);
    if (typeof password !== 'string' || password.length > 200 || !verifyPassword(password))
      throw new HttpError(401, 'That password doesn’t match. Please try again.');
    const value = token();
    await db()
      .prepare('INSERT INTO sessions(token_hash,expires_at) VALUES(?,?)')
      .run(hash(value), Date.now() + 86400000);
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(value) });
  }
  if (p === 'logout' && method === 'POST') {
    await db()
      .prepare('DELETE FROM sessions WHERE token_hash=?')
      .run(hash(sessionValue(req)));
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie('', 0) });
  }
  if (p === 'subscribe/email' && method === 'POST') {
    await rateLimit(req, 'email', 10);
    if (!configuration().email)
      throw new HttpError(503, 'Email updates will open soon. Please check back.');
    const { email, consent, website } = await jsonBody(req);
    if (website) return json({ message: 'Check your inbox to confirm your subscription.' });
    if (consent !== true) throw new HttpError(400, 'Please agree to receive new release emails.');
    if (
      typeof email !== 'string' ||
      email.length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    )
      throw new HttpError(400, 'Please enter a valid email address.');
    const address = email.trim().toLowerCase(),
      now = Date.now();
    await db()
      .prepare(
        "INSERT OR IGNORE INTO subscribers(id,channel,address,status,confirm_nonce,created_at) VALUES(?,'email',?,'pending',?,?)",
      )
      .run(randomUUID(), address, token(), now);
    const sub = (await db()
      .prepare("SELECT * FROM subscribers WHERE channel='email' AND address=?")
      .get(address)) as Subscriber & {
      last_confirmation: number;
    };
    if (sub.status !== 'active' && now - sub.last_confirmation > 60000) {
      const nonce = token();
      await db()
        .prepare(
          "UPDATE subscribers SET status='pending',confirm_nonce=?,last_confirmation=? WHERE id=?",
        )
        .run(nonce, now, sub.id);
      const confirmation = signedLink('confirm', sub.id, `${nonce}:${now + 86400000}`);
      try {
        await sendEmail(
          address,
          'One more step — join the listening room',
          `Confirm you’d like new music from Serhii Samborskyi:\n\n${origin()}/confirm?token=${confirmation}\n\nThis link expires in 24 hours. If you didn’t sign up, you can ignore this email.`,
          `${sub.id}-${nonce}`,
        );
      } catch {
        await db().prepare('UPDATE subscribers SET last_confirmation=0 WHERE id=?').run(sub.id);
        throw new HttpError(502, 'We couldn’t send your confirmation. Please try again shortly.');
      }
    }
    return json({ message: 'Check your inbox to confirm your subscription.' });
  }
  if (p === 'confirm' && method === 'POST') {
    await rateLimit(req, 'confirm', 30);
    const body = await jsonBody(req),
      { row, extra } = await getSubscriber(String(body.token || ''), 'confirm');
    const [nonce, expiry] = extra.split(':');
    if (
      nonce !== row.confirm_nonce ||
      Number(expiry) < Date.now() ||
      !Number.isFinite(Number(expiry)) ||
      row.status === 'unsubscribed'
    )
      throw new HttpError(400, 'This confirmation link has expired. Please subscribe again.');
    await db()
      .prepare("UPDATE subscribers SET status='active',confirmed_at=? WHERE id=?")
      .run(Date.now(), row.id);
    return json({ message: 'You’re in. I’ll be in touch when there’s something new to hear.' });
  }
  if (p === 'unsubscribe' && method === 'POST') {
    const body = await jsonBody(req);
    return unsubscribe(String(body.token || ''));
  }
  if (p === 'subscribe/push' && (method === 'POST' || method === 'DELETE')) {
    await rateLimit(req, 'push', 30);
    const body = await jsonBody(req),
      subscription = validatePush(body.subscription);
    if (method === 'DELETE') {
      await db()
        .prepare(
          "UPDATE subscribers SET status='unsubscribed' WHERE channel='push' AND address=? AND data=?",
        )
        .run(subscription.endpoint, JSON.stringify(subscription));
      return json({ message: 'Browser notifications are off.' });
    }
    if (!configuration().pushKey)
      throw new HttpError(503, 'Browser notifications will open soon. Please check back.');
    await db()
      .prepare(
        "INSERT INTO subscribers(id,channel,address,data,status,confirm_nonce,created_at,confirmed_at) VALUES(?,'push',?,?,'active',?,?,?) ON CONFLICT(channel,address) DO UPDATE SET status='active',data=excluded.data,confirmed_at=excluded.confirmed_at",
      )
      .run(
        randomUUID(),
        subscription.endpoint,
        JSON.stringify(subscription),
        token(),
        Date.now(),
        Date.now(),
      );
    return json({ message: 'You’re connected. New music will find you here.' });
  }
  if (p === 'events' && method === 'POST') {
    await rateLimit(req, 'events', 500, 60000);
    const body = await jsonBody(req);
    if (
      body.consent !== true ||
      !['page_view', 'play', 'listen_30', 'complete', 'subscribe'].includes(body.type) ||
      typeof body.visitorId !== 'string' ||
      !/^[a-f0-9-]{36}$/.test(body.visitorId)
    )
      throw new HttpError(400, 'Invalid listening event.');
    let releaseId: string | null = null;
    if (['play', 'listen_30', 'complete'].includes(body.type)) {
      if (
        typeof body.releaseId !== 'string' ||
        !(await db()
          .prepare("SELECT id FROM releases WHERE id=? AND status='published'")
          .get(body.releaseId))
      )
        throw new HttpError(400, 'Release not found.');
      releaseId = body.releaseId;
    }
    const key = hash(
      `${body.visitorId}:${body.type}:${releaseId || ''}:${Math.floor(Date.now() / 300000)}`,
    );
    if (
      (
        await db()
          .prepare('INSERT OR IGNORE INTO event_dedupe(key,expires_at) VALUES(?,?)')
          .run(key, Date.now() + 600000)
      ).changes
    )
      await db()
        .prepare('INSERT INTO events(id,visitor_id,type,release_id,created_at) VALUES(?,?,?,?,?)')
        .run(randomUUID(), body.visitorId, body.type, releaseId, Date.now());
    return json({ ok: true });
  }
  if (p.startsWith('admin/')) {
    await requireAdmin(req);
    if (p === 'admin/overview' && method === 'GET') {
      const since = Date.now() - 30 * 86400000;
      const stats = {
        releases: (
          (await db()
            .prepare("SELECT COUNT(*) AS n FROM releases WHERE status='published'")
            .get()) as {
            n: number;
          }
        ).n,
        listeners: (
          (await db()
            .prepare(
              "SELECT COUNT(DISTINCT visitor_id) AS n FROM events WHERE type='play' AND created_at>=?",
            )
            .get(since)) as {
            n: number;
          }
        ).n,
        plays: (
          (await db()
            .prepare("SELECT COUNT(*) AS n FROM events WHERE type='play' AND created_at>=?")
            .get(since)) as {
            n: number;
          }
        ).n,
        subscribers: (
          (await db()
            .prepare("SELECT COUNT(*) AS n FROM subscribers WHERE status='active'")
            .get()) as {
            n: number;
          }
        ).n,
      };
      return json({
        stats,
        releases: await db().prepare('SELECT * FROM releases ORDER BY created_at DESC').all(),
        channels: await db()
          .prepare(
            "SELECT channel,COUNT(*) AS count FROM subscribers WHERE status='active' GROUP BY channel",
          )
          .all(),
        deliveries: await db()
          .prepare('SELECT status,COUNT(*) AS count FROM deliveries GROUP BY status')
          .all(),
        integrations: configuration(),
      });
    }
    if (p === 'admin/uploads' && method === 'POST') {
      const max = 80 * 1024 * 1024;
      if (!req.headers.get('content-type')?.startsWith('multipart/form-data'))
        throw new HttpError(400, 'Choose a file to upload.');
      if (Number(req.headers.get('content-length') || 0) > max + 16384)
        throw new HttpError(413, 'Please upload a file smaller than 80 MB.');
      const chunks: Uint8Array[] = [];
      let length = 0;
      const reader = req.body?.getReader();
      if (!reader) throw new HttpError(400, 'Choose a file.');
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > max + 16384) {
          await reader.cancel();
          throw new HttpError(413, 'Please upload a file smaller than 80 MB.');
        }
        chunks.push(value);
      }
      const form = await new Response(Buffer.concat(chunks), {
        headers: { 'Content-Type': req.headers.get('content-type')! },
      }).formData();
      const file = form.get('file');
      if (!(file instanceof File) || file.size === 0 || file.size > max)
        throw new HttpError(400, 'Choose an audio file or cover image under 80 MB.');
      const buffer = Buffer.from(await file.arrayBuffer());
      const ascii = (a: number, b: number) => buffer.subarray(a, b).toString('ascii');
      let mime = '',
        kind: 'audio' | 'image' = 'audio';
      if (ascii(0, 3) === 'ID3' || (buffer[0] === 255 && (buffer[1] & 224) === 224))
        mime = 'audio/mpeg';
      else if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') mime = 'audio/wav';
      else if (ascii(0, 4) === 'OggS') mime = 'audio/ogg';
      else if (ascii(0, 4) === 'fLaC') mime = 'audio/flac';
      else if (ascii(4, 8) === 'ftyp' && ['M4A ', 'M4B '].includes(ascii(8, 12)))
        mime = 'audio/mp4';
      else if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) {
        mime = 'image/jpeg';
        kind = 'image';
      } else if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
        mime = 'image/png';
        kind = 'image';
      } else if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') {
        mime = 'image/webp';
        kind = 'image';
      }
      if (!mime)
        throw new HttpError(400, 'Use MP3, WAV, OGG, FLAC, M4A audio, or JPG, PNG, WebP images.');
      if (kind === 'image' && file.size > 10 * 1024 * 1024)
        throw new HttpError(413, 'Cover images must be under 10 MB.');
      const id = randomUUID();
      await db()
        .prepare(
          'INSERT INTO uploads(id,filename,mime,size,kind,created_at,content) VALUES(?,?,?,?,?,?,?)',
        )
        .run(id, file.name.slice(0, 200), mime, file.size, kind, Date.now(), buffer);
      return json({ id, kind, mime, size: file.size }, 201);
    }
    if (p === 'admin/releases' && method === 'POST') {
      const b = await jsonBody(req),
        title = textField(b.title, 'Title', 120),
        description = textField(b.description, 'Studio note', 2000, false),
        category = textField(b.category, 'Category', 40);
      if (
        !(await db()
          .prepare("SELECT id FROM uploads WHERE id=? AND kind='audio'")
          .get(String(b.audioId)))
      )
        throw new HttpError(400, 'Upload your audio first.');
      if (
        b.artworkId &&
        !(await db()
          .prepare("SELECT id FROM uploads WHERE id=? AND kind='image'")
          .get(String(b.artworkId)))
      )
        throw new HttpError(400, 'Choose a valid cover image.');
      const duration = Number(b.duration || 0);
      if (!Number.isFinite(duration) || duration < 0 || duration > 86400)
        throw new HttpError(400, 'Invalid track duration.');
      const id = randomUUID();
      await db()
        .prepare(
          'INSERT INTO releases(id,title,description,category,audio_id,artwork_id,duration,created_at) VALUES(?,?,?,?,?,?,?,?)',
        )
        .run(
          id,
          title,
          description,
          category,
          b.audioId,
          b.artworkId || null,
          duration,
          Date.now(),
        );
      return json({ id }, 201);
    }
    const publish = /^admin\/releases\/([a-f0-9-]{36})\/publish$/.exec(p);
    if (publish && method === 'POST') {
      const body = await jsonBody(req);
      if (typeof body.notify !== 'boolean')
        throw new HttpError(400, 'Choose whether to notify subscribers.');
      return json(await publishRelease(publish[1], body.notify));
    }
    const edit = /^admin\/releases\/([a-f0-9-]{36})$/.exec(p);
    if (edit && method === 'PATCH') {
      const b = await jsonBody(req);
      const title = textField(b.title, 'Title', 120),
        description = textField(b.description, 'Studio note', 2000, false),
        category = textField(b.category, 'Category', 40);
      if (
        !(
          await db()
            .prepare('UPDATE releases SET title=?,description=?,category=? WHERE id=?')
            .run(title, description, category, edit[1])
        ).changes
      )
        throw new HttpError(404, 'Release not found.');
      return json({ ok: true });
    }
    if (p === 'admin/notifications/drain' && method === 'POST') return json(await drainQueue(5));
    if (p === 'admin/notifications/retry' && method === 'POST') {
      await db()
        .prepare(
          "UPDATE deliveries SET status='pending',attempts=0,next_attempt=0 WHERE status='failed' AND subscriber_id IN (SELECT id FROM subscribers WHERE status='active')",
        )
        .run();
      return json({ ok: true });
    }
  }
  throw new HttpError(404, 'This page was not found.');
}
async function handler(req: Request) {
  try {
    return await route(req);
  } catch (error) {
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    console.error('Request failed:', error instanceof Error ? error.message : 'Unknown error');
    return json({ error: 'Something went wrong. Please try again.' }, 500);
  }
}
export { handler as GET, handler as POST, handler as PATCH, handler as DELETE };
