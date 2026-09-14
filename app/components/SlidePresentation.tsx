'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  FileDown,
  Globe,
  Copy,
  Printer,
  RotateCcw,
  Sparkles,
  Volume2,
  Plus,
  Trash2,
  Edit3,
  Check,
  Layout,
  Layers,
  FileText,
} from 'lucide-react';
import {
  SlideDeckData,
  SlideItem,
  exportSlidesToPptx,
  exportSlidesToHtml,
  formatSlideDeckText,
} from '@/lib/pptx-export';

interface SlidePresentationProps {
  initialDeck: SlideDeckData;
  courseTitle: string;
  levelLabel?: string;
  topic?: string;
  onReconfigure: () => void;
  notify: (msg: string) => void;
}

type SlideTheme = 'indigo' | 'slate' | 'ocean' | 'minimal';

export function SlidePresentation({
  initialDeck,
  courseTitle,
  levelLabel = 'Tiêu chuẩn',
  topic,
  onReconfigure,
  notify,
}: SlidePresentationProps) {
  const [deck, setDeck] = useState<SlideDeckData>(() => {
    if (initialDeck && initialDeck.slides && initialDeck.slides.length > 0) {
      return initialDeck;
    }
    return {
      title: initialDeck?.title || `Bài giảng: ${courseTitle}`,
      topic: topic || courseTitle,
      slides: [
        {
          slideNumber: 1,
          title: `Tổng quan môn ${courseTitle}`,
          subtitle: `Chuyên đề: ${topic || 'Nội dung cốt lõi'}`,
          bullets: ['Giới thiệu mục tiêu bài học', 'Các khái niệm nền tảng', 'Ứng dụng thực tế'],
          keyTakeaway: 'Nắm vững kiến thức trọng tâm để vận dụng vào bài tập và dự án.',
          notes: 'Mở đầu bài giảng bằng việc kết nối bài cũ và mục tiêu bài mới.',
        },
      ],
    };
  });

  const [currentIdx, setCurrentIdx] = useState(0);
  const [showNotes, setShowNotes] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [theme, setTheme] = useState<SlideTheme>('indigo');
  const [isEditing, setIsEditing] = useState(false);

  // Edit draft states
  const [editTitle, setEditTitle] = useState('');
  const [editSubtitle, setEditSubtitle] = useState('');
  const [editBulletsText, setEditBulletsText] = useState('');
  const [editTakeaway, setEditTakeaway] = useState('');
  const [editNotes, setEditNotes] = useState('');

  const containerRef = useRef<HTMLDivElement>(null);
  const slides = deck.slides || [];
  const currentSlide = slides[currentIdx] || slides[0];

  // Sync edit buffer when slide changes
  useEffect(() => {
    if (currentSlide) {
      setEditTitle(currentSlide.title || '');
      setEditSubtitle(currentSlide.subtitle || '');
      setEditBulletsText((currentSlide.bullets || []).join('\n'));
      setEditTakeaway(currentSlide.keyTakeaway || '');
      setEditNotes(currentSlide.notes || '');
      setIsEditing(false);
    }
  }, [currentIdx, currentSlide]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept when user is editing in an input/textarea
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        setCurrentIdx(prev => Math.min(prev + 1, slides.length - 1));
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        setCurrentIdx(prev => Math.max(prev - 1, 0));
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        setShowNotes(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [slides.length]);

  // Fullscreen change listener
  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      void containerRef.current.requestFullscreen();
    } else {
      void document.exitFullscreen();
    }
  };

  const handleExportPptx = async () => {
    try {
      notify('Đang khởi tạo tệp PowerPoint (.pptx)…');
      await exportSlidesToPptx(deck, courseTitle);
      notify('Đã tải tệp PowerPoint (.pptx) thành công');
    } catch (e) {
      console.error(e);
      notify('Không thể xuất tệp PowerPoint.');
    }
  };

  const handleExportHtml = () => {
    try {
      notify('Đang xuất bản trình chiếu HTML tự chạy…');
      exportSlidesToHtml(deck, courseTitle);
      notify('Đã tải slide HTML thành công');
    } catch {
      notify('Không thể xuất slide HTML.');
    }
  };

  const handleCopyMarkdown = async () => {
    const text = formatSlideDeckText(deck, courseTitle);
    await navigator.clipboard.writeText(text);
    notify('Đã sao chép toàn bộ nội dung slide vào bộ nhớ tạm');
  };

  const handleSaveEdit = () => {
    const updatedBullets = editBulletsText
      .split('\n')
      .map(s => s.replace(/^[•\-\*]\s*/, '').trim())
      .filter(Boolean);

    const updatedSlides = [...slides];
    updatedSlides[currentIdx] = {
      ...currentSlide,
      title: editTitle.trim() || `Slide ${currentIdx + 1}`,
      subtitle: editSubtitle.trim() || undefined,
      bullets: updatedBullets.length > 0 ? updatedBullets : ['Nội dung trang slide.'],
      keyTakeaway: editTakeaway.trim() || undefined,
      notes: editNotes.trim() || undefined,
    };

    setDeck(prev => ({ ...prev, slides: updatedSlides }));
    setIsEditing(false);
    notify('Đã cập nhật nội dung slide');
  };

  const handleAddSlide = () => {
    const newSlide: SlideItem = {
      slideNumber: slides.length + 1,
      title: 'Tiêu đề slide mới',
      subtitle: 'Mô tả ngắn bổ sung',
      bullets: ['Điểm nội dung thứ nhất', 'Điểm nội dung thứ hai'],
      keyTakeaway: 'Ý nghĩa bài học trọng tâm',
      notes: 'Lời giảng cho trang này...',
    };
    const nextSlides = [...slides, newSlide];
    setDeck(prev => ({ ...prev, slides: nextSlides }));
    setCurrentIdx(nextSlides.length - 1);
    notify('Đã thêm 1 trang slide mới');
  };

  const handleDeleteCurrentSlide = () => {
    if (slides.length <= 1) {
      notify('Không thể xóa slide duy nhất còn lại.');
      return;
    }
    const nextSlides = slides.filter((_, i) => i !== currentIdx);
    setDeck(prev => ({ ...prev, slides: nextSlides }));
    setCurrentIdx(prev => Math.min(prev, nextSlides.length - 1));
    notify('Đã xóa slide');
  };

  // Theme styling definitions
  const themeStyles = {
    indigo: {
      bg: 'linear-gradient(135deg, #0b0f19 0%, #1e1b4b 60%, #0f172a 100%)',
      accent: '#7c6df2',
      accentBg: 'rgba(124, 109, 242, 0.15)',
      titleColor: '#ffffff',
      textColor: '#e2e8f0',
      takeawayBg: 'rgba(124, 109, 242, 0.18)',
      border: '1px solid rgba(124, 109, 242, 0.35)',
    },
    slate: {
      bg: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
      accent: '#38bdf8',
      accentBg: 'rgba(56, 189, 248, 0.15)',
      titleColor: '#f8fafc',
      textColor: '#cbd5e1',
      takeawayBg: 'rgba(56, 189, 248, 0.15)',
      border: '1px solid rgba(56, 189, 248, 0.3)',
    },
    ocean: {
      bg: 'linear-gradient(135deg, #042f2e 0%, #0c4a6e 100%)',
      accent: '#2dd4bf',
      accentBg: 'rgba(45, 212, 191, 0.15)',
      titleColor: '#f0fdfa',
      textColor: '#ccfbf1',
      takeawayBg: 'rgba(45, 212, 191, 0.18)',
      border: '1px solid rgba(45, 212, 191, 0.35)',
    },
    minimal: {
      bg: 'linear-gradient(135deg, #18181b 0%, #27272a 100%)',
      accent: '#fbbf24',
      accentBg: 'rgba(251, 191, 36, 0.15)',
      titleColor: '#ffffff',
      textColor: '#d4d4d8',
      takeawayBg: 'rgba(251, 191, 36, 0.15)',
      border: '1px solid rgba(251, 191, 36, 0.3)',
    },
  }[theme];

  return (
    <div
      ref={containerRef}
      className={`artifact slide-presentation-root ${isFullscreen ? 'fullscreen-mode' : ''}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.85rem',
        width: '100%',
        color: '#f8fafc',
      }}
    >
      {/* Top Header Controls */}
      <div
        className="artifact-head"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '8px',
        }}
      >
        <div>
          <h2 style={{ margin: 0, fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Layout size={18} style={{ color: '#a594fd' }} />
            <span>{deck.title || `Slide bài giảng: ${courseTitle}`}</span>
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px' }}>
            <span className="level-badge">{levelLabel}</span>
            <span
              style={{
                fontSize: '11px',
                padding: '2px 8px',
                borderRadius: '10px',
                background: 'rgba(124, 109, 242, 0.2)',
                color: '#cfc8ff',
                fontWeight: 600,
              }}
            >
              {slides.length} trang slide
            </span>
            <small style={{ color: '#94a3b8' }}>Chủ đề: {topic || courseTitle}</small>
          </div>
        </div>

        {/* Action Button Group */}
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            type="button"
            className="reconfigure-btn"
            onClick={onReconfigure}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
            title="Tạo lại bộ slide theo chủ đề hoặc cấp độ khác"
          >
            <RotateCcw size={13} />
            <span>Cấu hình lại</span>
          </button>

          <button
            type="button"
            className="reconfigure-btn"
            onClick={handleCopyMarkdown}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
            title="Sao chép toàn bộ dàn ý slide dạng văn bản"
          >
            <Copy size={13} />
            <span>Sao chép</span>
          </button>

          <button
            type="button"
            className="reconfigure-btn"
            onClick={handleExportHtml}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              background: 'rgba(56, 189, 248, 0.15)',
              borderColor: 'rgba(56, 189, 248, 0.35)',
              color: '#38bdf8',
            }}
            title="Tải slide bài giảng dạng HTML độc lập, mở được offline trên mọi thiết bị"
          >
            <Globe size={13} />
            <span>Slide Web (.html)</span>
          </button>

          <button
            type="button"
            className="reconfigure-btn"
            onClick={() => void handleExportPptx()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              background: 'linear-gradient(135deg, rgba(124, 109, 242, 0.35), rgba(168, 85, 247, 0.35))',
              borderColor: '#7c6df2',
              color: '#ffffff',
              fontWeight: 700,
            }}
            title="Tải tệp trình chiếu PowerPoint chính thức (.pptx)"
          >
            <FileDown size={14} />
            <span>Tải PowerPoint (.pptx)</span>
          </button>

          <button
            type="button"
            className="reconfigure-btn"
            onClick={toggleFullscreen}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}
            title="Chế độ trình chiếu toàn màn hình (Phím tắt: F)"
          >
            {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
        </div>
      </div>

      {/* Main Slide Canvas (16:9 Aspect Ratio Container) */}
      <div
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: isFullscreen ? '16 / 9' : '16 / 9',
          minHeight: '340px',
          maxHeight: isFullscreen ? '90vh' : '480px',
          background: themeStyles.bg,
          border: themeStyles.border,
          borderRadius: '16px',
          padding: '2rem 2.5rem',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          boxShadow: '0 12px 40px rgba(0, 0, 0, 0.5)',
          overflow: 'hidden',
          transition: 'all 0.3s ease',
        }}
      >
        {/* Top Accent Stripe */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '4px',
            background: themeStyles.accent,
          }}
        />

        {/* Slide Header: Index Badge & Theme Selector */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', zIndex: 2 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              style={{
                fontSize: '11px',
                fontWeight: 700,
                padding: '2px 9px',
                borderRadius: '12px',
                background: themeStyles.accentBg,
                color: themeStyles.accent,
                border: `1px solid ${themeStyles.accent}55`,
                letterSpacing: '0.5px',
              }}
            >
              SLIDE {currentIdx + 1} / {slides.length}
            </span>
            <span style={{ fontSize: '11px', color: '#64748b' }}>{courseTitle}</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            {/* Theme switcher */}
            <div
              style={{
                display: 'inline-flex',
                background: 'rgba(0,0,0,0.3)',
                padding: '2px',
                borderRadius: '8px',
                border: '1px solid rgba(255,255,255,0.1)',
              }}
            >
              {(['indigo', 'slate', 'ocean', 'minimal'] as SlideTheme[]).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTheme(t)}
                  style={{
                    width: '14px',
                    height: '14px',
                    borderRadius: '4px',
                    margin: '2px',
                    border: theme === t ? '2px solid #ffffff' : 'none',
                    background:
                      t === 'indigo'
                        ? '#7c6df2'
                        : t === 'slate'
                        ? '#38bdf8'
                        : t === 'ocean'
                        ? '#2dd4bf'
                        : '#fbbf24',
                    cursor: 'pointer',
                    padding: 0,
                  }}
                  title={`Giao diện: ${t}`}
                />
              ))}
            </div>

            {/* Edit Slide Button */}
            <button
              type="button"
              onClick={() => setIsEditing(prev => !prev)}
              style={{
                background: isEditing ? themeStyles.accent : 'rgba(255,255,255,0.08)',
                color: isEditing ? '#ffffff' : '#cbd5e1',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: '6px',
                padding: '3px 8px',
                fontSize: '11px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                cursor: 'pointer',
              }}
              title="Chỉnh sửa nội dung slide này"
            >
              <Edit3 size={11} />
              <span>{isEditing ? 'Đóng sửa' : 'Sửa'}</span>
            </button>
          </div>
        </div>

        {/* Slide Content Area */}
        {isEditing ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              margin: '10px 0',
              overflowY: 'auto',
              flex: 1,
              paddingRight: '6px',
            }}
          >
            <input
              value={editTitle}
              onChange={e => setEditTitle(e.target.value)}
              placeholder="Tiêu đề slide..."
              style={{
                background: 'rgba(0,0,0,0.4)',
                border: '1px solid #7c6df2',
                borderRadius: '6px',
                padding: '6px 10px',
                color: '#fff',
                fontSize: '15px',
                fontWeight: 700,
              }}
            />
            <input
              value={editSubtitle}
              onChange={e => setEditSubtitle(e.target.value)}
              placeholder="Tiêu đề phụ / Ngữ cảnh..."
              style={{
                background: 'rgba(0,0,0,0.3)',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: '6px',
                padding: '4px 10px',
                color: '#cbd5e1',
                fontSize: '13px',
              }}
            />
            <textarea
              value={editBulletsText}
              onChange={e => setEditBulletsText(e.target.value)}
              placeholder="Nhập các ý chính (mỗi dòng một ý)..."
              rows={4}
              style={{
                background: 'rgba(0,0,0,0.3)',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: '6px',
                padding: '6px 10px',
                color: '#e2e8f0',
                fontSize: '13px',
                resize: 'none',
              }}
            />
            <input
              value={editTakeaway}
              onChange={e => setEditTakeaway(e.target.value)}
              placeholder="Điểm cốt lõi cần nhớ (Key Takeaway)..."
              style={{
                background: 'rgba(0,0,0,0.3)',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: '6px',
                padding: '4px 10px',
                color: '#a594fd',
                fontSize: '12px',
              }}
            />
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '4px' }}>
              <button
                type="button"
                onClick={handleSaveEdit}
                style={{
                  background: '#7c6df2',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '5px 12px',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                <Check size={13} />
                Lưu thay đổi
              </button>
            </div>
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              flex: 1,
              padding: '0.5rem 0',
              overflowY: 'auto',
            }}
          >
            {/* Title & Subtitle */}
            <div style={{ marginBottom: '1rem' }}>
              <h1
                style={{
                  margin: 0,
                  fontSize: isFullscreen ? '2.4rem' : currentIdx === 0 ? '1.75rem' : '1.5rem',
                  fontWeight: 800,
                  color: themeStyles.titleColor,
                  lineHeight: 1.25,
                }}
              >
                {currentSlide?.title || 'Tiêu đề slide'}
              </h1>
              {currentSlide?.subtitle && (
                <p
                  style={{
                    margin: '4px 0 0 0',
                    fontSize: isFullscreen ? '1.2rem' : '0.92rem',
                    color: '#94a3b8',
                    fontStyle: 'italic',
                  }}
                >
                  {currentSlide.subtitle}
                </p>
              )}
            </div>

            {/* Bullet Points */}
            <ul
              style={{
                listStyle: 'none',
                padding: 0,
                margin: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: isFullscreen ? '14px' : '9px',
              }}
            >
              {(currentSlide?.bullets || []).map((bullet, bIdx) => (
                <li
                  key={bIdx}
                  style={{
                    fontSize: isFullscreen ? '1.25rem' : '0.98rem',
                    lineHeight: 1.45,
                    color: themeStyles.textColor,
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: '10px',
                  }}
                >
                  <span
                    style={{
                      color: themeStyles.accent,
                      fontSize: '1.2rem',
                      lineHeight: '1',
                      marginTop: '1px',
                    }}
                  >
                    •
                  </span>
                  <span>{bullet}</span>
                </li>
              ))}
            </ul>

            {/* Key Takeaway Callout */}
            {currentSlide?.keyTakeaway && (
              <div
                style={{
                  marginTop: '1.1rem',
                  padding: '8px 14px',
                  borderRadius: '8px',
                  background: themeStyles.takeawayBg,
                  borderLeft: `3px solid ${themeStyles.accent}`,
                  fontSize: isFullscreen ? '1.1rem' : '0.86rem',
                  color: '#e2e8f0',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                }}
              >
                <Sparkles size={14} style={{ color: themeStyles.accent, flexShrink: 0 }} />
                <span>
                  <strong>Điểm cốt lõi:</strong> {currentSlide.keyTakeaway}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Slide Footer with Progress */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            paddingTop: '8px',
            fontSize: '11px',
            color: '#64748b',
          }}
        >
          <span>LMS Assistant AI · {deck.topic || courseTitle}</span>
          <span style={{ fontWeight: 600 }}>Trang {currentIdx + 1} / {slides.length}</span>
        </div>
      </div>

      {/* Slide Navigation & Control Bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: '#131122',
          border: '1px solid rgba(124, 109, 242, 0.25)',
          borderRadius: '12px',
          padding: '8px 16px',
          gap: '12px',
          flexWrap: 'wrap',
        }}
      >
        {/* Slide Management: Add / Delete */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            type="button"
            onClick={handleAddSlide}
            style={{
              background: 'rgba(124, 109, 242, 0.15)',
              color: '#cfc8ff',
              border: '1px solid rgba(124, 109, 242, 0.35)',
              borderRadius: '6px',
              padding: '4px 10px',
              fontSize: '12px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              cursor: 'pointer',
            }}
            title="Thêm một trang slide mới vào bài thuyết trình"
          >
            <Plus size={12} />
            <span>Thêm trang</span>
          </button>

          <button
            type="button"
            onClick={handleDeleteCurrentSlide}
            disabled={slides.length <= 1}
            style={{
              background: 'rgba(239, 68, 68, 0.12)',
              color: '#f87171',
              border: '1px solid rgba(239, 68, 68, 0.25)',
              borderRadius: '6px',
              padding: '4px 8px',
              fontSize: '12px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              cursor: slides.length <= 1 ? 'not-allowed' : 'pointer',
              opacity: slides.length <= 1 ? 0.4 : 1,
            }}
            title="Xóa trang slide hiện tại"
          >
            <Trash2 size={12} />
          </button>
        </div>

        {/* Center Navigation Buttons */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            onClick={() => setCurrentIdx(prev => Math.max(prev - 1, 0))}
            disabled={currentIdx === 0}
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              background: currentIdx === 0 ? 'rgba(255,255,255,0.04)' : 'rgba(124, 109, 242, 0.2)',
              border: '1px solid rgba(124, 109, 242, 0.35)',
              color: currentIdx === 0 ? '#475569' : '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: currentIdx === 0 ? 'not-allowed' : 'pointer',
            }}
            title="Slide trước (← hoặc PageUp)"
          >
            <ChevronLeft size={16} />
          </button>

          <span
            style={{
              fontSize: '13px',
              fontWeight: 700,
              minWidth: '70px',
              textAlign: 'center',
              color: '#f1f5f9',
            }}
          >
            {currentIdx + 1} / {slides.length}
          </span>

          <button
            type="button"
            onClick={() => setCurrentIdx(prev => Math.min(prev + 1, slides.length - 1))}
            disabled={currentIdx === slides.length - 1}
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              background:
                currentIdx === slides.length - 1 ? 'rgba(255,255,255,0.04)' : 'rgba(124, 109, 242, 0.2)',
              border: '1px solid rgba(124, 109, 242, 0.35)',
              color: currentIdx === slides.length - 1 ? '#475569' : '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: currentIdx === slides.length - 1 ? 'not-allowed' : 'pointer',
            }}
            title="Slide tiếp (→ hoặc Space hoặc PageDown)"
          >
            <ChevronRight size={16} />
          </button>
        </div>

        {/* Speaker Notes Toggle */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            type="button"
            onClick={() => setShowNotes(prev => !prev)}
            style={{
              background: showNotes ? 'rgba(124, 109, 242, 0.3)' : 'rgba(255,255,255,0.06)',
              color: showNotes ? '#e0d8ff' : '#94a3b8',
              border: '1px solid rgba(124, 109, 242, 0.3)',
              borderRadius: '6px',
              padding: '4px 10px',
              fontSize: '12px',
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              cursor: 'pointer',
            }}
            title="Bật/tắt khung hiển thị Lời giảng / Ghi chú thuyết trình (Phím tắt: N)"
          >
            <Volume2 size={13} style={{ color: showNotes ? '#a594fd' : undefined }} />
            <span>Lời giảng</span>
          </button>
        </div>
      </div>

      {/* Thumbnail Strip / Slide Picker */}
      <div
        style={{
          display: 'flex',
          gap: '8px',
          overflowX: 'auto',
          padding: '6px 2px',
          scrollbarWidth: 'thin',
        }}
      >
        {slides.map((s, idx) => (
          <button
            key={idx}
            type="button"
            onClick={() => setCurrentIdx(idx)}
            style={{
              flex: '0 0 110px',
              aspectRatio: '16 / 9',
              borderRadius: '8px',
              background: currentIdx === idx ? '#1e1b4b' : '#0f172a',
              border: currentIdx === idx ? '2px solid #7c6df2' : '1px solid rgba(255,255,255,0.1)',
              padding: '6px 8px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              cursor: 'pointer',
              textAlign: 'left',
              transition: 'all 0.15s ease',
              boxShadow: currentIdx === idx ? '0 0 12px rgba(124, 109, 242, 0.4)' : 'none',
            }}
            title={`Slide ${idx + 1}: ${s.title}`}
          >
            <div
              style={{
                fontSize: '9px',
                fontWeight: 700,
                color: currentIdx === idx ? '#a594fd' : '#94a3b8',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {idx + 1}. {s.title}
            </div>
            <div
              style={{
                fontSize: '8px',
                color: '#64748b',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {s.bullets?.[0] || 'Nội dung'}
            </div>
          </button>
        ))}
      </div>

      {/* Speaker Notes Accordion / Box */}
      {showNotes && (
        <div
          style={{
            background: 'rgba(20, 18, 35, 0.85)',
            border: '1px solid rgba(124, 109, 242, 0.3)',
            borderRadius: '10px',
            padding: '12px 16px',
            marginTop: '4px',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '6px',
            }}
          >
            <strong
              style={{
                fontSize: '12px',
                color: '#a594fd',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
            >
              <FileText size={13} />
              Ghi chú người thuyết trình / Lời giảng (Slide {currentIdx + 1}):
            </strong>
          </div>
          <p
            style={{
              margin: 0,
              fontSize: '13px',
              color: '#f1f5f9',
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
            }}
          >
            {currentSlide?.notes || 'Không có ghi chú riêng cho slide này.'}
          </p>
        </div>
      )}
    </div>
  );
}

