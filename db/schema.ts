import { integer, jsonb, pgTable, real, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  moodleUserId: integer('moodle_user_id').notNull().unique(),
  name: varchar('name', { length: 255 }),
  email: varchar('email', { length: 255 }).unique(),
  role: varchar('role', { length: 50 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`),
});

export const courses = pgTable('courses', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  moodleCourseId: integer('moodle_course_id').notNull().unique(),
  title: varchar('title', { length: 255 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`),
});

export const documents = pgTable('documents', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  courseId: uuid('course_id')
    .notNull()
    .references(() => courses.id, { onDelete: 'cascade' }),
  title: varchar('title', { length: 255 }).notNull(),
  content: text('content').notNull(),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`),
});

export const quizAttempts = pgTable('quiz_attempts', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  moodleQuizId: integer('moodle_quiz_id').notNull(),
  score: real('score').notNull(),
  aiFeedback: text('ai_feedback'),
  attemptedAt: timestamp('attempted_at', { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`),
});

export const gradebooks = pgTable('gradebooks', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  courseId: uuid('course_id')
    .notNull()
    .references(() => courses.id, { onDelete: 'cascade' }),
  sourceType: varchar('source_type', { length: 100 }).notNull(),
  sourceUrl: text('source_url').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`),
});

export const learningArtifacts = pgTable('learning_artifacts', {
  id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
  userId: integer('user_id')
    .notNull()
    .references(() => users.moodleUserId, { onDelete: 'cascade' }),
  moodleCourseId: integer('moodle_course_id').notNull(),
  artifactType: varchar('artifact_type', { length: 50 }).notNull(),
  contentData: jsonb('content_data').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).default(sql`CURRENT_TIMESTAMP`),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Course = typeof courses.$inferSelect;
export type NewCourse = typeof courses.$inferInsert;
export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type QuizAttempt = typeof quizAttempts.$inferSelect;
export type NewQuizAttempt = typeof quizAttempts.$inferInsert;
export type Gradebook = typeof gradebooks.$inferSelect;
export type NewGradebook = typeof gradebooks.$inferInsert;
export type LearningArtifact = typeof learningArtifacts.$inferSelect;
export type NewLearningArtifact = typeof learningArtifacts.$inferInsert;

