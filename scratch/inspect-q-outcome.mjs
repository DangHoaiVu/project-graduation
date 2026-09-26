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
    console.log(`\n=================== SLOT ${slot} OUTCOME ===================`);
    const outcomeMatch = cleanHtml.match(/<div class="outcome clearfix">([\s\S]*?)<\/div>\s*<div class="comment/i)
      || cleanHtml.match(/<div class="outcome clearfix">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/i)
      || cleanHtml.match(/<div class="outcome clearfix">([\s\S]*)/i);
    if (outcomeMatch) {
      console.log(outcomeMatch[0].slice(0, 1500));
    } else {
      console.log('No outcome match found');
    }

    // Also check option-level feedbacks
    const optionFeedbacks = [...cleanHtml.matchAll(/<div class="specificfeedback[^"]*"[^>]*>([\s\S]*?)<\/div>/gi)];
    console.log(`Option specific feedbacks count in Slot ${slot}:`, optionFeedbacks.length);
    optionFeedbacks.forEach((ofb, i) => console.log(`  [${i}]`, ofb[1].replace(/<[^>]+>/g, ' ').trim()));
  }
}
test().catch(console.error);

