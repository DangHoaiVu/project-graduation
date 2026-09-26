import mysql from 'mysql2/promise';
import fs from 'fs';

const env = fs.readFileSync('.env.local', 'utf8');
const getEnv = (k) => {
  const m = env.match(new RegExp('^' + k + '=(.*)$', 'm'));
  return m ? m[1].replace(/["']/g, '').trim() : '';
};

async function testAttempts() {
  const pool = mysql.createPool({
    host: getEnv('MOODLE_DB_HOST') || '127.0.0.1',
    port: Number(getEnv('MOODLE_DB_PORT') || 3306),
    user: getEnv('MOODLE_DB_USER') || 'root',
    password: getEnv('MOODLE_DB_PASSWORD') || '',
    database: getEnv('MOODLE_DB_NAME') || 'moodle',
  });

  const [attempts] = await pool.query('SELECT id, quiz, userid, state, timestart, timefinish FROM mdl_quiz_attempts ORDER BY id DESC');
  console.log('All attempts in mdl_quiz_attempts:', attempts);

  await pool.end();
}
testAttempts().catch(console.error);

