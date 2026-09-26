async function testDeleteApi() {
  const res = await fetch('http://localhost:3000/api/quiz/analysis');
  const data = await res.json();
  const first = data.analyses?.[0];
  console.log('Target analysis:', first?.id, first?.attemptId, first?.quizName);

  if (first?.id) {
    console.log('Sending DELETE to /api/learning-artifacts?id=' + first.id + '&userId=4&artifactType=quiz_analysis');
    const delRes = await fetch(
      `http://localhost:3000/api/learning-artifacts?id=${encodeURIComponent(first.id)}&userId=4&artifactType=quiz_analysis`,
      { method: 'DELETE' }
    );
    console.log('Delete status:', delRes.status);
    const delData = await delRes.json();
    console.log('Delete response:', delData);
  }
}
testDeleteApi().catch(console.error);

