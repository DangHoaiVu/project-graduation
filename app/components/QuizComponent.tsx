'use client';

import React, { useState } from 'react';
import {
  Sparkles,
  RotateCcw,
  Sliders,
  Printer,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Lightbulb,
  CheckSquare,
  Globe,
  Lock,
  BookOpen,
  HelpCircle,
  Award,
  BookX,
  Check,
  X,
} from 'lucide-react';
import { QuizQuestion } from '@/app/api/quiz/route';
import { MarkdownRenderer } from '@/app/components/MarkdownRenderer';

interface QuizComponentProps {
  courseTitle: string;
  courseCode?: string;
  courseId?: string | number;
  selectedSources: Array<{ name: string; url?: string; type?: string }>;
  allowExternalSource?: boolean;
  selectedModel?: string;
  notify: (msg: string) => void;
}

export function QuizComponent({
  courseTitle,
  courseCode,
  courseId,
  selectedSources,
  allowExternalSource: initialAllowExternal = false,
  selectedModel,
  notify,
}: QuizComponentProps) {
  // Config state
  const [questionCount, setQuestionCount] = useState<number>(10);
  const [difficulty, setDifficulty] = useState<'easy' | 'normal' | 'hard'>('normal');
  const [questionType, setQuestionType] = useState<'multiple_choice' | 'true_false' | 'multiple_select' | 'mixed'>('mixed');
  const [customTopic, setCustomTopic] = useState<string>('');
  const [allowExternal, setAllowExternal] = useState<boolean>(initialAllowExternal);

  // Execution state
  const [loading, setLoading] = useState<boolean>(false);
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[] | null>(null);
  const [currentIdx, setCurrentIdx] = useState<number>(0);
  const [userAnswers, setUserAnswers] = useState<Record<number, number | number[]>>({});
  const [submitted, setSubmitted] = useState<boolean>(false);

  // Clear previous course test questions when course changes
  React.useEffect(() => {
    setQuizQuestions(null);
    setUserAnswers({});
    setSubmitted(false);
    setCurrentIdx(0);
    setCustomTopic('');
  }, [courseTitle, courseCode, courseId]);

  // Generate Quiz API call
  const handleStartQuiz = async () => {
    // Validation
    const validatedCount = Math.min(50, Math.max(10, questionCount));
    setLoading(true);
    setUserAnswers({});
    setSubmitted(false);
    setCurrentIdx(0);

    try {
      notify(`Đang tạo ${validatedCount} câu hỏi trắc nghiệm độ khó ${difficulty === 'easy' ? 'Dễ' : difficulty === 'hard' ? 'Khó' : 'Trung bình'}…`);
      const res = await fetch('/api/quiz', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          count: validatedCount,
          difficulty,
          questionType,
          topic: customTopic.trim() || courseTitle,
          course: `${courseTitle} (${courseCode || ''})`,
          courseId,
          courseCode,
          sources: selectedSources,
          sourceNames: selectedSources.map(s => s.name),
          allowExternalSource: allowExternal,
          model: selectedModel,
        }),
      });

      const data = (await res.json()) as { error?: string; questions?: QuizQuestion[] };
      if (!res.ok) throw new Error(data.error || 'Không thể tạo đề trắc nghiệm.');

      if (Array.isArray(data.questions) && data.questions.length > 0) {
        setQuizQuestions(data.questions);
        notify(`Đã tạo thành công ${data.questions.length} câu hỏi!`);
      } else {
        throw new Error('Dữ liệu câu hỏi không hợp lệ.');
      }
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Có lỗi khi tạo câu hỏi trắc nghiệm.');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectAnswer = (qIdx: number, choiceIdx: number) => {
    if (submitted) return;
    const q = quizQuestions?.[qIdx];
    const isMulti = q?.type === 'multiple_select';

    if (isMulti) {
      setUserAnswers(prev => {
        const currentList = Array.isArray(prev[qIdx]) ? (prev[qIdx] as number[]) : [];
        const nextList = currentList.includes(choiceIdx)
          ? currentList.filter(i => i !== choiceIdx)
          : [...currentList, choiceIdx].sort((a, b) => a - b);
        return {
          ...prev,
          [qIdx]: nextList,
        };
      });
    } else {
      setUserAnswers(prev => ({
        ...prev,
        [qIdx]: choiceIdx,
      }));
    }
  };

  const isQuestionAnswered = (qIdx: number): boolean => {
    const ans = userAnswers[qIdx];
    if (ans === undefined) return false;
    if (Array.isArray(ans)) return ans.length > 0;
    return true;
  };

  const isAnswerCorrect = (q: QuizQuestion, qIdx: number): boolean => {
    const ans = userAnswers[qIdx];
    if (q.type === 'multiple_select') {
      const correctIndices = q.answers || (typeof q.answer === 'number' ? [q.answer] : []);
      const userSelected = Array.isArray(ans) ? ans : [];
      if (userSelected.length === 0 || userSelected.length !== correctIndices.length) return false;
      return userSelected.every(i => correctIndices.includes(i));
    }
    return ans === q.answer;
  };

  const handleSubmit = () => {
    const answeredCount = quizQuestions ? quizQuestions.filter((_, idx) => isQuestionAnswered(idx)).length : 0;
    const totalCount = quizQuestions?.length || 0;
    if (answeredCount < totalCount) {
      const confirmSubmit = window.confirm(
        `Bạn mới trả lời ${answeredCount}/${totalCount} câu hỏi. Bạn có chắc chắn muốn nộp bài?`
      );
      if (!confirmSubmit) return;
    }
    setSubmitted(true);
    notify('Đã nộp bài thi thành công!');
  };

  const handleRetake = () => {
    setUserAnswers({});
    setSubmitted(false);
    setCurrentIdx(0);
    notify('Đã làm mới bài kiểm tra');
  };

  const handleReconfigure = () => {
    setQuizQuestions(null);
    setUserAnswers({});
    setSubmitted(false);
    setCurrentIdx(0);
  };

  // Loading Screen
  if (loading) {
    return (
      <div className="artifact artifact-loading">
        <span className="bot-avatar">✦</span>
        <h3>Đang biên soạn {questionCount} câu hỏi trắc nghiệm {difficulty === 'easy' ? 'Cơ bản' : difficulty === 'hard' ? 'Nâng cao' : 'Tiêu chuẩn'} từ tài liệu…</h3>
        <div className="typing">
          <i />
          <i />
          <i />
        </div>
      </div>
    );
  }

  // 1. Configuration & Validation Panel (When no quiz is active)
  if (!quizQuestions) {
    return (
      <div className="tool-config-panel">
        <div className="tool-config-head">
          <div className="tool-icon-box">✓</div>
          <div>
            <h3>Tạo Đề Thi Trắc Nghiệm Tự Động</h3>
            <p>Trợ lý AI tổng hợp câu hỏi khảo sát kiến thức từ {selectedSources.length} nguồn tài liệu của môn {courseTitle}.</p>
          </div>
        </div>

        {/* Section 1: Number of Questions (10 - 50) */}
        <div>
          <div className="tool-section-label">
            <span>1. SỐ LƯỢNG CÂU HỎI (TỐI THIỂU 10 - TỐI ĐA 50)</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <input
              type="range"
              min={10}
              max={50}
              step={5}
              value={questionCount}
              onChange={e => setQuestionCount(Number(e.target.value))}
              style={{ flex: 1, minWidth: '180px', accentColor: '#8b5cf6' }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <input
                type="number"
                min={10}
                max={50}
                value={questionCount}
                onChange={e => {
                  const val = Number(e.target.value);
                  if (!isNaN(val)) setQuestionCount(val);
                }}
                className="tool-topic-input"
                style={{ width: '70px', textAlign: 'center', padding: '6px 8px' }}
              />
              <span style={{ fontSize: '13px', color: '#cbd5e1' }}>câu</span>
            </div>
          </div>
          {/* Quick presets */}
          <div style={{ display: 'flex', gap: '6px', marginTop: '8px' }}>
            {[10, 15, 20, 30, 50].map(cnt => (
              <button
                key={cnt}
                type="button"
                className={`reconfigure-btn ${questionCount === cnt ? 'active' : ''}`}
                style={{
                  padding: '4px 10px',
                  fontSize: '11.5px',
                  background: questionCount === cnt ? 'rgba(124, 58, 237, 0.35)' : undefined,
                  borderColor: questionCount === cnt ? '#8b5cf6' : undefined,
                }}
                onClick={() => setQuestionCount(cnt)}
              >
                {cnt} câu
              </button>
            ))}
          </div>
        </div>

        {/* Section 2: Difficulty Level */}
        <div>
          <div className="tool-section-label">2. ĐỘ KHÓ (DIFFICULTY)</div>
          <div className="level-selector">
            <button
              type="button"
              className={`level-card ${difficulty === 'easy' ? 'active' : ''}`}
              onClick={() => setDifficulty('easy')}
            >
              <strong style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <BookOpen size={14} />
                Cơ bản (Easy)
              </strong>
              <small>Nhận biết khái niệm, định nghĩa và nguyên lý trực tiếp</small>
            </button>

            <button
              type="button"
              className={`level-card ${difficulty === 'normal' ? 'active' : ''}`}
              onClick={() => setDifficulty('normal')}
            >
              <strong style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <HelpCircle size={14} />
                Trung bình (Normal)
              </strong>
              <small>Thông hiểu bản chất và vận dụng lý thuyết cân đối</small>
            </button>

            <button
              type="button"
              className={`level-card ${difficulty === 'hard' ? 'active' : ''}`}
              onClick={() => setDifficulty('hard')}
            >
              <strong style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Sparkles size={14} />
                Nâng cao (Hard)
              </strong>
              <small>Vận dụng cao, giải quyết tình huống thực tế và phân tích sâu</small>
            </button>
          </div>
        </div>

        {/* Section 3: Question Type */}
        <div>
          <div className="tool-section-label">3. ĐỊNH DẠNG CÂU HỎI (QUESTION TYPE)</div>
          <div className="level-selector" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
            <button
              type="button"
              className={`level-card ${questionType === 'multiple_choice' ? 'active' : ''}`}
              onClick={() => setQuestionType('multiple_choice')}
            >
              <strong style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <HelpCircle size={14} />
                4 Lựa chọn (A/B/C/D)
              </strong>
              <small>Trắc nghiệm tiêu chuẩn 1 đáp án đúng</small>
            </button>

            <button
              type="button"
              className={`level-card ${questionType === 'true_false' ? 'active' : ''}`}
              onClick={() => setQuestionType('true_false')}
            >
              <strong style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <BookX size={14} />
                Đúng / Sai (True/False)
              </strong>
              <small>Đánh giá tính chính xác của các mệnh đề khoa học</small>
            </button>

            <button
              type="button"
              className={`level-card ${questionType === 'multiple_select' ? 'active' : ''}`}
              onClick={() => setQuestionType('multiple_select')}
            >
              <strong style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <CheckSquare size={14} />
                Nhiều đáp án đúng
              </strong>
              <small>Câu hỏi có từ 2 đến 3 đáp án đúng đồng thời</small>
            </button>

            <button
              type="button"
              className={`level-card ${questionType === 'mixed' ? 'active' : ''}`}
              onClick={() => setQuestionType('mixed')}
            >
              <strong style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Sparkles size={14} />
                Tổng hợp (Mixed)
              </strong>
              <small>Phân bổ xen kẽ các dạng thức câu hỏi đa dạng</small>
            </button>
          </div>
        </div>

        {/* Section 4: Focus Topic */}
        <div>
          <div className="tool-section-label">4. CHỦ ĐỀ / PHẠM VI TRỌNG TÂM (TÙY CHỌN)</div>
          <input
            className="tool-topic-input"
            value={customTopic}
            onChange={e => setCustomTopic(e.target.value)}
            placeholder={`Để trống để ra đề toàn bộ môn ${courseTitle}, hoặc nhập chuyên đề...`}
          />
        </div>

        {/* Section 5: External Knowledge Option */}
        <div>
          <div className="tool-section-label">5. PHẠM VI NỘI DUNG RA ĐỀ</div>
          <button
            type="button"
            className={`level-card ${allowExternal ? 'active' : ''}`}
            onClick={() => setAllowExternal(prev => !prev)}
            style={{ width: '100%' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <strong style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                {allowExternal ? <Globe size={15} /> : <Lock size={15} />}
                {allowExternal ? 'Cho phép câu hỏi liên hệ thực tiễn ngoài giáo trình' : 'Bám sát nghiêm ngặt tài liệu được cung cấp'}
              </strong>
              <span className="level-badge" style={{ background: allowExternal ? 'rgba(56, 189, 248, 0.2)' : undefined }}>
                {allowExternal ? 'BẬT' : 'TẮT'}
              </span>
            </div>
            <small>
              {allowExternal
                ? 'Đề thi tích hợp các câu hỏi tình huống thực tế trong ngành, ứng dụng hiện đại và câu hỏi tư duy mở rộng.'
                : 'Đề thi tập trung hoàn toàn vào nội dung văn bản tài liệu môn học đã chọn.'}
            </small>
          </button>
        </div>

        <button
          type="button"
          className="generate-tool-btn"
          onClick={() => void handleStartQuiz()}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
        >
          <Sparkles size={16} />
          Bắt đầu làm bài trắc nghiệm ({questionCount} câu)
        </button>
      </div>
    );
  }

  // 2. Quiz In Progress or Review
  const currentQ = quizQuestions[currentIdx];
  const totalQuestions = quizQuestions.length;
  const answeredCount = quizQuestions.filter((_, idx) => isQuestionAnswered(idx)).length;

  // Calculate score if submitted
  let correctCount = 0;
  if (submitted) {
    quizQuestions.forEach((q, idx) => {
      if (isAnswerCorrect(q, idx)) {
        correctCount += 1;
      }
    });
  }
  const scorePercent = Math.round((correctCount / totalQuestions) * 100);

  const isMultiSelect = currentQ.type === 'multiple_select';
  const isTrueFalse = currentQ.type === 'true_false';

  return (
    <div className="artifact quiz-wrapper">
      {/* Quiz Top Header */}
      <div className="artifact-head">
        <div>
          <h2>Đề trắc nghiệm: {courseTitle}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px', flexWrap: 'wrap' }}>
            <span className="level-badge">
              {difficulty === 'easy' ? 'Cơ bản' : difficulty === 'hard' ? 'Nâng cao' : 'Trung bình'}
            </span>
            <span className="level-badge" style={{ background: 'rgba(56, 189, 248, 0.15)', borderColor: '#38bdf8', color: '#bae6fd' }}>
              {questionType === 'true_false' ? 'Đúng / Sai' : questionType === 'multiple_select' ? 'Nhiều đáp án' : questionType === 'mixed' ? 'Tổng hợp' : '4 Lựa chọn'}
            </span>
            <small style={{ color: '#94a3b8' }}>
              Đã hoàn thành: {answeredCount}/{totalQuestions} câu
            </small>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <button
            className="reconfigure-btn"
            onClick={handleReconfigure}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <Sliders size={14} />
            Cấu hình đề
          </button>

          {submitted && (
            <button
              className="reconfigure-btn"
              onClick={handleRetake}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <RotateCcw size={14} />
              Làm lại đề này
            </button>
          )}
        </div>
      </div>

      {/* Score Summary Box when submitted */}
      {submitted && (
        <div className="quiz-result-banner">
          <div className="score-circle">
            <span className="score-num">{scorePercent}%</span>
            <span className="score-sub">{correctCount}/{totalQuestions} đúng</span>
          </div>
          <div className="score-details">
            <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {scorePercent >= 85 ? (
                <>
                  <Award size={20} style={{ color: '#fbbf24' }} />
                  Kết quả xuất sắc: Nắm vững toàn diện kiến thức
                </>
              ) : scorePercent >= 65 ? (
                <>
                  <CheckCircle2 size={20} style={{ color: '#38bdf8' }} />
                  Kết quả đạt yêu cầu: Cần rà soát thêm các câu sai
                </>
              ) : (
                <>
                  <BookOpen size={20} style={{ color: '#f87171' }} />
                  Cần tiếp tục ôn tập và củng cố tài liệu bài giảng
                </>
              )}
            </h3>
            <p>Bài thi trắc nghiệm đã hoàn thành. Hãy đối chiếu các câu trả lời và xem giải thích chi tiết bên dưới.</p>
          </div>
        </div>
      )}

      {/* Question Card */}
      <div className="quiz-card">
        {/* Progress header */}
        <div className="quiz-card-head">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="quiz-q-counter">
              CÂU HỎI {currentIdx + 1} / {totalQuestions}
            </span>
            <span
              style={{
                fontSize: '11px',
                padding: '2px 8px',
                borderRadius: '6px',
                background: isMultiSelect
                  ? 'rgba(168, 85, 247, 0.2)'
                  : isTrueFalse
                  ? 'rgba(56, 189, 248, 0.2)'
                  : 'rgba(124, 109, 242, 0.15)',
                color: isMultiSelect ? '#d8b4fe' : isTrueFalse ? '#7dd3fc' : '#c4c1d6',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                fontWeight: 600,
              }}
            >
              {isMultiSelect ? 'Chọn nhiều đáp án đúng' : isTrueFalse ? 'Đúng / Sai' : 'Chọn 1 đáp án đúng'}
            </span>
          </div>
          {submitted && (
            <span
              className={`quiz-status-pill ${
                isAnswerCorrect(currentQ, currentIdx) ? 'correct' : 'incorrect'
              }`}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
            >
              {isAnswerCorrect(currentQ, currentIdx) ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
              {isAnswerCorrect(currentQ, currentIdx) ? 'Đúng' : 'Sai'}
            </span>
          )}
        </div>

        {/* Question Text */}
        <div className="quiz-question-text">
          <MarkdownRenderer content={currentQ.q} />
        </div>

        {/* Choices Options */}
        <div className="quiz-choices-list">
          {currentQ.choices.map((choice, cIdx) => {
            const isSelected = isMultiSelect
              ? Array.isArray(userAnswers[currentIdx]) && (userAnswers[currentIdx] as number[]).includes(cIdx)
              : userAnswers[currentIdx] === cIdx;

            const isCorrect = isMultiSelect
              ? (currentQ.answers || (typeof currentQ.answer === 'number' ? [currentQ.answer] : [])).includes(cIdx)
              : currentQ.answer === cIdx;

            const isMissed = submitted && isMultiSelect && isCorrect && !isSelected;

            let choiceClass = 'quiz-choice-btn';
            if (isMultiSelect) choiceClass += ' multi-choice';
            if (isSelected) choiceClass += ' selected';
            if (submitted) {
              if (isCorrect) choiceClass += ' correct-answer';
              else if (isSelected && !isCorrect) choiceClass += ' wrong-answer';
              else if (isMissed) choiceClass += ' missed-answer';
            }

            const letter = String.fromCharCode(65 + cIdx);

            return (
              <button
                key={cIdx}
                type="button"
                className={choiceClass}
                onClick={() => handleSelectAnswer(currentIdx, cIdx)}
                disabled={submitted}
              >
                <div className={`choice-prefix ${isMultiSelect ? 'checkbox-style' : 'radio-style'}`}>
                  {isMultiSelect ? (
                    isSelected ? (
                      <Check size={14} strokeWidth={3.5} className="choice-check-icon" />
                    ) : (
                      <span className="choice-letter">{letter}</span>
                    )
                  ) : (
                    <span className="choice-letter">{letter}</span>
                  )}
                </div>
                <span className="choice-text">{choice}</span>

                {submitted && isCorrect && isSelected && (
                  <span className="choice-badge-status correct">
                    <Check size={12} strokeWidth={3} />
                    <span>Đúng</span>
                  </span>
                )}
                {submitted && isMissed && (
                  <span className="choice-badge-status missed">
                    <Check size={12} strokeWidth={3} />
                    <span>Đáp án đúng</span>
                  </span>
                )}
                {submitted && isSelected && !isCorrect && (
                  <span className="choice-badge-status wrong">
                    <X size={12} strokeWidth={3} />
                    <span>Sai</span>
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Explanation Box (Visible after submission) */}
        {submitted && currentQ.explanation && (
          <div className="quiz-explanation-box">
            <div className="explanation-title" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Lightbulb size={15} style={{ color: '#fbbf24' }} />
              <span>Giải thích chi tiết:</span>
            </div>
            <div className="explanation-text">
              <MarkdownRenderer content={currentQ.explanation} />
            </div>
          </div>
        )}

        {/* Navigation & Submit footer */}
        <div className="quiz-card-footer">
          <button
            type="button"
            className="reconfigure-btn"
            disabled={currentIdx === 0}
            onClick={() => setCurrentIdx(prev => Math.max(0, prev - 1))}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          >
            <ChevronLeft size={14} />
            Câu trước
          </button>

          <div className="quiz-nav-dots">
            {quizQuestions.map((q, dotIdx) => {
              const isAnswered = isQuestionAnswered(dotIdx);
              const isCurr = dotIdx === currentIdx;
              let dotClass = 'quiz-dot';
              if (isCurr) dotClass += ' active';
              if (isAnswered) dotClass += ' answered';
              if (submitted) {
                dotClass += isAnswerCorrect(q, dotIdx) ? ' pass' : ' fail';
              }

              return (
                <button
                  key={dotIdx}
                  type="button"
                  className={dotClass}
                  onClick={() => setCurrentIdx(dotIdx)}
                  title={`Đến câu ${dotIdx + 1}`}
                >
                  {dotIdx + 1}
                </button>
              );
            })}
          </div>

          {currentIdx < totalQuestions - 1 ? (
            <button
              type="button"
              className="generate-tool-btn"
              style={{ margin: 0, padding: '8px 16px', fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
              onClick={() => setCurrentIdx(prev => Math.min(totalQuestions - 1, prev + 1))}
            >
              <span>Câu tiếp theo</span>
              <ChevronRight size={14} />
            </button>
          ) : !submitted ? (
            <button
              type="button"
              className="generate-tool-btn"
              style={{
                margin: 0,
                padding: '8px 20px',
                fontSize: '13px',
                background: 'linear-gradient(135deg, #10b981, #059669)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
              }}
              onClick={handleSubmit}
            >
              <CheckCircle2 size={15} />
              <span>Nộp bài thi</span>
            </button>
          ) : (
            <button
              type="button"
              className="reconfigure-btn"
              onClick={handleReconfigure}
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
            >
              <CheckCircle2 size={14} />
              <span>Hoàn thành</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
