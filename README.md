# Serhii Samborskyi — A place for sound

A Node.js listening room with music uploads, a player, a private publishing studio, email/Telegram/browser-push subscriptions, and consent-based listener analytics and Meta Pixel integration.

## Deploy in Coolify

Use repository **https://github.com/serhii-samborskyi/samborskyi.com**, branch **main**.

1. Create a PostgreSQL resource in Coolify and copy its **internal connection URL**. Make sure the application and database share a reachable Docker network. Keep the database private.
2. Create an application from the repository. Select the **Dockerfile** build pack, repository root `/` as the base directory, and `/Dockerfile` as the Dockerfile location.
3. Set the exposed port to **3000** and assign your domain, such as **https://samborskyi.com**.
4. Add these two **runtime-only** environment variables (disable their build-time availability):

   ```dotenv
   DATABASE_URL=postgresql://USER:PASSWORD@DATABASE_HOST:5432/DATABASE_NAME
   ADMIN_PASSWORD=your-unique-password-of-at-least-12-characters
   ```

5. Deploy. The health endpoint is **GET `/api/health`** on port **3000**. A Docker health check is already included. Set Coolify's health check to the same path if you enable one there.
6. Open **`/studio`** and log in with `ADMIN_PASSWORD`.

The image builds without a database connection or secrets. Startup creates/migrates tables, generates signing/Web Push/Telegram webhook keys, saves them in the database, and starts **both the web server and notification worker**. There are no required custom build/start commands, post-deployment migration commands, cron jobs, or separate worker applications. The container stops if either managed process exits unexpectedly, allowing Coolify to restart it.

Coolify supplies the domain through `COOLIFY_URL` or `COOLIFY_FQDN`. The first configured domain is canonical. If your Coolify installation does not expose these variables, or you deploy elsewhere, add `APP_URL=https://samborskyi.com`. The app never builds email or notification links from untrusted request headers.

**No application storage mount is needed with PostgreSQL.** Releases, uploaded audio/artwork, subscriptions, analytics, sessions, delivery jobs, and generated keys live in the database. Back up the database. Uploads are limited to 80 MB for audio and 10 MB for artwork; allow at least 81 MB at any additional reverse proxy. Database-backed media keeps deployment simple; storage and backups grow with your music archive.

Official references: [Coolify Dockerfile apps](https://coolify.io/docs/applications/builds/dockerfile), [runtime variables and automatic domain variables](https://coolify.io/docs/applications/configuration/environment-variables).

## Optional integrations

The two required variables run the core application. External services need their own credentials when you choose to enable them. Set integration values as runtime-only variables and redeploy.

| Feature          | Additional configuration                                                                                                                              |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Email updates    | `RESEND_API_KEY` and `EMAIL_FROM`, using a verified Resend sender domain and an address you monitor                                                   |
| Telegram updates | `TELEGRAM_BOT_TOKEN` and `TELEGRAM_BOT_USERNAME` (without `@`), from `@BotFather`; then run `npm run telegram:webhook` once in Coolify's app terminal |
| Browser push     | No additional variables: VAPID keys are generated and persisted automatically; the site must use HTTPS                                                |
| Meta Pixel       | Numeric `META_PIXEL_ID`; the Pixel only loads after marketing consent                                                                                 |

Telegram's webhook secret is stored automatically. The webhook command reads that same database value, so you don't have to manage another secret. Re-register the webhook when the domain changes. `/start` subscribes, `/stop` unsubscribes, and `/help` lists commands. Bot link clicks are not counted as confirmed subscriptions.

Email requires explicit consent and confirmation. Confirmation links expire after 24 hours; scanners fetching a link do not subscribe anyone. Release emails include unsubscribe links and RFC 8058 one-click unsubscribe headers. Browser push can be disabled in the site's Push tab. On iPhone/iPad, first add the site to the Home Screen.

Existing installations can override `SESSION_SECRET`, `TELEGRAM_WEBHOOK_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and `VAPID_SUBJECT`. Keep overrides stable to preserve existing subscriptions/links. `ADMIN_PASSWORD_HASH` remains supported for the original local setup; `ADMIN_PASSWORD` takes precedence. Changing the admin password and restarting invalidates existing studio sessions without rotating email-signing or push keys.

Provider references: [Resend](https://resend.com/docs/api-reference/emails/send-email), [Telegram](https://core.telegram.org/bots/api#setwebhook), [Web Push](https://github.com/web-push-libs/web-push).

## Publish music

1. Sign in at `/studio`.
2. Upload an MP3, WAV, OGG, FLAC, or M4A file and optional JPG/PNG/WebP artwork.
3. Add a title, category, and studio note, then save a draft.
4. Listen to the private preview and click **Publish** when ready.
5. Choose whether to notify active subscribers.

Drafts and draft files require authentication. Published releases get a shareable `/listen/:id` page and release-specific social metadata. Playback supports HTTP byte ranges, seeking, volume, and mobile media controls. There is no fabricated music or audience data in the initial site.

Publication and notification jobs are committed atomically. Multiple publishers/workers cannot create duplicate jobs for a `(release, subscription)` pair. Failed jobs retry with increasing delays, up to five attempts. Unsubscribed recipients are checked again before delivery. Resend uses idempotency keys. Telegram and push can still duplicate a message after a crash between provider acceptance and recording success; no provider offers an atomic transaction with the application's database.

## Audience tracking

Optional analytics and marketing are separate opt-ins; declining them does not affect music or subscriptions. Preferences last 180 days and can be changed in **Cookie choices**.

| Trigger                                            | Studio analytics | Meta event with marketing consent   |
| -------------------------------------------------- | ---------------- | ----------------------------------- |
| Page visit                                         | `page_view`      | `PageView`                          |
| Audio starts                                       | `play`           | `ViewContent` with release ID/title |
| 30 seconds of actual listening, excluding seeks    | `listen_30`      | `EngagedListen`                     |
| Track completion after meaningful listening        | `complete`       | `TrackCompleted`                    |
| Email confirmation or successful push subscription | `subscribe`      | `Subscribe`                         |

Analytics use a random browser identifier. They are not linked to subscriber email addresses or Telegram IDs. The app does not enable advanced matching or the Conversions API. Use the Pixel events in Meta's audience tools to create audiences later; this app does not automatically create a lookalike audience.

Studio metrics cover 30 days of consenting listeners. Events are deduplicated in five-minute windows. Subscription counts are channel subscriptions, not deduplicated people. The background worker removes analytics older than 90 days, expired sessions, expired rate/event metadata, and unconfirmed subscriptions older than seven days.

## Local development

Node **22.13+** is required.

```sh
npm ci
npm run setup
npm run dev
```

Setup creates `.env.local` with a file-backed SQLite URL, a generated admin password, and a localhost address. The password is also placed in `data/studio-access.txt`; save it in your password manager and delete that file. Existing local configuration is preserved. `npm run dev` starts the app and worker. The local port is derived from `APP_URL` unless `PORT` overrides it. Stop any previous app using that port first.

SQLite is still supported using `DATABASE_URL=file:./data/studio.sqlite`. For SQLite in a container, use `file:/app/data/studio.sqlite` and mount persistent storage at `/app/data`. Existing SQLite databases migrate automatically without deleting records; old filesystem uploads remain readable from `DATA_DIR/uploads`. Switching from SQLite to PostgreSQL starts with the PostgreSQL database's data; there is no implicit cross-database import.

An optional `compose.yaml` starts the same image alongside PostgreSQL for local deployment testing. Provide `POSTGRES_PASSWORD` and `ADMIN_PASSWORD` to Compose; `APP_URL` defaults to `http://localhost:3000`:

```sh
docker compose up --build -d
```

## Validation

```sh
npm run lint
npm run typecheck
npm test
# Optional: use a disposable PostgreSQL database; tests create/drop their own isolated schemas.
TEST_DATABASE_URL=postgresql://USER:PASSWORD@localhost:5432/TEST_DB npm test
npm run build
```

CI tests SQLite and PostgreSQL, builds the Docker image without secrets, starts it with the two runtime variables and Coolify's domain metadata, tests login/upload/publication, **replaces the whole container**, and verifies audio, sessions, and push keys survive. Notification providers are mocked in tests; no real messages are sent. `scripts/smoke.mjs` is restricted to disposable localhost deployments and never requests notifications.

The Docker process runs as a non-root user, listens on `0.0.0.0:3000`, forwards shutdown signals, drains an in-progress notification, and exits when either child stops. PostgreSQL migrations and publication/queue claims use transaction locks; concurrent SQLite requests are serialized around transactions. PostgreSQL TLS options are respected from `DATABASE_URL`; certificate verification is never disabled by app code. Set `TRUST_PROXY=1` only when your reverse proxy replaces `X-Forwarded-For`; otherwise rate limits conservatively share a direct-client bucket.

## Source map

- `Dockerfile`: secret-free build and Coolify runtime.
- `.env.example`: required variables and optional integration configuration.
- `scripts/start.ts`: bootstrap, web/worker supervision, shutdown.
- `lib/bootstrap.ts`: persisted keys and password-change session invalidation.
- `lib/db.ts`: PostgreSQL/SQLite connections, transactions, schema migration.
- `lib/releases.ts`: publication and durable notification delivery.
- `app/api/[...path]/route.ts`: protected uploads, playback, subscriptions, analytics, health.
- `components/`: listener experience and private studio.
- `public/serhii-cover.png`: the supplied portrait, unchanged.

`.env.local`, private access files, local databases, uploads, and build outputs are excluded from Git and image build context. The development-only Next ESLint toolchain currently inherits an upstream `braces` nested-pattern denial-of-service advisory; it is not included in the production runtime.
