import { NextResponse } from 'next/server';
import { saveLearningArtifact, getLearningArtifacts } from '@/lib/learning-artifacts';
import { supabaseAdmin } from '@/lib/supabase';
import { getDb } from '@/db';
import { learningArtifacts } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { deleteFirebaseRow } from '@/lib/firebase-admin';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userIdStr = searchParams.get('userId');
    const moodleCourseIdStr = searchParams.get('moodleCourseId') || searchParams.get('courseId');
    const artifactType = searchParams.get('artifactType') || undefined;
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!, 10) : 20;

    const userId = userIdStr ? parseInt(userIdStr, 10) : undefined;
    const moodleCourseId = moodleCourseIdStr ? parseInt(moodleCourseIdStr, 10) : undefined;

    const artifacts = await getLearningArtifacts({
      userId,
      moodleCourseId,
      artifactType,
      limit,
    });

    return NextResponse.json({
      success: true,
      artifacts,
      count: artifacts.length,
    });
  } catch (error) {
    console.error('Error fetching learning artifacts:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Lỗi lấy thành quả học tập.' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      userId?: number;
      userName?: string;
      moodleCourseId: number;
      artifactType: 'summary' | 'mindmap' | 'flashcard' | 'quiz_analysis' | string;
      contentData: Record<string, unknown>;
    };

    if (!body.moodleCourseId || !body.artifactType || !body.contentData) {
      return NextResponse.json(
        { error: 'Vui lòng cung cấp đầy đủ courseId, artifactType và contentData.' },
        { status: 400 }
      );
    }

    const userId = Number(body.userId) || 4;

    const saved = await saveLearningArtifact({
      userId,
      userName: body.userName,
      moodleCourseId: Number(body.moodleCourseId),
      artifactType: body.artifactType,
      contentData: body.contentData,
    });

    return NextResponse.json({
      success: true,
      artifact: saved,
    });
  } catch (error) {
    console.error('Error saving learning artifact:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Lỗi lưu thành quả học tập.' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const userId = Number(searchParams.get('userId'));
    const artifactType = searchParams.get('artifactType');

    if (!id) {
      return NextResponse.json({ error: 'Mã thành quả (id) là bắt buộc.' }, { status: 400 });
    }

    if (artifactType === 'quiz_analysis' && !userId) {
      return NextResponse.json({ error: 'userId là bắt buộc khi xóa phân tích bài thi.' }, { status: 400 });
    }

    try {
      const deleted = await deleteFirebaseRow('learning_artifacts', id);
      if (deleted) return NextResponse.json({ success: true, message: 'Đã xóa thành quả học tập.' });
    } catch (firebaseError) {
      console.warn('Firebase delete learning_artifacts error:', firebaseError);
    }

    if (supabaseAdmin) {
      try {
        let query = supabaseAdmin.from('learning_artifacts').delete().eq('id', id);
        if (userId) query = query.eq('user_id', userId);
        if (artifactType) query = query.eq('artifact_type', artifactType);
        const { error } = await query;
        if (error) throw error;
        return NextResponse.json({ success: true, message: 'Đã xóa thành quả học tập.' });
      } catch (sbErr) {
        console.warn('Supabase delete learning_artifacts error:', sbErr);
      }
    }

    const db = getDb();
    if (db) {
      try {
        const conditions = [eq(learningArtifacts.id, id)];
        if (userId) conditions.push(eq(learningArtifacts.userId, userId));
        if (artifactType) conditions.push(eq(learningArtifacts.artifactType, artifactType));
        await db.delete(learningArtifacts).where(and(...conditions));
        return NextResponse.json({ success: true, message: 'Đã xóa thành quả học tập.' });
      } catch (dbErr) {
        console.warn('Drizzle delete learning_artifacts error:', dbErr);
      }
    }

    return NextResponse.json({ success: true, mode: 'preview' });
  } catch (error) {
    console.error('Error deleting learning artifact:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Lỗi xóa thành quả học tập.' },
      { status: 500 }
    );
  }
}

