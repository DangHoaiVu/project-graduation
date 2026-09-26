import postgres from 'postgres';
import fs from 'fs';

const env = fs.readFileSync('.env.local', 'utf8');
const getEnv = (k) => {
  const m = env.match(new RegExp('^' + k + '=(.*)$', 'm'));
  return m ? m[1].replace(/["']/g, '').trim() : '';
};
const sql = postgres(getEnv('DATABASE_URL'));

async function test() {
  const tables = await sql`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public';
  `;
  console.log('Tables in public schema:', tables.map(t => t.table_name));
  await sql.end();
}
test().catch(console.error);

