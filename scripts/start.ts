import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { bootstrap } from '../lib/bootstrap';
import { db } from '../lib/db';
const require = createRequire(import.meta.url);
const development = process.argv.includes('--dev');
if (!process.env.NODE_ENV)
  Object.assign(process.env, { NODE_ENV: development ? 'development' : 'production' });
try {
  await bootstrap();
  await db().close();
} catch (error) {
  const message = error instanceof Error ? error.message : '';
  // Database connection errors can contain credentials; only print our known config failures.
  console.error(
    /^(Set |ADMIN_PASSWORD |SESSION_SECRET,|Assign a domain|The configured site URL|DATABASE_URL must)/.test(
      message,
    )
      ? message
      : 'Startup failed: check database connectivity and credentials.',
  );
  process.exit(1);
}
console.log('Database ready. Starting the listening room and notification worker.');
const children: ChildProcess[] = [];
let stopping = false;
let status = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
function shutdown(code: number) {
  if (stopping) return;
  stopping = true;
  status = code;
  for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
  timer = setTimeout(() => {
    for (const child of children) if (child.exitCode === null) child.kill('SIGKILL');
  }, 25000);
  timer.unref();
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
for (const [name, args] of [
  [
    'web',
    [
      require.resolve('next/dist/bin/next'),
      development ? 'dev' : 'start',
      '--hostname',
      '0.0.0.0',
      '--port',
      process.env.PORT || new URL(process.env.APP_URL!).port || '3000',
    ],
  ],
  ['worker', ['--import', 'tsx', 'scripts/worker.ts']],
] as const) {
  const child = spawn(process.execPath, [...args], { env: process.env, stdio: 'inherit' });
  children.push(child);
  child.on('error', () => {
    console.error(`${name} could not start.`);
    shutdown(1);
  });
  child.on('exit', (code) => {
    if (!stopping) {
      console.error(`${name} exited. Restarting the container is required.`);
      shutdown(code || 1);
    }
    if (children.every((c) => c.exitCode !== null || c.signalCode !== null)) {
      if (timer) clearTimeout(timer);
      process.exit(status);
    }
  });
}
