import fs from 'fs';

const env = fs.readFileSync('.env.local', 'utf8');
const getEnv = (k) => {
  const m = env.match(new RegExp('^' + k + '=(.*)$', 'm'));
  return m ? m[1].replace(/["']/g, '').trim() : '';
};

async function test() {
  const res = await fetch(`${getEnv('NEXT_PUBLIC_SUPABASE_URL')}/rest/v1/rpc`, {
    method: 'OPTIONS',
    headers: {
      'apikey': getEnv('SUPABASE_SERVICE_ROLE_KEY'),
      'Authorization': `Bearer ${getEnv('SUPABASE_SERVICE_ROLE_KEY')}`
    }
  });
  console.log('OPTIONS /rest/v1/rpc status:', res.status, res.headers.get('allow'));

  // Inspect OpenAPI spec paths
  const specRes = await fetch(`${getEnv('NEXT_PUBLIC_SUPABASE_URL')}/rest/v1/`, {
    headers: {
      'apikey': getEnv('SUPABASE_SERVICE_ROLE_KEY'),
      'Authorization': `Bearer ${getEnv('SUPABASE_SERVICE_ROLE_KEY')}`
    }
  });
  const spec = await specRes.json();
  const paths = Object.keys(spec.paths || {});
  console.log('Available paths in PostgREST:', paths);
}

test();

