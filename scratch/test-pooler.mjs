import fs from 'fs';
const env = fs.readFileSync('.env.local', 'utf8');
const getEnv = (k) => {
  const m = env.match(new RegExp('^' + k + '=(.*)$', 'm'));
  return m ? m[1].replace(/["']/g, '').trim() : '';
};
console.log('DATABASE_URL full:', getEnv('DATABASE_URL').replace(/:[^:@]+@/, ':***@'));

