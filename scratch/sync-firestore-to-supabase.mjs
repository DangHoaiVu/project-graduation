import fs from 'fs';
import { createClient } from '@supabase/supabase-js';

const env = fs.readFileSync('.env.local', 'utf8');
const getEnv = (k) => {
  const m = env.match(new RegExp('^' + k + '=(.*)$', 'm'));
  return m ? m[1].replace(/["']/g, '').trim() : '';
};

const supabase = createClient(getEnv('NEXT_PUBLIC_SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'));

async function sync() {
  console.log('Fetching existing analyses from API...');
  const res = await fetch('http://localhost:3000/api/quiz/analysis');
  const data = await res.json();
  const analyses = data.analyses || [];
  console.log(`Found ${analyses.length} analyses in Firestore.`);

  // Check if table exists in Supabase
  const { error: checkErr } = await supabase.from('learning_artifacts').select('id').limit(1);
  if (checkErr) {
    console.error('Table learning_artifacts does not exist in Supabase yet:', checkErr.message);
    console.log('Please execute preperation/learning_artifacts.sql in Supabase SQL Editor first.');
    return;
  }

  for (const a of analyses) {
    const userId = a.userId || 4;
    // Ensure user exists
    await supabase.from('users').upsert({
      moodle_user_id: userId,
      role: 'student',
      name: a.userName || 'Sinh viên'
    }, { onConflict: 'moodle_user_id' });

    const row = {
      id: a.id,
      user_id: userId,
      moodle_course_id: a.courseId || 0,
      artifact_type: 'quiz_analysis',
      content_data: a,
      created_at: a.createdAt || new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { error: insertErr } = await supabase.from('learning_artifacts').upsert(row, { onConflict: 'id' });
    if (insertErr) {
      console.error(`Failed to sync analysis ${a.id}:`, insertErr.message);
    } else {
      console.log(`Synced analysis for quiz "${a.quizName}" (attempt ${a.attemptId}) to Supabase.`);
    }
  }
}

sync().catch(console.error);

