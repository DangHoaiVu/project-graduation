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
  const review = await call('mod_quiz_get_attempt_review', { attemptid: '5' });
  for (const slot of [1, 2, 6, 7]) {
    const q = review.questions.find(item => item.slot === slot);
    if (!q) continue;
    const cleanHtml = q.html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '').trim();
    console.log(`\n=================== SLOT ${slot} ===================`);
    console.log('--- ALL CLASS NAMES IN SLOT ---');
    const classes = [...cleanHtml.matchAll(/class="([^"]+)"/g)].map(m => m[1]);
    console.log([...new Set(classes)]);
    
    // Check specific feedback elements
    console.log('--- HTML SNIPPET ---');
    console.log(cleanHtml.slice(0, 1500));
  }
}
test().catch(console.error);

