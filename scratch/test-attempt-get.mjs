async function test() {
  for (const id of [2, 4, 6]) {
    const res = await fetch(`http://localhost:3000/api/quiz/analysis?attemptId=${id}`);
    const data = await res.json();
    console.log(`attemptId ${id}:`, {
      hasAnalysis: !!data.analysis,
      cached: data.cached,
      id: data.analysis?.id,
      quizName: data.analysis?.quizName
    });
  }
}
test().catch(console.error);

