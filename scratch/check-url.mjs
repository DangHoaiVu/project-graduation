import fs from 'fs';
const env = fs.readFileSync('.env.local', 'utf8');
const getEnv = (k) => {
  const m = env.match(new RegExp('^' + k + '=(.*)$', 'm'));
  return m ? m[1].replace(/["']/g, '').trim() : '';
};
const url = getEnv('DATABASE_URL');
console.log('URL length:', url.length);
const parsed = new URL(url);
console.log('Username:', parsed.username);
console.log('Password length:', parsed.password.length);
console.log('Password starts with:', parsed.password.substring(0, 3));
console.log('Password ends with:', parsed.password.substring(parsed.password.length - 3));
console.log('Host:', parsed.host);

