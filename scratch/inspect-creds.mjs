import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const env = fs.readFileSync('.env.local', 'utf8');
const getEnv = (k) => {
  const m = env.match(new RegExp('^' + k + '=(.*)$', 'm'));
  return m ? m[1].replace(/["']/g, '').trim() : '';
};
const supabase = createClient(getEnv('NEXT_PUBLIC_SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'));

async function test() {
  const { data } = await supabase.from('moodle_credentials').select('*');
  console.log('Moodle credentials:', data?.map(d => ({ user_id: d.user_id, hasToken: !!d.encrypted_token })));
}
test().catch(console.error);

