import { NextResponse } from 'next/server';
import { currentUserId } from '../../../db/runtime';
import { getDb } from '../../../db';
import { quizAttempts, users } from '../../../db/schema';
import { eq, desc } from 'drizzle-orm';

export async function GET() {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'Bạn cần đăng nhập.' }, { status: 401 });

  const db = getDb();
  if (!db) return NextResponse.json({ attempts: [], mode: 'preview' });

  try {
    const attempts = await db
      .select()
      .from(quizAttempts)
      .orderBy(desc(quizAttempts.attemptedAt))
      .limit(20);

    const formatted = attempts.map((a) => ({
      id: a.id,
      courseCode: `QUIZ-${a.moodleQuizId}`,
      topic: a.aiFeedback || 'Quiz Attempt',
      score: a.score,
      total: 100,
      durationSeconds: 0,
      createdAt: a.attemptedAt ? new Date(a.attemptedAt).getTime() : Date.now(),
    }));

    return NextResponse.json({ attempts: formatted, mode: 'live' });
  } catch (error) {
    console.error('Error fetching progress:', error);
    return NextResponse.json({ attempts: [], mode: 'preview' });
  }
}

export async function POST(request: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'Bạn cần đăng nhập.' }, { status: 401 });

  const body = (await request.json()) as {
    courseCode?: string;
    topic?: string;
    score?: number;
    total?: number;
    durationSeconds?: number;
    moodleQuizId?: number;
    aiFeedback?: string;
  };

  const db = getDb();
  if (!db) return NextResponse.json({ saved: false, mode: 'preview' });

  try {
    // Find or create default user in Supabase
    let userUuid = '';
    const existingUsers = await db.select().from(users).limit(1);
    if (existingUsers.length > 0) {
      userUuid = existingUsers[0].id;
    } else {
      const [newUser] = await db
        .insert(users)
        .values({
          moodleUserId: 1,
          name: 'Sinh viên',
          email: 'student@example.com',
          role: 'student',
        })
        .returning();
      userUuid = newUser.id;
    }

    const moodleQuizId = body.moodleQuizId || 1;
    const scoreVal = typeof body.score === 'number' ? body.score : 0;
    const feedback = body.aiFeedback || (body.topic ? `Chủ đề: ${body.topic}` : null);

    const [newAttempt] = await db
      .insert(quizAttempts)
      .values({
        userId: userUuid,
        moodleQuizId,
        score: scoreVal,
        aiFeedback: feedback,
      })
      .returning();

    return NextResponse.json({ saved: true, id: newAttempt.id }, { status: 201 });
  } catch (error) {
    console.error('Error saving quiz attempt:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Lỗi lưu kết quả.' },
      { status: 500 }
    );
  }
}
