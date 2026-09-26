import fs from 'fs';
import postgres from 'postgres';

const env = fs.readFileSync('.env.local', 'utf8');
const getEnv = (k) => {
  const m = env.match(new RegExp('^' + k + '=(.*)$', 'm'));
  return m ? m[1].replace(/["']/g, '').trim() : '';
};
const dbUrl = getEnv('DATABASE_URL');
console.log('DB URL exists:', !!dbUrl);
if (dbUrl) {
  const sql = postgres(dbUrl, { prepare: false });
  try {
    const res = await sql`SELECT table_name FROM information_schema.tables WHERE table_schema='public'`;
    console.log('Tables in Postgres:', res.map(r => r.table_name));
  } catch (err) {
    console.error('Error connecting to postgres:', err);
  } finally {
    await sql.end();
  }
}

