'use client';

import { Suspense, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  LayoutDashboard,
  Bot,
  BookOpen,
  FolderClosed,
  CheckSquare,
  GraduationCap,
  Flame,
  User,
  ExternalLink,
  RotateCcw,
  Sparkles,
  Calendar,
  Clock,
  TrendingUp,
  FileText,
  Search,
  BarChart3,
  Settings,
  ArrowRight,
} from 'lucide-react';
import {
  defaultQuiz,
  inspirationalQuotes,
  nav,
} from '@/app/mock-data';
import { CourseCard, TeacherPortal } from '@/app/components';
import type {
  Course,
  ErrorResponse,
  ExamResult,
  LibraryFile,
  LibraryResponse,
  MoodleData,
  MoodleUser,
  QuizQuestion,
  QuizResponse,
  UploadResponse,
} from '@/app/types';

export type { Course, LibraryFile, QuizQuestion };

const defaultColors = ['#6c5ce7', '#ff8a65', '#20bfa9', '#3b82f6', '#ec4899', '#f59e0b'];

/* ── Helpers ─────────────────────────────────────────────── */

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatCurrentDateTime(date: Date) {
  const days = ['CHỦ NHẬT', 'THỨ HAI', 'THỨ BA', 'THỨ TƯ', 'THỨ NĂM', 'THỨ SÁU', 'THỨ BẢY'];
  const dayName = days[date.getDay()];
  const day = date.getDate();
  const month = date.getMonth() + 1;
  const year = date.getFullYear();
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  const seconds = date.getSeconds().toString().padStart(2, '0');

  return `${dayName}, ${day} THÁNG ${month}, ${year} · ${hours}:${minutes}:${seconds}`;
}

function getGreeting(hour: number) {
  if (hour < 12) return 'Chào buổi sáng';
  if (hour < 18) return 'Chào buổi chiều';
  return 'Chào buổi tối';
}

/* ── Sidebar ─────────────────────────────────────────────── */

function Sidebar({
  active,
  setActive,
  onProfile,
  user,
  courses,
}: {
  active: string;
  setActive: (v: string) => void;
  onProfile: () => void;
  user?: MoodleUser | null;
  courses: Course[];
}) {
  const router = useRouter();
  const [storedUser, setStoredUser] = useState<MoodleUser | null>(user ?? null);

  useEffect(() => {
    const stored = localStorage.getItem('moodleUser');
    const token = localStorage.getItem('moodleToken');
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as MoodleUser;
        if (
          token &&
          (!parsed.avatarUrl ||
            parsed.avatarUrl.includes('/u/f1') ||
            parsed.avatarUrl.includes('/u/f2') ||
            !parsed.avatarUrl.startsWith('/api/moodle/avatar'))
        ) {
          parsed.avatarUrl = `/api/moodle/avatar?token=${encodeURIComponent(token)}&id=${parsed.id}`;
        }
        setStoredUser(parsed);
      } catch {
        localStorage.removeItem('moodleUser');
      }
    }
  }, []);

  const profileUser = storedUser ?? user;
  const displayName = profileUser?.fullname || 'Student';
  const isAdminOrTeacher = useMemo(() => {
    const uname = (profileUser?.username || '').toLowerCase();
    const fname = (profileUser?.fullname || '').toLowerCase();
    return (
      uname === 'admin' ||
      uname.includes('admin') ||
      uname.includes('teacher') ||
      fname.includes('admin') ||
      fname.includes('giảng viên') ||
      fname.includes('thầy') ||
      fname.includes('cô')
    );
  }, [profileUser]);

  return (
    <aside className="sidebar">
      <button className="brand brand-button" onClick={() => setActive('Tổng quan')}>
        <img className="brand-mark" src="/lms-assistant-icon.png" alt="" />
        <span>LMS Assistant</span>
      </button>

      <nav aria-label="Điều hướng chính">
        <p className="nav-label">KHÔNG GIAN HỌC</p>

        {[
          { label: 'Tổng quan', icon: <LayoutDashboard size={16} /> },
          { label: 'Gia sư AI', icon: <Bot size={16} /> },
          { label: 'Khóa học', icon: <BookOpen size={16} /> },
          { label: 'Thư viện', icon: <FolderClosed size={16} /> },
          { label: 'Luyện tập', icon: <CheckSquare size={16} /> },
        ].map(({ label, icon }) => (
          <button
            key={label}
            className={active === label ? 'nav-item active' : 'nav-item'}
            onClick={() => {
              if (label === 'Gia sư AI') {
                router.push('/course');
              } else {
                setActive(label);
              }
            }}
            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
          >
            <span>{icon}</span>
            <span>{label}</span>
          </button>
        ))}

        <p className="nav-label second">DÀNH CHO GIẢNG VIÊN</p>
        <button
          className={active === 'Giảng viên' ? 'nav-item active' : 'nav-item'}
          onClick={() => setActive('Giảng viên')}
          style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          <GraduationCap size={16} />
          <span>Góc Giảng Viên {isAdminOrTeacher && '(Admin)'}</span>
        </button>

        <p className="nav-label second">KHÓA HỌC MOODLE</p>

        {courses.length === 0 ? (
          <div style={{ padding: '0.5rem 1rem', fontSize: '12px', color: '#94a3b8' }}>
            Chưa có khóa học nào
          </div>
        ) : (
          courses.map(c => (
            <button
              key={c.code}
              className="nav-item course-link"
              onClick={() =>
                router.push(
                  `/course?code=${encodeURIComponent(c.code)}&name=${encodeURIComponent(c.name)}&id=${c.id ?? ''}`
                )
              }
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

        <button className="profile" onClick={onProfile}>
          <span className="profile-avatar">
            {profileUser?.avatarUrl ? (
              <img src={profileUser.avatarUrl} alt="" />
            ) : (
              displayName.slice(0, 2).toUpperCase()
            )}
          </span>
          <div>
            <strong>{displayName}</strong>
            <small>
              {isAdminOrTeacher ? 'Quản trị viên & Giảng viên' : profileUser?.username || 'Sinh viên LMS'}
            </small>
          </div>
          <b>•••</b>
        </button>
      </div>
    </aside>
  );
}

/* ── Dashboard ───────────────────────────────────────────── */

function Dashboard({
  navigate,
  openCalendar,
  openHomework,
  moodle,
  user,
  onSync,
  isAdminOrTeacher,
  onOpenTeacherCourse,
}: {
  navigate: (tab: string, intent?: string) => void;
  openCalendar: () => void;
  openHomework: (item: DeadlineItem) => void;
  moodle: MoodleData | null;
  user?: MoodleUser | null;
  onSync: () => void;
  isAdminOrTeacher?: boolean;
  onOpenTeacherCourse?: (course: Course) => void;
}) {
  const router = useRouter();
  const [profileUser, setProfileUser] = useState<MoodleUser | null>(user ?? null);
  const [quote, setQuote] = useState(inspirationalQuotes[0]);
  const [currentDateTime, setCurrentDateTime] = useState<string>('');
  const [courseFilter, setCourseFilter] = useState<'all' | 'teaching' | 'learning'>('all');

  useEffect(() => {
    const update = () => setCurrentDateTime(formatCurrentDateTime(new Date()));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem('moodleUser');
    if (stored) {
      try {
        setProfileUser(JSON.parse(stored) as MoodleUser);
      } catch {
        localStorage.removeItem('moodleUser');
      }
    }
  }, []);

  useEffect(() => {
    setQuote(inspirationalQuotes[Math.floor(Math.random() * inspirationalQuotes.length)]);
  }, []);

  const deadlines = useMemo(() => {
    const now = Date.now();
    return (moodle?.deadlines ?? []).filter(d => d.timestamp > now);
  }, [moodle?.deadlines]);

  const courses: Course[] =
    moodle?.courses?.length
      ? moodle.courses.map((course, index) => {
          const isTeacher =
            course.role === 'editingteacher' ||
            course.role === 'teacher' ||
            course.role === 'manager' ||
            course.role === 'coursecreator' ||
            course.role === 'admin' ||
            Boolean(course.isTeacher);
          return {
            id: course.id,
            code: course.shortname,
            name: course.fullname,
            progress: course.progress ?? 0,
            color: defaultColors[index % defaultColors.length],
            icon: course.shortname.slice(0, 2).toUpperCase(),
            next: isTeacher ? 'Quản lý khóa học & Giảng dạy' : 'Xem nội dung khóa học',
            role: course.role || (isTeacher ? 'editingteacher' : 'student'),
            isTeacher,
          };
        })
      : [];

  const teachingCourses = useMemo(() => courses.filter(c => c.isTeacher), [courses]);
  const learningCourses = useMemo(() => courses.filter(c => !c.isTeacher), [courses]);

  const filteredCourses = useMemo(() => {
    if (courseFilter === 'teaching') return teachingCourses;
    if (courseFilter === 'learning') return learningCourses;
    return courses;
  }, [courseFilter, courses, teachingCourses, learningCourses]);

  const latestResult = moodle?.latestResult ?? moodle?.examResults?.[0] ?? null;
  const [showGradeHistoryModal, setShowGradeHistoryModal] = useState(false);
  const [gradeModalFilter, setGradeModalFilter] = useState<string>('all');
  const allExamResults = useMemo(() => moodle?.examResults || [], [moodle?.examResults]);
  const displayedGrades = useMemo(() => {
    if (gradeModalFilter === 'all') return allExamResults;
    return allExamResults.filter(
      r => String(r.courseId) === gradeModalFilter || r.courseCode?.toLowerCase() === gradeModalFilter.toLowerCase()
    );
  }, [allExamResults, gradeModalFilter]);

  return (
    <div className="page fade-in">
      {/* Hero */}
      <section className="hero-row">
        <div>
          <p className="eyebrow" suppressHydrationWarning>
            {currentDateTime || 'THỨ NĂM, 27 THÁNG 8, 2026'}
          </p>
          <h1 suppressHydrationWarning>
            {getGreeting(new Date().getHours())}, {profileUser?.fullname || 'Học viên'}
          </h1>
          <p className="subtitle">
            &ldquo;{quote.text}&rdquo; <small>— {quote.author}</small>
          </p>
        </div>
        <div className="daily-goal" />
      </section>

      {/* Continue learning */}
      <section className="section-block">
        <div className="section-head" style={{ flexWrap: 'wrap', gap: '0.75rem' }}>
          <div>
            <h2>Khóa học của bạn</h2>
            <p>Phân loại theo vai trò giảng dạy hoặc theo học trên LMS</p>
          </div>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: '4px', background: 'rgba(255, 255, 255, 0.05)', padding: '3px', borderRadius: '10px' }}>
              <button
                type="button"
                onClick={() => setCourseFilter('all')}
                style={{
                  padding: '5px 10px',
                  borderRadius: '7px',
                  border: 'none',
                  background: courseFilter === 'all' ? 'rgba(124, 109, 242, 0.35)' : 'transparent',
                  color: courseFilter === 'all' ? '#fff' : '#94a3b8',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Tất cả ({courses.length})
              </button>
              {teachingCourses.length > 0 && (
                <button
                  type="button"
                  onClick={() => setCourseFilter('teaching')}
                  style={{
                    padding: '5px 10px',
                    borderRadius: '7px',
                    border: 'none',
                    background: courseFilter === 'teaching' ? 'rgba(124, 109, 242, 0.35)' : 'transparent',
                    color: courseFilter === 'teaching' ? '#c4b5fd' : '#94a3b8',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <GraduationCap size={13} />
                  <span>Đang dạy ({teachingCourses.length})</span>
                </button>
              )}
              {learningCourses.length > 0 && (
                <button
                  type="button"
                  onClick={() => setCourseFilter('learning')}
                  style={{
                    padding: '5px 10px',
                    borderRadius: '7px',
                    border: 'none',
                    background: courseFilter === 'learning' ? 'rgba(124, 109, 242, 0.35)' : 'transparent',
                    color: courseFilter === 'learning' ? '#fff' : '#94a3b8',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                >
                  <BookOpen size={13} />
                  <span>Đang học ({learningCourses.length})</span>
                </button>
              )}
            </div>

            <button onClick={() => navigate('Khóa học')}>
              Xem tất cả <span>→</span>
            </button>
          </div>
        </div>

        {filteredCourses.length === 0 ? (
          <div
            className="empty-state"
            style={{
              padding: '2.5rem',
              textAlign: 'center',
              background: 'rgba(255, 255, 255, 0.02)',
              borderRadius: '16px',
              border: '1px dashed rgba(255, 255, 255, 0.1)',
            }}
          >
            <p style={{ margin: '0 0 1rem', color: '#94a3b8', fontSize: '14px' }}>
              Không có khóa học nào trong danh mục này.
            </p>
            <button className="primary-action" onClick={onSync} style={{ margin: '0 auto' }}>
              ↻ Đồng bộ Moodle ngay
            </button>
          </div>
        ) : (
          <div className="course-grid">
            {filteredCourses.map(c => (
              <CourseCard
                course={c}
                key={c.id ?? c.code}
                onOpen={() =>
                  router.push(
                    `/course?code=${encodeURIComponent(c.code)}&name=${encodeURIComponent(c.name)}&id=${c.id ?? ''}&mode=${c.isTeacher ? 'teacher' : 'student'}`
                  )
                }
                onOpenTeacher={() =>
                  router.push(
                    `/course?code=${encodeURIComponent(c.code)}&name=${encodeURIComponent(c.name)}&id=${c.id ?? ''}&mode=teacher`
                  )
                }
              />
            ))}
          </div>
        )}
      </section>

      {/* Deadlines + Activity (Student only) */}
      {(!isAdminOrTeacher || courseFilter === 'learning') && (
        <section className="lower-grid">
          <article className="deadline-card">
            <div className="section-head compact">
              <div>
                <h2>Sắp đến hạn</h2>
                <p>Đừng bỏ lỡ các đầu việc quan trọng</p>
              </div>
              <button onClick={openCalendar}>Xem lịch</button>
            </div>
            <div className="deadline-list">
              {deadlines.length === 0 ? (
                <div className="empty-state" style={{ padding: '1.5rem 0', color: '#94a3b8', fontSize: '13px' }}>
                  Không có deadline nào sắp tới từ Moodle.
                </div>
              ) : (
                deadlines.slice(0, 3).map((d, i) => (
                  <Deadline key={d.id} item={d} urgent={i === 0} onOpen={openHomework} />
                ))
              )}
            </div>
          </article>

          <article className="activity-card latest-result-card">
            <div className="section-head compact">
              <div>
                <h2>Kết quả mới nhất</h2>
                <p>Điểm bài thi từ Moodle LMS</p>
              </div>
              {latestResult ? (
                <span className={`result-status-tag ${latestResult.passed ? 'pass' : 'fail'}`}>
                  {latestResult.passed ? '✓ Đạt' : '✕ Cần cải thiện'}
                </span>
              ) : (
                <button onClick={onSync} title="Đồng bộ lại từ Moodle">
                  Đồng bộ
                </button>
              )}
            </div>

            {latestResult ? (
              <>
                <div className="latest-result-body">
                  <div className="result-course-info">
                    <span className="result-course-code">{latestResult.courseCode || 'MOODLE'}</span>
                    <span className="result-course-title" title={latestResult.courseName}>
                      {latestResult.courseName}
                    </span>
                  </div>
                  <h3 className="result-exam-title" title={latestResult.name}>
                    {latestResult.name}
                  </h3>

                  <div className="result-score-container">
                    <div className="result-score-row">
                      <div className="result-score-group">
                        <span className={`result-score-val ${latestResult.passed ? 'pass' : 'fail'}`}>
                          {latestResult.score}
                        </span>
                        <span className="result-score-max">/{latestResult.maxScore}</span>
                      </div>
                      <span className={`result-status-tag ${latestResult.passed ? 'pass' : 'fail'}`}>
                        {latestResult.percentage || `${Math.round((latestResult.score / latestResult.maxScore) * 100)}%`}
                      </span>
                    </div>

                    <div className="result-progress-track">
                      <div
                        className={`result-progress-bar ${latestResult.passed ? 'pass' : 'fail'}`}
                        style={{
                          width: `${Math.min(100, Math.max(0, (latestResult.score / (latestResult.maxScore || 10)) * 100))}%`,
                        }}
                      />
                    </div>

                    {latestResult.feedback ? (
                      <div
                        style={{
                          marginTop: '0.85rem',
                          padding: '0.75rem 0.9rem',
                          borderRadius: '10px',
                          background: 'linear-gradient(135deg, rgba(124, 109, 242, 0.15), rgba(90, 73, 215, 0.1))',
                          border: '1px solid rgba(124, 109, 242, 0.35)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.35rem',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.35rem',
                            fontSize: '11px',
                            fontWeight: 700,
                            color: '#cfc8ff',
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px',
                          }}
                        >
                          <span>💬</span>
                          <span>Nhận xét của Giảng viên:</span>
                        </div>
                        <p style={{ margin: 0, fontSize: '13px', color: '#f3f2f8', fontStyle: 'italic', lineHeight: '1.45' }}>
                          "{latestResult.feedback}"
                        </p>
                      </div>
                    ) : (
                      <div
                        style={{
                          marginTop: '0.85rem',
                          padding: '0.55rem 0.85rem',
                          borderRadius: '8px',
                          background: 'rgba(255, 255, 255, 0.03)',
                          border: '1px solid rgba(255, 255, 255, 0.08)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.5rem',
                          fontSize: '12px',
                          color: '#94a3b8',
                        }}
                      >
                        <span style={{ fontWeight: 600, color: '#a5b4fc' }}>💬 Nhận xét:</span>
                        <span style={{ color: '#cbd5e1', fontWeight: 600 }}>-</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="result-footer">
                  <div className="result-footer-stat">
                    <span>◷</span>
                    <section>
                      <strong>
                        {latestResult.gradedAt
                          ? new Date(latestResult.gradedAt).toLocaleDateString('vi-VN', {
                              day: '2-digit',
                              month: '2-digit',
                              year: 'numeric',
                            })
                          : 'Vừa xong'}
                      </strong>
                      <small>Thời gian chấm</small>
                    </section>
                  </div>

                  <div className="result-actions">
                    <button
                      type="button"
                      className="result-action-link"
                      onClick={() => setShowGradeHistoryModal(true)}
                      style={{
                        cursor: 'pointer',
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        background: 'rgba(255, 255, 255, 0.06)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        color: '#cbd5e1',
                      }}
                      title="Xem lịch sử điểm và nhận xét tất cả các môn"
                    >
                      <BarChart3 size={14} />
                      <span>Lịch sử điểm</span>
                    </button>
                    <button
                      className="result-ai-btn"
                      onClick={() =>
                        router.push(
                          `/course?code=${encodeURIComponent(latestResult.courseCode || '')}&name=${encodeURIComponent(
                            latestResult.courseName
                          )}&id=${latestResult.courseId}&draft=1&intent=${encodeURIComponent(
                            latestResult.feedback
                              ? `Giảng viên vừa chấm bài thi "${latestResult.name}" (${latestResult.score}/${latestResult.maxScore}đ) và nhận xét: "${latestResult.feedback}". Hãy hướng dẫn chi tiết phương hướng ôn tập và giải quyết đúng những phần này!`
                              : `Hãy hướng dẫn ôn tập nội dung bài "${latestResult.name}" (Điểm: ${latestResult.score}/${latestResult.maxScore})`
                          )}`
                        )
                      }
                      title="Hỏi AI về kết quả và nhận xét này"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                    >
                      <Sparkles size={14} />
                      <span>Hỏi AI về kết quả này</span>
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="result-empty">
                <FileText size={26} style={{ color: '#64748b' }} />
                <p>Chưa có kết quả thi</p>
                <small>Làm bài kiểm tra trên LMS để hiển thị điểm tại đây</small>
              </div>
            )}
          </article>
        </section>
      )}

      {/* Grade History Modal */}
      {showGradeHistoryModal && (
        <div
          className="grade-history-modal-overlay"
          onClick={() => setShowGradeHistoryModal(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(5, 4, 15, 0.8)',
            backdropFilter: 'blur(10px)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '1.25rem',
            animation: 'fadeIn 0.2s ease',
          }}
        >
          <div
            className="grade-history-modal-content"
            onClick={e => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: '820px',
              maxHeight: '88vh',
              background: 'linear-gradient(180deg, #18152e 0%, #110e22 100%)',
              border: '1px solid rgba(124, 109, 242, 0.35)',
              borderRadius: '22px',
              boxShadow: '0 25px 80px rgba(0, 0, 0, 0.65), 0 0 40px rgba(124, 109, 242, 0.18)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {/* Header */}
            <div
              style={{
                padding: '1.25rem 1.6rem',
                borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: 'rgba(255, 255, 255, 0.02)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
                <div
                  style={{
                    width: '42px',
                    height: '42px',
                    borderRadius: '12px',
                    background: 'linear-gradient(135deg, #7c6df2, #5a49d7)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 4px 14px rgba(124, 109, 242, 0.4)',
                  }}
                >
                  <BarChart3 size={20} style={{ color: '#fff' }} />
                </div>
                <div>
                  <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#fff' }}>
                    Lịch sử điểm &amp; Nhận xét tất cả các môn
                  </h3>
                  <p style={{ margin: '2px 0 0', fontSize: '13px', color: '#94a3b8' }}>
                    Tổng hợp {allExamResults.length} đầu điểm từ LMS kèm nhận xét giảng viên
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGradeHistoryModal(false)}
                style={{
                  background: 'rgba(255, 255, 255, 0.06)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '10px',
                  width: '36px',
                  height: '36px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#cbd5e1',
                  cursor: 'pointer',
                  fontSize: '16px',
                  transition: 'all 0.2s',
                }}
                title="Đóng cửa sổ"
              >
                ✕
              </button>
            </div>

            {/* Filter Tabs by Course */}
            {courses.length > 0 && (
              <div
                style={{
                  padding: '0.75rem 1.6rem',
                  borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                  display: 'flex',
                  gap: '8px',
                  overflowX: 'auto',
                  background: 'rgba(0, 0, 0, 0.18)',
                }}
              >
                <button
                  type="button"
                  onClick={() => setGradeModalFilter('all')}
                  style={{
                    padding: '6px 14px',
                    borderRadius: '9px',
                    border: 'none',
                    background:
                      gradeModalFilter === 'all' ? 'rgba(124, 109, 242, 0.35)' : 'rgba(255, 255, 255, 0.04)',
                    color: gradeModalFilter === 'all' ? '#fff' : '#94a3b8',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    transition: 'all 0.2s',
                  }}
                >
                  Tất cả ({allExamResults.length})
                </button>
                {courses.map(c => {
                  const countForCourse = allExamResults.filter(
                    r => r.courseId === c.id || r.courseCode === c.code
                  ).length;
                  return (
                    <button
                      key={c.id ?? c.code}
                      type="button"
                      onClick={() => setGradeModalFilter(String(c.id ?? c.code))}
                      style={{
                        padding: '6px 14px',
                        borderRadius: '9px',
                        border: 'none',
                        background:
                          gradeModalFilter === String(c.id ?? c.code)
                            ? 'rgba(124, 109, 242, 0.35)'
                            : 'rgba(255, 255, 255, 0.04)',
                        color: gradeModalFilter === String(c.id ?? c.code) ? '#c4b5fd' : '#94a3b8',
                        fontSize: '12px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        whiteSpace: 'nowrap',
                        transition: 'all 0.2s',
                      }}
                    >
                      {c.code} ({countForCourse})
                    </button>
                  );
                })}
              </div>
            )}

            {/* Grade Items List */}
            <div
              style={{
                padding: '1.25rem 1.6rem',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '1rem',
              }}
            >
              {displayedGrades.length === 0 ? (
                <div
                  style={{
                    padding: '3rem 1.5rem',
                    textAlign: 'center',
                    color: '#94a3b8',
                    fontSize: '14px',
                  }}
                >
                  <FileText size={36} style={{ display: 'block', margin: '0 auto 0.6rem', color: '#64748b' }} />
                  <p style={{ margin: 0, fontWeight: 650, color: '#f1f5f9' }}>Chưa có đầu điểm nào cho môn học này</p>
                  <small style={{ color: '#64748b' }}>Các bài thi và bài kiểm tra trên LMS sẽ tự động hiển thị tại đây</small>
                </div>
              ) : (
                displayedGrades.map((res, idx) => (
                  <div
                    key={`${res.id}-${res.courseId}-${idx}`}
                    style={{
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      borderRadius: '16px',
                      padding: '1.1rem 1.25rem',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.85rem',
                      transition: 'all 0.2s ease',
                    }}
                  >
                    {/* Row 1: Course Info + Date */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: '0.5rem',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span className="result-course-code">{res.courseCode || 'MOODLE'}</span>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: '#cbd5e1' }}>
                          {res.courseName}
                        </span>
                      </div>
                      <span style={{ fontSize: '12px', color: '#64748b' }}>
                        📅{' '}
                        {res.gradedAt
                          ? new Date(res.gradedAt).toLocaleDateString('vi-VN', {
                              day: '2-digit',
                              month: '2-digit',
                              year: 'numeric',
                            })
                          : 'Moodle'}
                      </span>
                    </div>

                    {/* Row 2: Exam Name + Score */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: '0.75rem',
                      }}
                    >
                      <div>
                        <h4 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#f8fafc' }}>
                          {res.name}
                        </h4>
                        <small style={{ fontSize: '12px', color: '#64748b' }}>
                          Loại bài: {res.itemModule || 'Kiểm tra'}
                        </small>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <div style={{ textAlign: 'right' }}>
                          <span
                            style={{
                              fontSize: '20px',
                              fontWeight: 800,
                              color: res.passed ? '#22c55e' : '#ef4444',
                            }}
                          >
                            {res.score}
                          </span>
                          <span style={{ fontSize: '13px', color: '#94a3b8' }}>/{res.maxScore}</span>
                        </div>
                        <span className={`result-status-tag ${res.passed ? 'pass' : 'fail'}`}>
                          {res.passed ? '✓ Đạt' : '✕ Cần cải thiện'} (
                          {res.percentage || `${Math.round((res.score / res.maxScore) * 100)}%`})
                        </span>
                      </div>
                    </div>

                    {/* Progress track */}
                    <div className="result-progress-track" style={{ height: '5px' }}>
                      <div
                        className={`result-progress-bar ${res.passed ? 'pass' : 'fail'}`}
                        style={{
                          width: `${Math.min(100, Math.max(0, (res.score / (res.maxScore || 10)) * 100))}%`,
                        }}
                      />
                    </div>

                    {/* Feedback box */}
                    {res.feedback ? (
                      <div
                        style={{
                          padding: '0.65rem 0.85rem',
                          borderRadius: '10px',
                          background:
                            'linear-gradient(135deg, rgba(124, 109, 242, 0.12), rgba(90, 73, 215, 0.08))',
                          border: '1px solid rgba(124, 109, 242, 0.28)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.25rem',
                        }}
                      >
                        <span
                          style={{
                            fontSize: '11px',
                            fontWeight: 700,
                            color: '#c4b5fd',
                            textTransform: 'uppercase',
                            letterSpacing: '0.4px',
                          }}
                        >
                          💬 Nhận xét của Giảng viên:
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
                          padding: '0.45rem 0.75rem',
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
                        <span style={{ fontWeight: 600, color: '#a5b4fc' }}>💬 Nhận xét:</span>
                        <span style={{ color: '#cbd5e1', fontWeight: 600 }}>-</span>
                      </div>
                    )}

                    {/* Actions */}
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
                          style={{ fontSize: '12px', padding: '0.45rem 0.85rem' }}
                          title="Mở trực tiếp trên Moodle"
                        >
                          Moodle ↗
                        </a>
                      )}
                      <button
                        type="button"
                        className="result-ai-btn"
                        style={{ fontSize: '12px', padding: '0.45rem 0.95rem' }}
                        onClick={() => {
                          setShowGradeHistoryModal(false);
                          router.push(
                            `/course?code=${encodeURIComponent(res.courseCode || '')}&name=${encodeURIComponent(
                              res.courseName
                            )}&id=${res.courseId}&draft=1&intent=${encodeURIComponent(
                              res.feedback
                                ? `Chào Gia sư AI, giảng viên vừa chấm bài thi "${res.name}" môn ${res.courseName} (${res.score}/${res.maxScore}đ) và nhận xét: "${res.feedback}". Hãy hướng dẫn chi tiết phương hướng ôn tập và giải quyết đúng những phần này!`
                                : `Hãy hướng dẫn ôn tập nội dung bài thi "${res.name}" môn ${res.courseName} (Điểm: ${res.score}/${res.maxScore})`
                            )}`
                          );
                        }}
                        title="Thảo luận với Gia sư AI về bài thi này"
                      >
                        ✦ Hỏi AI về bài này
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


/* ── Deadline ────────────────────────────────────────────── */

type DeadlineItem = MoodleData['deadlines'][number];

function Deadline({
  item,
  urgent,
  onOpen,
}: {
  item: DeadlineItem;
  urgent?: boolean;
  onOpen?: (item: DeadlineItem) => void;
}) {
  const date = new Date(item.timestamp);
  return (
    <div
      className={onOpen ? 'deadline-item clickable' : 'deadline-item'}
      suppressHydrationWarning
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={() => onOpen?.(item)}
      onKeyDown={event => {
        if (onOpen && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          onOpen(item);
        }
      }}
    >
      <time suppressHydrationWarning>
        <b>{date.getDate().toString().padStart(2, '0')}</b>
        <small>THG {date.getMonth() + 1}</small>
      </time>
      <span className={`deadline-icon ${urgent ? 'purple' : 'green'}`}>
        {urgent ? '▤' : '✓'}
      </span>
      <section>
        <strong>{item.name}</strong>
        <p suppressHydrationWarning>
          {item.courseName} ·{' '}
          {date.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
        </p>
      </section>
      {urgent && <em>Gấp</em>}
    </div>
  );
}

function HomeworkModal({
  item,
  resources,
  onClose,
  onOpenCourse,
}: {
  item: DeadlineItem;
  resources: MoodleData['resources'];
  onClose: () => void;
  onOpenCourse: () => void;
}) {
  const date = new Date(item.timestamp);
  const matchingResources = resources.filter(resource =>
    resource.courseName?.toLowerCase() === item.courseName.toLowerCase(),
  );

  return (
    <Modal title="Chi tiết bài tập" onClose={onClose}>
      <div className="homework-modal">
        <div className="homework-heading">
          <span className="deadline-icon purple">▤</span>
          <div>
            <p className="eyebrow">BÀI TẬP MOODLE</p>
            {item.url ? (
              <a className="homework-title-link" href={item.url} target="_blank" rel="noreferrer">
                {item.name} <span aria-hidden="true">↗</span>
              </a>
            ) : (
              <h3>{item.name}</h3>
            )}
          </div>
        </div>
        <div className="homework-details">
          <div><span>Khóa học</span><strong>{item.courseName}</strong></div>
          <div><span>Hạn nộp</span><strong>{date.toLocaleString('vi-VN', { dateStyle: 'full', timeStyle: 'short' })}</strong></div>
        </div>
        <div className="homework-status"><i /> Chưa có trạng thái nộp bài từ Moodle</div>
        {matchingResources.length > 0 && (
          <div className="homework-resources">
            <span>Tài liệu liên quan</span>
            {matchingResources.slice(0, 3).map(resource => (
              <a key={resource.url} href={resource.url} target="_blank" rel="noreferrer">{resource.name} <b>↗</b></a>
            ))}
          </div>
        )}
        <div className="homework-actions">
          <button onClick={onClose}>Đóng</button>
          <button className="primary-action" onClick={onOpenCourse}>Mở khóa học <span>→</span></button>
        </div>
      </div>
    </Modal>
  );
}

/* ── Courses Page ────────────────────────────────────────── */

function Courses({
  moodle,
  onSync,
  openCourse,
  syncing,
  onOpenTeacherCourse,
}: {
  moodle: MoodleData | null;
  onSync: () => void;
  openCourse: (course: Course) => void;
  syncing: boolean;
  onOpenTeacherCourse?: (course: Course) => void;
}) {
  const router = useRouter();
  const [courseFilter, setCourseFilter] = useState<'all' | 'teaching' | 'learning'>('all');

  const data: Course[] = moodle?.courses?.length
    ? moodle.courses.map((m, i) => {
        const isTeacher =
          m.role === 'editingteacher' ||
          m.role === 'teacher' ||
          m.role === 'manager' ||
          m.role === 'coursecreator' ||
          m.role === 'admin' ||
          Boolean(m.isTeacher);
        return {
          id: m.id,
          code: m.shortname,
          name: m.fullname,
          progress: m.progress ?? 0,
          color: defaultColors[i % defaultColors.length],
          icon: m.shortname.slice(0, 2).toUpperCase(),
          next: isTeacher ? 'Quản lý khóa học & Giảng dạy' : 'Xem nội dung khóa học',
          role: m.role || (isTeacher ? 'editingteacher' : 'student'),
          isTeacher,
        };
      })
    : [];

  const teachingCourses = useMemo(() => data.filter(c => c.isTeacher), [data]);
  const learningCourses = useMemo(() => data.filter(c => !c.isTeacher), [data]);

  const filtered = useMemo(() => {
    if (courseFilter === 'teaching') return teachingCourses;
    if (courseFilter === 'learning') return learningCourses;
    return data;
  }, [courseFilter, data, teachingCourses, learningCourses]);

  return (
    <div className="workspace-page fade-in">
      <div className="workspace-title">
        <div>
          <p className="eyebrow">ĐỒNG BỘ TỪ MOODLE</p>
          <h1>Khóa học của bạn</h1>
          <p>
            {data.length} khóa học · Phân loại theo vai trò Giảng dạy ({teachingCourses.length}) và Học tập ({learningCourses.length})
          </p>
        </div>
        <button className={`primary-action ${syncing ? 'syncing' : ''}`} onClick={onSync}>
          ↻ {syncing ? 'Đang đồng bộ…' : 'Đồng bộ ngay'}
        </button>
      </div>

      {moodle?.message && <div className="integration-note">ⓘ {moodle.message}</div>}

      <div className="stats-strip">
        <div>
          <BookOpen size={16} />
          <b>{data.length}</b>
          <small>Tổng khóa học</small>
        </div>
        <div>
          <GraduationCap size={16} />
          <b>{teachingCourses.length}</b>
          <small>Đang giảng dạy</small>
        </div>
        <div>
          <BookOpen size={16} />
          <b>{learningCourses.length}</b>
          <small>Đang theo học</small>
        </div>
        <div>
          <CheckSquare size={16} />
          <b>{data.length > 0 ? Math.round(data.reduce((a, c) => a + c.progress, 0) / data.length) : 0}%</b>
          <small>Tiến độ trung bình</small>
        </div>
      </div>

      {/* Filter Tabs */}
      <div style={{ display: 'flex', gap: '8px', margin: '1.25rem 0 0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => setCourseFilter('all')}
          style={{
            padding: '6px 14px',
            borderRadius: '10px',
            border: 'none',
            background: courseFilter === 'all' ? 'rgba(124, 109, 242, 0.35)' : 'rgba(255, 255, 255, 0.05)',
            color: courseFilter === 'all' ? '#fff' : '#94a3b8',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Tất cả ({data.length})
        </button>
        {teachingCourses.length > 0 && (
          <button
            type="button"
            onClick={() => setCourseFilter('teaching')}
            style={{
              padding: '6px 14px',
              borderRadius: '10px',
              border: 'none',
              background: courseFilter === 'teaching' ? 'rgba(124, 109, 242, 0.35)' : 'rgba(255, 255, 255, 0.05)',
              color: courseFilter === 'teaching' ? '#c4b5fd' : '#94a3b8',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <GraduationCap size={13} />
            <span>Khóa giảng dạy ({teachingCourses.length})</span>
          </button>
        )}
        {learningCourses.length > 0 && (
          <button
            type="button"
            onClick={() => setCourseFilter('learning')}
            style={{
              padding: '6px 14px',
              borderRadius: '10px',
              border: 'none',
              background: courseFilter === 'learning' ? 'rgba(124, 109, 242, 0.35)' : 'rgba(255, 255, 255, 0.05)',
              color: courseFilter === 'learning' ? '#fff' : '#94a3b8',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <BookOpen size={13} />
            <span>Khóa theo học ({learningCourses.length})</span>
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <div
          className="empty-state"
          style={{
            padding: '3rem',
            textAlign: 'center',
            background: 'rgba(255, 255, 255, 0.02)',
            borderRadius: '16px',
            border: '1px dashed rgba(255, 255, 255, 0.1)',
            marginTop: '1.5rem',
          }}
        >
          <h3>Không có khóa học nào trong mục này</h3>
          <p style={{ color: '#94a3b8', margin: '0.5rem 0 1.5rem' }}>
            Hãy chọn mục &ldquo;Tất cả&rdquo; hoặc nhấn &ldquo;Đồng bộ ngay&rdquo; để làm mới danh sách.
          </p>
          <button className="primary-action" onClick={onSync}>
            <RotateCcw size={14} style={{ marginRight: '5px' }} /> Đồng bộ LMS ngay
          </button>
        </div>
      ) : (
        <div className="large-course-grid">
          {filtered.map((c) => {
            const courseResourcesCount = (moodle?.resources ?? []).filter(
              r =>
                (r.courseCode && r.courseCode.toLowerCase() === c.code.toLowerCase()) ||
                (r.courseName && r.courseName.toLowerCase() === c.name.toLowerCase()) ||
                (c.id && r.courseId === c.id)
            ).length;

            return (
              <article key={c.code} style={{ '--course': c.color } as CSSProperties}>
                <div className="large-course-cover">
                  <BookOpen size={20} />
                  <small>MOODLE LMS</small>
                </div>
                <div className="large-course-body">
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                    <label style={{ margin: 0 }}>{c.code}</label>
                    <span
                      style={{
                        fontSize: '11px',
                        fontWeight: 700,
                        padding: '2px 8px',
                        borderRadius: '12px',
                        background: c.isTeacher ? 'rgba(124, 109, 242, 0.3)' : 'rgba(255, 255, 255, 0.08)',
                        color: c.isTeacher ? '#e0d8ff' : '#94a3b8',
                        border: c.isTeacher ? '1px solid rgba(124, 109, 242, 0.5)' : '1px solid rgba(255, 255, 255, 0.1)',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      {c.isTeacher ? <GraduationCap size={11} /> : <BookOpen size={11} />}
                      <span>{c.isTeacher ? 'Giảng dạy' : 'Học viên'}</span>
                    </span>
                  </div>

                  <h2>{c.name}</h2>
                  <p>{c.isTeacher ? 'Khóa bạn phụ trách giảng dạy' : 'Môn học bạn đang tham gia'}</p>

                  <div className="course-meta">
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <FileText size={12} />
                      <span>{courseResourcesCount} tài liệu học</span>
                    </span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                      <Bot size={12} />
                      <span>Gia sư AI</span>
                    </span>
                  </div>
                  <div className="progress-label">
                    <span>Hoàn thành</span>
                    <strong>{c.progress}%</strong>
                  </div>
                  <div className="progress">
                    <i style={{ width: `${c.progress}%`, background: c.color }} />
                  </div>

                  <div style={{ marginTop: '0.75rem' }}>
                    {c.isTeacher ? (
                      <button
                        className="liquid-glass-btn"
                        onClick={() =>
                          router.push(
                            `/course?code=${encodeURIComponent(c.code)}&name=${encodeURIComponent(c.name)}&id=${c.id ?? ''}&mode=teacher`
                          )
                        }
                        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '0 18px' }}
                      >
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                          <Settings size={13} />
                          <span>Điểm &amp; Quiz Moodle</span>
                        </span>
                        <ArrowRight size={13} />
                      </button>
                    ) : (
                      <button
                        className="liquid-glass-btn"
                        onClick={() => openCourse(c)}
                        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '0 18px' }}
                      >
                        <span>Vào không gian học</span>
                        <ArrowRight size={13} />
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Library ─────────────────────────────────────────────── */

function Library({ notify }: { notify: (s: string) => void }) {
  const [files, setFiles] = useState<LibraryFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('Tất cả');
  const [storageUsed, setStorageUsed] = useState(0);
  const [menu, setMenu] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    try {
      const res = await fetch('/api/library');
      const data = (await res.json()) as LibraryResponse;
      if (res.ok && data.documents?.length) {
        const remote: LibraryFile[] = data.documents.map(d => ({
          id: d.id,
          name: d.name,
          size: formatBytes(d.size),
          sizeBytes: d.size,
          type: d.name.split('.').pop()?.toUpperCase() || d.contentType,
          source: d.source === 'personal' ? 'Tải lên cá nhân' : 'Moodle',
          status: d.status === 'indexed' ? 'Đã lập chỉ mục' : d.status,
        }));
        setFiles(remote);
        setStorageUsed(data.storageUsed ?? 0);
      }
    } catch {
      // empty
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    setUploading(true);
    for (const file of Array.from(list)) {
      const temp = `temp-${crypto.randomUUID()}`;
      const row: LibraryFile = {
        id: temp,
        name: file.name,
        size: formatBytes(file.size),
        sizeBytes: file.size,
        type: file.name.split('.').pop()?.toUpperCase() || 'FILE',
        source: 'Tải lên cá nhân',
        status: 'Đang tải lên',
      };
      setFiles(v => [row, ...v]);
      try {
        const form = new FormData();
        form.append('file', file);
        const res = await fetch('/api/library', { method: 'POST', body: form });
        const data = (await res.json()) as UploadResponse;
        if (!res.ok) throw new Error(data.error);
        setFiles(v => v.map(x => (x.id === temp ? { ...x, id: data.id, status: 'Đã lập chỉ mục' } : x)));
        setStorageUsed(v => v + file.size);
        notify(`Đã thêm ${file.name}`);
      } catch (e) {
        setFiles(v => v.filter(x => x.id !== temp));
        notify(e instanceof Error ? e.message : `Không thể tải ${file.name}`);
      }
    }
    setUploading(false);
    if (inputRef.current) inputRef.current.value = '';
  };

  const remove = async (file: LibraryFile) => {
    if (!file.id || file.id.startsWith('temp-')) return;
    if (!window.confirm(`Xóa "${file.name}" khỏi thư viện?`)) return;
    const res = await fetch(`/api/library?id=${encodeURIComponent(file.id)}`, { method: 'DELETE' });
    const data = (await res.json()) as ErrorResponse;
    if (!res.ok) {
      notify(data.error ?? 'Không thể xóa tài liệu');
      return;
    }
    setFiles(v => v.filter(x => x.id !== file.id));
    setStorageUsed(v => Math.max(0, v - (file.sizeBytes ?? 0)));
    setMenu(null);
    notify('Đã xóa tài liệu');
  };

  const shown = files.filter(
    f =>
      f.name.toLowerCase().includes(query.toLowerCase()) &&
      (filter === 'Tất cả' || (filter === 'Moodle' ? f.source.includes('Moodle') : f.source.includes('cá nhân'))),
  );

  const percent = Math.min(100, (storageUsed / (10 * 1024 * 1024 * 1024)) * 100);

  return (
    <div className="workspace-page fade-in">
      <div className="workspace-title">
        <div>
          <p className="eyebrow">KHO TRI THỨC CÁ NHÂN</p>
          <h1>Thư viện tài liệu</h1>
          <p>Tất cả tài liệu Moodle và nguồn riêng của bạn tại một nơi.</p>
        </div>
        <button className="primary-action" onClick={() => inputRef.current?.click()}>
          ＋ Tải tài liệu
        </button>
        <input
          ref={inputRef}
          hidden
          type="file"
          multiple
          accept=".pdf,.doc,.docx,.ppt,.pptx,.txt"
          onChange={e => void upload(e.target.files)}
        />
      </div>

      <button
        className={`dropzone ${uploading ? 'busy' : ''}`}
        onClick={() => inputRef.current?.click()}
        onDragOver={e => e.preventDefault()}
        onDrop={e => {
          e.preventDefault();
          void upload(e.dataTransfer.files);
        }}
      >
        <span>⇧</span>
        <strong>{uploading ? 'Đang mã hóa và tải lên…' : 'Kéo thả tài liệu vào đây'}</strong>
        <small>PDF, DOCX, PPTX hoặc TXT · tối đa 50 MB · lưu trữ riêng tư</small>
      </button>

      <div className="library-toolbar">
        <label>
          ⌕ <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Tìm trong thư viện..." />
        </label>
        <div>
          {['Tất cả', 'Moodle', 'Cá nhân'].map(x => (
            <button key={x} className={filter === x ? 'selected' : ''} onClick={() => setFilter(x)}>
              {x}
            </button>
          ))}
        </div>
      </div>

      <div className="file-table">
        <div className="table-head">
          <span>TÊN TÀI LIỆU</span>
          <span>NGUỒN</span>
          <span>TRẠNG THÁI</span>
          <span />
        </div>

        {loading ? (
          <div className="empty-state">Đang tải thư viện…</div>
        ) : shown.length === 0 ? (
          <div className="empty-state">Chưa có tài liệu nào trong thư viện. Nhấn &ldquo;＋ Tải tài liệu&rdquo; để thêm.</div>
        ) : (
          shown.map((f, i) => (
            <div className="file-row" key={`${f.id ?? f.name}-${i}`}>
              <span className={`doc-icon ${f.type.toLowerCase()}`}>{f.type.slice(0, 1)}</span>
              <section>
                <strong>{f.name}</strong>
                <small>
                  {f.type} · {f.size}
                </small>
              </section>
              <span>{f.source}</span>
              <span className={f.status.includes('Đã') ? 'ready' : 'processing'}>
                <i /> {f.status}
              </span>
              <div className="row-menu">
                <button onClick={() => setMenu(menu === (f.id ?? f.name) ? null : (f.id ?? f.name))}>•••</button>
                {menu === (f.id ?? f.name) && (
                  <div>
                    <button
                      disabled={!f.id}
                      onClick={() => f.id && window.open(`/api/library?id=${encodeURIComponent(f.id)}`, '_blank')}
                    >
                      ↓ Tải xuống
                    </button>
                    <button disabled={!f.id} className="danger" onClick={() => void remove(f)}>
                      × Xóa
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="storage-card">
        <div>
          <span>☁</span>
          <section>
            <strong>{formatBytes(storageUsed)} / 10 GB</strong>
            <small>Dung lượng kho cá nhân</small>
          </section>
        </div>
        <div className="storage-progress">
          <i style={{ width: `${Math.max(1, percent)}%` }} />
        </div>
        <button onClick={() => notify('Gói nâng cấp sẽ được mở trong phiên bản thương mại.')}>Nâng cấp</button>
      </div>
    </div>
  );
}

/* ── Practice / Quiz ─────────────────────────────────────── */

function Practice({ notify }: { notify: (s: string) => void }) {
  const [questions, setQuestions] = useState<QuizQuestion[]>(defaultQuiz);
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<number[]>([]);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [startedAt, setStartedAt] = useState(Date.now());
  const [saved, setSaved] = useState(false);

  const generate = async () => {
    setLoading(true);
    setDone(false);
    setStep(0);
    setAnswers([]);
    setSaved(false);
    setStartedAt(Date.now());
    try {
      const res = await fetch('/api/quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic: 'Kiến thức tổng hợp',
          count: 5,
        }),
      });
      const data = (await res.json()) as QuizResponse;
      if (!res.ok) throw new Error(data.error);
      if (data.questions) setQuestions(data.questions);
      notify(data.mode === 'ai' ? 'Đã tạo quiz mới bằng AI' : 'Đã tạo quiz luyện tập');
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Không thể tạo quiz');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void generate();
  }, []);

  const choose = (n: number) => {
    const a = [...answers];
    a[step] = n;
    setAnswers(a);
  };

  const score = answers.filter((a, i) => a === questions[i]?.answer).length;

  const finish = async () => {
    setDone(true);
    const duration = Math.round((Date.now() - startedAt) / 1000);
    try {
      const res = await fetch('/api/progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseCode: 'QUIZ',
          topic: 'Kiến thức tổng hợp',
          score,
          total: questions.length,
          durationSeconds: duration,
        }),
      });
      if (res.ok) setSaved(true);
    } catch {
      // offline progress
    }
  };

  const next = () => {
    if (step < questions.length - 1) setStep(step + 1);
    else void finish();
  };

  if (done) {
    return (
      <div className="workspace-page fade-in">
        <div className="result-card">
          <div className="result-ring">
            <span>
              {score}/{questions.length}
            </span>
          </div>
          <p className="eyebrow">HOÀN THÀNH BÀI LUYỆN</p>
          <h1>{score === questions.length ? 'Xuất sắc! 🎉' : 'Làm tốt lắm!'}</h1>
          <p>Bạn đã hoàn thành bài luyện tập câu hỏi trắc nghiệm.</p>

          <div className="result-stats">
            <div>
              <b>{Math.round((score / questions.length) * 100)}%</b>
              <small>Chính xác</small>
            </div>
            <div>
              <b>{Math.max(1, Math.round((Date.now() - startedAt) / 60000))} phút</b>
              <small>Thời gian</small>
            </div>
            <div>
              <b>+{score * 10}</b>
              <small>XP nhận được</small>
            </div>
          </div>

          <div className="save-result">
            {saved ? '✓ Kết quả đã lưu vào tiến độ' : 'Kết quả hiển thị cục bộ'}
          </div>
          <button onClick={() => void generate()}>Tạo bài mới</button>
        </div>
      </div>
    );
  }

  return (
    <div className="workspace-page fade-in">
      <div className="workspace-title">
        <div>
          <p className="eyebrow">QUIZ DO AI TẠO</p>
          <h1>Luyện tập trước kỳ thi</h1>
          <p>Câu hỏi trắc nghiệm tạo từ tài liệu học tập của bạn.</p>
        </div>
        <button className="primary-action" onClick={() => void generate()} disabled={loading}>
          ✦ {loading ? 'Đang tạo…' : 'Tạo bộ câu hỏi mới'}
        </button>
      </div>

      <div className="quiz-layout">
        <aside className="quiz-info">
          <div className="quiz-icon">◎</div>
          <h2>Bộ câu hỏi trắc nghiệm</h2>
          <p>{questions.length} câu · Khoảng 5 phút</p>
          <div className="quiz-progress">
            <i style={{ width: `${((step + 1) / questions.length) * 100}%` }} />
          </div>
          <small>
            Tiến độ {step + 1}/{questions.length}
          </small>
          <hr />
          <div className="practice-note">ⓘ Bài tự luyện không tính vào điểm Moodle.</div>
        </aside>

        <section className="question-card">
          {loading ? (
            <div className="artifact-loading">
              <span className="bot-avatar">✦</span>
              <h3>AI đang tạo câu hỏi…</h3>
            </div>
          ) : (
            <>
              <div className="question-count">
                <span>
                  CÂU {step + 1} / {questions.length}
                </span>
                <small>CHỌN MỘT ĐÁP ÁN</small>
              </div>
              <h2>{questions[step]?.q}</h2>

              <div className="choices">
                {questions[step]?.choices?.map((c, i) => (
                  <button key={c} className={answers[step] === i ? 'chosen' : ''} onClick={() => choose(i)}>
                    <b>{String.fromCharCode(65 + i)}</b>
                    <span>{c}</span>
                    <i>{answers[step] === i ? '✓' : ''}</i>
                  </button>
                ))}
              </div>

              {answers[step] !== undefined && questions[step]?.explanation && (
                <div className="answer-hint">ⓘ {questions[step].explanation}</div>
              )}

              <div className="question-actions">
                <button onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>
                  ← Quay lại
                </button>
                <button className="next" onClick={next} disabled={answers[step] === undefined}>
                  {step === questions.length - 1 ? 'Hoàn thành' : 'Câu tiếp theo'} →
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

/* ── Modal / Toast ───────────────────────────────────────── */

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <section className="modal">
        <header>
          <h2>{title}</h2>
          <button onClick={onClose}>×</button>
        </header>
        {children}
      </section>
    </div>
  );
}

function Toast({ text }: { text: string }) {
  return <div className="toast">✓ {text}</div>;
}

/* ── Home (Root Content) ─────────────────────────────────── */

function HomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get('tab');
  const courseIdParam = searchParams.get('courseId');

  const [active, setActive] = useState('Tổng quan');
  const [teacherCourseId, setTeacherCourseId] = useState<number | string | null>(courseIdParam || null);

  useEffect(() => {
    if (courseIdParam) {
      setTeacherCourseId(courseIdParam);
    }
  }, [courseIdParam]);

  useEffect(() => {
    if (tabParam) {
      const map: Record<string, string> = {
        courses: 'Khóa học',
        course: 'Khóa học',
        library: 'Thư viện',
        practice: 'Luyện tập',
        overview: 'Tổng quan',
        teacher: 'Giảng viên',
      };
      const resolved = map[tabParam.toLowerCase()] || tabParam;
      setActive(resolved);
    } else if (typeof window !== 'undefined' && window.location.hash) {
      const hash = window.location.hash.toLowerCase();
      if (hash.includes('course')) setActive('Khóa học');
      else if (hash.includes('library')) setActive('Thư viện');
      else if (hash.includes('practice')) setActive('Luyện tập');
      else if (hash.includes('teacher')) setActive('Giảng viên');
    }
  }, [tabParam]);

  const [moodle, setMoodle] = useState<MoodleData | null>(null);
  const [user, setUser] = useState<MoodleUser | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState('');
  const [search, setSearch] = useState('');
  const [notifications, setNotifications] = useState(false);
  const [profile, setProfile] = useState(false);
  const [calendar, setCalendar] = useState(false);
  const [selectedHomework, setSelectedHomework] = useState<DeadlineItem | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const notify = (text: string) => {
    setToast(text);
    window.setTimeout(() => setToast(''), 2600);
  };

  const navigate = (tab: string) => {
    setActive(tab);
    setSearch('');
  };

  const openHomework = (item: DeadlineItem) => {
    setCalendar(false);
    setSelectedHomework(item);
  };

  const sync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const token = localStorage.getItem('moodleToken');
      const res = await fetch('/api/moodle', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const data = (await res.json()) as MoodleData & ErrorResponse;
      if (!res.ok) throw new Error(data.error);
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
      notify(data.mode === 'live' ? 'Đồng bộ Moodle thành công' : 'Đã tải dữ liệu Moodle');
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Không thể đồng bộ Moodle');
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

    void sync();

    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  const moodleCourses: Course[] = useMemo(() => {
    if (!moodle?.courses?.length) return [];
    return moodle.courses.map((course, index) => {
      const isTeacher =
        course.role === 'editingteacher' ||
        course.role === 'teacher' ||
        course.role === 'manager' ||
        course.role === 'coursecreator' ||
        course.role === 'admin' ||
        Boolean(course.isTeacher);
      return {
        id: course.id,
        code: course.shortname,
        name: course.fullname,
        progress: course.progress ?? 0,
        color: defaultColors[index % defaultColors.length],
        icon: course.shortname.slice(0, 2).toUpperCase(),
        next: isTeacher ? 'Quản lý khóa học & Giảng dạy' : 'Xem nội dung khóa học',
        role: course.role || (isTeacher ? 'editingteacher' : 'student'),
        isTeacher,
      };
    });
  }, [moodle]);

  const handleOpenTeacherCourse = (course: Course) => {
    setTeacherCourseId(course.id ?? course.code);
    navigate('Giảng viên');
  };

  const searchResults = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.toLowerCase();
    const items = [
      ...moodleCourses.map(c => ({
        title: c.name,
        meta: `Khóa học Moodle · ${c.code}`,
        action: () =>
          router.push(
            `/course?code=${encodeURIComponent(c.code)}&name=${encodeURIComponent(c.name)}&id=${c.id ?? ''}`
          ),
      })),
      {
        title: 'Tạo quiz luyện tập',
        meta: 'Công cụ AI',
        action: () => navigate('Luyện tập'),
      },
      {
        title: 'Bàn làm việc Giảng viên',
        meta: 'Hút điểm & Lò ấp Moodle XML',
        action: () => navigate('Giảng viên'),
      },
      {
        title: 'Hỏi gia sư AI',
        meta: 'Gia sư bám nguồn',
        action: () => router.push('/course'),
      },
    ];
    return items.filter(x => (x.title + x.meta).toLowerCase().includes(q)).slice(0, 6);
  }, [search, moodleCourses, router]);

  const isAdminOrTeacher = useMemo(() => {
    const uname = (user?.username || '').toLowerCase();
    const fname = (user?.fullname || '').toLowerCase();
    return (
      uname === 'admin' ||
      uname.includes('admin') ||
      uname.includes('teacher') ||
      fname.includes('admin') ||
      fname.includes('giảng viên') ||
      fname.includes('thầy') ||
      fname.includes('cô')
    );
  }, [user]);

  return (
    <main className="app-shell">
      <Sidebar
        active={active}
        setActive={tab => navigate(tab)}
        onProfile={() => setProfile(true)}
        courses={moodleCourses}
      />

      <section className="content">
        {/* Top bar */}
        <header className="topbar">
          <button className="mobile-logo" onClick={() => navigate('Tổng quan')}>
            n
          </button>

          <div className="global-search">
            <label className="search">
              <span>⌕</span>
              <input
                ref={searchRef}
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Tìm khóa học Moodle..."
              />
              <kbd>⌘ K</kbd>
            </label>

            {search && (
              <div className="search-results">
                {searchResults.length ? (
                  searchResults.map(x => (
                    <button key={x.title} onClick={x.action}>
                      <span>⌕</span>
                      <div>
                        <strong>{x.title}</strong>
                        <small>{x.meta}</small>
                      </div>
                      <b>→</b>
                    </button>
                  ))
                ) : (
                  <p>Không tìm thấy kết quả phù hợp.</p>
                )}
              </div>
            )}
          </div>

          <div className="top-actions">
            <button
              aria-label="Thông báo"
              className="icon-button"
              onClick={() => setNotifications(!notifications)}
            >
              ♧<i />
            </button>
            <button className={`sync ${syncing ? 'syncing' : ''}`} onClick={() => void sync()}>
              <span>↻</span>
              {syncing ? 'Đang đồng bộ...' : 'Đồng bộ Moodle'}
            </button>
          </div>

          {notifications && (
            <div className="notification-popover">
              <header>
                <strong>Thông báo</strong>
                <button onClick={() => setNotifications(false)}>×</button>
              </header>
              {(() => {
                const activeDeadlines = (moodle?.deadlines ?? []).filter(d => d.timestamp > Date.now());
                if (activeDeadlines.length === 0) {
                  return (
                    <div style={{ padding: '0.75rem 1rem', fontSize: '13px', color: '#94a3b8' }}>
                      Không có bài tập hoặc thông báo mới từ Moodle.
                    </div>
                  );
                }
                return activeDeadlines.slice(0, 4).map(d => {
                  const date = new Date(d.timestamp);
                  return (
                    <div key={d.id}>
                      <span className="purple">▤</span>
                      <section>
                        <b>{d.name}</b>
                        <small>
                          {d.courseName} · hạn {date.toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </small>
                      </section>
                    </div>
                  );
                });
              })()}
            </div>
          )}
        </header>

        {/* Page content */}
        {active === 'Tổng quan' && (
          <Dashboard
            navigate={navigate}
            openCalendar={() => setCalendar(true)}
            openHomework={openHomework}
            moodle={moodle}
            onSync={() => void sync()}
            isAdminOrTeacher={isAdminOrTeacher}
            onOpenTeacherCourse={handleOpenTeacherCourse}
          />
        )}
        {active === 'Khóa học' && (
          <Courses
            moodle={moodle}
            onSync={() => void sync()}
            syncing={syncing}
            openCourse={c =>
              router.push(
                `/course?code=${encodeURIComponent(c.code)}&name=${encodeURIComponent(c.name)}&id=${c.id ?? ''}`
              )
            }
            onOpenTeacherCourse={handleOpenTeacherCourse}
          />
        )}
        {active === 'Thư viện' && <Library notify={notify} />}
        {active === 'Luyện tập' && <Practice notify={notify} />}
        {active === 'Giảng viên' && (
          <TeacherPortal
            courses={moodleCourses}
            moodleUrl={moodle?.moodleUrl || 'http://moodle.test'}
            token={typeof window !== 'undefined' ? localStorage.getItem('moodleToken') || '' : ''}
            initialCourseId={teacherCourseId || undefined}
            sources={moodle?.resources || []}
          />
        )}
      </section>

      {/* Overlays */}
      {toast && <Toast text={toast} />}

      {profile && (
        <Modal title="Tài khoản học viên" onClose={() => setProfile(false)}>
          <div className="profile-modal">
            <span className="profile-avatar large">
              {user?.avatarUrl ? (
                <img src={user.avatarUrl} alt="" />
              ) : (
                (user?.fullname || 'Minh Nguyễn').slice(0, 2).toUpperCase()
              )}
            </span>
            <h3>{user?.fullname || 'Minh Nguyễn'}</h3>
            <p>{user?.username || 'Sinh viên'}</p>
            <div>
              <button
                onClick={() => {
                  setProfile(false);
                  notify('Hồ sơ đang dùng dữ liệu tài khoản đăng nhập');
                }}
              >
                Thông tin tài khoản
              </button>
              <a href="/login">Đăng nhập lại</a>
            </div>
          </div>
        </Modal>
      )}

      {calendar && (
        <Modal title="Lịch học sắp tới" onClose={() => setCalendar(false)}>
          <div className="calendar-list">
            {(moodle?.deadlines ?? []).length ? (
              (moodle?.deadlines ?? []).map(d => <Deadline key={d.id} item={d} onOpen={openHomework} />)
            ) : (
              <div className="empty-state" style={{ padding: '2rem 0' }}>
                Không có lịch học hoặc deadline nào từ Moodle.
              </div>
            )}
          </div>
        </Modal>
      )}

      {selectedHomework && (
        <HomeworkModal
          item={selectedHomework}
          resources={moodle?.resources ?? []}
          onClose={() => setSelectedHomework(null)}
          onOpenCourse={() => {
            const course = moodleCourses.find(c => c.name.toLowerCase() === selectedHomework.courseName.toLowerCase());
            setSelectedHomework(null);
            router.push(
              `/course?code=${encodeURIComponent(course?.code ?? selectedHomework.courseName)}&name=${encodeURIComponent(selectedHomework.courseName)}&id=${course?.id ?? ''}`
            );
          }}
        />
      )}
    </main>
  );
}

/* ── Export Root with Suspense ───────────────────────────── */

export default function Home() {
  return (
    <Suspense
      fallback={
        <div className="page fade-in" style={{ padding: '2rem' }}>
          <div className="artifact artifact-loading">
            <span className="bot-avatar">✦</span>
            <h3>Đang tải không gian học tập…</h3>
          </div>
        </div>
      }
    >
      <HomeContent />
    </Suspense>
  );
}
