async function test() {
  const res1 = await fetch('http://localhost:3000/api/learning-artifacts');
  console.log('Status /api/learning-artifacts:', res1.status);
  const data1 = await res1.json();
  console.log('Data /api/learning-artifacts:', JSON.stringify(data1, null, 2));

  const res2 = await fetch('http://localhost:3000/api/quiz/analysis');
  console.log('Status /api/quiz/analysis:', res2.status);
  const data2 = await res2.json();
  console.log('Data /api/quiz/analysis:', JSON.stringify(data2, null, 2));
}
test().catch(console.error);

