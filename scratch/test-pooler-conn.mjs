import fs from 'fs';
import postgres from 'postgres';

const env = fs.readFileSync('.env.local', 'utf8');
const getEnv = (k) => {
  const m = env.match(new RegExp('^' + k + '=(.*)$', 'm'));
  return m ? m[1].replace(/["']/g, '').trim() : '';
};
const rawUrl = getEnv('DATABASE_URL');
const parsed = new URL(rawUrl);
const password = decodeURIComponent(parsed.password);
const projectRef = 'wcsrsvllizfnvgfvixve';

console.log('Project Ref:', projectRef);

for (const port of [6543, 5432]) {
  const poolerUrl = `postgresql://postgres.${projectRef}:${encodeURIComponent(password)}@aws-0-ap-southeast-1.pooler.supabase.com:${port}/postgres`;
  console.log(`Testing port ${port}...`);
  const sql = postgres(poolerUrl, { prepare: false, connect_timeout: 5 });
  try {
    const res = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`;
    console.log(`SUCCESS with port ${port}! Tables:`, res.map(r => r.table_name));
    await sql.end();
    break;
  } catch (err) {
    console.log(`Failed for port ${port}:`, err.message);
    await sql.end();
  }
}

