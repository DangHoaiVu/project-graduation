import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const env = fs.readFileSync('.env.local', 'utf8');
const getEnv = (k) => {
  const m = env.match(new RegExp('^' + k + '=(.*)$', 'm'));
  return m ? m[1].replace(/["']/g, '').trim() : '';
};
const supabase = createClient(getEnv('NEXT_PUBLIC_SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'));

async function test() {
  // Test pg_meta / sql endpoint with service role key
  const res = await fetch(`${getEnv('NEXT_PUBLIC_SUPABASE_URL')}/rest/v1/rpc`, {
    headers: {
      'apikey': getEnv('SUPABASE_SERVICE_ROLE_KEY'),
      'Authorization': `Bearer ${getEnv('SUPABASE_SERVICE_ROLE_KEY')}`
    }
  });
  console.log('RPC endpoint status:', res.status);

  // Test /pg/query or /rest/v1
  const resSql = await fetch(`${getEnv('NEXT_PUBLIC_SUPABASE_URL')}/pg/query`, {
    method: 'POST',
    headers: {
      'apikey': getEnv('SUPABASE_SERVICE_ROLE_KEY'),
      'Authorization': `Bearer ${getEnv('SUPABASE_SERVICE_ROLE_KEY')}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query: 'SELECT 1;' })
  });
  console.log('/pg/query status:', resSql.status, await resSql.text());
}

test();

