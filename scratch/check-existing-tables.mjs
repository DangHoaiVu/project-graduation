import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const env = fs.readFileSync('.env.local', 'utf8');
const getEnv = (k) => {
  const m = env.match(new RegExp('^' + k + '=(.*)$', 'm'));
  return m ? m[1].replace(/["']/g, '').trim() : '';
};
const supabase = createClient(getEnv('NEXT_PUBLIC_SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'));

async function testTables() {
  const candidateTables = [
    'users',
    'fcm_tokens',
    'moodle_credentials',
    'events',
    'user_courses',
    'learning_artifacts',
    'personal_materials',
    'chat_sessions',
    'notification_deliveries',
  ];

  for (const table of candidateTables) {
    const { data, error } = await supabase.from(table).select('count', { count: 'exact', head: true });
    if (error) {
      console.log(`Table ${table}: NOT FOUND (${error.message})`);
    } else {
      console.log(`Table ${table}: EXISTS (rows: ${data === null ? 'accessible' : data})`);
    }
  }
}
testTables().catch(console.error);

