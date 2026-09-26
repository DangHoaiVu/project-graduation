import fs from 'fs';

const env = fs.readFileSync('.env.local', 'utf8');
const getEnv = (k) => {
  const m = env.match(new RegExp('^' + k + '=(.*)$', 'm'));
  return m ? m[1].replace(/["']/g, '').trim() : '';
};

// Set env vars
process.env.FIREBASE_PROJECT_ID = getEnv('FIREBASE_PROJECT_ID');
process.env.FIREBASE_CLIENT_EMAIL = getEnv('FIREBASE_CLIENT_EMAIL');
process.env.FIREBASE_PRIVATE_KEY = getEnv('FIREBASE_PRIVATE_KEY');

const { getFirebaseRows } = await import('../lib/firebase-admin.ts');

async function test() {
  const allRows = await getFirebaseRows('learning_artifacts');
  console.log('All rows count:', allRows?.length);
  allRows?.forEach((r, i) => {
    const c = r.content_data;
    console.log(`[${i}] id: ${r.id}, type: ${r.artifact_type}, course: ${r.moodle_course_id}, quizName: ${c?.quizName || c?.name}, attemptId: ${c?.attemptId}`);
  });
}
test().catch(console.error);
