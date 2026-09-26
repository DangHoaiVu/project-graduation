async function test() {
  const res = await fetch('http://localhost:3000/api/quiz/analysis');
  const data = await res.json();
  console.log('Total analyses in DB:', data.analyses?.length);
  data.analyses?.forEach((a) => {
    console.log({
      id: a.id,
      attemptId: a.attemptId,
      quizName: a.quizName,
      courseId: a.courseId,
      createdAt: a.createdAt,
    });
  });
}
test().catch(console.error);

