import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const env = fs.readFileSync('.env.local', 'utf8');
const getEnv = (k) => {
  const m = env.match(new RegExp('^' + k + '=(.*)$', 'm'));
  return m ? m[1].replace(/["']/g, '').trim() : '';
};
const supabase = createClient(getEnv('NEXT_PUBLIC_SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'));

async function main() {
  const { data, error } = await supabase.from('learning_artifacts').select('*');
  console.log('Error:', error);
  console.log('Rows count:', data ? data.length : 0);
  console.log('Rows:', JSON.stringify(data, null, 2));
}

main().catch(console.error);

