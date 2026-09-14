'use client';

import React from 'react';
import { BookOpen, GraduationCap } from 'lucide-react';
import type { Course } from '@/app/types';
import { CourseSwitcher } from './CourseSwitcher';

interface CourseHeaderProps {
  activeCourse: Course;
  allCourses: Course[];
  isTeacher?: boolean;
  onSelectCourse: (course: Course) => void;
  className?: string;
}

export function CourseHeader({
  activeCourse,
  allCourses,
  isTeacher = false,
  onSelectCourse,
  className = '',
}: CourseHeaderProps) {
  return (
    <header className={`course-header-root ${className}`}>
      {/* Top Metadata Row: Eyebrow on left, Role badge on right */}
      <div className="course-header-meta-row">
        <span className="course-header-eyebrow">
          {isTeacher ? 'BÀN LÀM VIỆC GIẢNG VIÊN' : 'KHÔNG GIAN MÔN HỌC & GIA SƯ AI'}
        </span>
        <span className={`course-header-role-badge ${isTeacher ? 'role-teacher' : 'role-student'}`}>
          {isTeacher ? <GraduationCap size={13} /> : <BookOpen size={13} />}
          <span>{isTeacher ? 'Vai trò: Giảng viên' : 'Vai trò: Học viên'}</span>
        </span>
      </div>

      {/* Main Row: Full-width Course Switcher */}
      <div className="course-header-main-row">
        <CourseSwitcher
          activeCourse={activeCourse}
          allCourses={allCourses}
          onSelectCourse={onSelectCourse}
          subtitle={`Mã môn: ${activeCourse.code || (isTeacher ? 'LMS' : 'Moodle')}`}
        />
      </div>
    </header>
  );
}
