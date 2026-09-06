import { getSupabaseAdmin } from '@/lib/supabase';
import { getDb } from '@/db';
import { learningArtifacts, users } from '@/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import type { QuizAnalysisData } from '@/app/types';

export interface SaveArtifactParams {
  userId: number;
  userName?: string;
  moodleCourseId: number;
  artifactType: 'quiz_analysis' | 'summary' | 'mindmap' | 'flashcard' | string;
  contentData: Record<string, unknown> | QuizAnalysisData;
}

export async function saveLearningArtifact(params: SaveArtifactParams) {
  const { userId, userName, moodleCourseId, artifactType, contentData } = params;

  // 1. Try Supabase Client first
  const supabase = getSupabaseAdmin();
  if (supabase) {
    try {
      // Ensure user exists in users table due to foreign key
      await supabase.from('users').upsert(
        {
          moodle_user_id: userId,
          role: 'student',
          name: userName || 'Sinh viên',
        },
        { onConflict: 'moodle_user_id' }
      );

      const { data, error } = await supabase
        .from('learning_artifacts')
        .insert({
          user_id: userId,
          moodle_course_id: moodleCourseId,
          artifact_type: artifactType,
          content_data: contentData,
        })
        .select()
        .single();

      if (!error && data) {
        return data;
      }
      if (error) {
        console.warn('Supabase saveLearningArtifact warning:', error);
      }
    } catch (sbErr) {
      console.warn('Supabase saveLearningArtifact exception:', sbErr);
    }
  }

  // 2. Fallback to Drizzle getDb() if available
  const db = getDb();
  if (db) {
    try {
      // Ensure user exists
      const existing = await db
        .select()
        .from(users)
        .where(eq(users.moodleUserId, userId))
        .limit(1);

      if (existing.length === 0) {
        await db.insert(users).values({
          moodleUserId: userId,
          role: 'student',
          name: userName || 'Sinh viên',
        });
      }

      const [inserted] = await db
        .insert(learningArtifacts)
        .values({
          userId,
          moodleCourseId,
          artifactType,
          contentData: contentData as unknown as Record<string, unknown>,
        })
        .returning();

      return inserted;
    } catch (dbErr) {
      console.warn('Drizzle saveLearningArtifact exception:', dbErr);
    }
  }

  return null;
}

export async function getLearningArtifacts(params: {
  userId?: number;
  moodleCourseId?: number;
  artifactType?: string;
  limit?: number;
}) {
  const { userId, moodleCourseId, artifactType, limit = 10 } = params;

  // 1. Try Supabase
  const supabase = getSupabaseAdmin();
  if (supabase) {
    try {
      let query = supabase.from('learning_artifacts').select('*');
      if (userId) query = query.eq('user_id', userId);
      if (moodleCourseId) query = query.eq('moodle_course_id', moodleCourseId);
      if (artifactType) query = query.eq('artifact_type', artifactType);

      const { data, error } = await query
        .order('id', { ascending: false })
        .limit(limit);

      if (!error && data) {
        return data;
      }
      if (error) {
        console.warn('Supabase getLearningArtifacts warning:', error);
      }
    } catch (sbErr) {
      console.warn('Supabase getLearningArtifacts exception:', sbErr);
    }
  }

  // 2. Fallback to Drizzle
  const db = getDb();
  if (db) {
    try {
      const conditions = [];
      if (userId) conditions.push(eq(learningArtifacts.userId, userId));
      if (moodleCourseId) conditions.push(eq(learningArtifacts.moodleCourseId, moodleCourseId));
      if (artifactType) conditions.push(eq(learningArtifacts.artifactType, artifactType));

      const query = db
        .select()
        .from(learningArtifacts)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(learningArtifacts.createdAt))
        .limit(limit);

      return await query;
    } catch (dbErr) {
      console.warn('Drizzle getLearningArtifacts exception:', dbErr);
    }
  }

  return [];
}

export async function getLatestQuizAnalysis(params: {
  userId?: number;
  moodleCourseId?: number;
}): Promise<QuizAnalysisData | null> {
  const artifacts = await getLearningArtifacts({
    userId: params.userId,
    moodleCourseId: params.moodleCourseId,
    artifactType: 'quiz_analysis',
    limit: 1,
  });

  if (artifacts && artifacts.length > 0) {
    const item = artifacts[0];
    const content = (item.content_data || item.contentData) as unknown as QuizAnalysisData;
    if (content) {
      return {
        ...content,
        id: item.id,
      };
    }
  }

  return null;
}

export async function getQuizAnalysisByAttempt(
  attemptId: number,
  moodleCourseId?: number
): Promise<QuizAnalysisData | null> {
  const artifacts = await getLearningArtifacts({
    moodleCourseId,
    artifactType: 'quiz_analysis',
    limit: 50,
  });

  const matched = artifacts.find((item: any) => {
    const c = item.content_data || item.contentData;
    return c && Number(c.attemptId) === Number(attemptId);
  });

  if (matched) {
    const content = (matched.content_data || matched.contentData) as unknown as QuizAnalysisData;
    return {
      ...content,
      id: matched.id,
      cached: true,
    };
  }

  return null;
}

