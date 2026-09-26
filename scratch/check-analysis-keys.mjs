async function testFields() {
  const res = await fetch('http://localhost:3000/api/quiz/analysis');
  const data = await res.json();
  data.analyses?.forEach(a => {
    console.log('Analysis keys:', Object.keys(a));
    console.log('attemptId:', a.attemptId, 'id:', a.id, 'quizName:', a.quizName);
  });
}
testFields().catch(console.error);

