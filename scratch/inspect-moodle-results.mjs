import fs from 'fs';
const env = fs.readFileSync('.env.local', 'utf8');
const getEnv = (k) => {
  const m = env.match(new RegExp('^' + k + '=(.*)$', 'm'));
  return m ? m[1].replace(/["']/g, '').trim() : '';
};
const token = getEnv('MOODLE_TOKEN');

async function test() {
  const res = await fetch('http://localhost:3000/api/moodle', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json();
  console.log('ExamResults count:', data.examResults?.length);
  data.examResults?.forEach((r, idx) => {
    console.log(`[${idx}] course: ${r.courseName} (${r.courseCode}), quiz: ${r.name}, attemptId: ${r.attemptId}`);
  });
}
test().catch(console.error);

