async function testMoodleResults() {
  const res = await fetch('http://localhost:3000/api/moodle?token=a0544c9b13926a8cfd6f851066041a7d');
  const data = await res.json();
  console.log('examResults:', data.examResults?.map(e => ({
    name: e.name,
    score: e.score,
    attemptId: e.attemptId,
    quizId: e.quizId
  })));
}
testMoodleResults().catch(console.error);

