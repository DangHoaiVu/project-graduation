'use client';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Bot,
  Table,
  HelpCircle,
  FileText,
  BookOpen,
  UploadCloud,
  RefreshCw,
  Send,
  Trash2,
  Copy,
  Check,
  Download,
  Plus,
  FileSpreadsheet,
  Sparkles,
  ExternalLink,
  X,
  Calendar,
  Search,
  Sliders,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  Users,
  GraduationCap,
  Square,
  Globe,
  Lock,
  BookX,
  CheckSquare,
  MessageSquare,
  Zap,
  Printer,
  FileDown,
  RotateCcw,
  Folder,
  Layers,
  GitFork,
  Layout,
} from 'lucide-react';
import type { Course, ChatMessage, CitationSource, CourseSourceItem, StudyToolResponse } from '@/app/types';
import { convertQuestionsToMoodleXml, type QuizQuestionItem } from '@/app/lib/moodle-xml';
import { MarkdownRenderer } from '@/app/components/MarkdownRenderer';
import { InteractiveMindmap } from '@/app/components/InteractiveMindmap';
import { SlidePresentation } from '@/app/components/SlidePresentation';
import type { SlideDeckData } from '@/lib/pptx-export';
import { exportSummaryToDocx, copyRichHtmlForWord } from '@/lib/export-utils';

/* ── Flashcards Component ────────────────────────────────── */

function Flashcards({
  initial,
  courseTitle,
  notify,
}: {
  initial: Array<{ front: string; back: string }>;
  courseTitle: string;
  notify: (s: string) => void;
}) {
  const [cards, setCards] = useState(initial);
  const [i, setI] = useState(0);
  const [flip, setFlip] = useState(false);

  const add = () => {
    const front = window.prompt('Nhập nội dung mặt trước của thẻ:');
    if (!front) return;
    const back = window.prompt('Nhập nội dung mặt sau của thẻ:');
    if (!back) return;
    setCards(v => [...v, { front, back }]);
    setI(cards.length);
    setFlip(false);
    notify('Đã thêm thẻ ghi nhớ mới');
  };

  return (
    <div className="artifact flash">
      <div className="artifact-head">
        <div>
          <h2>Bộ thẻ ghi nhớ: {courseTitle}</h2>
          <p>
            {cards.length > 0 ? `Thẻ ${i + 1} / ${cards.length}` : 'Chưa có thẻ nào'}
          </p>
        </div>
        <button onClick={add} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          <Plus size={14} />
          Thêm thẻ
        </button>
      </div>

      {cards.length > 0 ? (
        <button className={`flash-card ${flip ? 'flipped' : ''}`} onClick={() => setFlip(!flip)}>
          <small>{flip ? 'GIẢI THÍCH / ĐÁP ÁN' : 'KHÁI NIỆM / CÂU HỎI'}</small>
          <strong>{flip ? cards[i]?.back : cards[i]?.front}</strong>
          <span>Nhấn để lật thẻ</span>
        </button>
      ) : (
        <div className="empty-state">Chưa có thẻ ghi nhớ nào. Nhấn "Thêm thẻ" để tạo mới.</div>
      )}

      {cards.length > 0 && (
        <div className="card-nav">
          <button
            onClick={() => {
              setI((i + cards.length - 1) % cards.length);
              setFlip(false);
            }}
            title="Thẻ trước đó"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <ChevronLeft size={16} />
          </button>
          <div>
            {cards.map((_, x) => (
              <i className={x === i ? 'on' : ''} key={x} />
            ))}
          </div>
          <button
            onClick={() => {
              setI((i + 1) % cards.length);
              setFlip(false);
            }}
            title="Thẻ tiếp theo"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Study Artifact Component ────────────────────────────── */

interface GeneratedArtifact {
  data: unknown;
  level: 'simple' | 'standard' | 'complex';
  topic: string;
}

function StudyArtifact({
  type,
  artifact,
  courseTitle,
  loading,
  selectedSourcesCount,
  onGenerate,
  onReset,
  copyText,
  notify,
}: {
  type: string;
  artifact: GeneratedArtifact | null;
  courseTitle: string;
  loading: boolean;
  selectedSourcesCount: number;
  onGenerate: (level: 'simple' | 'standard' | 'complex', topic: string, allowExternal: boolean) => void;
  onReset: () => void;
  copyText: (s: string) => void;
  notify: (s: string) => void;
}) {
  const [selectedLevel, setSelectedLevel] = useState<'simple' | 'standard' | 'complex'>('standard');
  const [topicInput, setTopicInput] = useState('');
  const [allowExternal, setAllowExternal] = useState<boolean>(false);

  const toolIcon =
    type === 'Tóm tắt' ? (
      <FileText size={20} />
    ) : type === 'Mindmap' ? (
      <GitFork size={20} />
    ) : type === 'Slide' ? (
      <Layout size={20} />
    ) : (
      <Layers size={20} />
    );

  const toolName =
    type === 'Tóm tắt'
      ? 'Bản tóm tắt bài giảng'
      : type === 'Mindmap'
      ? 'Sơ đồ tư duy (Mindmap)'
      : type === 'Slide'
      ? 'Slide bài giảng (PowerPoint)'
      : 'Bộ thẻ ghi nhớ (Flashcards)';

  if (loading) {
    return (
      <div className="artifact artifact-loading">
        <span className="bot-avatar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Sparkles size={16} />
        </span>
        <h3>Đang phân tích tài liệu và khởi tạo {type.toLowerCase()} cấp độ {selectedLevel === 'simple' ? 'Cơ bản' : selectedLevel === 'complex' ? 'Chuyên sâu' : 'Tiêu chuẩn'}…</h3>
        <div className="typing">
          <i />
          <i />
          <i />
        </div>
      </div>
    );
  }

  if (!artifact) {
    return (
      <div className="tool-config-panel">
        <div className="tool-config-head">
          <div className="tool-icon-box" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{toolIcon}</div>
          <div>
            <h3>Khởi tạo {toolName}</h3>
            <p>Phân tích và tổng hợp dựa trên {selectedSourcesCount} nguồn tài liệu đã chọn của môn {courseTitle}.</p>
          </div>
        </div>

        <div>
          <div className="tool-section-label">1. CHỌN MỨC ĐỘ CHI TIẾT</div>
          <div className="level-selector">
            <button
              type="button"
              className={`level-card ${selectedLevel === 'simple' ? 'active' : ''}`}
              onClick={() => setSelectedLevel('simple')}
            >
              <strong style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Zap size={14} />
                Cơ bản
              </strong>
              <small>3-4 luận điểm trọng tâm, tổng hợp nhanh trong 1-2 phút</small>
            </button>

            <button
              type="button"
              className={`level-card ${selectedLevel === 'standard' ? 'active' : ''}`}
              onClick={() => setSelectedLevel('standard')}
            >
              <strong style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <BookOpen size={14} />
                Tiêu chuẩn
              </strong>
              <small>Cấu trúc mạch lạc, 5-7 luận điểm cân đối, dễ tiếp thu</small>
            </button>

            <button
              type="button"
              className={`level-card ${selectedLevel === 'complex' ? 'active' : ''}`}
              onClick={() => setSelectedLevel('complex')}
            >
              <strong style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Sparkles size={14} />
                Chuyên sâu
              </strong>
              <small>Phân tích đa chiều, đào sâu nguyên lý, công thức và ví dụ thực tế</small>
            </button>
          </div>
        </div>

        <div>
          <div className="tool-section-label">2. CHỦ ĐỀ / PHẠM VI TRỌNG TÂM (TÙY CHỌN)</div>
          <input
            className="tool-topic-input"
            value={topicInput}
            onChange={e => setTopicInput(e.target.value)}
            placeholder={`Để trống để phân tích toàn bộ môn ${courseTitle}, hoặc nhập chuyên đề...`}
          />
        </div>

        <div>
          <div className="tool-section-label">3. PHẠM VI DỮ LIỆU THAM KHẢO</div>
          <button
            type="button"
            className={`level-card ${allowExternal ? 'active' : ''}`}
            onClick={() => setAllowExternal(prev => !prev)}
            style={{ width: '100%' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <strong style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {allowExternal ? <Globe size={15} /> : <Lock size={15} />}
                {allowExternal ? 'Cho phép liên hệ kiến thức thực tiễn bên ngoài' : 'Bám sát nghiêm ngặt tài liệu được cung cấp'}
              </strong>
              <span className="level-badge" style={{ background: allowExternal ? 'rgba(56, 189, 248, 0.2)' : undefined }}>
                {allowExternal ? 'BẬT' : 'TẮT'}
              </span>
            </div>
            <small>
              {allowExternal
                ? 'Cho phép AI liên hệ thực tế ngành, ứng dụng hiện đại và mở rộng tư duy chuyên môn.'
                : 'AI phân tích nghiêm ngặt chỉ dựa trên nội dung tài liệu môn học được cung cấp.'}
            </small>
          </button>
        </div>

        <button
          type="button"
          className="generate-tool-btn"
          onClick={() => onGenerate(selectedLevel, topicInput.trim() || courseTitle, allowExternal)}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
        >
          <Sparkles size={16} />
          Bắt đầu khởi tạo {type}
        </button>
      </div>
    );
  }

  const levelLabel =
    artifact.level === 'simple' ? 'Cơ bản' : artifact.level === 'complex' ? 'Chuyên sâu' : 'Tiêu chuẩn';

  if (type === 'Slide') {
    return (
      <SlidePresentation
        initialDeck={artifact.data as SlideDeckData}
        courseTitle={courseTitle}
        levelLabel={levelLabel}
        topic={artifact.topic}
        onReconfigure={onReset}
        notify={notify}
      />
    );
  }

  if (type === 'Mindmap') {
    const map = artifact.data as { root: string; branches: Array<{ title: string; items: string[] }> };
    return (
      <InteractiveMindmap
        root={map.root || courseTitle}
        branches={map.branches || []}
        courseTitle={courseTitle}
        levelLabel={levelLabel}
        topic={artifact.topic}
        onReconfigure={onReset}
        notify={notify}
      />
    );
  }

  if (type === 'Flashcard') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 0.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="level-badge">{levelLabel}</span>
            <small style={{ color: '#94a3b8' }}>Chủ đề: {artifact.topic}</small>
          </div>
          <button
            className="reconfigure-btn"
            onClick={onReset}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <RotateCcw size={14} />
            Cấu hình lại
          </button>
        </div>
        <Flashcards
          initial={artifact.data as Array<{ front: string; back: string }>}
          courseTitle={courseTitle}
          notify={notify}
        />
      </div>
    );
  }

  // Summary
  const summary = artifact.data as { title: string; overview: string; points: string[] };
  const text = `${summary.title}\n\n${summary.overview}\n\n${(summary.points ?? []).map(x => `• ${x}`).join('\n')}`;

  const handleExportDocx = async () => {
    try {
      notify('Đang xuất tài liệu Word (.docx)…');
      await exportSummaryToDocx(summary, courseTitle);
      notify('Đã tải tệp Word (.docx) thành công');
    } catch {
      notify('Không thể xuất tệp Word.');
    }
  };

  return (
    <div className="artifact summary">
      <div className="artifact-head">
        <div>
          <h2>{summary.title || `Tóm tắt: ${courseTitle}`}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
            <span className="level-badge">{levelLabel}</span>
            <small style={{ color: '#94a3b8' }}>Chủ đề: {artifact.topic}</small>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            className="reconfigure-btn"
            onClick={onReset}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <RotateCcw size={14} />
            Cấu hình lại
          </button>
          <button
            className="reconfigure-btn"
            onClick={() => void copyText(text)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <Copy size={14} />
            Sao chép
          </button>
          <button
            className="reconfigure-btn"
            style={{
              background: 'rgba(59, 130, 246, 0.25)',
              borderColor: '#3b82f6',
              color: '#ffffff',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
            onClick={() => void handleExportDocx()}
          >
            <FileDown size={14} />
            Xuất Word (.docx)
          </button>
          <button
            onClick={() => {
              window.print();
              notify('Đã mở giao diện in / lưu PDF');
            }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <Printer size={14} />
            In tài liệu
          </button>
        </div>
      </div>
      <h3>Tổng quan</h3>
      <p>{summary.overview}</p>
      <h3>Nội dung chính</h3>
      <ul>
        {(summary.points ?? []).map(p => (
          <li key={p}>{p}</li>
        ))}
      </ul>
      <div className="source-note" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <FileText size={14} />
        Tổng hợp dựa trên {selectedSourcesCount} tài liệu môn học. Vui lòng đối chiếu với giáo trình chính thức khi giảng dạy &amp; ôn tập.
      </div>
    </div>
  );
}

/* ── Source Validation & Badge Helper ─────────────────────── */

function isValidKnowledgeSource(typeOrItem: string | { type?: string; name: string }, nameArg?: string) {
  let t = '';
  let n = '';
  if (typeof typeOrItem === 'object' && typeOrItem !== null) {
    t = (typeOrItem.type || '').toLowerCase();
    n = (typeOrItem.name || '').toLowerCase();
  } else {
    t = (typeOrItem || '').toLowerCase();
    n = (nameArg || '').toLowerCase();
  }

  // Exclude Announcements / Forums / Quizzes / Assignments / Exams / Homework
  if (
    t.includes('forum') ||
    t.includes('assign') ||
    t.includes('quiz') ||
    t.includes('exam') ||
    t.includes('homework') ||
    t.includes('feedback') ||
    t.includes('survey') ||
    n.includes('announcement') ||
    n.includes('thông báo') ||
    n.includes('diễn đàn tin tức') ||
    n.includes('bài tập về nhà') ||
    n.includes('bài kiểm tra') ||
    n.includes('thi kết thúc')
  ) {
    return false;
  }

  // Allow PDF
  if (t === 'pdf' || n.endsWith('.pdf')) return true;

  // Allow Word (.doc, .docx)
  if (t.includes('doc') || t.includes('word') || n.endsWith('.docx') || n.endsWith('.doc')) return true;

  // Allow Web Link (http, https, url, link)
  if (t === 'url' || t === 'link' || n.startsWith('http://') || n.startsWith('https://') || n.includes('.link')) return true;

  // Allow PPT (.ppt, .pptx) / Text (.txt)
  if (t.includes('ppt') || n.endsWith('.pptx') || n.endsWith('.ppt') || t === 'txt' || n.endsWith('.txt')) return true;

  return false;
}

function getSourceBadge(type: string, name: string): { label: React.ReactNode; className: string } {
  const upperType = (type || '').toUpperCase();
  const lowerName = name.toLowerCase();

  if (upperType === 'LINK' || upperType === 'URL' || lowerName.startsWith('http') || lowerName.includes('.link')) {
    return { label: <Globe size={14} />, className: 'link-badge' };
  }
  if (upperType === 'DOCX' || upperType === 'DOC' || lowerName.endsWith('.docx') || lowerName.endsWith('.doc')) {
    return { label: 'W', className: 'word-badge' };
  }
  if (upperType === 'PPTX' || upperType === 'PPT' || lowerName.endsWith('.pptx') || lowerName.endsWith('.ppt')) {
    return { label: 'P', className: 'ppt-badge' };
  }
  return { label: 'P', className: 'pdf-badge' };
}

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
  const quizModel = 'auto';
  const [isGeneratingQuiz, setIsGeneratingQuiz] = useState(false);
  const [generatedQuestions, setGeneratedQuestions] = useState<QuizQuestionItem[]>([]);
  const [xmlContent, setXmlContent] = useState<string>('');
  const [quizNotice, setQuizNotice] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [showXmlModal, setShowXmlModal] = useState(false);
  const [showGuideModal, setShowGuideModal] = useState(false);

  // --------------------------------------------------------------------------
  // Tab 3: Teacher AI Assistant Chat & Study Tools states
  // --------------------------------------------------------------------------
  const [portalSources, setPortalSources] = useState<CourseSourceItem[]>(sources as CourseSourceItem[]);
  const [checkedSources, setCheckedSources] = useState<boolean[]>(() => new Array(sources.length).fill(true));
  const [sourceQuery, setSourceQuery] = useState('');
  const [isSourcePanelCollapsed, setIsSourcePanelCollapsed] = useState(false);
  const [allowExternalSource, setAllowExternalSource] = useState(false);
  const [answerStyle, setAnswerStyle] = useState<'concise' | 'detailed'>('concise');
  const [tool, setTool] = useState('Chat');
  const [artifactsMap, setArtifactsMap] = useState<Record<string, GeneratedArtifact>>({});
  const [artifactLoading, setArtifactLoading] = useState(false);
  const [toast, setToast] = useState('');

  // Student/Teacher Resource Upload Modal states
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadTab, setUploadTab] = useState<'file' | 'url' | 'text'>('file');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadFileTitle, setUploadFileTitle] = useState('');
  const [uploadUrl, setUploadUrl] = useState('');
  const [uploadUrlTitle, setUploadUrlTitle] = useState('');
  const [uploadTextTitle, setUploadTextTitle] = useState('');
  const [uploadTextContent, setUploadTextContent] = useState('');
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadDragActive, setUploadDragActive] = useState(false);
  const uploadFileInputRef = useRef<HTMLInputElement>(null);

  const [assistantChat, setAssistantChat] = useState<ChatMessage[]>([]);
  const [assistantInput, setAssistantInput] = useState('');
  const [assistantLoading, setAssistantLoading] = useState(false);
  const assistantModel = 'auto';
  const [copiedMsgIdx, setCopiedMsgIdx] = useState<number | null>(null);
  const assistantAbortRef = useRef<AbortController | null>(null);
  const chatMessagesEndRef = useRef<HTMLDivElement>(null);

  // Sync sources prop
  useEffect(() => {
    setPortalSources(sources as CourseSourceItem[]);
    setCheckedSources(new Array(sources.length).fill(true));
  }, [sources]);

  const notify = (text: string) => {
    setToast(text);
    window.setTimeout(() => setToast(''), 2600);
  };

  const copyText = async (text: string) => {
    await navigator.clipboard.writeText(text);
    notify('Đã sao chép vào bộ nhớ tạm');
  };

  const openTool = (toolName: string) => {
    setTool(toolName);
  };

  // Auto-collapse source panel on compact windows
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 880) {
      setIsSourcePanelCollapsed(true);
    }
  }, []);

  // Auto-scroll chat to bottom
  useEffect(() => {
    if (activeTab === 'assistant' && tool === 'Chat') {
      chatMessagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [assistantChat, activeTab, tool, assistantLoading]);

  // Generate Tool Artifact (Summary, Mindmap, Flashcards)
  const generateToolArtifact = async (
    toolType: string,
    level: 'simple' | 'standard' | 'complex',
    topic: string,
    allowExternal?: boolean
  ) => {
    setArtifactLoading(true);
    const selectedSources = portalSources.filter((_, i) => checkedSources[i]);
    const selectedSourceNames = selectedSources.map(s => s.name);
    const apiType =
      toolType === 'Tóm tắt'
        ? 'summary'
        : toolType === 'Mindmap'
        ? 'mindmap'
        : toolType === 'Slide'
        ? 'slides'
        : 'flashcards';
    const curCourse = courses.find(c => String(c.id) === String(selectedCourseId) || c.code === String(selectedCourseId));
    const courseTitle = curCourse ? curCourse.name : 'Môn học';
    const effectiveAllowExternal = allowExternal !== undefined ? allowExternal : allowExternalSource;

    try {
      const res = await fetch('/api/study-tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: apiType,
          topic: topic || courseTitle,
          course: `${courseTitle} (${curCourse?.code || ''})`,
          courseId: curCourse?.id || selectedCourseId,
          courseCode: curCourse?.code || '',
          sources: selectedSources,
          sourceNames: selectedSourceNames,
          level,
          allowExternalSource: effectiveAllowExternal,
          model: assistantModel,
        }),
      });
      const data = (await res.json()) as StudyToolResponse;
      if (!res.ok) throw new Error(data.error);

      setArtifactsMap(prev => ({
        ...prev,
        [toolType]: {
          data: data.data,
          level,
          topic: topic || courseTitle,
        },
      }));
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Không thể tạo học liệu.');
    } finally {
      setArtifactLoading(false);
    }
  };

  const resetToolArtifact = (toolType: string) => {
    setArtifactsMap(prev => {
      const updated = { ...prev };
      delete updated[toolType];
      return updated;
    });
  };

  // Upload handler for adding documents
  const handleUploadSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const curCourse = courses.find(c => String(c.id) === String(selectedCourseId) || c.code === String(selectedCourseId));
    const courseCode = curCourse?.code || 'COURSE';
    const courseId = curCourse?.id || selectedCourseId;

    if (uploadTab === 'file') {
      if (!uploadFile) {
        notify('Vui lòng chọn hoặc kéo thả một tệp tài liệu.');
        return;
      }
      setUploadLoading(true);
      try {
        const fileName = uploadFileTitle.trim() || uploadFile.name;
        const ext = uploadFile.name.split('.').pop()?.toLowerCase() || '';
        let type: 'PDF' | 'DOCX' | 'PPTX' | 'TXT' | 'FILE' = 'FILE';
        if (ext === 'pdf') type = 'PDF';
        else if (ext === 'docx' || ext === 'doc') type = 'DOCX';
        else if (ext === 'pptx' || ext === 'ppt') type = 'PPTX';
        else if (ext === 'txt') type = 'TXT';

        let content = '';
        if (ext === 'txt') {
          content = await uploadFile.text();
        }

        try {
          const formData = new FormData();
          formData.append('file', uploadFile);
          formData.append('title', fileName);
          formData.append('courseId', courseCode);
          if (courseId) formData.append('moodleCourseId', String(courseId));
          if (content) formData.append('content', content);

          await fetch('/api/documents/process', {
            method: 'POST',
            body: formData,
          });
        } catch (err) {
          console.warn('Document indexing note:', err);
        }

        const sizeStr = (uploadFile.size / (1024 * 1024)).toFixed(1) + ' MB';
        const newItem: CourseSourceItem = {
          name: fileName,
          type,
          sizeOrPages: `Tệp đã nạp · ${sizeStr}`,
          courseCode,
        };

        setPortalSources(v => [newItem, ...v]);
        setCheckedSources(v => [true, ...v]);
        setShowUploadModal(false);
        setUploadFile(null);
        setUploadFileTitle('');
        notify(`Đã nạp thành công tài liệu: "${fileName}"`);
      } catch (err) {
        notify(err instanceof Error ? err.message : 'Tải tài liệu thất bại.');
      } finally {
        setUploadLoading(false);
      }
    } else if (uploadTab === 'url') {
      if (!uploadUrl.trim()) {
        notify('Vui lòng nhập đường dẫn liên kết.');
        return;
      }
      const cleanUrl = uploadUrl.trim();
      if (!cleanUrl.startsWith('http://') && !cleanUrl.startsWith('https://')) {
        notify('Đường dẫn phải bắt đầu bằng http:// hoặc https://');
        return;
      }
      const title = uploadUrlTitle.trim() || cleanUrl;
      const newItem: CourseSourceItem = {
        name: title,
        type: 'LINK',
        sizeOrPages: 'Liên kết web',
        url: cleanUrl,
        courseCode,
      };
      setPortalSources(v => [newItem, ...v]);
      setCheckedSources(v => [true, ...v]);
      setShowUploadModal(false);
      setUploadUrl('');
      setUploadUrlTitle('');
      notify(`Đã thêm liên kết: "${title}"`);
    } else if (uploadTab === 'text') {
      if (!uploadTextContent.trim()) {
        notify('Vui lòng nhập nội dung ghi chú.');
        return;
      }
      const title = uploadTextTitle.trim() || 'Ghi chú bài học mới';
      const newItem: CourseSourceItem = {
        name: title,
        type: 'TXT',
        sizeOrPages: 'Ghi chú cá nhân',
        courseCode,
      };
      setPortalSources(v => [newItem, ...v]);
      setCheckedSources(v => [true, ...v]);
      setShowUploadModal(false);
      setUploadTextTitle('');
      setUploadTextContent('');
      notify(`Đã lưu ghi chú: "${title}"`);
    }
  };

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

  const curCourse = useMemo(() => {
    return courses.find(c => String(c.id) === String(selectedCourseId) || c.code === String(selectedCourseId)) || courses[0];
  }, [courses, selectedCourseId]);
  const curCourseTitle = curCourse ? curCourse.name : 'môn học';

  const visibleSources = useMemo(() => {
    return portalSources
      .map((item, i) => ({ item, i }))
      .filter(({ item }) => {
        if (!isValidKnowledgeSource(item)) return false;
        if (!sourceQuery.trim()) return true;
        const q = sourceQuery.toLowerCase();
        return (
          item.name.toLowerCase().includes(q) ||
          (item.type && item.type.toLowerCase().includes(q)) ||
          (item.sizeOrPages && item.sizeOrPages.toLowerCase().includes(q))
        );
      });
  }, [portalSources, sourceQuery]);

  const selectedSourceNames = useMemo(() => {
    return portalSources
      .filter((item, i) => (checkedSources[i] ?? true) && isValidKnowledgeSource(item))
      .map(item => item.name);
  }, [portalSources, checkedSources]);

  // Initialize Teacher Assistant welcome message
  useEffect(() => {
    const courseTitle = curCourse ? curCourse.name : 'môn học';
    if (assistantChat.length === 0) {
      setAssistantChat([
        {
          role: 'ai',
          text: `Trợ lý AI Giảng dạy môn **${courseTitle}** đã sẵn sàng. Bạn có thể yêu cầu đề xuất tài liệu học tập, soạn bài tập, lập kế hoạch bài giảng hoặc phân tích kết quả sổ điểm.`,
        },
      ]);
    }
  }, [curCourse, assistantChat.length]);

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
    const selectedSources = portalSources.filter((_, i) => checkedSources[i]);

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
          sources: selectedSources.map(s => ({ name: s.name, url: s.url, type: s.type })),
          sourceNames: selectedSources.map(s => s.name),
          history: assistantChat.slice(1).map(c => ({ role: c.role, text: c.text })),
          model: assistantModel,
          allowExternalSource,
          answerStyle,
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

  const stopGeneration = () => {
    if (assistantAbortRef.current) {
      assistantAbortRef.current.abort();
      assistantAbortRef.current = null;
    }
    setAssistantLoading(false);
    setAssistantChat(v => [
      ...v,
      {
        role: 'ai',
        text: '*(Đã dừng câu trả lời theo yêu cầu)*',
        sources: [],
      },
    ]);
  };

  const handleClearChat = () => {
    if (assistantChat.length <= 1) return;
    const ok = window.confirm(
      'Bạn có chắc chắn muốn xóa toàn bộ lịch sử trò chuyện môn học này không? Hành động này sẽ làm mới toàn bộ đoạn hội thoại.'
    );
    if (!ok) return;

    const curCourse = courses.find(c => String(c.id) === String(selectedCourseId) || c.code === String(selectedCourseId));
    setAssistantChat([
      {
        role: 'ai',
        text: `Trợ lý AI Giảng dạy môn **${curCourse?.name || 'môn học'}** đã sẵn sàng. Bạn có thể yêu cầu đề xuất tài liệu học tập, soạn bài tập, lập kế hoạch bài giảng hoặc phân tích kết quả sổ điểm.`,
      },
    ]);
    setAssistantInput('');
    notify('Đã xóa lịch sử trò chuyện');
  };

  const transferToQuizTab = (text: string) => {
    setQuizDocumentText(text);
    setActiveTab('quiz');
    setQuizNotice({
      type: 'info',
      message: 'Đã chuyển nội dung câu hỏi từ Trợ lý AI sang trình tạo đề XML. Bạn có thể nhấp "Tạo Ngân Hàng Câu Hỏi Moodle XML" bên dưới để trích xuất XML.',
    });
  };

  const copyMessageText = async (text: string, idx: number) => {
    const el = document.getElementById(`teacher-chat-msg-${idx}`);
    if (el) {
      await copyRichHtmlForWord(el, text);
    } else {
      await navigator.clipboard.writeText(text);
    }
    setCopiedMsgIdx(idx);
    notify('Đã sao chép nội dung câu trả lời');
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
              <div
                style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '10px',
                  background: 'linear-gradient(135deg, #7c6df2, #5a49d7)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  flexShrink: 0,
                }}
              >
                <GraduationCap size={20} />
              </div>
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
                      title="Mở khóa học trên LMS"
                    >
                      <span>Xem trên Moodle</span>
                      <ExternalLink size={10} />
                    </a>
                  )}
                </div>
                <p style={{ margin: '0.2rem 0 0', fontSize: '0.82rem', color: '#9894ad' }}>
                  Hệ thống hỗ trợ nhập điểm tự động và khởi tạo ngân hàng đề thi chuẩn Moodle XML
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
                      <optgroup label="Khóa học bạn giảng dạy">
                        {teaching.map(c => (
                          <option key={c.id || c.code} value={c.id || c.code}>
                            {c.code}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {other.length > 0 && (
                      <optgroup label={teaching.length > 0 ? 'Khóa học khác / đang học' : 'Tất cả khóa học'}>
                        {other.map(c => (
                          <option key={c.id || c.code} value={c.id || c.code}>
                            {c.code}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {teaching.length === 0 && other.length === 0 && (
                      courses.map(c => (
                        <option key={c.id || c.code} value={c.id || c.code}>
                          {c.code}
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
      <div className={`teacher-tabs-container ${activeTab === 'assistant' ? 'assistant-mode' : ''}`}>
        <button
          type="button"
          onClick={() => handleTabChange('assistant')}
          className={`teacher-tab-btn ${activeTab === 'assistant' ? 'active' : ''}`}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
        >
          <Bot size={14} />
          <span>Trợ Lý Giảng Dạy</span>
        </button>

        <button
          type="button"
          onClick={() => handleTabChange('grades')}
          className={`teacher-tab-btn ${activeTab === 'grades' ? 'active' : ''}`}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
        >
          <Table size={14} />
          <span>Sổ Điểm</span>
        </button>

        <button
          type="button"
          onClick={() => handleTabChange('quiz')}
          className={`teacher-tab-btn ${activeTab === 'quiz' ? 'active' : ''}`}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
        >
          <HelpCircle size={14} />
          <span>Tạo Đề Moodle XML</span>
        </button>
      </div>

      {/* ==================================================================== */}
      {/* TAB 1: TEACHER AI ASSISTANT CHAT & STUDY TOOLS                       */}
      {/* ==================================================================== */}
      {activeTab === 'assistant' && (
        <div className={`tutor-layout ${isSourcePanelCollapsed ? 'source-collapsed' : ''}`} style={{ flex: '1 1 0%', minHeight: 0, height: '100%' }}>
          {/* Source panel */}
          <aside className={`source-panel ${isSourcePanelCollapsed ? 'collapsed' : ''}`}>
            <div className="source-panel-header">
              <div className="panel-title">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                  <Folder size={15} style={{ color: '#a78bfa' }} />
                  <strong>Nguồn tài liệu</strong>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                  <span>{selectedSourceNames.length} đã chọn</span>
                  <button
                    type="button"
                    className="collapse-source-btn"
                    onClick={() => setIsSourcePanelCollapsed(true)}
                    title="Thu gọn danh sách tài liệu môn học"
                    aria-label="Thu gọn danh sách tài liệu môn học"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    <ChevronLeft size={14} />
                  </button>
                </div>
              </div>

              <label className="source-search">
                <Search size={14} style={{ color: '#94a3b8', flexShrink: 0 }} />
                <input
                  value={sourceQuery}
                  onChange={e => setSourceQuery(e.target.value)}
                  placeholder="Tìm tài liệu môn học..."
                />
              </label>
            </div>

            <div className="source-list-scroll">
              {visibleSources.length === 0 ? (
                <div className="empty-state" style={{ padding: '1rem', fontSize: '13px' }}>
                  Chưa có tài liệu nào trong khóa học này. Hãy nhấn &quot;Thêm nguồn tài liệu&quot; bên dưới hoặc đồng bộ từ Moodle.
                </div>
              ) : (
                visibleSources.map(({ item, i }) => {
                  const badge = getSourceBadge(item.type || '', item.name);
                  return (
                    <label className="source-item" key={`${item.name}-${i}`}>
                      <input
                        type="checkbox"
                        checked={checkedSources[i] ?? true}
                        onChange={() =>
                          setCheckedSources(v => v.map((x, n) => (n === i ? !x : x)))
                        }
                      />
                      <span className={`file-badge ${badge.className}`}>{badge.label}</span>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {item.url ? (
                          <a
                            href={item.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()}
                            style={{ color: 'inherit', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                            title="Mở tài liệu gốc"
                          >
                            <span>{item.name}</span>
                            <ExternalLink size={12} style={{ opacity: 0.7 }} />
                          </a>
                        ) : (
                          item.name
                        )}
                        <small>
                          {item.sizeOrPages ? item.sizeOrPages : item.type === 'LINK' ? 'Liên kết Web' : item.type}
                        </small>
                      </span>
                    </label>
                  );
                })
              )}

              <button className="add-source" onClick={() => setShowUploadModal(true)} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                <Plus size={15} />
                Thêm nguồn tài liệu (PDF, Word, Web)
              </button>
            </div>

            <div className="source-panel-footer">
              <div
                className={`grounded interactive-switch ${allowExternalSource ? 'external-on' : ''}`}
                onClick={() => {
                  setAllowExternalSource(prev => {
                    const next = !prev;
                    notify(
                      next
                        ? 'Đã bật: Cho phép liên hệ kiến thức thực tiễn ngoài giáo trình'
                        : 'Đã bật: Chế độ bám sát nghiêm ngặt tài liệu môn học'
                    );
                    return next;
                  });
                }}
                style={{ cursor: 'pointer' }}
                title="Nhấp để bật/tắt quyền dùng nguồn kiến thức mở rộng bên ngoài"
              >
                <div className="grounded-header">
                  <div className="grounded-header-left">
                    {allowExternalSource ? <Globe size={15} style={{ color: '#38bdf8' }} /> : <Lock size={15} style={{ color: '#94a3b8' }} />}
                    <strong className="grounded-title">{allowExternalSource ? 'Nguồn mở rộng' : 'Bám sát tài liệu'}</strong>
                  </div>
                  <span className={`unified-status-chip ${allowExternalSource ? 'on' : 'off'}`}>
                    {allowExternalSource ? 'BẬT' : 'TẮT'}
                  </span>
                </div>
                <p className="grounded-subtitle">
                  {allowExternalSource
                    ? 'AI kết hợp giáo trình với kiến thức thực tiễn và công nghệ hiện đại.'
                    : 'AI phân tích nghiêm ngặt chỉ dựa trên các tài liệu đã chọn.'}
                </p>
              </div>
            </div>
          </aside>

          {/* Chat / Artifact panel */}
          <section className="chat-panel">
            <div className="tool-tabs">
              <div className="tool-tabs-left">
                {isSourcePanelCollapsed && (
                  <button
                    type="button"
                    className="expand-source-pill"
                    onClick={() => setIsSourcePanelCollapsed(false)}
                    title="Mở danh sách tài liệu môn học"
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                  >
                    <Folder size={14} />
                    <span></span>
                    <span className="source-count-badge">{selectedSourceNames.length}</span>
                  </button>
                )}
                {[
                  { id: 'Chat', label: 'Chat', icon: <MessageSquare size={14} /> },
                  { id: 'Tóm tắt', label: 'Tóm tắt', icon: <FileText size={14} /> },
                  { id: 'Mindmap', label: 'Mindmap', icon: <GitFork size={14} /> },
                  { id: 'Flashcard', label: 'Flashcard', icon: <Layers size={14} /> },
                  { id: 'Slide', label: 'Slide', icon: <Layout size={14} /> },
                ].map(tab => (
                  <button
                    key={tab.id}
                    className={tool === tab.id ? 'selected' : ''}
                    onClick={() => openTool(tab.id)}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                  >
                    {tab.icon}
                    <span>{tab.label}</span>
                  </button>
                ))}
              </div>

              <div className="tool-tabs-actions">
                {selectedCourseId && (
                  <a
                    href={`${moodleUrl.replace(/\/$/, '')}/course/view.php?id=${selectedCourseId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="lms-redirect-btn"
                    title={`Mở trực tiếp khóa học ${curCourseTitle} trên hệ thống Moodle LMS`}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                  >
                    <GraduationCap size={15} />
                    <span>Mở LMS</span>
                    <ExternalLink size={12} style={{ opacity: 0.8 }} />
                  </a>
                )}
              </div>
            </div>

            {tool === 'Chat' ? (
              <>
                {/* Chat Messages */}
                <div className="messages">
                  {assistantChat.map((m, i) => (
                    <div className={`message ${m.role}`} key={i}>
                      {m.role === 'ai' && (
                        <span className="bot-avatar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <Sparkles size={16} />
                        </span>
                      )}
                      <div id={`teacher-chat-msg-${i}`} style={{ minWidth: 0, width: '100%' }}>
                        <MarkdownRenderer content={m.text} />

                        {/* External sources citation pills */}
                        {m.sources && m.sources.length > 0 && (
                          <div className="citations">
                            {m.sources.map((s, idx) => {
                              const isObj = typeof s === 'object' && s !== null;
                              const rawName = isObj ? s.name : String(s);
                              const cleanName = rawName.replace(/^(▤|➕|\+\s*|\[Mở rộng\])/, '').trim();
                              const searchTarget = cleanName.replace(/^(Kiểm chứng|Nguồn mở rộng):\s*/i, '');
                              const url = isObj && s.url ? s.url : `https://www.google.com/search?q=${encodeURIComponent(searchTarget)}`;
                              return (
                                <a
                                  key={idx}
                                  className="citation-pill external-citation"
                                  href={url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                                >
                                  <Globe size={12} style={{ color: '#38bdf8' }} />
                                  <span className="citation-text">{cleanName}</span>
                                  <ExternalLink size={10} style={{ opacity: 0.7 }} />
                                </a>
                              );
                            })}
                          </div>
                        )}

                        {/* Toolbar for AI message */}
                        {m.role === 'ai' && (
                          <div className="message-toolbar" style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              className={`copy-message-btn ${copiedMsgIdx === i ? 'copied' : ''}`}
                              onClick={() => copyMessageText(m.text, i)}
                              title="Sao chép câu trả lời (hỗ trợ dán vào Word hoặc Markdown)"
                              style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                            >
                              {copiedMsgIdx === i ? <Check size={13} /> : <Copy size={13} />}
                              <span>{copiedMsgIdx === i ? 'Đã sao chép' : 'Sao chép'}</span>
                            </button>

                            <button
                              type="button"
                              className="copy-message-btn"
                              onClick={() => transferToQuizTab(m.text)}
                              title="Chuyển văn bản câu hỏi này sang trình tạo đề thi Moodle XML"
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '5px',
                                background: 'rgba(124, 109, 242, 0.15)',
                                color: '#cfc8ff',
                                borderColor: 'rgba(124, 109, 242, 0.35)',
                              }}
                            >
                              <HelpCircle size={13} style={{ color: '#a594fd' }} />
                              <span>Chuyển sang Tạo Đề XML</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}

                  {assistantLoading && (
                    <div className="message ai">
                      <span className="bot-avatar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Sparkles size={16} />
                      </span>
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
                    placeholder={`Nhập yêu cầu: soạn câu hỏi thi, lập giáo án, tóm tắt kiến thức hoặc phân tích môn ${curCourseTitle}...`}
                  />
                  <div className="chat-compose-footer">
                    <div className="chat-compose-chips">
                      {/* Answer Style Selector (Concise vs Detailed) */}
                      <button
                        type="button"
                        onClick={() => {
                          setAnswerStyle(prev => {
                            const next = prev === 'concise' ? 'detailed' : 'concise';
                            notify(
                              next === 'detailed'
                                ? 'Chế độ phân tích: Chi tiết & Chuyên sâu'
                                : 'Chế độ phân tích: Nhanh & Trọng tâm'
                            );
                            return next;
                          });
                        }}
                        className={`mode-indicator-chip ${answerStyle === 'detailed' ? 'style-detailed' : ''}`}
                        title="Chuyển đổi giữa phân tích trọng tâm và phân tích chuyên sâu"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                      >
                        {answerStyle === 'concise' ? <Zap size={13} /> : <BookOpen size={13} />}
                        <span>{answerStyle === 'concise' ? 'Nhanh / Trọng tâm' : 'Chi tiết / Chuyên sâu'}</span>
                      </button>
                    </div>

                    <div className="chat-compose-actions">
                      <button
                        type="button"
                        className="clear-chat-btn"
                        onClick={handleClearChat}
                        disabled={assistantChat.length <= 1 || assistantLoading}
                        title="Xóa toàn bộ lịch sử trò chuyện"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                      >
                        <Trash2 size={13} />
                        <span>Xóa lịch sử</span>
                      </button>

                      {assistantLoading ? (
                        <button
                          type="button"
                          onClick={stopGeneration}
                          style={{
                            background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                            color: '#fff',
                            border: 'none',
                            padding: '0.5rem 1.1rem',
                            borderRadius: '10px',
                            fontWeight: 600,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '6px',
                            cursor: 'pointer',
                            boxShadow: '0 2px 10px rgba(239, 68, 68, 0.4)',
                            transition: 'all 0.2s ease',
                          }}
                          title="Dừng phản hồi"
                        >
                          <Square size={12} fill="currentColor" />
                          <span>Dừng</span>
                        </button>
                      ) : (
                        <button
                          className="chat-send-btn"
                          onClick={() => void askAssistant()}
                          disabled={!assistantInput.trim()}
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                        >
                          <span>Gửi</span>
                          <Send size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="tool-workspace-container">
                <StudyArtifact
                  type={tool}
                  artifact={artifactsMap[tool] ?? null}
                  courseTitle={curCourseTitle}
                  loading={artifactLoading}
                  selectedSourcesCount={selectedSourceNames.length}
                  onGenerate={(lvl, top, ext) => void generateToolArtifact(tool, lvl, top, ext)}
                  onReset={() => resetToolArtifact(tool)}
                  copyText={copyText}
                  notify={notify}
                />
              </div>
            )}
          </section>
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
                <Table size={18} style={{ color: '#7c6df2' }} />
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
                  ● Trực tiếp LMS
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
                      <option value="all">Tất cả cột điểm (All grades)</option>
                      {activeGradeColumns.map(col => (
                        <option key={col.id} value={col.id}>
                          {col.name} (Tối đa: {col.grademax}đ)
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
                  fontWeight: 600,
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
                title="Mở bảng nhập điểm tự động từ Excel/Hình ảnh"
              >
                <UploadCloud size={16} />
                <span>Nhập điểm thông minh</span>
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
                  placeholder="Tìm kiếm sinh viên theo tên hoặc mã SV..."
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
                    <option value="name-asc">Tên: A → Z</option>
                    <option value="name-desc">Tên: Z → A</option>
                    <option value="grade-desc">Điểm: Cao nhất</option>
                    <option value="grade-asc">Điểm: Thấp nhất</option>
                    <option value="default">Thứ tự mặc định</option>
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
                                    {col.name}
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
                              {displayedGradeColumns.length > 1 ? `${col.name}: ` : ''}{fb}
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
                            <span style={{ fontWeight: 600 }}>Nhận xét (str_feedback)</span>
                          </div>
                          <div style={{ fontSize: '0.75rem', color: '#9894ad' }}>Đẩy LMS &amp; hiển thị sinh viên</div>
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

            {/* Bottom Bar: Summary information */}
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
                      <UploadCloud size={18} style={{ color: '#7c6df2' }} />
                      <span>Nhập Điểm Sổ Điểm LMS</span>
                    </h3>
                    <p style={{ margin: '0.2rem 0 0', color: '#9894ad', fontSize: '0.8rem' }}>
                      Tự động trích xuất điểm từ tệp/hình ảnh hoặc nhập trực tiếp cho sinh viên.
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
                            {col.name} (Tối đa: {col.grademax}đ)
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
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '5px',
                        }}
                      >
                        <FileText size={13} />
                        <span>Dán văn bản</span>
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
                    <div style={{ fontSize: '24px', marginBottom: '0.25rem', display: 'flex', justifyContent: 'center' }}>
                      {isExtracting ? <Sparkles size={24} style={{ color: '#a855f7' }} /> : <UploadCloud size={24} style={{ color: '#7c6df2' }} />}
                    </div>
                    <h4 style={{ margin: '0 0 0.2rem', fontSize: '0.9rem', color: '#f3f2f8' }}>
                      {isExtracting ? 'Đang phân tích và trích xuất bảng điểm...' : 'Tải lên bảng điểm (Excel, Hình ảnh hoặc PDF)'}
                    </h4>
                    <p style={{ margin: 0, fontSize: '0.75rem', color: '#9894ad' }}>
                      Tự động đối chiếu thông tin sinh viên và điền điểm số
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
                                {activeGradeColumns.find(c => c.id === (selectedGradeColumnId !== 'all' ? selectedGradeColumnId : activeGradeColumns[0]?.id))?.name || 'Điểm'}
                              </th>
                              <th style={{ padding: '0.75rem 1rem', color: '#cfc8ff' }}>
                                Nhận xét (str_feedback)
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
                <Sparkles size={18} style={{ color: '#7c6df2' }} />
                <span>Khởi Tạo Ngân Hàng Câu Hỏi Moodle XML</span>
              </h2>
              <p style={{ margin: 0, fontSize: '0.82rem', color: '#9894ad' }}>
                Biên soạn bộ câu hỏi đa định dạng chuẩn xác 100% từ tài liệu bài giảng, sẵn sàng nạp thẳng vào Ngân hàng câu hỏi LMS.
              </p>
            </div>

            {/* 1. Question Format (Full Line) */}
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#cfc8ff', marginBottom: '0.5rem' }}>
                1. ĐỊNH DẠNG CÂU HỎI (QUESTION FORMAT):
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(auto-fit, minmax(140px, 1fr))' : 'repeat(auto-fit, minmax(210px, 1fr))', gap: '0.65rem' }}>
                {[
                  { id: 'mixed', label: 'Kết hợp (Mixed)', icon: Sparkles, desc: 'Xen kẽ cả 1 lựa chọn, Đúng/Sai & Nhiều đáp án' },
                  { id: 'multiple_choice', label: '1 Lựa chọn (A/B/C/D)', icon: HelpCircle, desc: 'Chuẩn 4 phương án, 1 đáp án đúng' },
                  { id: 'true_false', label: 'Đúng / Sai (True/False)', icon: BookX, desc: 'Phán đoán tính đúng/sai của nhận định' },
                  { id: 'multiple_select', label: 'Chọn nhiều đáp án', icon: CheckSquare, desc: 'Có từ 2 đến 3 đáp án đúng (Multi-answer)' },
                ].map(item => {
                  const isSelected = quizQuestionType === item.id;
                  const Icon = item.icon;
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
                      <strong style={{ fontSize: isMobile ? '0.88rem' : '0.94rem', color: isSelected ? '#fff' : '#c4c1d6', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <Icon size={14} />
                        <span>{item.label}</span>
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
                  { id: 'easy', label: 'Cơ bản (Nhận biết)' },
                  { id: 'normal', label: 'Trung bình (Thông hiểu)' },
                  { id: 'hard', label: 'Nâng cao (Vận dụng cao)' },
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
                        fontWeight: 600,
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

            {/* Document Text / Notes (Expanded Textarea) */}
            <div>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#cfc8ff', marginBottom: '0.45rem' }}>
                4. TÀI LIỆU NGUỒN / GHI CHÚ BÀI GIẢNG (TÙY CHỌN):
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
                Tệp xuất ra đạt chuẩn <strong>Moodle XML</strong> có sẵn CDATA, feedback, penalty và fraction 100%.
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
                  fontWeight: 600,
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
                    <Sparkles size={16} />
                    <span>Đang biên soạn câu hỏi...</span>
                  </>
                ) : (
                  <>
                    <Sparkles size={16} />
                    <span>Tạo ngân hàng câu hỏi Moodle XML ({quizCount} câu)</span>
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
                    Đã sẵn sàng {generatedQuestions.length} câu hỏi
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
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                    }}
                  >
                    <BookOpen size={14} />
                    <span>Hướng dẫn</span>
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
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                    }}
                  >
                    <FileText size={14} />
                    <span>Xem XML</span>
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
                      fontWeight: 600,
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
                    <Download size={14} />
                    <span>Tải tệp quiz.xml</span>
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
                          {isMulti ? 'Nhiều đáp án' : isTF ? 'Đúng / Sai' : '1 Lựa chọn'}
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
                          ? (isCorrect ? '[x] ' + ['A', 'B', 'C', 'D', 'E'][optIdx] : '[ ] ' + ['A', 'B', 'C', 'D', 'E'][optIdx])
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
                        Giải thích chi tiết / General Feedback:
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
                Dán danh sách điểm dạng văn bản
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
              placeholder="Ví dụ:&#10;Nguyễn Văn An, 9.5&#10;Trần Thị Bình, 10.0&#10;leminhcuong@example.com: 8.5"
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
                Xem trước định dạng Moodle XML
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
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                }}
              >
                <Copy size={14} />
                <span>Sao chép XML</span>
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
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '5px',
                }}
              >
                <Download size={14} />
                <span>Tải tệp quiz.xml</span>
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
                Hướng dẫn 3 bước nhập tệp XML vào Moodle
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

      {/* ==================================================================== */}
      {/* RESOURCE UPLOAD MODAL (TEACHER & COURSE SOURCES)                     */}
      {/* ==================================================================== */}
      {showUploadModal && (
        <div
          className="teacher-modal-backdrop"
          onClick={() => {
            if (!uploadLoading) setShowUploadModal(false);
          }}
        >
          <div
            className="teacher-modal-panel"
            style={{ width: 'min(100%, 640px)', padding: 0 }}
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: '1.25rem 1.5rem',
                borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                background: 'rgba(20, 18, 34, 0.95)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '10px',
                    background: 'linear-gradient(135deg, #7c6df2, #5a49d7)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#fff',
                    flexShrink: 0,
                  }}
                >
                  <UploadCloud size={18} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#f3f2f8', fontWeight: 700 }}>
                    Thêm Nguồn Tài Liệu Giảng Dạy
                  </h3>
                  <p style={{ margin: '0.15rem 0 0', fontSize: '0.8rem', color: '#9894ad' }}>
                    Nạp tài liệu môn học để Trợ lý AI và các công cụ hỗ trợ phân tích chuyên sâu
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!uploadLoading) setShowUploadModal(false);
                }}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#9894ad',
                  fontSize: '1.25rem',
                  cursor: 'pointer',
                  padding: '0.3rem 0.5rem',
                  borderRadius: '6px',
                }}
                aria-label="Đóng"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <form onSubmit={handleUploadSubmit} style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
              <div style={{ padding: '1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>
                {/* 3 Mode Tabs */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    background: '#141220',
                    padding: '4px',
                    borderRadius: '10px',
                    border: '1px solid #26233a',
                    gap: '4px',
                  }}
                >
                  {[
                    { id: 'file', label: 'Tải tệp lên', icon: FileText, desc: 'PDF, Word, PPTX, TXT' },
                    { id: 'url', label: 'Liên kết Web', icon: Globe, desc: 'URL, Bài viết, Tài liệu' },
                    { id: 'text', label: 'Ghi chú nhanh', icon: BookOpen, desc: 'Dán trực tiếp văn bản' },
                  ].map(tab => {
                    const isSelected = uploadTab === tab.id;
                    const Icon = tab.icon;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setUploadTab(tab.id as 'file' | 'url' | 'text')}
                        style={{
                          padding: '0.6rem 0.5rem',
                          borderRadius: '8px',
                          border: isSelected ? '1px solid rgba(124, 109, 242, 0.5)' : '1px solid transparent',
                          background: isSelected ? 'rgba(124, 109, 242, 0.2)' : 'transparent',
                          color: isSelected ? '#ffffff' : '#9894ad',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px',
                          fontSize: '0.85rem',
                          fontWeight: isSelected ? 600 : 500,
                          transition: 'all 0.2s ease',
                        }}
                      >
                        <Icon size={15} style={{ color: isSelected ? '#a594fd' : '#71717a' }} />
                        <span>{tab.label}</span>
                      </button>
                    );
                  })}
                </div>

                {/* Tab 1: File Upload Dropzone */}
                {uploadTab === 'file' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                    <div
                      onDragOver={e => {
                        e.preventDefault();
                        setUploadDragActive(true);
                      }}
                      onDragLeave={() => setUploadDragActive(false)}
                      onDrop={e => {
                        e.preventDefault();
                        setUploadDragActive(false);
                        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                          setUploadFile(e.dataTransfer.files[0]);
                          if (!uploadFileTitle) {
                            setUploadFileTitle(e.dataTransfer.files[0].name.replace(/\.[^/.]+$/, ''));
                          }
                        }
                      }}
                      onClick={() => uploadFileInputRef.current?.click()}
                      style={{
                        padding: '1.75rem 1.25rem',
                        border: uploadDragActive ? '2px dashed #7c6df2' : '2px dashed rgba(124, 109, 242, 0.4)',
                        borderRadius: '12px',
                        background: uploadDragActive ? 'rgba(124, 109, 242, 0.15)' : 'rgba(20, 18, 34, 0.6)',
                        textAlign: 'center',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '0.4rem',
                      }}
                    >
                      <input
                        ref={uploadFileInputRef}
                        type="file"
                        accept=".pdf,.docx,.doc,.pptx,.ppt,.txt"
                        style={{ display: 'none' }}
                        onChange={e => {
                          if (e.target.files && e.target.files[0]) {
                            const f = e.target.files[0];
                            setUploadFile(f);
                            if (!uploadFileTitle) {
                              setUploadFileTitle(f.name.replace(/\.[^/.]+$/, ''));
                            }
                          }
                        }}
                      />

                      {uploadFile ? (
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.75rem',
                            width: '100%',
                            maxWidth: '380px',
                            padding: '0.65rem 0.85rem',
                            background: '#141220',
                            borderRadius: '10px',
                            border: '1px solid rgba(124, 109, 242, 0.35)',
                          }}
                          onClick={e => e.stopPropagation()}
                        >
                          <div
                            style={{
                              width: '32px',
                              height: '32px',
                              borderRadius: '8px',
                              background: 'rgba(124, 109, 242, 0.2)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: '#a594fd',
                              flexShrink: 0,
                            }}
                          >
                            <FileText size={18} />
                          </div>
                          <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                            <div
                              style={{
                                fontSize: '0.88rem',
                                fontWeight: 600,
                                color: '#f3f2f8',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {uploadFile.name}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: '#9894ad' }}>
                              {(uploadFile.size / (1024 * 1024)).toFixed(2)} MB
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setUploadFile(null);
                              setUploadFileTitle('');
                            }}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: '#ef4444',
                              cursor: 'pointer',
                              padding: '4px',
                              fontSize: '1rem',
                            }}
                            title="Xóa tệp đã chọn"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <>
                          <div
                            style={{
                              width: '44px',
                              height: '44px',
                              borderRadius: '50%',
                              background: 'rgba(124, 109, 242, 0.15)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: '#a594fd',
                              marginBottom: '0.2rem',
                            }}
                          >
                            <UploadCloud size={24} />
                          </div>
                          <strong style={{ fontSize: '0.92rem', color: '#f3f2f8' }}>
                            Kéo thả tài liệu vào đây hoặc nhấp để chọn tệp
                          </strong>
                          <p style={{ margin: 0, fontSize: '0.78rem', color: '#9894ad' }}>
                            Hỗ trợ các định dạng: PDF, Word (.docx, .doc), PowerPoint (.pptx, .ppt), TXT
                          </p>
                        </>
                      )}
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#cfc8ff', marginBottom: '0.4rem' }}>
                        Tên hiển thị tài liệu (Tùy chọn):
                      </label>
                      <input
                        type="text"
                        value={uploadFileTitle}
                        onChange={e => setUploadFileTitle(e.target.value)}
                        placeholder="VD: Đề cương môn học - Chương 1..."
                        style={{
                          width: '100%',
                          padding: '0.65rem 0.85rem',
                          borderRadius: '8px',
                          background: '#141220',
                          color: '#f3f2f8',
                          border: '1px solid #26233a',
                          fontSize: '16px',
                          outline: 'none',
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Tab 2: Web URL */}
                {uploadTab === 'url' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#cfc8ff', marginBottom: '0.4rem' }}>
                        Địa chỉ liên kết Web (URL): <span style={{ color: '#ef4444' }}>*</span>
                      </label>
                      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                        <Globe size={16} style={{ position: 'absolute', left: '12px', color: '#9894ad' }} />
                        <input
                          type="url"
                          value={uploadUrl}
                          onChange={e => setUploadUrl(e.target.value)}
                          placeholder="https://example.com/tai-lieu-giang-day"
                          required
                          style={{
                            width: '100%',
                            padding: '0.65rem 0.85rem 0.65rem 36px',
                            borderRadius: '8px',
                            background: '#141220',
                            color: '#f3f2f8',
                            border: '1px solid #26233a',
                            fontSize: '16px',
                            outline: 'none',
                            boxSizing: 'border-box',
                          }}
                        />
                      </div>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#cfc8ff', marginBottom: '0.4rem' }}>
                        Tiêu đề liên kết / Tên tài liệu:
                      </label>
                      <input
                        type="text"
                        value={uploadUrlTitle}
                        onChange={e => setUploadUrlTitle(e.target.value)}
                        placeholder="VD: Tài liệu tham khảo môn học..."
                        style={{
                          width: '100%',
                          padding: '0.65rem 0.85rem',
                          borderRadius: '8px',
                          background: '#141220',
                          color: '#f3f2f8',
                          border: '1px solid #26233a',
                          fontSize: '16px',
                          outline: 'none',
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Tab 3: Text Note */}
                {uploadTab === 'text' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#cfc8ff', marginBottom: '0.4rem' }}>
                        Tiêu đề ghi chú:
                      </label>
                      <input
                        type="text"
                        value={uploadTextTitle}
                        onChange={e => setUploadTextTitle(e.target.value)}
                        placeholder="VD: Ghi chú đề bài thi giữa kỳ..."
                        style={{
                          width: '100%',
                          padding: '0.65rem 0.85rem',
                          borderRadius: '8px',
                          background: '#141220',
                          color: '#f3f2f8',
                          border: '1px solid #26233a',
                          fontSize: '16px',
                          outline: 'none',
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: '0.82rem', fontWeight: 600, color: '#cfc8ff', marginBottom: '0.4rem' }}>
                        Nội dung bài học / Ghi chép: <span style={{ color: '#ef4444' }}>*</span>
                      </label>
                      <textarea
                        rows={6}
                        value={uploadTextContent}
                        onChange={e => setUploadTextContent(e.target.value)}
                        placeholder="Dán nội dung giáo án, tài liệu, ghi chú vào đây..."
                        required
                        style={{
                          width: '100%',
                          padding: '0.75rem',
                          borderRadius: '8px',
                          background: '#141220',
                          color: '#f3f2f8',
                          border: '1px solid #26233a',
                          fontSize: '16px',
                          outline: 'none',
                          resize: 'vertical',
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Modal Footer */}
              <div
                style={{
                  padding: '1rem 1.5rem',
                  borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  gap: '0.75rem',
                  background: 'rgba(0, 0, 0, 0.25)',
                }}
              >
                <button
                  type="button"
                  onClick={() => setShowUploadModal(false)}
                  disabled={uploadLoading}
                  style={{
                    padding: '0.55rem 1.15rem',
                    borderRadius: '8px',
                    border: '1px solid #26233a',
                    background: 'transparent',
                    color: '#9894ad',
                    fontWeight: 600,
                    fontSize: '0.88rem',
                    cursor: 'pointer',
                  }}
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  disabled={uploadLoading}
                  style={{
                    padding: '0.55rem 1.35rem',
                    borderRadius: '8px',
                    border: 'none',
                    background: 'linear-gradient(135deg, #7c6df2, #5a49d7)',
                    color: '#ffffff',
                    fontWeight: 700,
                    fontSize: '0.88rem',
                    cursor: uploadLoading ? 'not-allowed' : 'pointer',
                    boxShadow: '0 4px 14px rgba(124, 109, 242, 0.4)',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px',
                    opacity: uploadLoading ? 0.7 : 1,
                  }}
                >
                  {uploadLoading ? (
                    <>
                      <Sparkles size={14} />
                      <span>Đang xử lý tài liệu...</span>
                    </>
                  ) : (
                    <>
                      <Check size={14} />
                      <span>Thêm vào tài liệu môn học</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div className="toast">
          {toast}
        </div>
      )}
    </div>
  );
}
