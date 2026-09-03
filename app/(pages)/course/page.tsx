'use client';

import { Suspense, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  MessageSquare,
  FileText,
  GitFork,
  Layers,
  HelpCircle,
  Zap,
  BookOpen,
  Copy,
  Check,
  Trash2,
  Square,
  Send,
  Plus,
  Search,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Folder,
  BarChart3,
  GraduationCap,
  Sparkles,
  Lock,
  Globe,
  Printer,
  FileDown,
  RotateCcw,
  Sliders,
  CheckCircle2,
  X,
  User,
  ShieldCheck,
  Award,
  Calendar,
  Flame,
  UploadCloud,
} from 'lucide-react';
import {
  baseCourses,
  getCourseSources,
  inspirationalQuotes,
  nav,
} from '@/app/mock-data';
import type {
  ChatMessage,
  Course,
  CourseSourceItem,
  ErrorResponse,
  ExamResult,
  MoodleData,
  MoodleResource,
  MoodleUser,
  StudyToolResponse,
  TutorResponse,
} from '@/app/types';
import { MarkdownRenderer } from '@/app/components/MarkdownRenderer';
import { InteractiveMindmap } from '@/app/components/InteractiveMindmap';
import { QuizComponent } from '@/app/components/QuizComponent';
import { TeacherPortal } from '@/app/components/teacher/TeacherPortal';
import { exportSummaryToDocx, copyRichHtmlForWord, exportChatMessageToDocx } from '@/lib/export-utils';

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

  const toolIcon = type === 'Tóm tắt' ? <FileText size={20} /> : type === 'Mindmap' ? <GitFork size={20} /> : <Layers size={20} />;
  const toolName = type === 'Tóm tắt' ? 'Bản tóm tắt học thuật' : type === 'Mindmap' ? 'Sơ đồ tư duy (Mindmap)' : 'Bộ thẻ ghi nhớ (Flashcards)';

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

  // If artifact hasn't been generated yet or was reset, show configuration & confirmation panel
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
        Tổng hợp dựa trên {selectedSourcesCount} tài liệu môn học. Vui lòng đối chiếu với giáo trình chính thức khi ôn tập.
      </div>
    </div>
  );
}

/* ── Source Validation & Badge Helper ─────────────────────── */

function isValidKnowledgeSource(type: string, name: string) {
  const t = (type || '').toLowerCase();
  const n = (name || '').toLowerCase();

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

/* ── Course Detail Inner Content ─────────────────────────── */

function CourseDetailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const queryId = searchParams.get('id');
  const queryCode = searchParams.get('code');
  const queryName = searchParams.get('name');
  const initialIntent = searchParams.get('intent') || searchParams.get('q') || '';
  // When draft=1 the intent is pre-filled but NOT auto-sent (user can edit model/prompt first)
  const draftMode = searchParams.get('draft') === '1';

  const [moodle, setMoodle] = useState<MoodleData | null>(null);
  const [user, setUser] = useState<MoodleUser | null>(null);
  const [toast, setToast] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [notifications, setNotifications] = useState(false);
  const [profile, setProfile] = useState(false);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const notify = (text: string) => {
    setToast(text);
    window.setTimeout(() => setToast(''), 2600);
  };

  // Sync Moodle data and read local caches
  const syncMoodleData = async () => {
    setSyncing(true);
    try {
      const token = localStorage.getItem('moodleToken');
      const res = await fetch('/api/moodle', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = (await res.json()) as MoodleData & ErrorResponse;
      if (res.ok && data) {
        setMoodle(data);
        localStorage.setItem('moodleData', JSON.stringify(data));
        if (data.user) {
          setUser(prev => {
            const avatarUrl =
              data.user!.avatarUrl ||
              (token ? `/api/moodle/avatar?token=${encodeURIComponent(token)}&id=${data.user!.id}` : prev?.avatarUrl);
            const updated: MoodleUser = {
              id: data.user!.id,
              fullname: data.user!.name || prev?.fullname || '',
              username: data.user!.username || prev?.username || '',
              avatarUrl,
            };
            localStorage.setItem('moodleUser', JSON.stringify(updated));
            return updated;
          });
        }
      }
    } catch {
      // offline or demo mode
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    const storedUser = localStorage.getItem('moodleUser');
    const token = localStorage.getItem('moodleToken');
    if (storedUser) {
      try {
        const parsed = JSON.parse(storedUser) as MoodleUser;
        if (
          token &&
          (!parsed.avatarUrl ||
            parsed.avatarUrl.includes('/u/f1') ||
            parsed.avatarUrl.includes('/u/f2') ||
            !parsed.avatarUrl.startsWith('/api/moodle/avatar'))
        ) {
          parsed.avatarUrl = `/api/moodle/avatar?token=${encodeURIComponent(token)}&id=${parsed.id}`;
        }
        setUser(parsed);
      } catch {
        localStorage.removeItem('moodleUser');
      }
    }

    const storedMoodle = localStorage.getItem('moodleData');
    if (storedMoodle) {
      try {
        setMoodle(JSON.parse(storedMoodle) as MoodleData);
      } catch {
        localStorage.removeItem('moodleData');
      }
    }

    void syncMoodleData();
  }, []);

  // Compute all available courses (exclusively from Moodle live courses)
  const allCourses: Course[] = useMemo(() => {
    const coursesMap = new Map<string, Course>();
    const defaultColors = ['#6c5ce7', '#ff8a65', '#20bfa9', '#3b82f6', '#ec4899', '#f59e0b'];

    if (moodle?.courses?.length) {
      moodle.courses.forEach((mc, index) => {
        const isTeacher =
          mc.role === 'editingteacher' ||
          mc.role === 'teacher' ||
          mc.role === 'manager' ||
          mc.role === 'coursecreator' ||
          mc.role === 'admin' ||
          Boolean(mc.isTeacher);
        coursesMap.set(mc.shortname.toLowerCase(), {
          id: mc.id,
          code: mc.shortname,
          name: mc.fullname,
          progress: mc.progress ?? 0,
          color: defaultColors[index % defaultColors.length],
          icon: mc.shortname.slice(0, 2).toUpperCase(),
          next: isTeacher ? 'Quản lý khóa học & Giảng dạy' : 'Xem nội dung khóa học Moodle',
          role: isTeacher ? (mc.role || 'editingteacher') : 'student',
          isTeacher,
        });
      });
    }

    return Array.from(coursesMap.values());
  }, [moodle]);

  // Determine current active course
  const activeCourse: Course = useMemo(() => {
    // Match by ID
    if (queryId) {
      const found = allCourses.find(c => String(c.id) === String(queryId));
      if (found) return found;
    }

    // Match by Code
    if (queryCode) {
      const decodedCode = decodeURIComponent(queryCode).toLowerCase().trim();
      const found = allCourses.find(c => c.code.toLowerCase() === decodedCode);
      if (found) return found;
    }

    // Match by Name
    if (queryName) {
      const decodedName = decodeURIComponent(queryName).toLowerCase().trim();
      const found = allCourses.find(
        c =>
          c.name.toLowerCase() === decodedName ||
          c.name.toLowerCase().includes(decodedName) ||
          decodedName.includes(c.name.toLowerCase())
      );
      if (found) return found;
    }

    // If queryCode or queryName was specified but not in allCourses, construct it dynamically
    if (queryCode || queryName) {
      const codeStr = queryCode ? decodeURIComponent(queryCode) : 'COURSE';
      const nameStr = queryName ? decodeURIComponent(queryName) : codeStr;
      return {
        id: queryId ? Number(queryId) : 999,
        code: codeStr,
        name: nameStr,
        progress: 0,
        color: '#6c5ce7',
        icon: codeStr.slice(0, 2).toUpperCase(),
        next: 'Khóa học Moodle',
      };
    }

    return (
      allCourses[0] || {
        id: 0,
        code: '',
        name: 'Chưa chọn khóa học',
        progress: 0,
        color: '#6c5ce7',
        icon: 'LM',
        next: '',
      }
    );
  }, [queryId, queryCode, queryName, allCourses]);

  const isTeacherCourse = Boolean(activeCourse.isTeacher);

  // Compute knowledge sources for the active course (from Moodle resources only)
  const courseSources: CourseSourceItem[] = useMemo(() => {
    const results: CourseSourceItem[] = [];

    // Extract matching resources from Moodle (Filtered: only Word, PDF, Web links)
    if (moodle?.resources?.length) {
      const moodleMatches = moodle.resources.filter(r => {
        // Exclude Announcements, Quizzes, Homework, Exams
        if (!isValidKnowledgeSource(r.type || '', r.name || r.module || '')) {
          return false;
        }

        const matchId = activeCourse.id && r.courseId && r.courseId === activeCourse.id;
        const matchCode =
          r.courseCode && r.courseCode.toLowerCase() === activeCourse.code.toLowerCase();
        const matchName =
          r.courseName &&
          (r.courseName.toLowerCase() === activeCourse.name.toLowerCase() ||
            r.courseName.toLowerCase().includes(activeCourse.name.toLowerCase()) ||
            activeCourse.name.toLowerCase().includes(r.courseName.toLowerCase()));
        return matchId || matchCode || matchName;
      });

      moodleMatches.forEach((mr, idx) => {
        results.push({
          id: `moodle-${mr.courseId ?? activeCourse.id}-${idx}`,
          name: mr.name || mr.module || 'Tài liệu Moodle',
          type: mr.type || 'FILE',
          sizeOrPages: mr.module ? `Moodle · ${mr.module}` : 'Tài liệu Moodle',
          url: mr.url || undefined,
          courseCode: activeCourse.code,
        });
      });
    }

    return results;
  }, [moodle, activeCourse]);

  // Compute direct LMS URL for the active course
  const lmsCourseUrl = useMemo(() => {
    let baseUrl = moodle?.moodleUrl;
    if (!baseUrl && moodle?.resources?.length) {
      const resWithUrl = moodle.resources.find(
        r => r.url && (r.url.startsWith('http://') || r.url.startsWith('https://'))
      );
      if (resWithUrl?.url) {
        try {
          baseUrl = new URL(resWithUrl.url).origin;
        } catch {}
      }
    }
    const cleanBase = (baseUrl || 'http://moodle.test').replace(/\/$/, '');
    if (activeCourse.id) {
      return `${cleanBase}/course/view.php?id=${activeCourse.id}`;
    }
    return cleanBase;
  }, [moodle, activeCourse.id]);

  const [sources, setSources] = useState<CourseSourceItem[]>(courseSources);
  const [checked, setChecked] = useState<boolean[]>(() => new Array(courseSources.length).fill(true));
  const [sourceQuery, setSourceQuery] = useState('');

  // Sync sources whenever active course or Moodle data updates
  useEffect(() => {
    setSources(courseSources);
    setChecked(new Array(courseSources.length).fill(true));
  }, [courseSources]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>([
    {
      role: 'ai',
      text: `Trợ lý Học tập AI môn ${activeCourse.name} đã sẵn sàng. Bạn có thể đặt câu hỏi hoặc yêu cầu phân tích, tóm tắt tài liệu.`,
      sources: [`${courseSources.length} tài liệu sẵn sàng`],
    },
  ]);

  // Reset chat when switching courses
  useEffect(() => {
    setChat([
      {
        role: 'ai',
        text: `Trợ lý Học tập AI môn ${activeCourse.name} đã sẵn sàng. Bạn có thể đặt câu hỏi hoặc yêu cầu phân tích, tóm tắt tài liệu.`,
        sources: [`${courseSources.length} tài liệu sẵn sàng`],
      },
    ]);
  }, [activeCourse.code, activeCourse.name, courseSources.length]);

  const [input, setInput] = useState(
    initialIntent.startsWith('__') || initialIntent.startsWith('Tiếp tục học') ? '' : initialIntent
  );
  const [loading, setLoading] = useState(false);
  const [tool, setTool] = useState(initialIntent === '__mindmap' ? 'Mindmap' : 'Chat');
  const [artifactsMap, setArtifactsMap] = useState<Record<string, GeneratedArtifact>>({});
  const [artifactLoading, setArtifactLoading] = useState(false);
  const [allowExternalSource, setAllowExternalSource] = useState<boolean>(false);
  const [answerStyle, setAnswerStyle] = useState<'concise' | 'detailed'>('concise');
  const [isSourcePanelCollapsed, setIsSourcePanelCollapsed] = useState<boolean>(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const selectedModel = 'auto';
  const [showGradeHistory, setShowGradeHistory] = useState<boolean>(false);
  const [teacherTab, setTeacherTab] = useState<'assistant' | 'grades' | 'quiz'>('assistant');
  const askedIntent = useRef(false);

  // Student Document & Resource Upload Modal State
  const [showUploadModal, setShowUploadModal] = useState<boolean>(false);
  const [uploadTab, setUploadTab] = useState<'file' | 'url' | 'text'>('file');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadFileTitle, setUploadFileTitle] = useState<string>('');
  const [uploadUrl, setUploadUrl] = useState<string>('');
  const [uploadUrlTitle, setUploadUrlTitle] = useState<string>('');
  const [uploadTextTitle, setUploadTextTitle] = useState<string>('');
  const [uploadTextContent, setUploadTextContent] = useState<string>('');
  const [uploadLoading, setUploadLoading] = useState<boolean>(false);
  const [uploadDragActive, setUploadDragActive] = useState<boolean>(false);
  const uploadFileInputRef = useRef<HTMLInputElement>(null);

  // Compute exam results for current active course ONLY
  const courseExamResults = useMemo(() => {
    if (!moodle?.examResults?.length) return [];
    return moodle.examResults.filter(
      r =>
        (activeCourse.id && String(r.courseId) === String(activeCourse.id)) ||
        (activeCourse.code && r.courseCode?.toLowerCase() === activeCourse.code.toLowerCase()) ||
        (activeCourse.name && r.courseName?.toLowerCase() === activeCourse.name.toLowerCase())
    );
  }, [moodle?.examResults, activeCourse.id, activeCourse.code, activeCourse.name]);

  // Handler to ask AI about an exam result without auto-sending
  const handleAskAiAboutGrade = (res: ExamResult) => {
    const prompt = res.feedback
      ? `Chào Gia sư AI, giảng viên vừa chấm bài thi "${res.name}" môn ${res.courseName} (${res.score}/${res.maxScore}đ) và nhận xét: "${res.feedback}". Hãy hướng dẫn chi tiết phương hướng ôn tập và giải quyết đúng những phần này!`
      : `Hãy hướng dẫn ôn tập nội dung bài thi "${res.name}" môn ${res.courseName} (Điểm: ${res.score}/${res.maxScore})`;
    setInput(prompt);
    setTool('Chat');
    setShowGradeHistory(false);
    notify(`Đã đưa bài "${res.name}" vào ô hỏi AI`);
  };

  // Close drawer on Escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showGradeHistory) {
        setShowGradeHistory(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showGradeHistory]);

  // Auto cleanup RAM vector cache on course unmount / exit
  useEffect(() => {
    const courseCode = activeCourse.code;
    return () => {
      try {
        if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
          const blob = new Blob([JSON.stringify({ courseCode })], { type: 'application/json' });
          navigator.sendBeacon('/api/documents/cache', blob);
        } else {
          fetch('/api/documents/cache', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ courseCode }),
            keepalive: true,
          }).catch(() => {});
        }
      } catch {}
    };
  }, [activeCourse.code]);

  const handleClearChat = () => {
    if (chat.length <= 1) return;
    const ok = window.confirm(
      'Bạn có chắc chắn muốn xóa toàn bộ lịch sử trò chuyện môn học này không? Hành động này sẽ làm mới toàn bộ đoạn hội thoại và giải phóng bộ nhớ RAM cache.'
    );
    if (!ok) return;

    fetch('/api/documents/cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ courseCode: activeCourse.code }),
    }).catch(() => {});

    setChat([
      {
        role: 'ai',
        text: `Trợ lý Học tập AI môn ${activeCourse.name} đã sẵn sàng. Bạn có thể đặt câu hỏi hoặc yêu cầu phân tích, tóm tắt tài liệu.`,
        sources: [`${courseSources.length} tài liệu sẵn sàng`],
      },
    ]);
    setInput('');
    notify('Đã xóa lịch sử trò chuyện & giải phóng bộ nhớ RAM');
  };

  // Stop AI response manually
  const stopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setLoading(false);
    setChat(v => [
      ...v,
      {
        role: 'ai',
        text: '*(Đã dừng câu trả lời theo yêu cầu)*',
        sources: [],
      },
    ]);
  };

  // Auto-collapse source panel on compact windows (e.g. tablet / split-screen)
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 880) {
      setIsSourcePanelCollapsed(true);
    }
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat, loading]);

  const selectedSourceNames = sources.filter((_, i) => checked[i]).map(s => s.name);

  // Submit question to LLM
  const ask = async (customPrompt?: string) => {
    if (loading) {
      stopGeneration();
      return;
    }

    const q = (customPrompt ?? input).trim();
    if (!q) return;

    const nextChat: ChatMessage[] = [...chat, { role: 'user', text: q }];
    setChat(nextChat);
    if (!customPrompt) setInput('');
    setLoading(true);

    const selectedSources = sources.filter((_, i) => checked[i]);
    const selectedSourceNames = selectedSources.map(s => s.name);

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      const res = await fetch('/api/tutor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          question: q,
          course: `${activeCourse.name} (${activeCourse.code})`,
          courseId: activeCourse.id,
          courseCode: activeCourse.code,
          sources: selectedSources,
          sourceNames: selectedSourceNames,
          allowExternalSource,
          answerStyle,
          model: selectedModel,
          history: chat.slice(1).map(c => ({ role: c.role, text: c.text })),
        }),
      });
      const data = (await res.json()) as TutorResponse;
      if (!res.ok) throw new Error(data.error);
      setChat(v => [
        ...v,
        {
          role: 'ai',
          text: data.answer ?? '',
          sources: data.sources ?? [],
        },
      ]);
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') {
        return;
      }
      setChat(v => [
        ...v,
        {
          role: 'ai',
          text: e instanceof Error ? e.message : 'Không thể kết nối gia sư lúc này.',
          sources: [],
        },
      ]);
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      setLoading(false);
    }
  };

  useEffect(() => {
    if (
      initialIntent &&
      !initialIntent.startsWith('__') &&
      !initialIntent.startsWith('Tiếp tục học') &&
      !initialIntent.startsWith('Giảng dạy') &&
      !askedIntent.current
    ) {
      askedIntent.current = true;
      if (!draftMode) {
        // Auto-send only when NOT in draft mode
        void ask(initialIntent);
      }
      // In draft mode the intent is already in the input state — user sends manually
    }
  }, [initialIntent, activeCourse.code]);

  // Tab switching simply activates the view without auto-fetching
  const openTool = (next: string) => {
    setTool(next);
  };

  // On-demand generation triggered only when user validates
  const generateToolArtifact = async (
    type: string,
    level: 'simple' | 'standard' | 'complex',
    topic: string,
    allowExternal?: boolean
  ) => {
    setArtifactLoading(true);
    const selectedSources = sources.filter((_, i) => checked[i]);
    const selectedSourceNames = selectedSources.map(s => s.name);
    const apiType = type === 'Tóm tắt' ? 'summary' : type === 'Mindmap' ? 'mindmap' : 'flashcards';
    const effectiveAllowExternal = allowExternal !== undefined ? allowExternal : allowExternalSource;

    try {
      const res = await fetch('/api/study-tools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: apiType,
          topic: topic || activeCourse.name,
          course: `${activeCourse.name} (${activeCourse.code})`,
          courseId: activeCourse.id,
          courseCode: activeCourse.code,
          sources: selectedSources,
          sourceNames: selectedSourceNames,
          level,
          allowExternalSource: effectiveAllowExternal,
          model: selectedModel,
        }),
      });
      const data = (await res.json()) as StudyToolResponse;
      if (!res.ok) throw new Error(data.error);

      setArtifactsMap(prev => ({
        ...prev,
        [type]: {
          data: data.data,
          level,
          topic: topic || activeCourse.name,
        },
      }));
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Không thể tạo học liệu.');
    } finally {
      setArtifactLoading(false);
    }
  };

  const resetToolArtifact = (type: string) => {
    setArtifactsMap(prev => {
      const updated = { ...prev };
      delete updated[type];
      return updated;
    });
  };

  const copyText = async (text: string) => {
    await navigator.clipboard.writeText(text);
    notify('Đã sao chép vào bộ nhớ tạm');
  };

  const handleAddSource = () => {
    setShowUploadModal(true);
  };

  const handleUploadSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
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
          formData.append('courseId', activeCourse.code);
          if (activeCourse.id) formData.append('moodleCourseId', String(activeCourse.id));
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
          courseCode: activeCourse.code,
        };

        setSources(v => [newItem, ...v]);
        setChecked(v => [true, ...v]);
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
        courseCode: activeCourse.code,
      };
      setSources(v => [newItem, ...v]);
      setChecked(v => [true, ...v]);
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
        courseCode: activeCourse.code,
      };
      setSources(v => [newItem, ...v]);
      setChecked(v => [true, ...v]);
      setShowUploadModal(false);
      setUploadTextTitle('');
      setUploadTextContent('');
      notify(`Đã lưu ghi chú: "${title}"`);
    }
  };

  const visibleSources = sources
    .map((item, i) => ({ item, i }))
    .filter(({ item }) => item.name.toLowerCase().includes(sourceQuery.toLowerCase()));

  const displayName = user?.fullname || moodle?.user?.name || 'Student';

  return (
    <main className="app-shell course-shell-layout">
      {/* Sidebar */}
      <aside className="sidebar">
        <Link href="/home" className="brand brand-button">
          <img className="brand-mark" src="/lms-assistant-icon.png" alt="" />
          <span>LMS Assistant</span>
        </Link>

        <nav aria-label="Điều hướng chính">
          <p className="nav-label">KHÔNG GIAN HỌC</p>

          <Link href="/home" className="nav-item">
            <span>⌂</span>
            <span>Tổng quan</span>
          </Link>

          <button className="nav-item active">
            <span>✦</span>
            <span>Gia sư AI</span>
          </button>

          <Link href="/home#courses" className="nav-item">
            <span>▤</span>
            <span>Khóa học</span>
          </Link>

          <Link href="/home#library" className="nav-item">
            <span>◫</span>
            <span>Thư viện</span>
          </Link>

          <Link href="/home#practice" className="nav-item">
            <span>◎</span>
            <span>Luyện tập</span>
          </Link>

          <p className="nav-label second">DÀNH CHO GIẢNG VIÊN</p>
          <Link href="/home?tab=teacher" className="nav-item" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <GraduationCap size={16} />
            <span>Góc Giảng Viên</span>
          </Link>

          <p className="nav-label second">KHÓA HỌC MOODLE</p>

          {allCourses.length === 0 ? (
            <div style={{ padding: '0.5rem 1rem', fontSize: '12px', color: '#94a3b8' }}>
              Chưa có khóa học nào
            </div>
          ) : (
            allCourses.map(c => (
              <button
                key={c.code}
                className={`nav-item course-link ${activeCourse.code.toLowerCase() === c.code.toLowerCase() ? 'active' : ''}`}
                onClick={() => {
                  router.replace(
                    `/course?code=${encodeURIComponent(c.code)}&name=${encodeURIComponent(c.name)}&id=${c.id ?? ''}`
                  );
                }}
              >
                <i style={{ background: c.color }}><BookOpen size={13} /></i>
                <span>
                  {c.name}
                  <small>{c.code}</small>
                </span>
              </button>
            ))
          )}
        </nav>

        <div className="sidebar-bottom">
          <div className="streak">
            <Flame size={18} style={{ color: '#f97316' }} />
            <div>
              <strong>7 ngày</strong>
              <small>Chuỗi học tập</small>
            </div>
            <b>+2</b>
          </div>

          <button className="profile" onClick={() => setProfile(true)}>
            <span className="profile-avatar">
              {user?.avatarUrl ? (
                <img src={user.avatarUrl} alt="" />
              ) : (
                displayName.slice(0, 2).toUpperCase()
              )}
            </span>
            <div>
              <strong>{displayName}</strong>
              <small>{user?.username || 'Sinh viên LMS'}</small>
            </div>
            <b>•••</b>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <section className="content course-content">
        <header className="topbar course-topbar">
          <Link href="/home" className="mobile-logo">
            n
          </Link>

          <div className="global-search">
            <label className="search">
              <Search size={14} style={{ opacity: 0.7 }} />
              <input
                ref={searchRef}
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Tìm khóa học, tài liệu..."
              />
              <kbd>⌘ K</kbd>
            </label>
          </div>

          <div className="top-actions">
            <button
              aria-label="Thông báo"
              className="icon-button"
              onClick={() => setNotifications(!notifications)}
            >
              <Sparkles size={16} /><i />
            </button>
            <button
              className={`sync ${syncing ? 'syncing' : ''}`}
              onClick={() => void syncMoodleData()}
              title="Đồng bộ lại tài liệu từ LMS"
            >
              <RotateCcw size={13} />
              <span>{syncing ? 'Đang tải…' : 'Đồng bộ LMS'}</span>
            </button>
            <Link href="/home" className="sync">
              <span>←</span>
              <span>Trang chủ</span>
            </Link>
          </div>

          {notifications && (
            <div className="notification-popover">
              <header>
                <strong>Thông báo</strong>
                <button onClick={() => setNotifications(false)}>×</button>
              </header>
              {(moodle?.deadlines ?? []).length > 0 ? (
                (moodle?.deadlines ?? []).slice(0, 4).map(d => {
                  const date = new Date(d.timestamp);
                  return (
                    <div key={d.id}>
                      <span className="purple"><FileText size={14} /></span>
                      <section>
                        <b>{d.name}</b>
                        <small>
                          {d.courseName} · hạn {date.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </small>
                      </section>
                    </div>
                  );
                })
              ) : (
                <div style={{ padding: '0.75rem 1rem', fontSize: '13px', color: '#94a3b8' }}>
                  Không có bài tập hoặc thông báo mới từ LMS.
                </div>
              )}
            </div>
          )}
        </header>

        {/* Course Detail Page Body */}
        {isTeacherCourse ? (
          <div className={`workspace-page course-workspace teacher-workspace fade-in ${teacherTab === 'assistant' ? 'assistant-tab-active' : ''}`}>
            <div
              className="workspace-title course-workspace-title"
              style={{ marginBottom: teacherTab === 'assistant' ? '0.75rem' : '1.5rem' }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <span className="eyebrow" style={{ margin: 0 }}>BÀN LÀM VIỆC GIẢNG VIÊN</span>
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: '12px',
                      background: 'rgba(124, 109, 242, 0.35)',
                      color: '#e0d8ff',
                      border: '1px solid rgba(124, 109, 242, 0.5)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    <GraduationCap size={12} />
                    <span>Vai trò: Giảng viên</span>
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <h1 style={{ margin: 0 }}>{activeCourse.name}</h1>
                  {activeCourse.id && (
                    <a
                      href={`${(moodle?.moodleUrl || 'http://moodle.test').replace(/\/$/, '')}/course/view.php?id=${activeCourse.id}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '3px 10px',
                        borderRadius: '20px',
                        background: 'rgba(124, 109, 242, 0.15)',
                        border: '1px solid rgba(124, 109, 242, 0.35)',
                        color: '#cfc8ff',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        textDecoration: 'none',
                        transition: 'all 0.15s ease',
                      }}
                      title="Mở khóa học này trực tiếp trên LMS"
                    >
                      <span>Xem trên Moodle</span>
                      <ExternalLink size={10} />
                    </a>
                  )}
                </div>
                <p>Mã môn: {activeCourse.code || 'LMS'}</p>
              </div>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                {allCourses.length > 0 && (
                  <select
                    value={activeCourse.code}
                    onChange={e => {
                      const targetCode = e.target.value;
                      const target = allCourses.find(c => c.code.toLowerCase() === targetCode.toLowerCase());
                      if (target) {
                        router.replace(
                          `/course?code=${encodeURIComponent(target.code)}&name=${encodeURIComponent(target.name)}&id=${target.id ?? ''}`
                        );
                      }
                    }}
                  >
                    {allCourses.map(c => (
                      <option key={c.code} value={c.code}>
                        {c.name} · {c.code}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            <TeacherPortal
              courses={allCourses}
              moodleUrl={moodle?.moodleUrl || 'http://moodle.test'}
              token={typeof window !== 'undefined' ? localStorage.getItem('moodleToken') || '' : ''}
              initialCourseId={activeCourse.id || activeCourse.code}
              hideHeader={true}
              sources={courseSources}
              initialTab="assistant"
              onTabChange={setTeacherTab}
            />
          </div>
        ) : (
          <div className="workspace-page course-workspace fade-in">
            <div className="workspace-title course-workspace-title">
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <span className="eyebrow" style={{ margin: 0 }}>KHÔNG GIAN MÔN HỌC &amp; GIA SƯ AI</span>
                  <span
                    style={{
                      fontSize: '11px',
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: '12px',
                      background: 'rgba(255, 255, 255, 0.1)',
                      color: '#94a3b8',
                      border: '1px solid rgba(255, 255, 255, 0.15)',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px',
                    }}
                  >
                    <BookOpen size={12} />
                    <span>Vai trò: Học viên</span>
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                  <h1 style={{ margin: 0 }}>{activeCourse.name}</h1>
                </div>
                <p>Mã môn: {activeCourse.code || 'Moodle'}</p>
              </div>

              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                {allCourses.length > 0 && (
                  <select
                    className="course-select-input"
                    value={activeCourse.code}
                    onChange={e => {
                      const target = allCourses.find(c => c.code === e.target.value);
                      if (target) {
                        router.replace(
                          `/course?code=${encodeURIComponent(target.code)}&name=${encodeURIComponent(target.name)}&id=${target.id ?? ''}`
                        );
                      }
                    }}
                  >
                    {allCourses.map(c => (
                      <option key={c.code} value={c.code}>
                        {c.name} ({c.code})
                      </option>
                    ))}
                    {!allCourses.some(c => c.code.toLowerCase() === activeCourse.code.toLowerCase()) && (
                      <option value={activeCourse.code}>
                        {activeCourse.name} ({activeCourse.code})
                      </option>
                    )}
                  </select>
                )}
              </div>
            </div>

          <div className={`tutor-layout ${isSourcePanelCollapsed ? 'source-collapsed' : ''}`}>
            {/* Source panel */}
            <aside className={`source-panel ${isSourcePanelCollapsed ? 'collapsed' : ''}`}>
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

              {visibleSources.length === 0 ? (
                <div className="empty-state" style={{ padding: '1rem', fontSize: '13px' }}>
                  Chưa có tài liệu nào trong khóa học này. Hãy nhấn "Thêm nguồn tài liệu" bên dưới hoặc đồng bộ từ Moodle.
                </div>
              ) : (
                visibleSources.map(({ item, i }) => {
                  const badge = getSourceBadge(item.type, item.name);
                  return (
                    <label className="source-item" key={`${item.name}-${i}`}>
                      <input
                        type="checkbox"
                        checked={checked[i] ?? true}
                        onChange={() =>
                          setChecked(v => v.map((x, n) => (n === i ? !x : x)))
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
                          {item.type === 'LINK' ? 'Liên kết Web' : item.type}
                        </small>
                      </span>
                    </label>
                  );
                })
              )}

              <button className="add-source" onClick={handleAddSource} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                <Plus size={15} />
                Thêm nguồn tài liệu (PDF, Word, Web)
              </button>

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
                    { id: 'Chat', label: 'Hỏi đáp', icon: <MessageSquare size={14} /> },
                    { id: 'Tóm tắt', label: 'Tóm tắt', icon: <FileText size={14} /> },
                    { id: 'Mindmap', label: 'Sơ đồ tư duy', icon: <GitFork size={14} /> },
                    { id: 'Flashcard', label: 'Thẻ ghi nhớ', icon: <Layers size={14} /> },
                    { id: 'Trắc nghiệm', label: 'Trắc nghiệm', icon: <HelpCircle size={14} /> },
                  ].map(tab => (
                    <button
                      key={tab.id}
                      className={tool === tab.id ? 'selected' : ''}
                      onClick={() => void openTool(tab.id)}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                    >
                      {tab.icon}
                      <span>{tab.label}</span>
                    </button>
                  ))}
                </div>

                <div className="tool-tabs-actions">
                  <button
                    type="button"
                    onClick={() => setShowGradeHistory(prev => !prev)}
                    className="grade-history-tab-btn"
                    title={showGradeHistory ? 'Ẩn bảng điểm (Esc)' : 'Xem kết quả học tập & nhận xét môn học'}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                  >
                    <BarChart3 size={14} />
                    <span>Bảng điểm</span>
                    {courseExamResults.length > 0 && (
                      <span
                        style={{
                          background: showGradeHistory ? '#7c6df2' : 'rgba(124, 109, 242, 0.3)',
                          color: '#fff',
                          fontSize: '10px',
                          fontWeight: 700,
                          padding: '1px 6px',
                          borderRadius: '999px',
                        }}
                      >
                        {courseExamResults.length}
                      </span>
                    )}
                  </button>

                  <a
                    href={lmsCourseUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="lms-redirect-btn"
                    title={`Mở trực tiếp khóa học ${activeCourse.name} trên hệ thống LMS`}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                  >
                    <GraduationCap size={15} />
                    <span>Mở LMS</span>
                    <ExternalLink size={12} style={{ opacity: 0.8 }} />
                  </a>
                </div>
              </div>

              {tool === 'Chat' ? (
                <>
                  <div className="messages">
                    {chat.map((m, i) => (
                      <div className={`message ${m.role}`} key={i}>
                        {m.role === 'ai' && (
                          <span className="bot-avatar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Sparkles size={16} />
                          </span>
                        )}
                        <div id={`chat-msg-${i}`} style={{ minWidth: 0, width: '100%' }}>
                          <MarkdownRenderer content={m.text} />
                          {(() => {
                            if (!m.sources || m.sources.length === 0) return null;
                            const externalSources = m.sources.filter(s => {
                              if (typeof s === 'object' && s !== null) return Boolean(s.isExternal);
                              const str = String(s);
                              return str.includes('➕') || str.toLowerCase().includes('mở rộng') || str.toLowerCase().includes('kiểm chứng') || str.toLowerCase().includes('external');
                            });

                            if (externalSources.length === 0) return null;

                            return (
                              <div className="citations">
                                {externalSources.map((s, idx) => {
                                  const isObj = typeof s === 'object' && s !== null;
                                  const rawName = isObj ? s.name : String(s);
                                  const cleanName = rawName.replace(/^(▤|➕|\+\s*|\[Mở rộng\])/, '').trim();
                                  const searchTarget = cleanName.replace(/^(Kiểm chứng|Nguồn mở rộng):\s*/i, '');
                                  const url = isObj && s.url ? s.url : `https://www.google.com/search?q=${encodeURIComponent(searchTarget)}`;

                                  return (
                                    <a
                                      key={`${cleanName}-${idx}`}
                                      className="citation-pill external-citation"
                                      href={url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      title="Nhấp để chuyển đến nguồn ngoài đối chiếu & kiểm chứng thông tin"
                                      style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                                    >
                                      <Globe size={12} style={{ color: '#38bdf8' }} />
                                      <span className="citation-text">{cleanName}</span>
                                      <ExternalLink size={10} style={{ opacity: 0.7 }} />
                                    </a>
                                  );
                                })}
                              </div>
                            );
                          })()}

                          {/* Copy button for AI message */}
                          {m.role === 'ai' && (
                            <div className="message-toolbar">
                              <button
                                type="button"
                                className={`copy-message-btn ${copiedIndex === i ? 'copied' : ''}`}
                                onClick={async () => {
                                  const el = document.getElementById(`chat-msg-${i}`);
                                  if (el) {
                                    await copyRichHtmlForWord(el, m.text);
                                  } else {
                                    await navigator.clipboard.writeText(m.text);
                                  }
                                  setCopiedIndex(i);
                                  notify('Đã sao chép nội dung câu trả lời');
                                  window.setTimeout(() => {
                                    setCopiedIndex(prev => (prev === i ? null : prev));
                                  }, 2000);
                                }}
                                title="Sao chép câu trả lời (hỗ trợ dán vào Word hoặc Markdown)"
                                style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                              >
                                {copiedIndex === i ? <Check size={13} /> : <Copy size={13} />}
                                <span>{copiedIndex === i ? 'Đã sao chép' : 'Sao chép'}</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                    {loading && (
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
                    <div ref={messagesEndRef} />
                  </div>

                  <div className="chat-compose">
                    <textarea
                      value={input}
                      onChange={e => setInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          void ask();
                        }
                      }}
                      placeholder={`Đặt câu hỏi về ${activeCourse.name} từ các tài liệu đã chọn...`}
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
                          disabled={chat.length <= 1 || loading}
                          title="Xóa toàn bộ lịch sử trò chuyện môn học"
                          style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                        >
                          <Trash2 size={13} />
                          <span>Xóa lịch sử</span>
                        </button>
                        {loading ? (
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
                            onClick={() => void ask()}
                            disabled={!input.trim()}
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
                  {tool === 'Trắc nghiệm' ? (
                    <QuizComponent
                      courseTitle={activeCourse.name}
                      courseCode={activeCourse.code}
                      courseId={activeCourse.id}
                      selectedSources={sources.filter((_, i) => checked[i])}
                      allowExternalSource={allowExternalSource}
                      selectedModel={selectedModel}
                      notify={notify}
                    />
                  ) : (
                    <StudyArtifact
                      type={tool}
                      artifact={artifactsMap[tool] ?? null}
                      courseTitle={activeCourse.name}
                      loading={artifactLoading}
                      selectedSourcesCount={selectedSourceNames.length}
                      onGenerate={(level, customTopic, ext) => void generateToolArtifact(tool, level, customTopic, ext)}
                      onReset={() => resetToolArtifact(tool)}
                      copyText={copyText}
                      notify={notify}
                    />
                  )}
                </div>
              )}
            </section>
          </div>
        </div>
      )}
      </section>

      {/* Toast */}
      {toast && <div className="toast" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}><CheckCircle2 size={15} /> {toast}</div>}

      {/* Profile Modal */}
      {profile && (
        <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && setProfile(false)}>
          <section className="modal">
            <header>
              <h2 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <User size={18} />
                Tài khoản học viên
              </h2>
              <button onClick={() => setProfile(false)} title="Đóng">
                <X size={16} />
              </button>
            </header>
            <div className="profile-modal">
              <span className="profile-avatar large">
                {user?.avatarUrl ? (
                  <img src={user.avatarUrl} alt="" />
                ) : (
                  displayName.slice(0, 2).toUpperCase()
                )}
              </span>
              <h3>{displayName}</h3>
              <p>{user?.username || 'Sinh viên'}</p>
              <div>
                <button
                  onClick={() => {
                    setProfile(false);
                    notify('Hồ sơ sử dụng thông tin tài khoản đăng nhập');
                  }}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                >
                  <ShieldCheck size={14} />
                  Thông tin tài khoản
                </button>
                <a href="/login" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <ExternalLink size={14} />
                  Đăng nhập lại
                </a>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* Grade History Popup Modal (Strictly for this course) */}
      {showGradeHistory && (
        <div
          className="grade-modal-overlay"
          onClick={() => setShowGradeHistory(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(5, 4, 15, 0.78)',
            backdropFilter: 'blur(8px)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1.25rem',
            animation: 'fadeIn 0.2s ease',
          }}
        >
          <div
            className="grade-modal-card"
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: '720px',
              maxHeight: '86vh',
              background: 'linear-gradient(180deg, #18152e 0%, #110e22 100%)',
              border: '1px solid rgba(124, 109, 242, 0.35)',
              borderRadius: '20px',
              boxShadow: '0 25px 80px rgba(0, 0, 0, 0.7), 0 0 40px rgba(124, 109, 242, 0.18)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: '1.2rem 1.5rem',
                borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: 'rgba(255, 255, 255, 0.02)',
                flexShrink: 0,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', minWidth: 0 }}>
                <div
                  style={{
                    width: '42px',
                    height: '42px',
                    borderRadius: '12px',
                    background: 'linear-gradient(135deg, #7c6df2, #5a49d7)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    boxShadow: '0 4px 14px rgba(124, 109, 242, 0.45)',
                    color: '#fff',
                  }}
                >
                  <BarChart3 size={20} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <h3 style={{ margin: 0, fontSize: '17px', fontWeight: 700, color: '#fff' }}>
                      Bảng điểm môn học
                    </h3>
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        padding: '2px 8px',
                        borderRadius: '999px',
                        background: 'rgba(124, 109, 242, 0.25)',
                        border: '1px solid rgba(124, 109, 242, 0.4)',
                        color: '#c4b5fd',
                      }}
                    >
                      {courseExamResults.length} đầu điểm
                    </span>
                  </div>
                  <p
                    style={{
                      margin: '3px 0 0',
                      fontSize: '12.5px',
                      color: '#94a3b8',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {activeCourse.name} {activeCourse.code ? `(${activeCourse.code})` : ''}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowGradeHistory(false)}
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '10px',
                  background: 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  color: '#cbd5e1',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '15px',
                  fontWeight: 600,
                  transition: 'all 0.2s ease',
                }}
                title="Đóng bảng điểm (Esc)"
              >
                <X size={15} />
              </button>
            </div>

            {/* Modal Body - Grades of THIS course only */}
            <div
              style={{
                padding: '1.25rem 1.5rem',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.9rem',
                flex: '1 1 auto',
                minHeight: 0,
              }}
            >
              {courseExamResults.length === 0 ? (
                <div
                  style={{
                    padding: '3.5rem 1rem',
                    textAlign: 'center',
                    color: '#94a3b8',
                  }}
                >
                  <FileText size={40} style={{ margin: '0 auto 0.85rem', color: '#64748b' }} />
                  <h4 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#f1f5f9' }}>
                    Chưa có đầu điểm nào cho môn học này
                  </h4>
                  <p style={{ margin: '6px 0 0', fontSize: '13px', color: '#64748b' }}>
                    Điểm các bài kiểm tra, bài thi và nhận xét trên LMS của môn {activeCourse.name} sẽ tự động hiển thị ở đây khi được cập nhật.
                  </p>
                </div>
              ) : (
                courseExamResults.map((res, idx) => (
                  <div
                    key={`${res.id}-${res.courseId}-${idx}`}
                    style={{
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      borderRadius: '14px',
                      padding: '1.1rem 1.25rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.85rem',
                    }}
                  >
                    {/* Row 1: Exam Title + Date */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: '0.5rem',
                      }}
                    >
                      <div>
                        <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#f8fafc' }}>
                          {res.name}
                        </h4>
                        <span style={{ fontSize: '11.5px', color: '#64748b', marginTop: '2px', display: 'inline-block' }}>
                          Loại bài: {res.itemModule || 'Kiểm tra'}
                        </span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                        <span style={{ fontSize: '11.5px', color: '#94a3b8', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                          <Calendar size={12} />
                          {res.gradedAt
                            ? new Date(res.gradedAt).toLocaleDateString('vi-VN', {
                                day: '2-digit',
                                month: '2-digit',
                                year: 'numeric',
                              })
                            : 'LMS'}
                        </span>
                        <span className={`result-status-tag ${res.passed ? 'pass' : 'fail'}`}>
                          {res.passed ? 'Đạt' : 'Cần cải thiện'} (
                          {res.percentage || `${Math.round((res.score / res.maxScore) * 100)}%`})
                        </span>
                      </div>
                    </div>

                    {/* Row 2: Score + Progress track */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: '12px', color: '#94a3b8' }}>Điểm số:</span>
                        <div>
                          <span
                            style={{
                              fontSize: '22px',
                              fontWeight: 800,
                              color: res.passed ? '#22c55e' : '#ef4444',
                            }}
                          >
                            {res.score}
                          </span>
                          <span style={{ fontSize: '13px', color: '#64748b' }}>/{res.maxScore}</span>
                        </div>
                      </div>

                      <div className="result-progress-track" style={{ height: '5px' }}>
                        <div
                          className={`result-progress-bar ${res.passed ? 'pass' : 'fail'}`}
                          style={{
                            width: `${Math.min(100, Math.max(0, (res.score / (res.maxScore || 10)) * 100))}%`,
                          }}
                        />
                      </div>
                    </div>

                    {/* Row 3: Teacher Feedback */}
                    {res.feedback ? (
                      <div
                        style={{
                          padding: '0.75rem 0.95rem',
                          borderRadius: '10px',
                          background:
                            'linear-gradient(135deg, rgba(124, 109, 242, 0.12), rgba(90, 73, 215, 0.08))',
                          border: '1px solid rgba(124, 109, 242, 0.28)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.3rem',
                        }}
                      >
                        <span
                          style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            color: '#c4b5fd',
                            textTransform: 'uppercase',
                            letterSpacing: '0.4px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '5px',
                          }}
                        >
                          <MessageSquare size={13} />
                          Nhận xét của Giảng viên:
                        </span>
                        <p
                          style={{
                            margin: 0,
                            fontSize: '13px',
                            color: '#f1f5f9',
                            fontStyle: 'italic',
                            lineHeight: '1.45',
                          }}
                        >
                          "{res.feedback}"
                        </p>
                      </div>
                    ) : (
                      <div
                        style={{
                          padding: '0.5rem 0.85rem',
                          borderRadius: '8px',
                          background: 'rgba(255, 255, 255, 0.02)',
                          border: '1px solid rgba(255, 255, 255, 0.06)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                          fontSize: '12px',
                          color: '#94a3b8',
                        }}
                      >
                        <span style={{ fontWeight: 600, color: '#a5b4fc' }}>Nhận xét:</span>
                        <span style={{ color: '#cbd5e1', fontWeight: 600 }}>Chưa có nhận xét riêng</span>
                      </div>
                    )}

                    {/* Row 4: Actions */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'flex-end',
                        gap: '8px',
                        marginTop: '2px',
                      }}
                    >
                      {res.url && (
                        <a
                          href={res.url}
                          target="_blank"
                          rel="noreferrer"
                          className="result-action-link"
                          style={{ fontSize: '11px', padding: '0.4rem 0.85rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                          title="Mở trực tiếp trên LMS"
                        >
                          <span>Mở trên LMS</span>
                          <ExternalLink size={11} />
                        </a>
                      )}
                      <button
                        type="button"
                        className="result-ai-btn"
                        style={{ fontSize: '11.5px', padding: '0.4rem 0.95rem', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                        onClick={() => handleAskAiAboutGrade(res)}
                        title="Hướng dẫn ôn tập phần kiến thức này"
                      >
                        <Sparkles size={13} />
                        <span>Hướng dẫn ôn tập</span>
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Modal Footer */}
            <div
              style={{
                padding: '0.9rem 1.5rem',
                borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: 'rgba(0, 0, 0, 0.25)',
                flexShrink: 0,
              }}
            >
              <span style={{ fontSize: '12px', color: '#94a3b8' }}>
                Tổng cộng {courseExamResults.length} đầu điểm môn học
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Student Document & Resource Upload Modal */}
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
                    Thêm Nguồn Tài Liệu Học Tập
                  </h3>
                  <p style={{ margin: '0.15rem 0 0', fontSize: '0.8rem', color: '#9894ad' }}>
                    Nạp tài liệu môn học để Gia sư AI và các công cụ học tập hỗ trợ phân tích
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
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', width: '100%', maxWidth: '380px', padding: '0.65rem 0.85rem', background: '#141220', borderRadius: '10px', border: '1px solid rgba(124, 109, 242, 0.35)' }} onClick={e => e.stopPropagation()}>
                          <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(124, 109, 242, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#a594fd', flexShrink: 0 }}>
                            <FileText size={18} />
                          </div>
                          <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                            <div style={{ fontSize: '0.88rem', fontWeight: 600, color: '#f3f2f8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
                            style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '4px', fontSize: '1rem' }}
                            title="Xóa tệp đã chọn"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <>
                          <div style={{ width: '44px', height: '44px', borderRadius: '50%', background: 'rgba(124, 109, 242, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#a594fd', marginBottom: '0.2rem' }}>
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
                        placeholder="VD: Giáo trình Chương 3 - Cấu trúc dữ liệu..."
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
                          placeholder="https://example.com/tai-lieu-hoc-tap"
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
                        placeholder="VD: Tài liệu tham khảo chính thức..."
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
                        placeholder="VD: Tóm tắt bài giảng tuần 4..."
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
                        placeholder="Dán nội dung bài học, định nghĩa, ghi chép cá nhân vào đây..."
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
    </main>
  );
}

/* ── Course Page Root with Suspense ──────────────────────── */

export default function CoursePage() {
  return (
    <Suspense
      fallback={
        <div className="workspace-page fade-in" style={{ padding: '2rem' }}>
          <div className="artifact artifact-loading">
            <span className="bot-avatar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Sparkles size={16} />
            </span>
            <h3>Đang tải không gian môn học…</h3>
          </div>
        </div>
      }
    >
      <CourseDetailContent />
    </Suspense>
  );
}
