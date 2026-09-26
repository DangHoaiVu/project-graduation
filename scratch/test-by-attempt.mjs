async function test() {
  for (const id of [2, 4, 5, 6]) {
    const res = await fetch(`http://localhost:3000/api/quiz/analysis?attemptId=${id}`);
    const data = await res.json();
    console.log(`Attempt ${id}:`, !!data?.analysis, data?.analysis?.quizName, data?.analysis?.id);
  }
}
test().catch(console.error);

