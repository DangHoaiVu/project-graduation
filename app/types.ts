export type Course = {
  id?: number;
  code: string;
  name: string;
  progress: number;
  color: string;
  icon: string;
  next: string;
  role?: string;
  isTeacher?: boolean;
};

export type LibraryFile = {
  id?: string;
  name: string;
  size: string;
  sizeBytes?: number;
  type: string;
  source: string;
  status: string;
};

export type CourseSourceItem = {
  id?: string;
  name: string;
  type: 'PDF' | 'DOCX' | 'PPTX' | 'LINK' | 'TXT' | string;
  sizeOrPages?: string;
  url?: string;
  courseCode?: string;
};

export type CitationSource = {
  name: string;
  isExternal?: boolean;
  type?: string;
  url?: string;
};

export type ChatMessage = {
  role: 'user' | 'ai';
  text: string;
  sources?: Array<string | CitationSource>;
};

export type QuizQuestion = {
  q: string;
  choices: string[];
  answer: number;
  explanation?: string;
};

export type MoodleResource = {
  courseId?: number;
  courseCode?: string;
  courseName?: string;
  module?: string;
  type?: string;
  name: string;
  url: string;
};

export type ExamResult = {
  id: number;
  courseId: number;
  courseName: string;
  courseCode?: string;
  name: string;
  itemModule?: string;
  score: number;
  maxScore: number;
  minScore?: number;
  percentage?: string;
  gradedAt?: number | null;
  feedback?: string;
  passed?: boolean;
  url?: string;
};

export type MoodleData = {
  mode: 'demo' | 'live';
  courses: Array<{
    id: number;
    shortname: string;
    fullname: string;
    progress?: number;
    role?: string;
    isTeacher?: boolean;
  }>;
  deadlines: Array<{ id: number; name: string; courseName: string; timestamp: number; url?: string }>;
  resources: MoodleResource[];
  examResults?: ExamResult[];
  latestResult?: ExamResult | null;
  syncedAt: string;
  message?: string;
  user?: { id: number; name: string; username?: string; avatarUrl?: string | null };
  moodleUrl?: string;
};

export type MoodleUser = {
  id: number;
  fullname: string;
  username: string;
  avatarUrl?: string | null;
};

export type ErrorResponse = {
  error?: string;
};

export type TutorResponse = ErrorResponse & {
  answer?: string;
  sources?: Array<string | CitationSource>;
};

export type StudyToolResponse = ErrorResponse & {
  data?: unknown;
};

export type LibraryResponse = ErrorResponse & {
  documents?: Array<{
    id: string;
    name: string;
    size: number;
    contentType: string;
    source: string;
    status: string;
  }>;
  storageUsed?: number;
};

export type UploadResponse = ErrorResponse & {
  id?: string;
};

export type QuizResponse = ErrorResponse & {
  questions?: QuizQuestion[];
  mode?: string;
};

