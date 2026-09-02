import { NextResponse } from 'next/server';
import { generateText } from '@/models/registry';
import { convertQuestionsToMoodleXml, type QuizQuestionItem } from '@/app/lib/moodle-xml';
import { getDb } from '@/db';
import { documents } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { parseDocumentFromUrl } from '@/lib/document-parser';
import { retrieveRelevantChunks, formatChunksForPrompt } from '@/lib/rag';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      topic?: string;
      course?: string;
      courseId?: string | number;
      sources?: Array<{ name: string; url?: string }>;
      documentText?: string;
      count?: number;
      difficulty?: 'easy' | 'normal' | 'hard';
      questionType?: 'multiple_choice' | 'true_false' | 'multiple_select' | 'mixed';
      model?: string;
    };

    const count = Math.min(100, Math.max(1, typeof body.count === 'number' ? body.count : 10));
    const difficulty = body.difficulty || 'normal';
    const questionType = body.questionType || 'mixed';
    const topic = body.topic || 'Kiểm tra kiến thức môn học';

    const rawDocs: Array<{ title: string; text: string }> = [];

    if (body.documentText?.trim()) {
      rawDocs.push({ title: 'Tài liệu cung cấp', text: body.documentText.trim() });
    }

    // 1. Gather documents from DB if courseId is available
    if (body.courseId) {
      const db = getDb();
      if (db) {
        try {
          const dbDocs = await db
            .select({ title: documents.title, content: documents.content })
            .from(documents)
            .where(eq(documents.courseId, String(body.courseId)))
            .limit(5);

          for (const d of dbDocs) {
            if (d.content && d.content.length > 50) {
              rawDocs.push({ title: d.title, text: d.content });
            }
          }
        } catch (dbErr) {
          console.warn('DB fetch error in teacher quiz generate:', dbErr);
        }
      }
    }

    // 2. Fetch URLs from sources if provided
    if (body.sources && body.sources.length > 0) {
      for (const s of body.sources.slice(0, 5)) {
        if (s.url) {
          try {
            const parsed = await parseDocumentFromUrl(s.url, s.name);
            if (parsed && parsed.trim()) {
              rawDocs.push({ title: s.name, text: parsed });
            }
          } catch {
            // ignore
          }
        }
      }
    }

    let context = '';
    if (rawDocs.length > 0) {
      try {
        const relevantChunks = await retrieveRelevantChunks(topic, rawDocs, {
          topK: 10,
          maxTotalChars: 22000,
          minSimilarity: 0.15,
        });
        if (relevantChunks.length > 0) {
          context = formatChunksForPrompt(relevantChunks);
        } else {
          context = rawDocs.map((d, i) => `[TÀI LIỆU ${i + 1}: ${d.title}]\n${d.text.slice(0, 5000)}`).join('\n\n');
        }
      } catch {
        context = rawDocs.map((d, i) => `[TÀI LIỆU ${i + 1}: ${d.title}]\n${d.text.slice(0, 5000)}`).join('\n\n');
      }
    }

    let difficultyGuide = 'ĐỘ KHÓ: TRUNG BÌNH (Cân đối lý thuyết và bài tập tư duy).';
    if (difficulty === 'easy') {
      difficultyGuide = 'ĐỘ KHÓ: DỄ (Nhận biết định nghĩa, khái niệm căn bản, rõ ràng).';
    } else if (difficulty === 'hard') {
      difficultyGuide = 'ĐỘ KHÓ: KHÓ / NÂNG CAO (Câu hỏi vận dụng cao, bẫy trắc nghiệm tinh vi, phân tích tình huống thực tế sâu sắc).';
    }

    let typeGuide = '';
    if (questionType === 'multiple_choice') {
      typeGuide = 'LOẠI CÂU HỎI: 100% CÂU HỎI TRẮC NGHIỆM 4 LỰA CHỌN (Single Choice: A/B/C/D). Mỗi câu đúng 1 đáp án duy nhất ("type": "multichoice", "correctAnswerIndex": 0..3).';
    } else if (questionType === 'true_false') {
      typeGuide = 'LOẠI CÂU HỎI: 100% CÂU HỎI ĐÚNG / SAI (True/False). Mỗi câu có 2 lựa chọn ["Đúng", "Sai"] ("type": "truefalse", "correctAnswerIndex": 0 nếu Đúng hoặc 1 nếu Sai).';
    } else if (questionType === 'multiple_select') {
      typeGuide = 'LOẠI CÂU HỎI: 100% CÂU HỎI CHỌN NHIỀU ĐÁP ÁN ĐÚNG (Multiple Select / Multi-answer). Mỗi câu có 4-5 lựa chọn và CÓ TỪ 2 ĐẾN 3 ĐÁP ÁN ĐÚNG ("type": "multiselect", "correctAnswerIndices": [0, 2]).';
    } else {
      typeGuide = 'LOẠI CÂU HỎI: KẾT HỢP ĐA DẠNG (Mixed). Hãy tạo xen kẽ cả 3 loại câu hỏi: (1) Trắc nghiệm 1 đáp án ("type": "multichoice"), (2) Đúng/Sai ("type": "truefalse"), và (3) Chọn nhiều đáp án đúng ("type": "multiselect").';
    }

    const contextSection = context
      ? `TÀI LIỆU NGUỒN CỦA MÔN HỌC:\n${context.slice(0, 20000)}\n\n`
      : `MÔN HỌC: ${body.course || 'Khóa học đại học'}\nCHỦ ĐỀ: ${topic}\n\n`;

    const systemPrompt = `Bạn là chuyên gia khảo thí, sư phạm đại học và thiết kế đề thi trắc nghiệm theo chuẩn Moodle Question Bank.
Nhiệm vụ của bạn là soạn bộ câu hỏi trắc nghiệm chất lượng cao, chính xác 100%, không bị ảo giác.
BẮT BUỘC trả về đúng cấu trúc JSON, không markdown hay văn bản ngoài JSON.`;

    const userPrompt = `${contextSection}YÊU CẦU SOẠN BỘ CÂU HỎI TRẮC NGHIỆM MOODLE:
Hãy tạo CHÍNH XÁC ${count} câu hỏi trắc nghiệm (tuyệt đối không nhiều hơn và không ít hơn, đúng ${count} câu) theo chủ đề: "${topic}".
${difficultyGuide}
${typeGuide}

QUY TẮC BẮT BUỘC CHO TỪNG LOẠI CÂU HỎI:
1. Đối với "type": "multichoice" (1 đáp án đúng): "options" có 4 phương án, "correctAnswerIndex": số nguyên 0..3.
2. Đối với "type": "truefalse" (Đúng/Sai): "options": ["Đúng", "Sai"], "correctAnswerIndex": 0 (nếu nhận định là Đúng) hoặc 1 (nếu nhận định là Sai).
3. Đối với "type": "multiselect" (Chọn nhiều đáp án đúng): "options" có 4-5 phương án, "correctAnswerIndices": mảng các chỉ số đúng (ví dụ [0, 2] hoặc [1, 3], bắt buộc có ít nhất 2 đáp án đúng).
4. "explanation": Lời giải thích khoa học, rõ ràng tại sao các đáp án đó đúng/sai.
5. "questionText": Nội dung câu hỏi rõ ràng, không ghi sẵn chữ "A, B, C, D" hay "Câu 1".

CẤU TRÚC JSON BẮT BUỘC:
{
  "questions": [
    {
      "type": "multichoice",
      "questionText": "Nội dung câu hỏi 1 lựa chọn?",
      "options": ["Lựa chọn A", "Lựa chọn B", "Lựa chọn C", "Lựa chọn D"],
      "correctAnswerIndex": 0,
      "explanation": "Giải thích chi tiết..."
    },
    {
      "type": "truefalse",
      "questionText": "Nhận định này đúng hay sai?",
      "options": ["Đúng", "Sai"],
      "correctAnswerIndex": 0,
      "explanation": "Giải thích chi tiết..."
    },
    {
      "type": "multiselect",
      "questionText": "Những phát biểu nào sau đây là ĐÚNG? (Chọn nhiều đáp án)",
      "options": ["Lựa chọn A", "Lựa chọn B", "Lựa chọn C", "Lựa chọn D"],
      "correctAnswerIndices": [0, 2],
      "explanation": "Giải thích chi tiết..."
    }
  ]
}`;

    const modelToUse = body.model || 'gemini:gemini-2.5-flash';
    const result = await generateText(modelToUse, {
      system: systemPrompt,
      userPrompt,
      temperature: 0.2,
      jsonMode: true,
    });

    if (!result.text) {
      return NextResponse.json({ error: 'Mô hình AI không trả về kết quả.' }, { status: 500 });
    }

    let parsedQuestions: Array<{
      type?: 'multichoice' | 'truefalse' | 'multiselect' | string;
      questionText?: string;
      q?: string;
      options?: string[];
      choices?: string[];
      correctAnswerIndex?: number;
      correctAnswerIndices?: number[];
      answer?: number | number[];
      explanation?: string;
    }> = [];

    try {
      const parsed = JSON.parse(result.text);
      const list = parsed.questions || parsed.quiz || (Array.isArray(parsed) ? parsed : []);
      if (Array.isArray(list)) {
        parsedQuestions = list;
      }
    } catch {
      // Regex fallback if JSON contains markdown wrapper
      const jsonMatch = result.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          const list = parsed.questions || parsed.quiz || (Array.isArray(parsed) ? parsed : []);
          if (Array.isArray(list)) {
            parsedQuestions = list;
          }
        } catch {
          // ignore
        }
      }
    }

    if (parsedQuestions.length === 0) {
      return NextResponse.json({ error: 'Không thể phân tích dữ liệu câu hỏi từ AI.' }, { status: 500 });
    }

    const normalizedQuestions: QuizQuestionItem[] = parsedQuestions.slice(0, count).map((q, idx) => {
      const questionText = q.questionText || q.q || `Câu hỏi ${idx + 1}`;
      const rawOptions = q.options || q.choices || [];

      // Determine type
      let qType: 'multichoice' | 'truefalse' | 'multiselect' = 'multichoice';
      if (
        q.type === 'truefalse' ||
        q.type === 'true_false' ||
        (rawOptions.length === 2 && (rawOptions[0].toLowerCase().includes('đúng') || rawOptions[0].toLowerCase().includes('true')))
      ) {
        qType = 'truefalse';
      } else if (
        q.type === 'multiselect' ||
        q.type === 'multiple_select' ||
        (Array.isArray(q.correctAnswerIndices) && q.correctAnswerIndices.length > 1) ||
        (Array.isArray(q.answer) && q.answer.length > 1)
      ) {
        qType = 'multiselect';
      }

      if (qType === 'truefalse') {
        const correctIdx = typeof q.correctAnswerIndex === 'number'
          ? q.correctAnswerIndex
          : typeof q.answer === 'number'
          ? q.answer
          : 0;

        return {
          id: `q-${idx + 1}-${Date.now()}`,
          type: 'truefalse',
          questionText,
          options: ['Đúng', 'Sai'],
          correctAnswerIndex: correctIdx === 1 ? 1 : 0,
          explanation: q.explanation || 'Không có giải thích chi tiết.',
          defaultGrade: 1.0,
        };
      }

      if (qType === 'multiselect') {
        const rawIndices = Array.isArray(q.correctAnswerIndices)
          ? q.correctAnswerIndices
          : Array.isArray(q.answer)
          ? q.answer
          : [0, 1];

        const options = rawOptions.length >= 2 ? rawOptions : ['Lựa chọn A', 'Lựa chọn B', 'Lựa chọn C', 'Lựa chọn D'];
        const validIndices = rawIndices
          .map(Number)
          .filter(n => !isNaN(n) && n >= 0 && n < options.length);

        return {
          id: `q-${idx + 1}-${Date.now()}`,
          type: 'multiselect',
          questionText,
          options,
          correctAnswerIndices: validIndices.length > 0 ? validIndices : [0, 1],
          explanation: q.explanation || 'Không có giải thích chi tiết.',
          defaultGrade: 1.0,
        };
      }

      // Single multichoice
      const options = rawOptions.length >= 4 ? rawOptions.slice(0, 4) : [...rawOptions, 'Đáp án khác 1', 'Đáp án khác 2'].slice(0, 4);
      const correctAnswerIndex = typeof q.correctAnswerIndex === 'number'
        ? q.correctAnswerIndex
        : typeof q.answer === 'number'
        ? q.answer
        : 0;

      return {
        id: `q-${idx + 1}-${Date.now()}`,
        type: 'multichoice',
        questionText,
        options,
        correctAnswerIndex: Math.min(options.length - 1, Math.max(0, correctAnswerIndex)),
        explanation: q.explanation || 'Không có giải thích chi tiết.',
        defaultGrade: 1.0,
      };
    });

    const categoryName = body.course ? `${body.course} - ${topic}` : topic;
    const moodleXml = convertQuestionsToMoodleXml(normalizedQuestions, categoryName);

    return NextResponse.json({
      success: true,
      count: normalizedQuestions.length,
      questions: normalizedQuestions,
      xmlContent: moodleXml,
      fileName: `quiz_${Date.now()}.xml`,
      categoryName,
    });
  } catch (error) {
    console.error('Teacher quiz generation error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Lỗi khi tạo đề trắc nghiệm.' },
      { status: 500 }
    );
  }
}

