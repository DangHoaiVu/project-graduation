import { deleteFirebaseRow, getFirebaseRow } from './lib/firebase-admin.js';

async function test() {
  console.log('Testing deleteFirebaseRow...');
  // Check if 509b82d3-289f-4996-8436-a241aa71d470 exists:
  const row = await getFirebaseRow('learning_artifacts', '509b82d3-289f-4996-8436-a241aa71d470');
  console.log('Row exists before delete:', !!row, row?.id);
}
test().catch(console.error);

