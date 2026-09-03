'use client';

import type { CSSProperties } from 'react';
import { GraduationCap, BookOpen, Clock, Settings, Sparkles, ArrowRight } from 'lucide-react';
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
            <span className="course-card-badge" style={{ display: 'inline-flex', alignItems: 'center' }}>
              <Sparkles size={12} />
            </span>
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
              gap: '4px',
            }}
          >
            {isTeacher ? <GraduationCap size={12} /> : <BookOpen size={12} />}
            <span>{isTeacher ? 'Giảng dạy' : 'Học tập'}</span>
          </span>
        </div>

        <div className="course-body">
          <h3>{c.name}</h3>
          <p style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <Clock size={12} style={{ opacity: 0.7 }} />
            <span>{c.next || 'Xem nội dung khóa học'}</span>
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
                title="Mở Bảng điểm & Tạo đề Moodle XML"
                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '0 18px' }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <Settings size={13} />
                  <span>Điểm &amp; Quiz</span>
                </span>
                <ArrowRight size={13} />
              </button>
            ) : (
              <button
                className="liquid-glass-btn"
                onClick={onOpen}
                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', padding: '0 18px' }}
              >
                <span>Tiếp tục học</span>
                <ArrowRight size={13} />
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

export default CourseCard;
