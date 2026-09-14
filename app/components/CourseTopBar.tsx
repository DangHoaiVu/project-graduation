'use client';

import React, { useEffect, useRef } from 'react';
import Link from 'next/link';
import { Bell, FileText, RotateCcw } from 'lucide-react';
import type { MoodleUser } from '@/app/types';

export interface CourseTopBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  searchRef?: React.RefObject<HTMLInputElement | null>;
  syncing?: boolean;
  onSync?: () => void;
  notifications: boolean;
  onToggleNotifications: () => void;
  onCloseNotifications: () => void;
  notificationPermission?: NotificationPermission;
  onRequestNotificationPermission?: () => Promise<void> | void;
  deadlines?: Array<{
    id: number | string;
    name: string;
    courseName: string;
    timestamp: number;
    url?: string;
  }>;
  user?: MoodleUser | null;
  displayName: string;
  onOpenProfile: () => void;
}

export function CourseTopBar({
  search,
  onSearchChange,
  searchRef,
  syncing = false,
  onSync,
  notifications,
  onToggleNotifications,
  onCloseNotifications,
  notificationPermission = 'default',
  onRequestNotificationPermission,
  deadlines = [],
  user,
  displayName,
  onOpenProfile,
}: CourseTopBarProps) {
  const notifRef = useRef<HTMLDivElement>(null);

  // Close notifications popover on click outside
  useEffect(() => {
    if (!notifications) return;

    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        onCloseNotifications();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [notifications, onCloseNotifications]);

  useEffect(() => {
    if (!notifications || notificationPermission !== 'default' || !onRequestNotificationPermission) return;

    void onRequestNotificationPermission();
    const retryWhenFocused = () => void onRequestNotificationPermission();
    window.addEventListener('focus', retryWhenFocused);
    return () => window.removeEventListener('focus', retryWhenFocused);
  }, [notifications, notificationPermission, onRequestNotificationPermission]);

  const initials = (displayName || 'User').slice(0, 2).toUpperCase();

  return (
    <header className="course-topbar-root" aria-label="Thanh điều hướng">
      {/* Left: Brand Logo & Title */}
      <div className="course-topbar-left">
        <Link href="/home" className="course-topbar-brand" title="Về trang chủ LMS Assistant">
          <img
            className="course-topbar-logo"
            src="/lms-assistant-icon.png"
            alt="LMS Assistant Logo"
          />
          <span className="course-topbar-title">LMS Assistant</span>
        </Link>
      </div>

      {/* Right: Actions, Notification Bell, User Avatar */}
      <div className="course-topbar-right">
        {/* Sync LMS data button (desktop) */}
        {onSync && (
          <button
            type="button"
            className={`course-topbar-btn desktop-only sync-btn ${syncing ? 'syncing' : ''}`}
            onClick={onSync}
            title="Đồng bộ lại tài liệu từ LMS"
          >
            <RotateCcw size={13} className={syncing ? 'animate-spin' : ''} />
            <span>{syncing ? 'Đang tải…' : 'Đồng bộ LMS'}</span>
          </button>
        )}

        {/* Notification Bell (Mobile & Desktop) */}
        <div className="course-topbar-notif-wrap" ref={notifRef}>
          <button
            type="button"
            aria-label="Thông báo"
            className={`course-topbar-icon-btn ${notifications ? 'active' : ''}`}
            onClick={() => {
              onToggleNotifications();
            }}
            title="Thông báo"
          >
            <Bell size={17} />
            {deadlines.length > 0 && <span className="course-topbar-unread-dot" />}
          </button>

          {/* Notification Popover */}
          {notifications && (
            <div className="course-topbar-popover" role="dialog" aria-modal="true">
              <header className="course-topbar-popover-header">
                <strong>Thông báo ({deadlines.length})</strong>
                <button
                  type="button"
                  onClick={onCloseNotifications}
                  aria-label="Đóng thông báo"
                  className="course-topbar-popover-close"
                >
                  ×
                </button>
              </header>

              <div className="course-topbar-popover-content">
                {notificationPermission !== 'granted' && (
                  <button
                    type="button"
                    className="notification-permission-button"
                    disabled={notificationPermission === 'denied'}
                    onClick={() => void onRequestNotificationPermission?.()}
                  >
                    {notificationPermission === 'denied' ? 'Thông báo đang bị chặn trong trình duyệt' : 'Bật thông báo nhắc hạn'}
                  </button>
                )}
                {deadlines.length > 0 ? (
                  deadlines.slice(0, 4).map(d => {
                    const date = new Date(d.timestamp);
                    return (
                      <div key={d.id} className="course-topbar-notif-item">
                        <span className="course-topbar-notif-badge">
                          <FileText size={14} />
                        </span>
                        <div className="course-topbar-notif-text">
                          <b>{d.name}</b>
                          <small>
                            {d.courseName} · hạn{' '}
                            {date.toLocaleString('vi-VN', {
                              day: '2-digit',
                              month: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </small>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="course-topbar-notif-empty">
                    Không có bài tập hoặc thông báo mới từ LMS.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Profile Avatar Button */}
        <button
          type="button"
          className="course-topbar-profile-btn"
          onClick={onOpenProfile}
          title={`Hồ sơ cá nhân: ${displayName}`}
          aria-label="Hồ sơ cá nhân"
        >
          <span className="course-topbar-avatar">
            {user?.avatarUrl ? (
              <img src={user.avatarUrl} alt={displayName} />
            ) : (
              <span className="course-topbar-avatar-initials">{initials}</span>
            )}
          </span>
          <div className="course-topbar-profile-text desktop-only">
            <strong>{displayName}</strong>
            <small>{user?.username || 'Sinh viên LMS'}</small>
          </div>
        </button>
      </div>
    </header>
  );
}

export default CourseTopBar;

