async function test() {
  const url = 'http://localhost:3000/api/learning-artifacts?id=509b82d3-289f-4996-8436-a241aa71d470&userId=4&artifactType=quiz_analysis';
  console.log('Calling DELETE:', url);
  const res = await fetch(url, { method: 'DELETE' });
  console.log('Status:', res.status);
  const text = await res.text();
  console.log('Response:', text);
}
test().catch(console.error);

