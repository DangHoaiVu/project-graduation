import fs from 'fs';

const env = fs.readFileSync('.env.local', 'utf8');
const getEnv = (k) => {
  const m = env.match(new RegExp('^' + k + '=(.*)$', 'm'));
  return m ? m[1].replace(/["']/g, '').trim() : '';
};

async function test() {
  const res = await fetch(`${getEnv('NEXT_PUBLIC_SUPABASE_URL')}/rest/v1/`, {
    headers: {
      'apikey': getEnv('SUPABASE_SERVICE_ROLE_KEY'),
      'Authorization': `Bearer ${getEnv('SUPABASE_SERVICE_ROLE_KEY')}`
    }
  });
  const data = await res.json();
  console.log('Definitions/Tables in Supabase schema:');
  if (data.definitions) {
    console.log(Object.keys(data.definitions));
  } else if (data.components?.schemas) {
    console.log(Object.keys(data.components.schemas));
  } else {
    console.log(Object.keys(data));
  }
}

test();

