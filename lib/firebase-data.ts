import { getFirebaseRows } from '@/lib/firebase-admin';

export function getPersonalMaterials(params: {
  userId?: number;
  moodleCourseId?: number;
  limit?: number;
}) {
  return getFirebaseRows('personal_materials', {
    user_id: params.userId,
    moodle_course_id: params.moodleCourseId,
  }, params.limit);
}