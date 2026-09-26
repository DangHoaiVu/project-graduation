import fs from 'fs';

const env = fs.readFileSync('.env.local', 'utf8');
const getEnv = (k) => {
  const m = env.match(new RegExp('^' + k + '=(.*)$', 'm'));
  return m ? m[1].replace(/["']/g, '').trim() : '';
};
const MOODLE_URL = getEnv('MOODLE_URL');
const MOODLE_TOKEN = getEnv('MOODLE_TOKEN');

async function call(fn, extra = {}) {
  const base = `${MOODLE_URL.replace(/\/$/, '')}/webservice/rest/server.php`;
  const params = new URLSearchParams({ wstoken: MOODLE_TOKEN, wsfunction: fn, moodlewsrestformat: 'json', ...extra });
  const res = await fetch(`${base}?${params}`);
  return res.json();
}

async function test() {
  const courses = [6, 5, 3, 2, 4];
  for (const cid of courses) {
    const grades = await call('gradereport_user_get_grade_items', { courseid: String(cid), userid: '4' });
    const items = grades.usergrades?.[0]?.gradeitems || [];
    for (const item of items) {
      if (item.itemtype === 'mod') {
        let attemptId = null;
        if (item.itemmodule === 'quiz' && item.iteminstance) {
          const att = await call('mod_quiz_get_user_attempts', { quizid: String(item.iteminstance), userid: '4' });
          attemptId = att.attempts?.[0]?.id;
        }
        console.log(`[course ${cid}] [${item.itemmodule}] ${item.itemname}: grade=${item.gradeformatted}, instance=${item.iteminstance}, attemptId=${attemptId}`);
      }
    }
  }
}
test().catch(console.error);

