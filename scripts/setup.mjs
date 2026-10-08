import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
if (existsSync('.env.local')) {
  console.log(
    'Existing .env.local preserved. Set ADMIN_PASSWORD there or keep your existing password hash.',
  );
  process.exit(0);
}
const password = randomBytes(24).toString('base64url');
const origin = process.env.SETUP_APP_URL || 'http://localhost:3000';
writeFileSync(
  '.env.local',
  `DATABASE_URL=file:./data/studio.sqlite\nADMIN_PASSWORD=${password}\nAPP_URL=${origin}\n`,
  { mode: 0o600 },
);
mkdirSync('data', { recursive: true, mode: 0o700 });
writeFileSync(
  'data/studio-access.txt',
  `Your private studio\n${origin}/studio\n\nPassword: ${password}\n\nStore this password in your password manager, then delete this file.\nDo not commit or share this file.\n`,
  { mode: 0o600 },
);
console.log(
  'Local studio configured. Your generated password is in data/studio-access.txt. Start with npm run dev.',
);
