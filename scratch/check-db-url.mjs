import fs from 'fs';

const env = fs.readFileSync('.env.local', 'utf8');
const lines = env.split('\n');
lines.forEach(l => {
  if (l.includes('DATABASE_URL') || l.includes('SUPABASE')) {
    const key = l.split('=')[0];
    console.log('Key:', key, 'has value:', !!l.split('=')[1]);
  }
});

