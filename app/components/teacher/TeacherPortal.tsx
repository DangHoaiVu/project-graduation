'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import type { Course, ChatMessage, CitationSource } from '@/app/types';
import { convertQuestionsToMoodleXml, type QuizQuestionItem } from '@/app/lib/moodle-xml';
import { MarkdownRenderer } from '@/app/components/MarkdownRenderer';

interface MoodleStudent {
  id: number;
  fullname: string;
  username: string;
  email: string;
  idnumber?: string;
}

interface GradeColumn {
  id: number;
  name: string;
  itemtype: string;
  itemmodule: string;
  iteminstance: number;
  grademax: number;
}

interface ExtractedRow {
  identifier: string;
  name?: string;
  score: number;
  feedback?: string;
  matchedStudentId?: number;
  matchStatus: 'exact' | 'fuzzy' | 'unmatched';
}

interface TeacherPortalProps {
  courses: Course[];
  moodleUrl?: string;
  token?: string;
  initialCourseId?: number | string;
  hideHeader?: boolean;
  sources?: Array<{ name: string; url?: string; type?: string; courseId?: number | string; courseCode?: string }>;
  initialTab?: 'assistant' | 'grades' | 'quiz';
  onTabChange?: (tab: 'assistant' | 'grades' | 'quiz') => void;
}

export function TeacherPortal({
  courses,
  moodleUrl = 'http://moodle.test',
  token,
  initialCourseId,
  hideHeader = false,
  sources = [],
  initialTab = 'assistant',
  onTabChange,
}: TeacherPortalProps) {
  const [activeTab, setActiveTab] = useState<'assistant' | 'grades' | 'quiz'>(initialTab);
  const [selectedCourseId, setSelectedCourseId] = useState<number | string>(
    initialCourseId || courses.find(c => c.isTeacher)?.id || courses[0]?.id || 1
  );
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const updateSize = () => {
      setIsMobile(window.innerWidth <= 640);
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  useEffect(() => {
    if (initialCourseId) {
      setSelectedCourseId(initialCourseId);
    }
  }, [initialCourseId]);

  // --------------------------------------------------------------------------
  // Tab 1: Smart Grade Import states
  // --------------------------------------------------------------------------
  const [gradeColumns, setGradeColumns] = useState<GradeColumn[]>([]);
  const [students, setStudents] = useState<MoodleStudent[]>([]);
  const [selectedGradeColumnId, setSelectedGradeColumnId] = useState<number | 'all'>('all');
  const [extractedRows, setExtractedRows] = useState<ExtractedRow[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [importNotice, setImportNotice] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [rawTextPaste, setRawTextPaste] = useState('');
  const [showPasteModal, setShowPasteModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --------------------------------------------------------------------------
  // Gradebook / Grader Report states (Mirroring Moodle Grader report)
  // --------------------------------------------------------------------------
  const [gradebookScores, setGradebookScores] = useState<Record<number, Record<number, number | string>>>({});
  const [gradebookFeedbacks, setGradebookFeedbacks] = useState<Record<number, Record<number, string>>>({});
  const [modifiedCells, setModifiedCells] = useState<Set<string>>(new Set());
  const [gradebookSearch, setGradebookSearch] = useState('');
  const [sortBy, setSortBy] = useState<'default' | 'name-asc' | 'name-desc' | 'grade-desc' | 'grade-asc'>('name-asc');
  const [showImportModal, setShowImportModal] = useState(false);
  const [isSavingGradebook, setIsSavingGradebook] = useState(false);

  // --------------------------------------------------------------------------
  // Tab 2: AI Quiz Generator states
  // --------------------------------------------------------------------------
  const [quizDocumentText, setQuizDocumentText] = useState('');
  const [quizCount, setQuizCount] = useState<number>(10);
  const [quizDifficulty, setQuizDifficulty] = useState<'easy' | 'normal' | 'hard'>('normal');
  const [quizQuestionType, setQuizQuestionType] = useState<'multiple_choice' | 'true_false' | 'multiple_select' | 'mixed'>('mixed');
  const [quizModel, setQuizModel] = useState('gemini:gemini-2.5-flash');
  const [isGeneratingQuiz, setIsGeneratingQuiz] = useState(false);
  const [generatedQuestions, setGeneratedQuestions] = useState<QuizQuestionItem[]>([]);
  const [xmlContent, setXmlContent] = useState<string>('');
  const [quizNotice, setQuizNotice] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [showXmlModal, setShowXmlModal] = useState(false);
  const [showGuideModal, setShowGuideModal] = useState(false);

  // --------------------------------------------------------------------------
  // Tab 3: Teacher AI Assistant Chat states
  // --------------------------------------------------------------------------
  const [assistantChat, setAssistantChat] = useState<ChatMessage[]>([]);
  const [assistantInput, setAssistantInput] = useState('');
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [assistantModel, setAssistantModel] = useState('auto');
  const [availableModels, setAvailableModels] = useState<Array<{ id: string; label: string }>>([
    { id: 'auto', label: '⚡ Tự động tối ưu (Auto)' },
    { id: 'gemini:gemini-2.5-flash', label: '⚡ Gemini 2.5 Flash' },
    { id: 'gemini:gemini-2.5-pro', label: '🧠 Gemini 2.5 Pro' },
    { id: 'openai:gpt-4o', label: '🌐 GPT-4o' },
  ]);
  const [copiedMsgIdx, setCopiedMsgIdx] = useState<number | null>(null);
  const assistantAbortRef = useRef<AbortController | null>(null);
  const chatMessagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (activeTab === 'assistant') {
      chatMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [assistantChat, activeTab]);

  // Load available models from API
  useEffect(() => {
    fetch('/api/models')
      .then(res => res.json())
      .then((data: any) => {
        if (data && data.models && Array.isArray(data.models)) {
          const activeList = data.models
            .filter((m: { available: boolean }) => m.available)
            .map((m: { id: string; label: string }) => ({ id: m.id, label: m.label }));
          if (activeList.length > 0) {
            setAvailableModels([
              { id: 'auto', label: '⚡ Tự động tối ưu (Auto)' },
              ...activeList,
            ]);
          }
        }
      })
      .catch(() => {});
  }, []);

  // Fetch course students & grade columns whenever selected course changes
  useEffect(() => {
    if (!selectedCourseId) return;

    // Reset previous course data immediately so nothing bleeds into the new course
    setGradebookScores({});
    setGradebookFeedbacks({});
    setExtractedRows([]);
    setModifiedCells(new Set());
    setSelectedGradeColumnId('all');

    const fetchStudentsAndColumns = async () => {
      try {
        const headers: Record<string, string> = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;
        const res = await fetch(`/api/teacher/students?courseId=${selectedCourseId}`, {
          headers,
        });
        if (res.ok) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const data = (await res.json()) as any;
          setStudents(data.students || []);
          const cols: GradeColumn[] = data.gradeItems || [];
          setGradeColumns(cols);
          setGradebookScores(data.initialScores || {});

          // Normalize initialFeedbacks: Record<number, Record<number, string>>
          const rawFeedbacks = data.initialFeedbacks || {};
          const normalizedFeedbacks: Record<number, Record<number, string>> = {};
          for (const sId of Object.keys(rawFeedbacks)) {
            const numSid = Number(sId);
            const val = rawFeedbacks[sId];
            if (typeof val === 'string') {
              if (val.trim() && cols[0]?.id) {
                normalizedFeedbacks[numSid] = { [cols[0].id]: val.trim() };
              }
            } else if (typeof val === 'object' && val !== null) {
              normalizedFeedbacks[numSid] = val;
            }
          }
          setGradebookFeedbacks(normalizedFeedbacks);
          setModifiedCells(new Set());
        }
      } catch (err) {
        console.warn('Failed to load course details:', err);
      }
    };
    fetchStudentsAndColumns();
  }, [selectedCourseId, token]);

  // Fallbacks matching Moodle course (e.g. Bùi Xuân Huấn, Ngô Bá Khá)
  const defaultStudents: MoodleStudent[] = [
    { id: 101, fullname: 'Bùi Xuân Huấn', username: 'huanhoahong', email: 'huanhoahong@example.com', idnumber: 'SV001' },
    { id: 102, fullname: 'Ngô Bá Khá', username: 'khabanh', email: 'khabanh@example.com', idnumber: 'SV002' },
  ];
  const activeStudents = students.length > 0 ? students : defaultStudents;

  const activeGradeColumns = gradeColumns.filter(
    col =>
      col.itemtype !== 'course' &&
      !col.name.toLowerCase().includes('course total') &&
      !col.name.toLowerCase().includes('tổng kết')
  );

  const isAllColumnsSelected = selectedGradeColumnId === 'all';
  const displayedGradeColumns = isAllColumnsSelected
    ? activeGradeColumns
    : activeGradeColumns.filter(c => c.id === selectedGradeColumnId).length > 0
    ? activeGradeColumns.filter(c => c.id === selectedGradeColumnId)
    : activeGradeColumns;

  // Helper to safely get feedback string for a student and column
  const getStudentColFeedback = (studentId: number, colId?: number): string => {
    const fbEntry = (gradebookFeedbacks as Record<number, unknown>)[studentId];
    if (!fbEntry) return '';
    if (typeof fbEntry === 'string') return fbEntry;
    if (typeof fbEntry === 'object' && fbEntry !== null && colId !== undefined) {
      return (fbEntry as Record<number, string>)[colId] || '';
    }
    return '';
  };

  // Check whether any student actually has non-empty feedback for the displayed column(s)
  const hasFeedbackForDisplayedColumns = displayedGradeColumns.some(col =>
    activeStudents.some(s => Boolean(getStudentColFeedback(s.id, col.id).trim()))
  );

  // The feedback column is ONLY shown when a specific column is selected AND that column actually has feedback from Moodle.
  // If there isn't any feedback, or when viewing all columns, the feedback column is removed.
  const showFeedbackColumn = !isAllColumnsSelected && hasFeedbackForDisplayedColumns;

  // Helper to extract student's score for sorting
  const getStudentSortingScore = (studentId: number): number => {
    if (selectedGradeColumnId !== 'all') {
      const s = gradebookScores[studentId]?.[selectedGradeColumnId];
      if (s !== undefined && s !== '' && !isNaN(Number(s))) return Number(s);
      return -1;
    }
    const cols = displayedGradeColumns;
    if (cols.length === 0) return -1;
    const scores = cols
      .map(c => gradebookScores[studentId]?.[c.id])
      .filter(s => s !== undefined && s !== '' && !isNaN(Number(s)))
      .map(Number);
    if (scores.length > 0) {
      return scores.reduce((sum, v) => sum + v, 0) / scores.length;
    }
    return -1;
  };

  // Filtered and sorted student list
  const processedStudents = useMemo(() => {
    // 1. Filter by search keyword
    const list = activeStudents.filter(s => {
      if (!gradebookSearch.trim()) return true;
      const q = gradebookSearch.toLowerCase();
      return (
        s.fullname.toLowerCase().includes(q) ||
        s.email.toLowerCase().includes(q) ||
        s.username.toLowerCase().includes(q)
      );
    });

    // 2. Sort by student name (A-Z, Z-A) or grade (highest, lowest)
    return [...list].sort((a, b) => {
      if (sortBy === 'name-asc') {
        const lastA = a.fullname.trim().split(/\s+/).slice(-1)[0] || a.fullname;
        const lastB = b.fullname.trim().split(/\s+/).slice(-1)[0] || b.fullname;
        const cmp = lastA.localeCompare(lastB, 'vi', { sensitivity: 'base' });
        return cmp !== 0 ? cmp : a.fullname.localeCompare(b.fullname, 'vi');
      }
      if (sortBy === 'name-desc') {
        const lastA = a.fullname.trim().split(/\s+/).slice(-1)[0] || a.fullname;
        const lastB = b.fullname.trim().split(/\s+/).slice(-1)[0] || b.fullname;
        const cmp = lastB.localeCompare(lastA, 'vi', { sensitivity: 'base' });
        return cmp !== 0 ? cmp : b.fullname.localeCompare(a.fullname, 'vi');
      }
      if (sortBy === 'grade-desc') {
        const scoreA = getStudentSortingScore(a.id);
        const scoreB = getStudentSortingScore(b.id);
        if (scoreA === -1 && scoreB !== -1) return 1;
        if (scoreB === -1 && scoreA !== -1) return -1;
        return scoreB - scoreA;
      }
      if (sortBy === 'grade-asc') {
        const scoreA = getStudentSortingScore(a.id);
        const scoreB = getStudentSortingScore(b.id);
        if (scoreA === -1 && scoreB !== -1) return 1;
        if (scoreB === -1 && scoreA !== -1) return -1;
        return scoreA - scoreB;
      }
      return 0;
    });
  }, [activeStudents, gradebookSearch, sortBy, gradebookScores, selectedGradeColumnId, displayedGradeColumns]);

  // Initialize Teacher Assistant welcome message
  useEffect(() => {
    const curCourse = courses.find(c => String(c.id) === String(selectedCourseId) || c.code === String(selectedCourseId));
    const courseTitle = curCourse ? curCourse.name : 'môn học này';
    if (assistantChat.length === 0) {
      setAssistantChat([
        {
          role: 'ai',
          text: `Chào Thầy/Cô! Em là trợ lý AI môn **${courseTitle}**. Thầy/Cô có thể yêu cầu em tìm tài liệu học tập, soạn bài tập về nhà, lập kế hoạch bài giảng hoặc tạo câu hỏi thi cho môn học nhé!`,
        },
      ]);
    }
  }, [selectedCourseId, courses, assistantChat.length]);

  const askAssistant = async (customPrompt?: string) => {
    if (assistantLoading) {
      if (assistantAbortRef.current) {
        assistantAbortRef.current.abort();
        assistantAbortRef.current = null;
      }
      setAssistantLoading(false);
      return;
    }

    const q = (customPrompt ?? assistantInput).trim();
    if (!q) return;

    const nextChat: ChatMessage[] = [...assistantChat, { role: 'user', text: q }];
    setAssistantChat(nextChat);
    if (!customPrompt) setAssistantInput('');
    setAssistantLoading(true);

    const controller = new AbortController();
    assistantAbortRef.current = controller;

    const curCourse = courses.find(c => String(c.id) === String(selectedCourseId) || c.code === String(selectedCourseId));

    const currentCourseSources = sources.filter(s => {
      if (s.courseId && String(s.courseId) === String(selectedCourseId)) return true;
      if (curCourse && s.courseCode && s.courseCode.toLowerCase() === curCourse.code.toLowerCase()) return true;
      return true;
    });

    try {
      const res = await fetch('/api/teacher/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          question: q,
          course: curCourse?.name || 'Khóa học',
          courseCode: curCourse?.code || '',
          courseId: curCourse?.id || selectedCourseId,
          sources: currentCourseSources.map(s => ({ name: s.name, url: s.url, type: s.type })),
          history: assistantChat.slice(1).map(c => ({ role: c.role, text: c.text })),
          model: assistantModel,
          students: activeStudents.map(s => ({
            id: s.id,
            fullname: s.fullname,
            username: s.username,
            idnumber: s.idnumber,
            scores: activeGradeColumns.map(col => ({
              columnName: col.name,
              maxScore: col.grademax,
              score: gradebookScores[s.id]?.[col.id] !== undefined && gradebookScores[s.id]?.[col.id] !== ''
                ? Number(gradebookScores[s.id]?.[col.id])
                : null,
            })),
          })),
          gradeColumns: activeGradeColumns.map(c => ({ id: c.id, name: c.name, grademax: c.grademax })),
        }),
      });

      const data = (await res.json()) as { error?: string; answer?: string; sources?: Array<string | CitationSource> };
      if (!res.ok) throw new Error(data.error || 'Lỗi xử lý AI');

      setAssistantChat(prev => [
        ...prev,
        {
          role: 'ai',
          text: data.answer || '',
          sources: data.sources || [],
        },
      ]);
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
      setAssistantChat(prev => [
        ...prev,
        {
          role: 'ai',
          text: `⚠️ **Lỗi kết nối AI**: ${(err as Error)?.message || 'Không thể nhận phản hồi lúc này.'}`,
        },
      ]);
    } finally {
      if (assistantAbortRef.current === controller) {
        assistantAbortRef.current = null;
      }
      setAssistantLoading(false);
    }
  };

  const transferToQuizTab = (text: string) => {
    setQuizDocumentText(text);
    setActiveTab('quiz');
    setQuizNotice({
      type: 'info',
      message: '⚡ Đã chuyển nội dung câu hỏi từ Trợ lý AI sang Lò Ấp! Thầy/Cô có thể nhấp "Tạo Ngân Hàng Câu Hỏi Moodle XML" bên dưới để trích xuất XML.',
    });
  };

  const copyMessageText = (text: string, idx: number) => {
    navigator.clipboard.writeText(text);
    setCopiedMsgIdx(idx);
    setTimeout(() => setCopiedMsgIdx(null), 2000);
  };

  // --------------------------------------------------------------------------
  // Helper: Match extracted rows with Moodle students
  // --------------------------------------------------------------------------
  const matchRowWithStudents = (
    row: { identifier: string; name?: string; score: number; feedback?: string },
    studentList: MoodleStudent[]
  ): ExtractedRow => {
    const rawId = (row.identifier || '').trim().toLowerCase();
    const rawName = (row.name || '').trim().toLowerCase();

    // 1. Exact Email / Username / Idnumber match
    const exact = studentList.find(
      s =>
        (s.email && s.email.toLowerCase() === rawId) ||
        (s.username && s.username.toLowerCase() === rawId) ||
        (s.idnumber && s.idnumber.toLowerCase() === rawId) ||
        (s.fullname && s.fullname.toLowerCase() === rawName)
    );

    if (exact) {
      return {
        ...row,
        matchedStudentId: exact.id,
        matchStatus: 'exact',
      };
    }

    // 2. Fuzzy name match (e.g. "Bùi Xuân Huấn" vs "Huấn Hoa Hồng" or partial name)
    const fuzzy = studentList.find(s => {
      const sName = s.fullname.toLowerCase();
      const sUser = s.username.toLowerCase();
      return (
        (rawName && (sName.includes(rawName) || rawName.includes(sName))) ||
        (rawId && (sName.includes(rawId) || rawId.includes(sName) || sUser.includes(rawId)))
      );
    });

    if (fuzzy) {
      return {
        ...row,
        matchedStudentId: fuzzy.id,
        matchStatus: 'fuzzy',
      };
    }

    return {
      ...row,
      matchedStudentId: undefined,
      matchStatus: 'unmatched',
    };
  };

  // --------------------------------------------------------------------------
  // Handle File / Image / Excel Upload
  // --------------------------------------------------------------------------
  const handleFileUpload = async (file: File) => {
    setIsExtracting(true);
    setImportNotice(null);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/teacher/grades/import', {
        method: 'POST',
        body: formData,
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (await res.json()) as any;
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Trích xuất điểm thất bại.');
      }

      const rawGrades: Array<{ identifier: string; name?: string; score: number; feedback?: string }> =
        data.grades || [];

      if (rawGrades.length === 0) {
        setImportNotice({
          type: 'info',
          message: 'Không tìm thấy dữ liệu điểm trong file. Hãy kiểm tra lại định dạng file hoặc ảnh chụp.',
        });
        setIsExtracting(false);
        return;
      }

      const mapped = rawGrades.map(g => matchRowWithStudents(g, activeStudents));
      setExtractedRows(mapped);

      const targetColId: number = (selectedGradeColumnId !== 'all' ? selectedGradeColumnId : activeGradeColumns[0]?.id) || 1;
      setGradebookScores(prev => {
        const next = { ...prev };
        mapped.forEach(r => {
          if (r.matchedStudentId) {
            next[r.matchedStudentId] = { ...(next[r.matchedStudentId] || {}), [targetColId]: r.score };
          }
        });
        return next;
      });
      setGradebookFeedbacks(prev => {
        const next = { ...prev };
        mapped.forEach(r => {
          if (r.matchedStudentId) {
            next[r.matchedStudentId] = {
              ...(typeof next[r.matchedStudentId] === 'object' ? next[r.matchedStudentId] : {}),
              [targetColId]: r.feedback ? r.feedback.trim() : '',
            };
          }
        });
        return next;
      });
      setModifiedCells(prev => {
        const next = new Set(prev);
        mapped.forEach(r => {
          if (r.matchedStudentId) next.add(`${r.matchedStudentId}-${targetColId}`);
        });
        return next;
      });

      setImportNotice({
        type: 'success',
        message: `Đã "hút" thành công ${rawGrades.length} điểm và tự động điền vào Sổ điểm qua ${
          data.method === 'multimodal_ai' ? 'Trí tuệ nhân tạo Đa phương thức (AI Multimodal)' : 'Phân tích bảng tính Excel'
        }!`,
      });
    } catch (err) {
      setImportNotice({
        type: 'error',
        message: err instanceof Error ? err.message : 'Lỗi khi trích xuất file.',
      });
    } finally {
      setIsExtracting(false);
    }
  };

  // Quick load sample data
  const loadSampleGrades = () => {
    const sampleData = [
      {
        identifier: 'huanhoahong@example.com',
        name: 'Bùi Xuân Huấn',
        score: 7.5,
        feedback: 'Cần tìm hiểu thêm về các backend framework',
      },
      {
        identifier: 'khabanh@example.com',
        name: 'Ngô Bá Khá',
        score: 7.0,
        feedback: 'Cần tìm hiểu thêm về các Python framework',
      },
    ];
    const mapped = sampleData.map(g => matchRowWithStudents(g, activeStudents));
    setExtractedRows(mapped);

    const targetColId: number = (selectedGradeColumnId !== 'all' ? selectedGradeColumnId : activeGradeColumns[0]?.id) || 1;
    setGradebookScores(prev => {
      const next = { ...prev };
      mapped.forEach((r: ExtractedRow) => {
        if (r.matchedStudentId) {
          next[r.matchedStudentId] = { ...(next[r.matchedStudentId] || {}), [targetColId]: r.score };
        }
      });
      return next;
    });
    setGradebookFeedbacks(prev => {
      const next = { ...prev };
      mapped.forEach((r: ExtractedRow) => {
        if (r.matchedStudentId && r.feedback) {
          next[r.matchedStudentId] = {
            ...(typeof next[r.matchedStudentId] === 'object' ? next[r.matchedStudentId] : {}),
            [targetColId]: r.feedback.trim(),
          };
        }
      });
      return next;
    });
    setModifiedCells(prev => {
      const next = new Set(prev);
      mapped.forEach((r: ExtractedRow) => {
        if (r.matchedStudentId) next.add(`${r.matchedStudentId}-${targetColId}`);
      });
      return next;
    });

    setImportNotice({
      type: 'success',
      message: '✓ Đã nạp thành công điểm & nhận xét mẫu: Bùi Xuân Huấn (7.5đ - "Cần tìm hiểu thêm về các backend framework"), Ngô Bá Khá (7.0đ - "Cần tìm hiểu thêm về các Python framework"). Bấm "Save changes" để lưu và đồng bộ lên Moodle!',
    });
  };

  // Handle Text Paste
  const handlePasteSubmit = async () => {
    if (!rawTextPaste.trim()) return;
    setIsExtracting(true);
    setImportNotice(null);
    setShowPasteModal(false);
    try {
      const res = await fetch('/api/teacher/grades/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rawText: rawTextPaste }),
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (await res.json()) as any;
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Trích xuất thất bại.');
      }
      const rawGrades = data.grades || [];
      const mapped = rawGrades.map((g: { identifier: string; name?: string; score: number }) =>
        matchRowWithStudents(g, activeStudents)
      );
      setExtractedRows(mapped);

      const targetColId: number = (selectedGradeColumnId !== 'all' ? selectedGradeColumnId : activeGradeColumns[0]?.id) || 1;
      setGradebookScores(prev => {
        const next = { ...prev };
        mapped.forEach((r: ExtractedRow) => {
          if (r.matchedStudentId) {
            next[r.matchedStudentId] = { ...(next[r.matchedStudentId] || {}), [targetColId]: r.score };
          }
        });
        return next;
      });
      setGradebookFeedbacks(prev => {
        const next = { ...prev };
        mapped.forEach((r: ExtractedRow) => {
          if (r.matchedStudentId) {
            next[r.matchedStudentId] = {
              ...(typeof next[r.matchedStudentId] === 'object' ? next[r.matchedStudentId] : {}),
              [targetColId]: r.feedback ? r.feedback.trim() : '',
            };
          }
        });
        return next;
      });
      setModifiedCells(prev => {
        const next = new Set(prev);
        mapped.forEach((r: ExtractedRow) => {
          if (r.matchedStudentId) next.add(`${r.matchedStudentId}-${targetColId}`);
        });
        return next;
      });

      setImportNotice({
        type: 'success',
        message: `Đã trích xuất ${rawGrades.length} sinh viên từ văn bản và điền vào Sổ điểm.`,
      });
    } catch (err) {
      setImportNotice({
        type: 'error',
        message: err instanceof Error ? err.message : 'Lỗi xử lý văn bản.',
      });
    } finally {
      setIsExtracting(false);
    }
  };

  // Push grades to Moodle
  const pushGradesToMoodle = async () => {
    const validGrades = extractedRows
      .filter(r => r.matchedStudentId !== undefined)
      .map(r => ({
        studentId: r.matchedStudentId!,
        score: Number(r.score),
        feedback: r.feedback,
      }));

    if (validGrades.length === 0) {
      alert('Chưa có sinh viên nào được khớp hợp lệ để đẩy điểm.');
      return;
    }

    const targetCol = gradeColumns.find(c => c.id === selectedGradeColumnId);

    setIsPushing(true);
    setImportNotice(null);
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch('/api/teacher/grades/update', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          courseId: selectedCourseId,
          component: targetCol?.itemmodule ? `mod_${targetCol.itemmodule}` : 'mod_quiz',
          activityId: targetCol?.iteminstance ?? 0,
          itemNumber: 0,
          grades: validGrades,
        }),
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (await res.json()) as any;
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Không thể cập nhật điểm vào Moodle.');
      }

      setImportNotice({
        type: 'success',
        message: `🎉 TUYỆT VỜI! Đã tự động cập nhật ${validGrades.length} điểm vào cột "${
          targetCol?.name || 'Kiểm tra'
        }" trên Moodle thành công!`,
      });
    } catch (err) {
      setImportNotice({
        type: 'error',
        message: err instanceof Error ? err.message : 'Lỗi khi gửi dữ liệu sang Moodle.',
      });
    } finally {
      setIsPushing(false);
    }
  };

  // Direct cell editing in the Gradebook
  const handleGradeCellChange = (studentId: number, colId: number, value: string) => {
    setGradebookScores(prev => ({
      ...prev,
      [studentId]: {
        ...(prev[studentId] || {}),
        [colId]: value,
      },
    }));
    setModifiedCells(prev => new Set(prev).add(`${studentId}-${colId}`));
  };

  // Feedback editing in the Gradebook
  const handleFeedbackChange = (studentId: number, fb: string, colId?: number) => {
    const targetCol = colId || (selectedGradeColumnId !== 'all' ? selectedGradeColumnId : activeGradeColumns[0]?.id) || 1;
    setGradebookFeedbacks(prev => ({
      ...prev,
      [studentId]: {
        ...(typeof prev[studentId] === 'object' ? prev[studentId] : {}),
        [targetCol]: fb,
      },
    }));
    setModifiedCells(prev => new Set(prev).add(`${studentId}-fb-${targetCol}`));
  };

  // Save entire Gradebook to Moodle (Save changes button mirroring Moodle Grader report)
  const handleSaveGradebook = async () => {
    const colId: number = (selectedGradeColumnId !== 'all' ? selectedGradeColumnId : activeGradeColumns[0]?.id) || 1;
    const col = activeGradeColumns.find(c => c.id === colId) || activeGradeColumns[0];
    const gradesToPush: Array<{ studentId: number; score: number; feedback?: string }> = [];

    activeStudents.forEach(s => {
      const val = gradebookScores[s.id]?.[colId];
      if (val !== undefined && val !== '' && !isNaN(Number(val))) {
        const studentFb = getStudentColFeedback(s.id, colId);
        gradesToPush.push({
          studentId: s.id,
          score: Number(val),
          feedback: studentFb || '',
        });
      }
    });

    if (gradesToPush.length === 0) {
      setImportNotice({
        type: 'info',
        message: 'Chưa có điểm nào trong Sổ điểm để lưu lên Moodle. Vui lòng nhập điểm hoặc dùng chức năng Hút điểm.',
      });
      return;
    }

    setIsSavingGradebook(true);
    setImportNotice(null);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch('/api/teacher/grades/update', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          courseId: selectedCourseId,
          component: col?.itemmodule ? `mod_${col.itemmodule}` : 'moodle',
          activityId: col?.iteminstance ?? 0,
          itemNumber: col?.id ?? 0,
          grades: gradesToPush,
        }),
      });

      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Không thể cập nhật điểm vào Moodle.');
      }

      setImportNotice({
        type: 'success',
        message: `🎉 TUYỆT VỜI! Đã lưu thành công ${gradesToPush.length} điểm sinh viên vào cột "${col?.name || 'Điểm'}" trên Moodle Grader report!`,
      });
      setModifiedCells(new Set());
    } catch (err) {
      setImportNotice({
        type: 'error',
        message: err instanceof Error ? err.message : 'Lỗi khi lưu điểm lên Moodle.',
      });
    } finally {
      setIsSavingGradebook(false);
    }
  };

  // --------------------------------------------------------------------------
  // Tab 2: AI Quiz Generator Handlers
  // --------------------------------------------------------------------------
  const generateQuiz = async () => {
    setIsGeneratingQuiz(true);
    setQuizNotice(null);
    try {
      const selectedCourse = courses.find(c => String(c.id) === String(selectedCourseId));
      const effectiveTopic = selectedCourse?.name || 'Ngân hàng câu hỏi trắc nghiệm';
      const res = await fetch('/api/teacher/quiz/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          course: selectedCourse?.name || 'Khóa học',
          courseId: selectedCourseId,
          topic: effectiveTopic,
          documentText: quizDocumentText,
          count: quizCount,
          difficulty: quizDifficulty,
          questionType: quizQuestionType,
          model: quizModel,
        }),
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = (await res.json()) as any;
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Không thể tạo đề trắc nghiệm.');
      }

      setGeneratedQuestions(data.questions || []);
      setXmlContent(data.xmlContent || '');
      setQuizNotice({
        type: 'success',
        message: `Đã biên soạn thành công ${data.count} câu hỏi trắc nghiệm chuẩn Moodle XML! Bạn có thể tải file hoặc chỉnh sửa trực tiếp.`,
      });
    } catch (err) {
      setQuizNotice({
        type: 'error',
        message: err instanceof Error ? err.message : 'Lỗi khi tạo câu hỏi.',
      });
    } finally {
      setIsGeneratingQuiz(false);
    }
  };

  // Download XML file
  const downloadMoodleXml = () => {
    if (!xmlContent && generatedQuestions.length === 0) return;
    const selectedCourse = courses.find(c => String(c.id) === String(selectedCourseId));
    const titleName = selectedCourse?.name || 'question_bank';
    const finalXml = xmlContent || convertQuestionsToMoodleXml(generatedQuestions, titleName);
    const blob = new Blob([finalXml], { type: 'application/xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `moodle_quiz_${titleName.replace(/\s+/g, '_')}_${Date.now()}.xml`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleTabChange = (tab: 'assistant' | 'grades' | 'quiz') => {
    setActiveTab(tab);
    onTabChange?.(tab);
  };

  return (
    <div className={`teacher-portal-container ${activeTab === 'assistant' ? 'assistant-active' : ''}`}>
      {/* Top Header (Hidden on course page to prevent duplication) */}
      {!hideHeader && (
        <div className="teacher-header-card">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <span style={{ fontSize: '24px' }}>🎓</span>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, color: '#f3f2f8' }}>
                    Bàn Làm Việc Giảng Viên (Teacher Portal)
                  </h1>
                  {selectedCourseId && (
                    <a
                      href={`${moodleUrl.replace(/\/$/, '')}/course/view.php?id=${selectedCourseId}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        fontSize: '0.75rem',
                        color: '#cfc8ff',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '3px',
                        textDecoration: 'none',
                        padding: '2px 8px',
                        borderRadius: '12px',
                        background: 'rgba(124, 109, 242, 0.15)',
                        border: '1px solid rgba(124, 109, 242, 0.3)',
                      }}
                      title="Mở khóa học trên Moodle"
                    >
                      <span>Xem trên Moodle</span>
                      <span style={{ fontSize: '10px' }}>↗</span>
                    </a>
                  )}
                </div>
                <p style={{ margin: '0.2rem 0 0', fontSize: '0.82rem', color: '#9894ad' }}>
                  Vũ khí AI tự động hóa: Hút điểm đa định dạng vào Moodle &amp; Lò ấp đề thi trắc nghiệm XML
                </p>
              </div>
            </div>
          </div>

          {/* Course Selector */}
          <div className="course-select-wrap">
            <label style={{ fontSize: '0.85rem', color: '#9894ad', whiteSpace: 'nowrap' }}>Khóa học:</label>
            <select
              value={selectedCourseId}
              onChange={e => setSelectedCourseId(e.target.value)}
              style={{
                padding: '0.5rem 0.85rem',
                borderRadius: '10px',
                background: '#141220',
                color: '#f3f2f8',
                border: '1px solid rgba(124, 109, 242, 0.4)',
                fontSize: '0.88rem',
                fontWeight: 500,
                cursor: 'pointer',
              }}
            >
              {(() => {
                const teaching = courses.filter(c => c.isTeacher);
                const other = courses.filter(c => !c.isTeacher);
                return (
                  <>
                    {teaching.length > 0 && (
                      <optgroup label="🎓 Khóa học bạn giảng dạy">
                        {teaching.map(c => (
                          <option key={c.id || c.code} value={c.id || c.code}>
                            {c.name} ({c.code})
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {other.length > 0 && (
                      <optgroup label={teaching.length > 0 ? '📚 Khóa học khác / đang học' : '📚 Tất cả khóa học'}>
                        {other.map(c => (
                          <option key={c.id || c.code} value={c.id || c.code}>
                            {c.name} ({c.code})
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {teaching.length === 0 && other.length === 0 && (
                      courses.map(c => (
                        <option key={c.id || c.code} value={c.id || c.code}>
                          {c.name} ({c.code})
                        </option>
                      ))
                    )}
                  </>
                );
              })()}
            </select>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="teacher-tabs-container">
        <button
          type="button"
          onClick={() => handleTabChange('assistant')}
          className={`teacher-tab-btn ${activeTab === 'assistant' ? 'active' : ''}`}
        >
          <span>🤖</span>
          <span>Trợ Lý AI</span>
        </button>

        <button
          type="button"
          onClick={() => handleTabChange('grades')}
          className={`teacher-tab-btn ${activeTab === 'grades' ? 'active' : ''}`}
        >
          <span>📥</span>
          <span>Bảng điểm</span>
        </button>

        <button
          type="button"
          onClick={() => handleTabChange('quiz')}
          className={`teacher-tab-btn ${activeTab === 'quiz' ? 'active' : ''}`}
        >
          <span>⚡</span>
          <span>Trắc Nghiệm</span>
        </button>
      </div>

      {/* ==================================================================== */}
      {/* TAB 1: TEACHER AI ASSISTANT CHAT                                     */}
      {/* ==================================================================== */}
      {activeTab === 'assistant' && (
        <div className="teacher-assistant-chat-wrap">
          {/* Chat Messages */}
          <div className="messages">
            {assistantChat.map((m, i) => (
              <div className={`message ${m.role}`} key={i}>
                {m.role === 'ai' && <span className="bot-avatar">✦</span>}
                <div id={`teacher-chat-msg-${i}`} style={{ minWidth: 0, width: '100%' }}>
                  <MarkdownRenderer content={m.text} />

                  {/* External sources citation pills */}
                  {m.sources && m.sources.length > 0 && (
                    <div className="citations">
                      {m.sources.map((s, idx) => {
                        const isObj = typeof s === 'object' && s !== null;
                        const rawName = isObj ? s.name : String(s);
                        const url = isObj && s.url ? s.url : `https://www.google.com/search?q=${encodeURIComponent(rawName)}`;
                        return (
                          <a
                            key={idx}
                            className="citation-pill external-citation"
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ textDecoration: 'none' }}
                          >
                            <span className="citation-icon">🌐</span>
                            <span className="citation-text">{rawName}</span>
                            <span style={{ fontSize: '10px', opacity: 0.8, marginLeft: '2px' }}>↗</span>
                          </a>
                        );
                      })}
                    </div>
                  )}

                  {/* Copy button for AI message */}
                  {m.role === 'ai' && (
                    <div className="message-toolbar">
                      <button
                        type="button"
                        className={`copy-message-btn ${copiedMsgIdx === i ? 'copied' : ''}`}
                        onClick={() => copyMessageText(m.text, i)}
                        title="Sao chép nội dung"
                      >
                        <span>{copiedMsgIdx === i ? '✓' : '📋'}</span>
                        <span>{copiedMsgIdx === i ? 'Đã sao chép' : 'Sao chép'}</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {assistantLoading && (
              <div className="message ai">
                <span className="bot-avatar">✦</span>
                <div className="typing">
                  <i />
                  <i />
                  <i />
                </div>
              </div>
            )}
            <div ref={chatMessagesEndRef} />
          </div>

          {/* Chat Composer */}
          <div className="chat-compose">
            <textarea
              value={assistantInput}
              onChange={e => setAssistantInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void askAssistant();
                }
              }}
              placeholder="Đặt câu hỏi, yêu cầu soạn tài liệu, bài tập, giáo án hay đề thi cho môn học..."
            />
            <div className="chat-compose-footer">
              <div className="chat-compose-chips">
                {/* AI Model Selector */}
                <select
                  value={assistantModel}
                  onChange={e => setAssistantModel(e.target.value)}
                  className="model-selector-chip"
                  title="Chọn model AI"
                >
                  {availableModels.map(m => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="chat-compose-actions">
                <button
                  type="button"
                  className="clear-chat-btn"
                  onClick={() => {
                    const curCourse = courses.find(c => String(c.id) === String(selectedCourseId) || c.code === String(selectedCourseId));
                    setAssistantChat([
                      {
                        role: 'ai',
                        text: `Chào Thầy/Cô! Em là trợ lý AI môn **${curCourse?.name || 'này'}**. Thầy/Cô có thể yêu cầu em tìm tài liệu học tập, soạn bài tập về nhà, lập kế hoạch bài giảng hoặc tạo câu hỏi thi cho môn học nhé!`,
                      },
                    ]);
                  }}
                  disabled={assistantChat.length <= 1 || assistantLoading}
                  title="Xóa lịch sử trò chuyện"
                >
                  <span style={{ fontSize: '13px' }}>🗑</span>
                  <span>Xóa lịch sử</span>
                </button>

                {assistantLoading ? (
                  <button
                    type="button"
                    onClick={() => {
                      if (assistantAbortRef.current) {
                        assistantAbortRef.current.abort();
                        assistantAbortRef.current = null;
                      }
                      setAssistantLoading(false);
                    }}
                    style={{
                      background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                      color: '#fff',
                      border: 'none',
                      padding: '0.5rem 1.1rem',
                      borderRadius: '10px',
                      fontWeight: 700,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      cursor: 'pointer',
                      boxShadow: '0 2px 10px rgba(239, 68, 68, 0.4)',
                    }}
                    title="Dừng câu trả lời của AI"
                  >
                    <span style={{ fontSize: '11px' }}>■</span>
                    <span>Dừng</span>
                  </button>
                ) : (
                  <button onClick={() => void askAssistant()} disabled={!assistantInput.trim()}>
                    Gửi <b>↑</b>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 2: SMART GRADE IMPORT                                            */}
      {/* ==================================================================== */}
      {activeTab === 'grades' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {/* Top Control Bar */}
          <div className="teacher-control-bar">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap', flex: '1 1 auto' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                <span style={{ fontSize: '1.2rem' }}>📊</span>
                <strong style={{ fontSize: '0.98rem', color: '#f3f2f8' }}>Sổ Điểm (Grader report)</strong>
                <span
                  style={{
                    fontSize: '11px',
                    padding: '2px 8px',
                    borderRadius: '12px',
                    background: 'rgba(32, 191, 169, 0.15)',
                    color: '#20bfa9',
                    border: '1px solid rgba(32, 191, 169, 0.3)',
                    fontWeight: 600,
                  }}
                >
                  ● Trực tiếp Moodle
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap', flex: isMobile ? '1 1 100%' : 'initial' }}>
                <label style={{ fontSize: '0.82rem', color: '#9894ad', whiteSpace: 'nowrap' }}>Cột đang chọn:</label>
                <select
                  value={selectedGradeColumnId}
                  onChange={e => {
                    const val = e.target.value;
                    setSelectedGradeColumnId(val === 'all' ? 'all' : Number(val));
                  }}
                  style={{
                    padding: '0.45rem 0.8rem',
                    borderRadius: '8px',
                    background: '#141220',
                    color: '#f3f2f8',
                    border: '1px solid rgba(124, 109, 242, 0.4)',
                    fontSize: '0.85rem',
                    fontWeight: 600,
                    outline: 'none',
                    maxWidth: '100%',
                    flex: isMobile ? 1 : 'initial',
                    opacity: activeGradeColumns.length === 0 ? 0.6 : 1,
                  }}
                  disabled={activeGradeColumns.length === 0}
                >
                  {activeGradeColumns.length === 0 ? (
                    <option value="all">Chưa có bài kiểm tra nào</option>
                  ) : (
                    <>
                      <option value="all">📊 Tất cả cột điểm (All grades)</option>
                      {activeGradeColumns.map(col => (
                        <option key={col.id} value={col.id}>
                          📝 {col.name} (Tối đa: {col.grademax}đ)
                        </option>
                      ))}
                    </>
                  )}
                </select>
              </div>
            </div>

            {/* Quick Action Button right in the control bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: isMobile ? '100%' : 'auto' }}>
              <button
                type="button"
                onClick={() => setShowImportModal(true)}
                style={{
                  padding: '0.5rem 1rem',
                  borderRadius: '8px',
                  border: 'none',
                  background: 'linear-gradient(135deg, #7c6df2, #5a49d7)',
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: '0.86rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.45rem',
                  boxShadow: '0 2px 12px rgba(124, 109, 242, 0.35)',
                  whiteSpace: 'nowrap',
                  width: isMobile ? '100%' : 'auto',
                  minHeight: '40px',
                }}
                title="Mở bảng nhập điểm và sử dụng AI Hút điểm"
              >
                <span>📥</span>
                <span>Hút Điểm Thông Minh / Nhập Điểm</span>
              </button>
            </div>
          </div>

          {/* Notice Banner */}
          {importNotice && (
            <div
              style={{
                padding: '0.75rem 1.25rem',
                borderRadius: '10px',
                fontSize: '0.88rem',
                background:
                  importNotice.type === 'success'
                    ? 'rgba(32, 191, 169, 0.15)'
                    : importNotice.type === 'error'
                    ? 'rgba(239, 68, 68, 0.15)'
                    : 'rgba(59, 130, 246, 0.15)',
                color:
                  importNotice.type === 'success'
                    ? '#20bfa9'
                    : importNotice.type === 'error'
                    ? '#ef4444'
                    : '#60a5fa',
                border: `1px solid ${
                  importNotice.type === 'success'
                    ? 'rgba(32, 191, 169, 0.4)'
                    : importNotice.type === 'error'
                    ? 'rgba(239, 68, 68, 0.4)'
                    : 'rgba(59, 130, 246, 0.4)'
                }`,
              }}
            >
              {importNotice.message}
            </div>
          )}

          {/* THE GRADEBOOK / GRADER REPORT TABLE (READ-ONLY DISPLAY) */}
          <div
            style={{
              background: '#171526',
              borderRadius: '14px',
              border: '1px solid #26233a',
              overflow: 'hidden',
              boxShadow: '0 4px 20px rgba(0, 0, 0, 0.25)',
            }}
          >
            {/* Filter Bar (Search users + View Mode Toggle) */}
            <div
              style={{
                padding: '0.75rem 1.25rem',
                borderBottom: '1px solid #26233a',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '0.65rem',
                background: 'rgba(20, 18, 34, 0.7)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flex: '1 1 200px' }}>
                <input
                  type="text"
                  placeholder="🔍 Tìm kiếm sinh viên theo tên hoặc mã SV..."
                  value={gradebookSearch}
                  onChange={e => setGradebookSearch(e.target.value)}
                  style={{
                    padding: '0.45rem 0.85rem',
                    borderRadius: '8px',
                    background: '#141220',
                    color: '#f3f2f8',
                    border: '1px solid #26233a',
                    fontSize: '0.85rem',
                    width: '100%',
                    maxWidth: '360px',
                  }}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', flexWrap: 'wrap' }}>
                <div style={{ fontSize: '0.8rem', color: '#9894ad', whiteSpace: 'nowrap' }}>
                  Sĩ số: <strong style={{ color: '#f3f2f8' }}>{activeStudents.length} SV</strong>
                </div>

                {/* Quick Sort Dropdown */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  <label style={{ fontSize: '0.78rem', color: '#9894ad', whiteSpace: 'nowrap' }}>Sắp xếp:</label>
                  <select
                    value={sortBy}
                    onChange={e => setSortBy(e.target.value as 'default' | 'name-asc' | 'name-desc' | 'grade-desc' | 'grade-asc')}
                    style={{
                      padding: '0.35rem 0.65rem',
                      borderRadius: '8px',
                      background: '#141220',
                      color: '#f3f2f8',
                      border: '1px solid rgba(124, 109, 242, 0.4)',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      outline: 'none',
                      cursor: 'pointer',
                    }}
                  >
                    <option value="name-asc">🔤 Tên: A → Z</option>
                    <option value="name-desc">🔤 Tên: Z → A</option>
                    <option value="grade-desc">📈 Điểm: Cao nhất</option>
                    <option value="grade-asc">📉 Điểm: Thấp nhất</option>
                    <option value="default">📋 Thứ tự gốc (Mặc định)</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Mobile Cards View (Mobile only), Desktop Table View (Desktop only) */}
            {isMobile ? (
              <div className="teacher-mobile-cards">
                {processedStudents.map((student, idx) => {
                    return (
                      <div key={student.id} className="teacher-student-card">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                            <div
                              style={{
                                width: '32px',
                                height: '32px',
                                borderRadius: '50%',
                                background: 'linear-gradient(135deg, #7c6df2, #5a49d7)',
                                color: '#fff',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontWeight: 700,
                                fontSize: '0.8rem',
                                flexShrink: 0,
                              }}
                            >
                              {student.fullname
                                .split(' ')
                                .slice(-2)
                                .map(w => w[0])
                                .join('')
                                .toUpperCase()}
                            </div>
                            <div>
                              <div style={{ fontWeight: 600, color: '#f3f2f8', fontSize: '0.92rem' }}>
                                {student.fullname}
                              </div>
                              <div style={{ fontSize: '0.74rem', color: '#9894ad' }}>
                                Mã SV: {student.username}
                              </div>
                            </div>
                          </div>
                          <span style={{ fontSize: '0.72rem', color: '#7c6df2', background: 'rgba(124, 109, 242, 0.15)', padding: '2px 7px', borderRadius: '10px', fontWeight: 600 }}>
                            #{idx + 1}
                          </span>
                        </div>

                        {/* Scores for this student */}
                        {displayedGradeColumns.length === 0 ? (
                          <div style={{ fontSize: '0.78rem', color: '#64748b', fontStyle: 'italic', padding: '0.35rem 0.65rem', background: 'rgba(255, 255, 255, 0.02)', borderRadius: '8px' }}>
                            Chưa có bài kiểm tra nào
                          </div>
                        ) : (
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.5rem', background: 'rgba(255, 255, 255, 0.02)', padding: '0.5rem 0.65rem', borderRadius: '8px' }}>
                            {displayedGradeColumns.map(col => {
                              const val = gradebookScores[student.id]?.[col.id] ?? '';
                              const hasVal = val !== undefined && val !== '' && !isNaN(Number(val));
                              return (
                                <div key={col.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.4rem' }}>
                                  <div style={{ fontSize: '0.75rem', color: '#c4c1d6', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    📝 {col.name}
                                  </div>
                                  <div
                                    style={{
                                      padding: '2px 8px',
                                      borderRadius: '6px',
                                      background: hasVal ? 'rgba(124, 109, 242, 0.2)' : 'rgba(255, 255, 255, 0.04)',
                                      border: hasVal ? '1px solid rgba(124, 109, 242, 0.4)' : '1px solid #26233a',
                                      fontWeight: 700,
                                      fontSize: '0.88rem',
                                      color: hasVal ? '#a594fd' : '#9894ad',
                                      whiteSpace: 'nowrap',
                                    }}
                                  >
                                    {hasVal ? `${Number(val).toFixed(1)}đ` : '-'}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {/* Feedback if any */}
                        {displayedGradeColumns.map(col => {
                          const fb = getStudentColFeedback(student.id, col.id);
                          if (!fb.trim()) return null;
                          return (
                            <div
                              key={`fb-${col.id}`}
                              style={{
                                fontSize: '0.78rem',
                                color: '#cfc8ff',
                                background: 'rgba(124, 109, 242, 0.08)',
                                padding: '0.4rem 0.6rem',
                                borderRadius: '6px',
                                borderLeft: '3px solid #7c6df2',
                              }}
                            >
                              💬 {displayedGradeColumns.length > 1 ? `${col.name}: ` : ''}{fb}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
              </div>
            ) : (
              /* Read-Only Table with sticky columns */
              <div className="teacher-table-scroll">
                <table className="teacher-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                  <thead>
                    <tr style={{ background: '#141220', color: '#9894ad', textAlign: 'left', borderBottom: '1px solid #26233a' }}>
                      <th className="sticky-col" style={{ padding: '0.85rem 1rem', width: '40px' }}>STT</th>
                      <th
                        className="sticky-col"
                        onClick={() => setSortBy(prev => (prev === 'name-asc' ? 'name-desc' : 'name-asc'))}
                        style={{
                          padding: '0.85rem 1rem',
                          minWidth: '170px',
                          left: '40px',
                          cursor: 'pointer',
                          userSelect: 'none',
                        }}
                        title="Bấm để sắp xếp Tên (A-Z hoặc Z-A)"
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                          <span>First name / Last name</span>
                          <span
                            style={{
                              fontSize: '0.72rem',
                              padding: '2px 6px',
                              borderRadius: '4px',
                              background: sortBy.startsWith('name') ? 'rgba(124, 109, 242, 0.25)' : 'rgba(255, 255, 255, 0.05)',
                              color: sortBy.startsWith('name') ? '#a594fd' : '#64748b',
                              fontWeight: 700,
                            }}
                          >
                            {sortBy === 'name-asc' ? '↑ A-Z' : sortBy === 'name-desc' ? '↓ Z-A' : '↕'}
                          </span>
                        </div>
                      </th>
                      {displayedGradeColumns.map(col => (
                        <th
                          key={col.id}
                          onClick={() => setSortBy(prev => (prev === 'grade-desc' ? 'grade-asc' : 'grade-desc'))}
                          style={{
                            padding: '0.85rem 1rem',
                            minWidth: '150px',
                            color: '#cfc8ff',
                            cursor: 'pointer',
                            userSelect: 'none',
                          }}
                          title="Bấm để sắp xếp theo Điểm (Cao nhất hoặc Thấp nhất)"
                        >
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '4px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <span>📝</span>
                              <span style={{ fontWeight: 600 }}>{col.name}</span>
                            </div>
                            <span
                              style={{
                                fontSize: '0.7rem',
                                padding: '2px 5px',
                                borderRadius: '4px',
                                background: sortBy.startsWith('grade') ? 'rgba(32, 191, 169, 0.25)' : 'rgba(255, 255, 255, 0.05)',
                                color: sortBy.startsWith('grade') ? '#20bfa9' : '#64748b',
                                fontWeight: 700,
                              }}
                            >
                              {sortBy === 'grade-desc' ? '↓ Cao' : sortBy === 'grade-asc' ? '↑ Thấp' : '↕'}
                            </span>
                          </div>
                          <div style={{ fontSize: '0.75rem', color: '#9894ad' }}>Tối đa: {col.grademax}đ</div>
                        </th>
                      ))}
                      {displayedGradeColumns.length === 0 && (
                        <th style={{ padding: '0.85rem 1rem', color: '#64748b', fontWeight: 400, fontStyle: 'italic', minWidth: '180px' }}>
                          (Chưa có bài kiểm tra)
                        </th>
                      )}
                      {showFeedbackColumn && (
                        <th style={{ padding: '0.85rem 1rem', minWidth: '220px', color: '#cfc8ff' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span>💬</span>
                            <span style={{ fontWeight: 600 }}>Nhận xét (str_feedback)</span>
                          </div>
                          <div style={{ fontSize: '0.75rem', color: '#9894ad' }}>Đẩy Moodle &amp; hiển thị sinh viên</div>
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {processedStudents.map((student, idx) => {
                        return (
                          <tr
                            key={student.id}
                            style={{
                              borderBottom: '1px solid #26233a',
                              background: idx % 2 === 0 ? 'transparent' : 'rgba(255, 255, 255, 0.01)',
                              transition: 'background 0.2s',
                            }}
                          >
                            <td className="sticky-col" style={{ padding: '0.85rem 1rem', color: '#9894ad' }}>{idx + 1}</td>
                            <td className="sticky-col" style={{ padding: '0.85rem 1rem', left: '40px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                                <div
                                  style={{
                                    width: '32px',
                                    height: '32px',
                                    borderRadius: '50%',
                                    background: 'linear-gradient(135deg, #7c6df2, #5a49d7)',
                                    color: '#fff',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontWeight: 700,
                                    fontSize: '0.8rem',
                                    flexShrink: 0,
                                  }}
                                >
                                  {student.fullname
                                    .split(' ')
                                    .slice(-2)
                                    .map(w => w[0])
                                    .join('')
                                    .toUpperCase()}
                                </div>
                                <div>
                                  <div style={{ fontWeight: 600, color: '#f3f2f8' }}>{student.fullname}</div>
                                  <div style={{ fontSize: '0.75rem', color: '#9894ad' }}>
                                    Mã SV: {student.username}
                                  </div>
                                </div>
                              </div>
                            </td>
                            {displayedGradeColumns.map(col => {
                              const val = gradebookScores[student.id]?.[col.id] ?? '';
                              const hasVal = val !== undefined && val !== '' && !isNaN(Number(val));

                              return (
                                <td key={col.id} style={{ padding: '0.85rem 1rem' }}>
                                  <div
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      justifyContent: 'center',
                                      padding: '0.45rem 0.85rem',
                                      borderRadius: '8px',
                                      background: hasVal ? 'rgba(124, 109, 242, 0.12)' : 'rgba(255, 255, 255, 0.04)',
                                      border: hasVal ? '1px solid rgba(124, 109, 242, 0.35)' : '1px solid #26233a',
                                      fontWeight: 700,
                                      color: hasVal ? '#f3f2f8' : '#9894ad',
                                      minWidth: '60px',
                                      fontSize: '0.95rem',
                                      userSelect: 'text',
                                    }}
                                    title={`Điểm số môn học: ${hasVal ? val : 'Chưa có điểm'}`}
                                  >
                                    {hasVal ? `${Number(val).toFixed(1)}đ` : '-'}
                                  </div>
                                </td>
                              );
                            })}
                            {displayedGradeColumns.length === 0 && (
                              <td style={{ padding: '0.85rem 1rem', color: '#64748b' }}>-</td>
                            )}
                            {showFeedbackColumn && (
                              <td style={{ padding: '0.85rem 1rem' }}>
                                {(() => {
                                  const targetColId = displayedGradeColumns[0]?.id;
                                  const fb = getStudentColFeedback(student.id, targetColId);
                                  return (
                                    <span style={{ color: fb ? '#f3f2f8' : '#64748b', fontSize: '0.88rem' }}>
                                      {fb || '-'}
                                    </span>
                                  );
                                })()}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: '#141220', borderTop: '1px solid #26233a', fontWeight: 600 }}>
                      <td colSpan={2} className="sticky-col" style={{ padding: '0.85rem 1rem', color: '#c4c1d6' }}>
                        Overall average (Điểm trung bình cả lớp)
                      </td>
                      {displayedGradeColumns.map(col => {
                        const scores = activeStudents
                          .map(s => Number(gradebookScores[s.id]?.[col.id]))
                          .filter(n => !isNaN(n) && n > 0);
                        const avg = scores.length > 0 ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : '-';
                        return (
                          <td key={col.id} style={{ padding: '0.85rem 1rem', color: '#a594fd' }}>
                            {avg !== '-' ? `${avg}đ` : '-'}
                          </td>
                        );
                      })}
                      {displayedGradeColumns.length === 0 && (
                        <td style={{ padding: '0.85rem 1rem', color: '#64748b' }}>-</td>
                      )}
                      {showFeedbackColumn && (
                        <td style={{ padding: '0.85rem 1rem', color: '#9894ad' }}>-</td>
                      )}
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}

            {/* Bottom Bar: Action Button to Open Smart Import Modal */}
            <div
              style={{
                padding: '0.85rem 1.25rem',
                borderTop: '1px solid #26233a',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: '0.75rem',
                background: 'rgba(20, 18, 34, 0.85)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#9894ad', fontSize: '0.82rem' }}>
                <span>Hiển thị tất cả {activeStudents.length} sinh viên</span>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', width: isMobile ? '100%' : 'auto' }}>
                <button
                  type="button"
                  onClick={() => setShowImportModal(true)}
                  style={{
                    padding: '0.65rem 1.4rem',
                    borderRadius: '8px',
                    border: 'none',
                    background: 'linear-gradient(135deg, #7c6df2, #5a49d7)',
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: '0.9rem',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                    boxShadow: '0 4px 14px rgba(124, 109, 242, 0.4)',
                    transition: 'all 0.2s ease',
                    width: isMobile ? '100%' : 'auto',
                    minHeight: '44px',
                  }}
                  title="Mở bảng nhập điểm và sử dụng AI Hút điểm đa định dạng"
                >
                  <span>📥</span>
                  <span>Hút Điểm Thông Minh (File/Ảnh/Dán) &amp; Nhập Điểm</span>
                </button>
              </div>
            </div>
          </div>
          {/* ================================================================ */}
          {/* SMART GRADE IMPORT & EDIT POP-UP MODAL                          */}
          {/* ================================================================ */}
          {showImportModal && (
            <div
              className="teacher-modal-backdrop"
              onClick={() => setShowImportModal(false)}
            >
              <div
                className="teacher-modal-panel"
                onClick={e => e.stopPropagation()}
              >
                {/* Modal Header */}
                <div
                  style={{
                    padding: '1rem 1.25rem',
                    borderBottom: '1px solid #26233a',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: 'rgba(20, 18, 34, 0.95)',
                  }}
                >
                  <div>
                    <h3 style={{ margin: 0, color: '#f3f2f8', fontSize: '1.05rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span>📥</span>
                      <span>Hút &amp; Nhập Điểm Sổ Điểm Moodle</span>
                    </h3>
                    <p style={{ margin: '0.2rem 0 0', color: '#9894ad', fontSize: '0.8rem' }}>
                      Tự động trích xuất điểm từ file/ảnh hoặc nhập trực tiếp cho sinh viên.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowImportModal(false)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#9894ad',
                      fontSize: '1.4rem',
                      cursor: 'pointer',
                      padding: '0.4rem 0.6rem',
                      minWidth: '40px',
                      minHeight: '40px',
                      display: 'grid',
                      placeItems: 'center',
                    }}
                    aria-label="Đóng"
                  >
                    ✕
                  </button>
                </div>

                {/* Modal Body (Scrollable) */}
                <div style={{ padding: '1rem 1.25rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '1rem', flex: 1 }}>
                  {/* Step 1: Target Gradebook Column Selector */}
                  <div
                    style={{
                      padding: '0.85rem 1rem',
                      background: 'rgba(20, 18, 34, 0.6)',
                      borderRadius: '12px',
                      border: '1px solid #26233a',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flexWrap: 'wrap',
                      gap: '0.65rem',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: isMobile ? '1 1 100%' : 'initial' }}>
                      <span style={{ fontSize: '0.85rem', color: '#c4c1d6', fontWeight: 600 }}>1. Cột điểm:</span>
                      <select
                        value={selectedGradeColumnId || activeGradeColumns[0]?.id}
                        onChange={e => setSelectedGradeColumnId(Number(e.target.value))}
                        style={{
                          padding: '0.45rem 0.85rem',
                          borderRadius: '8px',
                          background: '#141220',
                          color: '#f3f2f8',
                          border: '1px solid rgba(124, 109, 242, 0.4)',
                          fontWeight: 600,
                          outline: 'none',
                          flex: isMobile ? 1 : 'initial',
                        }}
                      >
                        {activeGradeColumns.map(col => (
                          <option key={col.id} value={col.id}>
                            📝 {col.name} (Tối đa: {col.grademax}đ)
                          </option>
                        ))}
                      </select>
                    </div>

                    <div style={{ display: 'flex', gap: '0.5rem', width: isMobile ? '100%' : 'auto' }}>
                      <button
                        type="button"
                        onClick={() => setShowPasteModal(true)}
                        style={{
                          padding: '0.45rem 0.85rem',
                          borderRadius: '6px',
                          background: 'rgba(255, 255, 255, 0.08)',
                          border: '1px solid #26233a',
                          color: '#f3f2f8',
                          fontSize: '0.8rem',
                          cursor: 'pointer',
                          width: isMobile ? '100%' : 'auto',
                          textAlign: 'center',
                        }}
                      >
                        📝 Dán văn bản thô
                      </button>
                    </div>
                  </div>

                  {/* Step 2: AI Upload Dropzone */}
                  <div
                    onDragOver={e => {
                      e.preventDefault();
                      setDragActive(true);
                    }}
                    onDragLeave={() => setDragActive(false)}
                    onDrop={e => {
                      e.preventDefault();
                      setDragActive(false);
                      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                        handleFileUpload(e.dataTransfer.files[0]);
                      }
                    }}
                    onClick={() => fileInputRef.current?.click()}
                    style={{
                      padding: isMobile ? '1rem' : '1.35rem',
                      border: dragActive ? '2px dashed #7c6df2' : '2px dashed rgba(124, 109, 242, 0.35)',
                      borderRadius: '12px',
                      background: dragActive ? 'rgba(124, 109, 242, 0.12)' : 'rgba(20, 18, 34, 0.6)',
                      textAlign: 'center',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".xlsx,.xls,.csv,.png,.jpg,.jpeg,.webp,.pdf"
                      style={{ display: 'none' }}
                      onChange={e => {
                        if (e.target.files && e.target.files[0]) {
                          handleFileUpload(e.target.files[0]);
                        }
                      }}
                    />
                    <div style={{ fontSize: '24px', marginBottom: '0.25rem' }}>{isExtracting ? '⏳' : '📥'}</div>
                    <h4 style={{ margin: '0 0 0.2rem', fontSize: '0.9rem', color: '#f3f2f8' }}>
                      {isExtracting ? 'Biệt đội AI đang "hút" điểm...' : 'Nhấn hoặc kéo thả Bảng Điểm (Excel, Ảnh, PDF)'}
                    </h4>
                    <p style={{ margin: 0, fontSize: '0.75rem', color: '#9894ad' }}>
                      Tự động dò khớp tên sinh viên và điền điểm số
                    </p>
                  </div>

                  {/* Notice Banner */}
                  {importNotice && (
                    <div
                      style={{
                        padding: '0.65rem 1rem',
                        borderRadius: '8px',
                        fontSize: '0.85rem',
                        background:
                          importNotice.type === 'success'
                            ? 'rgba(32, 191, 169, 0.15)'
                            : importNotice.type === 'error'
                            ? 'rgba(239, 68, 68, 0.15)'
                            : 'rgba(59, 130, 246, 0.15)',
                        color:
                          importNotice.type === 'success'
                            ? '#20bfa9'
                            : importNotice.type === 'error'
                            ? '#ef4444'
                            : '#60a5fa',
                        border: `1px solid ${
                          importNotice.type === 'success'
                            ? 'rgba(32, 191, 169, 0.4)'
                            : importNotice.type === 'error'
                            ? 'rgba(239, 68, 68, 0.4)'
                            : 'rgba(59, 130, 246, 0.4)'
                        }`,
                      }}
                    >
                      {importNotice.message}
                    </div>
                  )}

                  {/* Step 3: THE TRUE EDITABLE TABLE / MOBILE LIST */}
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <span style={{ fontSize: '0.88rem', color: '#c4c1d6', fontWeight: 600 }}>
                        2. Nhập &amp; chỉnh sửa điểm:
                      </span>
                      <span style={{ fontSize: '0.78rem', color: '#9894ad' }}>
                        {activeStudents.length} sinh viên
                      </span>
                    </div>

                    {isMobile ? (
                      /* Mobile Editable Cards */
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
                        {activeStudents.map((student, idx) => {
                          const targetColId: number = (selectedGradeColumnId !== 'all' ? selectedGradeColumnId : activeGradeColumns[0]?.id) || 1;
                          const currentScore = gradebookScores[student.id]?.[targetColId] ?? '';
                          const targetCol = activeGradeColumns.find(c => c.id === targetColId) || activeGradeColumns[0];
                          const isMod = modifiedCells.has(`${student.id}-${targetColId}`);
                          const isFbMod = modifiedCells.has(`${student.id}-fb`);

                          return (
                            <div
                              key={student.id}
                              style={{
                                background: '#141220',
                                border: isMod || isFbMod ? '1px solid rgba(32, 191, 169, 0.4)' : '1px solid #26233a',
                                borderRadius: '10px',
                                padding: '0.75rem',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '0.5rem',
                              }}
                            >
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                  <span style={{ fontSize: '0.75rem', color: '#7c6df2', fontWeight: 700 }}>#{idx + 1}</span>
                                  <strong style={{ fontSize: '0.9rem', color: '#f3f2f8' }}>{student.fullname}</strong>
                                </div>
                                <span style={{ fontSize: '0.72rem', color: '#9894ad' }}>{student.username}</span>
                              </div>

                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flex: '0 0 auto' }}>
                                  <label style={{ fontSize: '0.8rem', color: '#cfc8ff', fontWeight: 600 }}>Điểm:</label>
                                  <input
                                    type="number"
                                    min="0"
                                    max={targetCol?.grademax ?? 10}
                                    step="0.1"
                                    value={currentScore}
                                    placeholder="-"
                                    onChange={e => handleGradeCellChange(student.id, targetColId, e.target.value)}
                                    style={{
                                      width: '75px',
                                      padding: '0.4rem 0.5rem',
                                      borderRadius: '6px',
                                      background: isMod ? 'rgba(32, 191, 169, 0.15)' : '#171526',
                                      color: isMod ? '#20bfa9' : '#f3f2f8',
                                      fontWeight: 700,
                                      fontSize: '16px',
                                      border: isMod ? '1px solid #20bfa9' : '1px solid rgba(124, 109, 242, 0.35)',
                                      textAlign: 'center',
                                      outline: 'none',
                                    }}
                                  />
                                </div>
                                <div style={{ flex: 1 }}>
                                  <input
                                    type="text"
                                    value={getStudentColFeedback(student.id, targetColId)}
                                    placeholder="Nhận xét gửi sinh viên..."
                                    onChange={e => handleFeedbackChange(student.id, e.target.value, targetColId)}
                                    style={{
                                      width: '100%',
                                      padding: '0.4rem 0.6rem',
                                      borderRadius: '6px',
                                      background: isFbMod ? 'rgba(124, 109, 242, 0.15)' : '#171526',
                                      color: '#f3f2f8',
                                      border: isFbMod ? '1px solid #7c6df2' : '1px solid #26233a',
                                      fontSize: '16px',
                                      outline: 'none',
                                    }}
                                  />
                                </div>
                                {isMod && (
                                  <span style={{ fontSize: '10px', color: '#20bfa9', fontWeight: 700, whiteSpace: 'nowrap' }}>
                                    ✓ Mới
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      /* Desktop Spreadsheet Table */
                      <div
                        style={{
                          border: '1px solid #26233a',
                          borderRadius: '10px',
                          overflow: 'hidden',
                          background: '#141220',
                        }}
                      >
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                          <thead>
                            <tr style={{ background: 'rgba(20, 18, 34, 0.9)', color: '#9894ad', textAlign: 'left', borderBottom: '1px solid #26233a' }}>
                              <th style={{ padding: '0.75rem 1rem', width: '40px' }}>STT</th>
                              <th style={{ padding: '0.75rem 1rem' }}>Sinh viên</th>
                              <th style={{ padding: '0.75rem 1rem', width: '160px', color: '#cfc8ff' }}>
                                📝 {activeGradeColumns.find(c => c.id === (selectedGradeColumnId !== 'all' ? selectedGradeColumnId : activeGradeColumns[0]?.id))?.name || 'Điểm'}
                              </th>
                              <th style={{ padding: '0.75rem 1rem', color: '#cfc8ff' }}>
                                💬 Nhận xét (str_feedback)
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {activeStudents.map((student, idx) => {
                              const targetColId: number = (selectedGradeColumnId !== 'all' ? selectedGradeColumnId : activeGradeColumns[0]?.id) || 1;
                              const currentScore = gradebookScores[student.id]?.[targetColId] ?? '';
                              const targetCol = activeGradeColumns.find(c => c.id === targetColId) || activeGradeColumns[0];
                              const isMod = modifiedCells.has(`${student.id}-${targetColId}`);
                              const isFbMod = modifiedCells.has(`${student.id}-fb-${targetColId}`);

                              return (
                                <tr
                                  key={student.id}
                                  style={{
                                    borderBottom: '1px solid #26233a',
                                    background: isMod || isFbMod ? 'rgba(32, 191, 169, 0.05)' : 'transparent',
                                  }}
                                >
                                  <td style={{ padding: '0.75rem 1rem', color: '#9894ad' }}>{idx + 1}</td>
                                  <td style={{ padding: '0.75rem 1rem' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                                      <div
                                        style={{
                                          width: '28px',
                                          height: '28px',
                                          borderRadius: '50%',
                                          background: 'linear-gradient(135deg, #7c6df2, #5a49d7)',
                                          color: '#fff',
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'center',
                                          fontWeight: 700,
                                          fontSize: '0.75rem',
                                        }}
                                      >
                                        {student.fullname.split(' ').slice(-2).map(w => w[0]).join('').toUpperCase()}
                                      </div>
                                      <div>
                                        <div style={{ fontWeight: 600, color: '#f3f2f8' }}>{student.fullname}</div>
                                        <div style={{ fontSize: '0.72rem', color: '#9894ad' }}>Mã SV: {student.username}</div>
                                      </div>
                                    </div>
                                  </td>
                                  <td style={{ padding: '0.75rem 1rem' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                      <input
                                        type="number"
                                        min="0"
                                        max={targetCol?.grademax ?? 10}
                                        step="0.1"
                                        value={currentScore}
                                        placeholder="-"
                                        onChange={e => handleGradeCellChange(student.id, targetColId, e.target.value)}
                                        style={{
                                          width: '75px',
                                          padding: '0.4rem 0.5rem',
                                          borderRadius: '6px',
                                          background: isMod ? 'rgba(32, 191, 169, 0.12)' : '#171526',
                                          color: isMod ? '#20bfa9' : '#f3f2f8',
                                          fontWeight: 700,
                                          fontSize: '0.9rem',
                                          border: isMod ? '1px solid #20bfa9' : '1px solid rgba(124, 109, 242, 0.35)',
                                          textAlign: 'center',
                                          outline: 'none',
                                        }}
                                      />
                                      {isMod && (
                                        <span style={{ fontSize: '10px', color: '#20bfa9', fontWeight: 600, whiteSpace: 'nowrap' }}>
                                          ✓ Mới nạp
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td style={{ padding: '0.75rem 1rem' }}>
                                    <input
                                      type="text"
                                      value={getStudentColFeedback(student.id, targetColId)}
                                      placeholder="Nhập nhận xét gửi sinh viên..."
                                      onChange={e => handleFeedbackChange(student.id, e.target.value, targetColId)}
                                      style={{
                                        width: '100%',
                                        padding: '0.4rem 0.65rem',
                                        borderRadius: '6px',
                                        background: isFbMod ? 'rgba(124, 109, 242, 0.15)' : '#171526',
                                        color: '#f3f2f8',
                                        border: isFbMod ? '1px solid #7c6df2' : '1px solid #26233a',
                                        fontSize: '0.82rem',
                                        outline: 'none',
                                      }}
                                    />
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                </div>

                {/* Modal Footer */}
                <div
                  style={{
                    padding: '0.85rem 1.25rem',
                    borderTop: '1px solid #26233a',
                    display: 'flex',
                    justifyContent: 'flex-end',
                    alignItems: 'center',
                    gap: '0.65rem',
                    background: 'rgba(20, 18, 34, 0.95)',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setShowImportModal(false)}
                    style={{
                      padding: '0 1.25rem',
                      height: '42px',
                      borderRadius: '8px',
                      border: '1px solid #363252',
                      background: 'rgba(255, 255, 255, 0.05)',
                      color: '#c4c1d6',
                      fontSize: '0.88rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.45rem',
                      whiteSpace: 'nowrap',
                      flex: isMobile ? 1 : 'initial',
                      boxSizing: 'border-box',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <span>✕</span>
                    <span>Đóng</span>
                  </button>
                  <button
                    type="button"
                    disabled={isSavingGradebook}
                    onClick={handleSaveGradebook}
                    style={{
                      padding: '0 1.35rem',
                      height: '42px',
                      borderRadius: '8px',
                      border: 'none',
                      background: 'linear-gradient(135deg, #7c6df2, #5a49d7)',
                      color: '#fff',
                      fontWeight: 600,
                      fontSize: '0.88rem',
                      cursor: isSavingGradebook ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.45rem',
                      boxShadow: '0 4px 14px rgba(124, 109, 242, 0.35)',
                      whiteSpace: 'nowrap',
                      flex: isMobile ? 1 : 'initial',
                      boxSizing: 'border-box',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {isSavingGradebook ? (
                      <>
                        <span>⏳</span>
                        <span>Đang lưu...</span>
                      </>
                    ) : (
                      <>
                        <span>💾</span>
                        <span>Lưu vào Moodle</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ==================================================================== */}
      {/* TAB 3: AI QUIZ GENERATOR & MOODLE XML                                 */}
      {/* ==================================================================== */}
      {activeTab === 'quiz' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', minHeight: 'calc(100vh - 280px)' }}>
          {/* Top Generator Studio Form */}
          <div
            style={{
              padding: isMobile ? '1rem' : '1.5rem',
              background: '#171526',
              borderRadius: '16px',
              border: '1px solid #26233a',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.35)',
              display: 'flex',
              flexDirection: 'column',
              gap: isMobile ? '1.1rem' : '1.35rem',
            }}
          >
            {/* Header */}
            <div>
              <h2 style={{ margin: '0 0 0.25rem', fontSize: '1.15rem', color: '#f3f2f8', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>⚡</span>
                <span>Lò Ấp Ngân Hàng Câu Hỏi Moodle XML</span>
              </h2>
              <p style={{ margin: 0, fontSize: '0.82rem', color: '#9894ad' }}>
                Biên soạn bộ câu hỏi đa định dạng chuẩn xác 100% từ tài liệu bài giảng, sẵn sàng nạp thẳng vào Ngân hàng câu hỏi Moodle.
              </p>
            </div>

            {/* 1. Question Format (Full Line) */}
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#cfc8ff', marginBottom: '0.5rem' }}>
                1. ĐỊNH DẠNG CÂU HỎI (QUESTION FORMAT):
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(auto-fit, minmax(140px, 1fr))' : 'repeat(auto-fit, minmax(210px, 1fr))', gap: '0.65rem' }}>
                {[
                  { id: 'mixed', label: '🔀 Kết hợp (Mixed)', desc: 'Xen kẽ cả 1 lựa chọn, Đúng/Sai & Nhiều đáp án' },
                  { id: 'multiple_choice', label: '🔤 1 Lựa chọn (A/B/C/D)', desc: 'Chuẩn 4 phương án, 1 đáp án đúng' },
                  { id: 'true_false', label: '⚖️ Đúng / Sai (True/False)', desc: 'Phán đoán tính đúng/sai của nhận định' },
                  { id: 'multiple_select', label: '☑️ Chọn nhiều đáp án', desc: 'Có từ 2 đến 3 đáp án đúng (Multi-answer)' },
                ].map(item => {
                  const isSelected = quizQuestionType === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setQuizQuestionType(item.id as 'multiple_choice' | 'true_false' | 'multiple_select' | 'mixed')}
                      style={{
                        padding: isMobile ? '0.65rem 0.75rem' : '0.85rem 1rem',
                        borderRadius: '12px',
                        border: isSelected ? '1.5px solid #7c6df2' : '1px solid #26233a',
                        background: isSelected ? 'rgba(124, 109, 242, 0.2)' : '#141220',
                        color: isSelected ? '#f3f2f8' : '#9894ad',
                        textAlign: 'left',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        boxShadow: isSelected ? '0 0 18px rgba(124, 109, 242, 0.3)' : 'none',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '0.25rem',
                      }}
                    >
                      <strong style={{ fontSize: isMobile ? '0.88rem' : '0.94rem', color: isSelected ? '#fff' : '#c4c1d6' }}>
                        {item.label}
                      </strong>
                      <small style={{ fontSize: isMobile ? '0.72rem' : '0.76rem', color: isSelected ? '#a594fd' : '#6b6684', lineHeight: 1.3 }}>
                        {item.desc}
                      </small>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 2. Số Lượng Câu Hỏi (Own Full Line) */}
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#cfc8ff', marginBottom: '0.45rem' }}>
                2. SỐ LƯỢNG CÂU HỎI:
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={quizCount || ''}
                    onChange={e => {
                      const val = parseInt(e.target.value, 10);
                      if (!isNaN(val)) {
                        setQuizCount(Math.min(100, Math.max(1, val)));
                      } else {
                        setQuizCount(0);
                      }
                    }}
                    onBlur={() => {
                      if (!quizCount || quizCount < 1) setQuizCount(5);
                      else if (quizCount > 100) setQuizCount(100);
                    }}
                    style={{
                      width: '65px',
                      padding: '0.45rem 0.5rem',
                      borderRadius: '8px',
                      background: '#141220',
                      color: '#20bfa9',
                      border: '1.5px solid #20bfa9',
                      fontWeight: 700,
                      fontSize: '16px',
                      textAlign: 'center',
                      outline: 'none',
                      boxShadow: '0 0 12px rgba(32, 191, 169, 0.25)',
                    }}
                  />
                  <span style={{ fontSize: '0.85rem', color: '#cbd5e1', fontWeight: 600 }}>câu</span>
                </div>

                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                  {[5, 10, 15, 20, 30, 50].map(cnt => {
                    const isSelected = quizCount === cnt;
                    return (
                      <button
                        key={cnt}
                        type="button"
                        onClick={() => setQuizCount(cnt)}
                        style={{
                          padding: isMobile ? '0.45rem 0.75rem' : '0.55rem 1rem',
                          borderRadius: '8px',
                          border: isSelected ? '1.5px solid #20bfa9' : '1px solid #26233a',
                          background: isSelected ? 'rgba(32, 191, 169, 0.22)' : '#141220',
                          color: isSelected ? '#20bfa9' : '#9894ad',
                          fontWeight: 700,
                          fontSize: '0.84rem',
                          cursor: 'pointer',
                          transition: 'all 0.15s ease',
                          boxShadow: isSelected ? '0 0 12px rgba(32, 191, 169, 0.25)' : 'none',
                        }}
                      >
                        {cnt} câu
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* 3. Độ Khó (Own Full Line) */}
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#cfc8ff', marginBottom: '0.45rem' }}>
                3. ĐỘ KHÓ (DIFFICULTY):
              </label>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {[
                  { id: 'easy', label: '🟢 Dễ (Nhận biết)' },
                  { id: 'normal', label: '🟡 Trung bình (Thông hiểu)' },
                  { id: 'hard', label: '🔴 Khó (Vận dụng cao)' },
                ].map(item => {
                  const isSelected = quizDifficulty === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setQuizDifficulty(item.id as 'easy' | 'normal' | 'hard')}
                      style={{
                        padding: isMobile ? '0.45rem 0.8rem' : '0.55rem 1rem',
                        borderRadius: '8px',
                        border: isSelected ? '1.5px solid #f59e0b' : '1px solid #26233a',
                        background: isSelected ? 'rgba(245, 158, 11, 0.22)' : '#141220',
                        color: isSelected ? '#fbbf24' : '#9894ad',
                        fontWeight: 700,
                        fontSize: '0.84rem',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                        boxShadow: isSelected ? '0 0 12px rgba(245, 158, 11, 0.25)' : 'none',
                      }}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 4. Mô Hình AI (Own Full Line) */}
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#cfc8ff', marginBottom: '0.45rem' }}>
                4. MÔ HÌNH AI (AI ENGINE):
              </label>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                {[
                  { id: 'gemini:gemini-2.5-flash', label: '⚡ Gemini 2.5 Flash' },
                  { id: 'gemini:gemini-2.5-pro', label: '🧠 Gemini 2.5 Pro' },
                  { id: 'anthropic:claude-3-5-sonnet-20241022', label: '✨ Claude 3.5 Sonnet' },
                  { id: 'openai:gpt-4o', label: '🌐 GPT-4o' },
                ].map(item => {
                  const isSelected = quizModel === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setQuizModel(item.id)}
                      style={{
                        padding: isMobile ? '0.45rem 0.8rem' : '0.55rem 1rem',
                        borderRadius: '8px',
                        border: isSelected ? '1.5px solid #a855f7' : '1px solid #26233a',
                        background: isSelected ? 'rgba(168, 85, 247, 0.22)' : '#141220',
                        color: isSelected ? '#d8b4fe' : '#9894ad',
                        fontWeight: 700,
                        fontSize: '0.84rem',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                        boxShadow: isSelected ? '0 0 12px rgba(168, 85, 247, 0.25)' : 'none',
                      }}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Document Text / Notes (Expanded Textarea) */}
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#cfc8ff', marginBottom: '0.45rem' }}>
                5. TÀI LIỆU NGUỒN / GHI CHÚ BÀI GIẢNG (TÙY CHỌN):
              </label>
              <textarea
                rows={4}
                value={quizDocumentText}
                onChange={e => setQuizDocumentText(e.target.value)}
                placeholder="Dán nội dung bài giảng, tóm tắt lý thuyết môn học hoặc để trống để AI tự trích xuất..."
                style={{
                  width: '100%',
                  padding: '0.75rem 0.85rem',
                  borderRadius: '10px',
                  background: '#141220',
                  color: '#f3f2f8',
                  border: '1px solid #26233a',
                  fontSize: '16px',
                  lineHeight: 1.5,
                  minHeight: '100px',
                  resize: 'vertical',
                  outline: 'none',
                }}
              />
            </div>

            {/* Footer with Big Vibrant Action Button */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.85rem', paddingTop: '0.5rem', borderTop: '1px solid #26233a' }}>
              <div style={{ fontSize: '0.8rem', color: '#9894ad', flex: '1 1 200px' }}>
                💡 File xuất ra đạt chuẩn <strong>Moodle XML</strong> có sẵn CDATA, feedback, penalty và fraction 100%.
              </div>

              <button
                type="button"
                disabled={isGeneratingQuiz}
                onClick={generateQuiz}
                style={{
                  padding: '0.75rem 1.6rem',
                  borderRadius: '10px',
                  border: 'none',
                  background: 'linear-gradient(135deg, #7c6df2, #5a49d7)',
                  color: '#fff',
                  fontWeight: 700,
                  fontSize: '0.94rem',
                  cursor: isGeneratingQuiz ? 'not-allowed' : 'pointer',
                  opacity: isGeneratingQuiz ? 0.7 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  boxShadow: '0 4px 18px rgba(124, 109, 242, 0.45)',
                  transition: 'all 0.2s ease',
                  width: isMobile ? '100%' : 'auto',
                  minHeight: '46px',
                }}
              >
                {isGeneratingQuiz ? (
                  <>
                    <span>⏳</span>
                    <span>Đang biên soạn câu hỏi...</span>
                  </>
                ) : (
                  <>
                    <span>⚡</span>
                    <span>Tạo Ngân Hàng Câu Hỏi Moodle XML ({quizCount} câu)</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Quiz Notice */}
          {quizNotice && (
            <div
              style={{
                padding: '0.8rem 1.15rem',
                borderRadius: '10px',
                fontSize: '0.88rem',
                background:
                  quizNotice.type === 'success'
                    ? 'rgba(32, 191, 169, 0.15)'
                    : 'rgba(239, 68, 68, 0.15)',
                color: quizNotice.type === 'success' ? '#20bfa9' : '#ef4444',
                border: `1px solid ${
                  quizNotice.type === 'success'
                    ? 'rgba(32, 191, 169, 0.4)'
                    : 'rgba(239, 68, 68, 0.4)'
                }`,
              }}
            >
              {quizNotice.message}
            </div>
          )}

          {/* Generated Questions List & Actions */}
          {generatedQuestions.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
              {/* Actions Header */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '0.75rem',
                  padding: '0.85rem 1.15rem',
                  background: '#171526',
                  borderRadius: '12px',
                  border: '1px solid #26233a',
                }}
              >
                <div>
                  <h3 style={{ margin: 0, fontSize: '0.98rem', color: '#f3f2f8' }}>
                    📝 Đã sẵn sàng {generatedQuestions.length} câu hỏi
                  </h3>
                  <p style={{ margin: '0.15rem 0 0', fontSize: '0.78rem', color: '#9894ad' }}>
                    Tải ngay file XML hoặc chỉnh sửa câu chữ bên dưới
                  </p>
                </div>

                <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', width: isMobile ? '100%' : 'auto' }}>
                  <button
                    type="button"
                    onClick={() => setShowGuideModal(true)}
                    style={{
                      padding: '0.5rem 0.8rem',
                      borderRadius: '8px',
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid #26233a',
                      color: '#f3f2f8',
                      fontSize: '0.82rem',
                      cursor: 'pointer',
                      flex: isMobile ? 1 : 'initial',
                      minHeight: '38px',
                    }}
                  >
                    📖 Hướng dẫn
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowXmlModal(true)}
                    style={{
                      padding: '0.5rem 0.8rem',
                      borderRadius: '8px',
                      background: 'rgba(124, 109, 242, 0.15)',
                      border: '1px solid rgba(124, 109, 242, 0.35)',
                      color: '#cfc8ff',
                      fontSize: '0.82rem',
                      cursor: 'pointer',
                      flex: isMobile ? 1 : 'initial',
                      minHeight: '38px',
                    }}
                  >
                    🔍 Xem XML
                  </button>

                  <button
                    type="button"
                    onClick={downloadMoodleXml}
                    style={{
                      padding: '0.5rem 1.15rem',
                      borderRadius: '8px',
                      border: 'none',
                      background: 'linear-gradient(135deg, #20bfa9, #179b89)',
                      color: '#fff',
                      fontWeight: 700,
                      fontSize: '0.86rem',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.4rem',
                      boxShadow: '0 4px 12px rgba(32, 191, 169, 0.3)',
                      width: isMobile ? '100%' : 'auto',
                      minHeight: '38px',
                    }}
                  >
                    <span>📥</span>
                    <span>Tải file quiz.xml</span>
                  </button>
                </div>
              </div>

              {/* Question Cards */}
              {generatedQuestions.map((q, idx) => {
                const isMulti = q.type === 'multiselect';
                const isTF = q.type === 'truefalse';

                return (
                  <div
                    key={q.id || idx}
                    style={{
                      padding: isMobile ? '0.85rem' : '1.25rem',
                      background: '#171526',
                      borderRadius: '12px',
                      border: '1px solid #26233a',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        marginBottom: '0.65rem',
                        gap: '0.5rem',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                        <span
                          style={{
                            background: '#7c6df2',
                            color: '#fff',
                            fontWeight: 700,
                            fontSize: '0.78rem',
                            padding: '0.2rem 0.5rem',
                            borderRadius: '6px',
                          }}
                        >
                          Câu {idx + 1}
                        </span>
                        <span
                          style={{
                            fontSize: '0.72rem',
                            padding: '0.2rem 0.5rem',
                            borderRadius: '6px',
                            background: isMulti ? 'rgba(168, 85, 247, 0.2)' : isTF ? 'rgba(56, 189, 248, 0.2)' : 'rgba(124, 109, 242, 0.2)',
                            color: isMulti ? '#d8b4fe' : isTF ? '#7dd3fc' : '#c4c1d6',
                            fontWeight: 600,
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                          }}
                        >
                          {isMulti ? '☑️ Nhiều đáp án' : isTF ? '⚖️ Đúng / Sai' : '🔤 1 Lựa chọn'}
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          setGeneratedQuestions(curr => curr.filter((_, i) => i !== idx));
                        }}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: '#ef4444',
                          cursor: 'pointer',
                          fontSize: '0.85rem',
                          padding: '0.2rem 0.4rem',
                        }}
                        title="Xóa câu này"
                      >
                        ✕ Xóa
                      </button>
                    </div>

                    {/* Question text */}
                    <textarea
                      rows={2}
                      value={q.questionText}
                      onChange={e => {
                        const val = e.target.value;
                        setGeneratedQuestions(curr =>
                          curr.map((item, i) => (i === idx ? { ...item, questionText: val } : item))
                        );
                      }}
                      style={{
                        width: '100%',
                        padding: '0.5rem 0.7rem',
                        borderRadius: '8px',
                        background: '#141220',
                        color: '#f3f2f8',
                        border: '1px solid #26233a',
                        fontSize: '16px',
                        fontWeight: 600,
                        marginBottom: '0.65rem',
                        resize: 'vertical',
                      }}
                    />

                    {/* Choices / Options */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', marginBottom: '0.65rem' }}>
                      {q.options.map((opt, optIdx) => {
                        const isCorrect = isMulti
                          ? (q.correctAnswerIndices || [0, 1]).includes(optIdx)
                          : optIdx === (q.correctAnswerIndex ?? 0);
                        const optLabel = isTF
                          ? (optIdx === 0 ? 'Đúng' : 'Sai')
                          : isMulti
                          ? (isCorrect ? '☑ ' + ['A', 'B', 'C', 'D', 'E'][optIdx] : '☐ ' + ['A', 'B', 'C', 'D', 'E'][optIdx])
                          : ['A', 'B', 'C', 'D', 'E'][optIdx];

                        return (
                          <div
                            key={optIdx}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.45rem',
                              padding: '0.35rem 0.55rem',
                              borderRadius: '8px',
                              background: isCorrect ? 'rgba(32, 191, 169, 0.08)' : 'transparent',
                              border: isCorrect
                                ? '1px solid rgba(32, 191, 169, 0.4)'
                                : '1px solid rgba(255, 255, 255, 0.05)',
                            }}
                          >
                            <button
                              type="button"
                              onClick={() => {
                                setGeneratedQuestions(curr =>
                                  curr.map((item, i) => {
                                    if (i !== idx) return item;
                                    if (isMulti) {
                                      const currList = item.correctAnswerIndices || [0, 1];
                                      const nextList = currList.includes(optIdx)
                                        ? currList.filter(n => n !== optIdx)
                                        : [...currList, optIdx].sort((a, b) => a - b);
                                      return { ...item, correctAnswerIndices: nextList.length > 0 ? nextList : [optIdx] };
                                    } else {
                                      return { ...item, correctAnswerIndex: optIdx };
                                    }
                                  })
                                );
                              }}
                              style={{
                                padding: '0.3rem 0.55rem',
                                borderRadius: '6px',
                                border: 'none',
                                background: isCorrect ? '#20bfa9' : '#26233a',
                                color: isCorrect ? '#fff' : '#9894ad',
                                fontWeight: 700,
                                fontSize: '0.8rem',
                                cursor: 'pointer',
                                minWidth: isTF ? '48px' : '34px',
                                flexShrink: 0,
                              }}
                              title={isCorrect ? 'Đáp án đúng (Nhấp để bỏ chọn)' : 'Nhấp để đặt làm đáp án đúng'}
                            >
                              {optLabel}
                            </button>

                            <input
                              type="text"
                              value={opt}
                              onChange={e => {
                                const val = e.target.value;
                                setGeneratedQuestions(curr =>
                                  curr.map((item, i) => {
                                    if (i !== idx) return item;
                                    const newOpts = [...item.options];
                                    newOpts[optIdx] = val;
                                    return { ...item, options: newOpts };
                                  })
                                );
                              }}
                              style={{
                                flex: 1,
                                padding: '0.35rem 0.55rem',
                                borderRadius: '6px',
                                background: '#141220',
                                color: '#f3f2f8',
                                border: '1px solid #26233a',
                                fontSize: '16px',
                                minWidth: 0,
                              }}
                            />

                            {isCorrect && (
                              <span style={{ fontSize: '0.74rem', color: '#20bfa9', fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0 }}>
                                {isMobile ? '✓' : '✓ Đúng'}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Explanation */}
                    <div>
                      <label style={{ display: 'block', fontSize: '0.75rem', color: '#9894ad', marginBottom: '0.2rem' }}>
                        💡 Lời giải thích / General Feedback:
                      </label>
                      <input
                        type="text"
                        value={q.explanation || ''}
                        onChange={e => {
                          const val = e.target.value;
                          setGeneratedQuestions(curr =>
                            curr.map((item, i) => (i === idx ? { ...item, explanation: val } : item))
                          );
                        }}
                        style={{
                          width: '100%',
                          padding: '0.35rem 0.55rem',
                          borderRadius: '6px',
                          background: '#141220',
                          color: '#cfc8ff',
                          border: '1px solid #26233a',
                          fontSize: '16px',
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL 1: Raw Text Paste Modal                                        */}
      {/* ==================================================================== */}
      {showPasteModal && (
        <div
          className="teacher-modal-backdrop"
          onClick={() => setShowPasteModal(false)}
        >
          <div
            className="teacher-modal-panel"
            style={{ width: 'min(100%, 600px)', padding: isMobile ? '1rem' : '1.5rem' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#f3f2f8' }}>
                📝 Dán Danh Sách Điểm Dạng Văn Bản
              </h3>
              <button
                type="button"
                onClick={() => setShowPasteModal(false)}
                style={{ background: 'transparent', border: 'none', color: '#9894ad', fontSize: '1.2rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>
            <p style={{ margin: '0 0 0.85rem', fontSize: '0.8rem', color: '#9894ad' }}>
              Mỗi dòng một sinh viên theo cú pháp: <code>Tên/MSSV/Email: Điểm</code>
            </p>
            <textarea
              rows={6}
              value={rawTextPaste}
              onChange={e => setRawTextPaste(e.target.value)}
              placeholder="Ví dụ:&#10;Bùi Xuân Huấn, 9.5&#10;Ngô Bá Khá, 10.0&#10;huanhoahong@example.com: 8.5"
              style={{
                width: '100%',
                padding: '0.75rem',
                borderRadius: '8px',
                background: '#141220',
                color: '#f3f2f8',
                border: '1px solid #26233a',
                fontSize: '16px',
                fontFamily: 'monospace',
                marginBottom: '1rem',
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button
                type="button"
                onClick={() => setShowPasteModal(false)}
                style={{
                  padding: '0.5rem 1rem',
                  borderRadius: '8px',
                  background: 'transparent',
                  border: '1px solid #26233a',
                  color: '#9894ad',
                  cursor: 'pointer',
                  flex: isMobile ? 1 : 'initial',
                  minHeight: '42px',
                }}
              >
                Hủy
              </button>
              <button
                type="button"
                onClick={handlePasteSubmit}
                style={{
                  padding: '0.5rem 1.25rem',
                  borderRadius: '8px',
                  border: 'none',
                  background: '#7c6df2',
                  color: '#fff',
                  fontWeight: 600,
                  cursor: 'pointer',
                  flex: isMobile ? 1 : 'initial',
                  minHeight: '42px',
                }}
              >
                Xác nhận trích xuất
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL 2: XML Preview Modal                                           */}
      {/* ==================================================================== */}
      {showXmlModal && (
        <div
          className="teacher-modal-backdrop"
          onClick={() => setShowXmlModal(false)}
        >
          <div
            className="teacher-modal-panel"
            style={{ width: 'min(100%, 750px)', padding: isMobile ? '1rem' : '1.5rem', maxHeight: '85vh' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem', color: '#f3f2f8' }}>
                📄 Xem Trước Định Dạng Moodle XML
              </h3>
              <button
                type="button"
                onClick={() => setShowXmlModal(false)}
                style={{ background: 'transparent', border: 'none', color: '#9894ad', fontSize: '1.2rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <pre
              style={{
                maxHeight: '400px',
                overflow: 'auto',
                padding: '0.85rem',
                borderRadius: '8px',
                background: '#141220',
                color: '#a594fd',
                fontSize: '0.8rem',
                fontFamily: 'monospace',
                border: '1px solid #26233a',
                whiteSpace: 'pre-wrap',
                margin: '0 0 1rem',
                flex: 1,
              }}
            >
              {xmlContent || convertQuestionsToMoodleXml(generatedQuestions, courses.find(c => String(c.id) === String(selectedCourseId))?.name || 'Ngân hàng câu hỏi')}
            </pre>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => {
                  const currentCourseName = courses.find(c => String(c.id) === String(selectedCourseId))?.name || 'Ngân hàng câu hỏi';
                  navigator.clipboard.writeText(xmlContent || convertQuestionsToMoodleXml(generatedQuestions, currentCourseName));
                  alert('Đã sao chép mã XML vào bộ nhớ đệm!');
                }}
                style={{
                  padding: '0.5rem 1rem',
                  borderRadius: '8px',
                  background: 'rgba(255, 255, 255, 0.08)',
                  border: '1px solid #26233a',
                  color: '#f3f2f8',
                  cursor: 'pointer',
                  flex: isMobile ? 1 : 'initial',
                  minHeight: '42px',
                }}
              >
                📋 Sao chép XML
              </button>
              <button
                type="button"
                onClick={downloadMoodleXml}
                style={{
                  padding: '0.5rem 1.25rem',
                  borderRadius: '8px',
                  border: 'none',
                  background: '#20bfa9',
                  color: '#fff',
                  fontWeight: 600,
                  cursor: 'pointer',
                  flex: isMobile ? 1 : 'initial',
                  minHeight: '42px',
                }}
              >
                📥 Tải file quiz.xml
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ==================================================================== */}
      {/* MODAL 3: Moodle Import Guide Modal                                   */}
      {/* ==================================================================== */}
      {showGuideModal && (
        <div
          className="teacher-modal-backdrop"
          onClick={() => setShowGuideModal(false)}
        >
          <div
            className="teacher-modal-panel"
            style={{ width: 'min(100%, 650px)', padding: isMobile ? '1.15rem' : '1.75rem', maxHeight: '88vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#f3f2f8' }}>
                🚀 3 Bước Nhập File XML Vào Moodle
              </h3>
              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                style={{ background: 'transparent', border: 'none', color: '#9894ad', fontSize: '1.2rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', margin: '0.5rem 0 1.25rem' }}>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <span
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '50%',
                    background: '#7c6df2',
                    color: '#fff',
                    display: 'grid',
                    placeItems: 'center',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    flexShrink: 0,
                  }}
                >
                  1
                </span>
                <div>
                  <strong style={{ color: '#f3f2f8' }}>Mở Question Bank trong Moodle</strong>
                  <p style={{ margin: '0.2rem 0 0', fontSize: '0.82rem', color: '#9894ad' }}>
                    Vào trang môn học trên Moodle &rarr; Tab <strong>More</strong> &rarr; Chọn <strong>Question bank</strong> (Ngân hàng câu hỏi).
                  </p>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <span
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '50%',
                    background: '#7c6df2',
                    color: '#fff',
                    display: 'grid',
                    placeItems: 'center',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    flexShrink: 0,
                  }}
                >
                  2
                </span>
                <div>
                  <strong style={{ color: '#f3f2f8' }}>Chọn định dạng Moodle XML format</strong>
                  <p style={{ margin: '0.2rem 0 0', fontSize: '0.82rem', color: '#9894ad' }}>
                    Chọn tab <strong>Import</strong> (Nhập) &rarr; Tích chọn <strong>Moodle XML format</strong>.
                  </p>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <span
                  style={{
                    width: '28px',
                    height: '28px',
                    borderRadius: '50%',
                    background: '#7c6df2',
                    color: '#fff',
                    display: 'grid',
                    placeItems: 'center',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    flexShrink: 0,
                  }}
                >
                  3
                </span>
                <div>
                  <strong style={{ color: '#f3f2f8' }}>Kéo thả file quiz.xml và bấm Import</strong>
                  <p style={{ margin: '0.2rem 0 0', fontSize: '0.82rem', color: '#9894ad' }}>
                    Thả file <code>quiz.xml</code> vào ô upload &rarr; Nhấn <strong>Import</strong>.
                  </p>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={() => setShowGuideModal(false)}
                style={{
                  padding: '0.55rem 1.4rem',
                  borderRadius: '8px',
                  border: 'none',
                  background: '#7c6df2',
                  color: '#fff',
                  fontWeight: 600,
                  cursor: 'pointer',
                  width: isMobile ? '100%' : 'auto',
                  minHeight: '42px',
                }}
              >
                Đã hiểu
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
