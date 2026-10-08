import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
export async function testDatabase() {
  const directory = mkdtempSync(path.join(tmpdir(), 'samborskyi-test-'));
  process.env.DATA_DIR = directory;
  const url = process.env.TEST_DATABASE_URL;
  let admin: Pool | undefined;
  const schema = 'test_' + randomUUID().replaceAll('-', '');
  if (url) {
    admin = new Pool({ connectionString: url });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    const scoped = new URL(url);
    scoped.searchParams.set('options', `-c search_path=${schema}`);
    process.env.DATABASE_URL = scoped.href;
  } else process.env.DATABASE_URL = `file:${path.join(directory, 'studio.sqlite')}`;
  return {
    directory,
    async cleanup() {
      if (admin) {
        await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
        await admin.end();
      }
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
