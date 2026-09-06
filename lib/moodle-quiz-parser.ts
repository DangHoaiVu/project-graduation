/**
 * Utilities to parse and extract structured data from Moodle's mod_quiz_get_attempt_review question HTML
 */

export interface ParsedMoodleQuestion {
  slot: number;
  type: string;
  state: string; // 'gradedwrong' | 'gradedpartial' | 'gradedright' | string
  status: string; // 'Incorrect' | 'Partially correct' | 'Correct' | string
  mark: string;
  maxmark: number;
  questionText: string;
  studentAnswer: string;
  rightAnswer: string;
  feedback: string;
}

export function extractPlainText(html: string): string {
  if (!html) return '';
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function cleanAnswerText(raw: string | null | undefined): string {
  if (!raw) return '';
  let text = raw
    // 1. Strip class attributes, r0/r1 and correct/incorrect fragments like:
    // class="r0 incorrect">, incorrect">, correct">, r0 incorrect">, etc.
    .replace(/(?:class\s*=\s*["']?)?\s*(?:r[0-9]\s+)?(?:correct|incorrect|partiallycorrect)[^>]*>/gi, '')
    // 2. Strip leftover class="..." or id="..."
    .replace(/\b(?:class|id)\s*=\s*["'][^"']*["']/gi, '')
    // 3. Strip stray r0/r1 attribute remnants
    .replace(/\b(?:r[0-9])["']?>?/gi, '')
    // 4. Strip any opening/closing HTML tags like <span ...>, <div>, etc.
    .replace(/<[^>]+>/g, ' ')
    // 5. Strip any stray quotes followed by > at boundaries e.g. "; ">" or "^ ">"
    .replace(/(?:^|;)\s*["']?>+/g, '; ')
    // 6. Decode common HTML entities
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/gi, "'")
    // 7. Clean up multiple spaces and semicolons
    .replace(/\s+/g, ' ')
    .replace(/\s*;\s*/g, '; ')
    .replace(/^(?:;\s*)+|(?:;\s*)+$/g, '');

  // 8. Remove trailing feedback or checkmark symbols from Moodle
  const checkIdx = text.indexOf('✓');
  if (checkIdx > 0) {
    text = text.slice(0, checkIdx);
  }
  const xIdx = text.indexOf('✗');
  if (xIdx > 0) {
    text = text.slice(0, xIdx);
  }

  return text.replace(/\s+/g, ' ').trim();
}

export function parseMoodleQuestion(rawQuestion: {
  slot: number;
  type?: string;
  state?: string;
  status?: string;
  mark?: string;
  maxmark?: number;
  html?: string;
}): ParsedMoodleQuestion {
  const html = rawQuestion.html || '';
  const clean = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

  // 1. Question text from .qtext
  let questionText = '';
  const qtextMatch =
    clean.match(/<div class="qtext"[^>]*>([\s\S]*?)<\/div>\s*<fieldset/i) ||
    clean.match(/<div class="qtext"[^>]*>([\s\S]*?)<\/fieldset>/i) ||
    clean.match(/<div class="qtext"[^>]*>([\s\S]*?)<\/div>/i);
  if (qtextMatch) {
    questionText = extractPlainText(qtextMatch[1]);
  }

  // 2. Right answer from .rightanswer
  let rightAnswer = '';
  const rightMatch = clean.match(/<div class="rightanswer"[^>]*>([\s\S]*?)<\/div>/i);
  if (rightMatch) {
    rightAnswer = extractPlainText(rightMatch[1])
      .replace(/^The correct answer is:?\s*/i, '')
      .replace(/^The correct answers are:?\s*/i, '')
      .replace(/^Câu trả lời đúng là:?\s*/i, '')
      .replace(/^Đáp án đúng là:?\s*/i, '')
      .trim();
  }

  // 3. Feedback from .generalfeedback or .specificfeedback
  let feedback = '';
  const genFbMatch = clean.match(/<div class="generalfeedback"[^>]*>([\s\S]*?)<\/div>/i);
  const specFbMatch = clean.match(/<div class="specificfeedback"[^>]*>([\s\S]*?)<\/div>/i);
  if (genFbMatch) feedback += extractPlainText(genFbMatch[1]) + ' ';
  if (specFbMatch) feedback += extractPlainText(specFbMatch[1]);
  feedback = feedback.trim();

  // 4. Student answer
  const studentChoices: string[] = [];
  const answerBlockMatch = clean.match(/<div class="answer">([\s\S]*?)<\/div>\s*<\/fieldset>/i);
  if (answerBlockMatch) {
    const optionRows = answerBlockMatch[1].split(/<div class="(?:r0|r1)/i);
    for (const row of optionRows) {
      if (/checked="checked"|checked\b/i.test(row)) {
        const cleaned = cleanAnswerText(row);
        if (cleaned) {
          studentChoices.push(cleaned);
        }
      }
    }
  }

  // Fallback to response history: "Saved: <answer>"
  const historySaved = [...clean.matchAll(/Saved:\s*([^<\r\n]+)/gi)];
  let historyAnswer = '';
  if (historySaved.length > 0) {
    historyAnswer = historySaved[historySaved.length - 1][1].trim();
  }

  const studentAnswer =
    studentChoices.length > 0 ? studentChoices.join('; ') : historyAnswer || 'Chưa trả lời';

  return {
    slot: rawQuestion.slot,
    type: rawQuestion.type || 'multichoice',
    state: rawQuestion.state || '',
    status: rawQuestion.status || (rawQuestion.state === 'gradedwrong' ? 'Incorrect' : 'Partially correct'),
    mark: rawQuestion.mark ?? '0.00',
    maxmark: rawQuestion.maxmark ?? 1,
    questionText,
    studentAnswer,
    rightAnswer,
    feedback,
  };
}

