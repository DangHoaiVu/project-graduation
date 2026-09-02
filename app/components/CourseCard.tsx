'use client';

import type { CSSProperties } from 'react';
import type { Course } from '@/app/types';

export interface CourseCardProps {
  course: Course;
  onOpen: () => void;
  onOpenTeacher?: (course: Course) => void;
}

export function CourseCard({ course: c, onOpen, onOpenTeacher }: CourseCardProps) {
  const isTeacher = Boolean(
    c.isTeacher ||
      c.role === 'editingteacher' ||
      c.role === 'teacher' ||
      c.role === 'manager' ||
      c.role === 'coursecreator'
  );

  return (
    <article
      className="course-card full-colored"
      style={
        {
          '--course-color': c.color,
          background: `linear-gradient(145deg, ${c.color}f0 0%, ${c.color}aa 32%, rgba(20, 18, 34, 0.96) 88%)`,
          borderColor: `${c.color}55`,
        } as CSSProperties
      }
    >
      <div className="course-card-inner">
        <div className="course-card-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <span className="course-card-badge">✦</span>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 600,
                color: 'rgba(255, 255, 255, 0.85)',
                letterSpacing: '0.5px',
              }}
            >
              MOODLE LMS
            </span>
          </div>

          {/* Role badge */}
          <span
            style={{
              fontSize: '10px',
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: '12px',
              background: isTeacher ? 'rgba(124, 109, 242, 0.35)' : 'rgba(255, 255, 255, 0.12)',
              color: isTeacher ? '#e0d8ff' : 'rgba(255, 255, 255, 0.8)',
              border: isTeacher ? '1px solid rgba(124, 109, 242, 0.6)' : '1px solid rgba(255, 255, 255, 0.1)',
              letterSpacing: '0.3px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '3px',
            }}
          >
            <span>{isTeacher ? '🎓' : '📚'}</span>
            <span>{isTeacher ? 'Giảng dạy' : 'Học tập'}</span>
          </span>
        </div>

        <div className="course-body">
          <h3>{c.name}</h3>
          <p>
            <span>◷</span> {c.next || 'Xem nội dung khóa học'}
          </p>

          <div style={{ marginTop: '0.75rem' }}>
            {isTeacher ? (
              <button
                className="liquid-glass-btn"
                onClick={e => {
                  e.stopPropagation();
                  if (onOpenTeacher) onOpenTeacher(c);
                  else onOpen();
                }}
                title="Mở Bảng điểm & Lò ấp Quiz Moodle"
              >
                <span>⚙️ Điểm &amp; Quiz</span>
                <b>→</b>
              </button>
            ) : (
              <button className="liquid-glass-btn" onClick={onOpen}>
                <span>Tiếp tục học</span>
                <b>→</b>
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

export default CourseCard;
