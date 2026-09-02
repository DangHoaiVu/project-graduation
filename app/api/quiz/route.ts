import { NextResponse } from 'next/server';
import { generateText } from '@/models/registry';
import { getDb } from '@/db';
import { courses, documents } from '@/db/schema';
import { eq, ilike, or } from 'drizzle-orm';
import { parseDocumentFromUrl } from '@/lib/document-parser';
import { retrieveRelevantChunks, formatChunksForPrompt } from '@/lib/rag';

interface SourceItem {
  name: string;
  url?: string;
  type?: string;
}

export interface QuizQuestion {
  id?: string;
  q: string;
  type?: 'multiple_choice' | 'true_false' | 'multiple_select';
  choices: string[];
  answer?: number; // 0-based index for single / true_false
  answers?: number[]; // array of 0-based indices for multiple_select
  explanation: string;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      topic?: string;
      course?: string;
      courseCode?: string;
      courseId?: string | number;
      sourceNames?: string[];
      sources?: SourceItem[];
      count?: number;
      difficulty?: 'easy' | 'normal' | 'hard';
      questionType?: 'multiple_choice' | 'true_false' | 'multiple_select' | 'mixed';
      allowExternalSource?: boolean;
      model?: string;
    };

    // Validate count: minimum 10, maximum 50
    const rawCount = typeof body.count === 'number' ? body.count : 10;
    const count = Math.min(50, Math.max(10, rawCount));

    const difficulty = body.difficulty || 'normal';
    const questionType = body.questionType || 'multiple_choice';
    const topic = body.topic || 'Kiểm tra kiến thức môn học';

    const effectiveSources: SourceItem[] =
      body.sources && body.sources.length > 0
        ? body.sources
        : (body.sourceNames || []).map(name => ({ name }));

    const effectiveSourceNames = effectiveSources.map(s => s.name);

    // 1. Gather document context from Supabase/Moodle
    let documentContext = '';
    const db = getDb();
    const docMap = new Map<string, string>();

    if (db) {
      try {
        let dbDocs: Array<{ id: string; title: string; content: string }> = [];
        if (body.courseId && typeof body.courseId === 'string' && body.courseId.includes('-')) {
          dbDocs = await db
            .select({ id: documents.id, title: documents.title, content: documents.content })
            .from(documents)
            .where(eq(documents.courseId, body.courseId))
            .limit(10);
        } else if (body.courseCode || body.course) {
          const matchedCourses = await db
            .select()
            .from(courses)
            .where(
              or(
                body.courseCode ? ilike(courses.title, `%${body.courseCode}%`) : undefined,
                body.course ? ilike(courses.title, `%${body.course.split('(')[0].trim()}%`) : undefined
              )
            )
            .limit(3);

          if (matchedCourses.length > 0) {
            for (const mc of matchedCourses) {
              const docs = await db
                .select({ id: documents.id, title: documents.title, content: documents.content })
                .from(documents)
                .where(eq(documents.courseId, mc.id))
                .limit(5);
              dbDocs.push(...docs);
            }
          }
        }

        for (const doc of dbDocs) {
          if (doc.content && doc.content.length > 50) {
            docMap.set(doc.title.toLowerCase(), doc.content);
          }
        }
      } catch (dbErr) {
        console.warn('Could not query Supabase documents in quiz route:', dbErr);
      }
    }

    // Parse URL documents if needed
    for (const src of effectiveSources) {
      const lowerName = src.name.toLowerCase();
      if (!docMap.has(lowerName) && src.url) {
        try {
          const extractedText = await parseDocumentFromUrl(src.url, src.name);
          if (extractedText && extractedText.trim()) {
            docMap.set(lowerName, extractedText);
          }
        } catch {
          // ignore
        }
      }
    }

    const compiledDocs: Array<{ title: string; text: string }> = [];
    for (const src of effectiveSources) {
      const lowerName = src.name.toLowerCase();
      let text = docMap.get(lowerName) || '';
      if (!text) {
        for (const [key, val] of docMap.entries()) {
          if (key.includes(lowerName) || lowerName.includes(key)) {
            text = val;
            break;
          }
        }
      }
      if (text && text.trim() && !compiledDocs.some(d => d.title === src.name)) {
        compiledDocs.push({ title: src.name, text });
      }
    }

    if (compiledDocs.length > 0) {
      try {
        const relevantChunks = await retrieveRelevantChunks(topic, compiledDocs, {
          topK: 8,
          maxTotalChars: 18000,
          minSimilarity: 0.15,
        });

        if (relevantChunks.length > 0) {
          documentContext = formatChunksForPrompt(relevantChunks);
        } else {
          const maxPerDoc = Math.max(2500, Math.floor(25000 / compiledDocs.length));
          documentContext = compiledDocs
            .map((doc, idx) => `[TÀI LIỆU ${idx + 1}: "${doc.title}"]\n${doc.text.slice(0, maxPerDoc)}`)
            .join('\n\n');
        }
      } catch (ragErr) {
        console.warn('RAG retrieval warning in quiz route:', ragErr);
        const maxPerDoc = Math.max(2500, Math.floor(25000 / compiledDocs.length));
        documentContext = compiledDocs
          .map((doc, idx) => `[TÀI LIỆU ${idx + 1}: "${doc.title}"]\n${doc.text.slice(0, maxPerDoc)}`)
          .join('\n\n');
      }
    }

    // Difficulty Prompting
    let difficultyDesc = '';
    if (difficulty === 'easy') {
      difficultyDesc = 'ĐỘ KHÓ: DỄ (Câu hỏi nhận biết khái niệm cơ bản, định nghĩa trực tiếp, không bẫy phức tạp).';
    } else if (difficulty === 'hard') {
      difficultyDesc = 'ĐỘ KHÓ: KHÓ / NÂNG CAO (Câu hỏi vận dụng cao, phân tích tình huống thực tế, so sánh chi tiết, công thức, bẫy trắc nghiệm sâu sắc).';
    } else {
      difficultyDesc = 'ĐỘ KHÓ: TRUNG BÌNH (Cân đối giữa câu hỏi lý thuyết hiểu bản chất và bài tập vận dụng vừa phải).';
    }

    // Type Prompting
    let typeDesc = '';
    if (questionType === 'true_false') {
      typeDesc = 'LOẠI CÂU HỎI: 100% ĐÚNG / SAI (True/False). Mỗi câu có chính xác 2 lựa chọn: ["Đúng", "Sai"], "type": "true_false", "answer": 0 hoặc 1.';
    } else if (questionType === 'multiple_select') {
      typeDesc = 'LOẠI CÂU HỎI: 100% CHỌN NHIỀU ĐÁP ÁN ĐÚNG (Multiple Select). Mỗi câu có 4-5 lựa chọn và CÓ TỪ 2-3 ĐÁP ÁN ĐÚNG, "type": "multiple_select", "answers": [0, 2].';
    } else if (questionType === 'mixed') {
      typeDesc = 'LOẠI CÂU HỎI: KẾT HỢP ĐA DẠNG. Gồm xen kẽ cả: (1) 4 lựa chọn 1 đáp án đúng ("type": "multiple_choice", "answer": 0..3), (2) Đúng/Sai ("type": "true_false", "choices": ["Đúng", "Sai"], "answer": 0..1), và (3) Chọn nhiều đáp án đúng ("type": "multiple_select", "choices": [...], "answers": [0, 2]).';
    } else {
      typeDesc = 'LOẠI CÂU HỎI: 4 LỰA CHỌN (A/B/C/D - Single Choice). Mỗi câu có chính xác 4 lựa chọn khác nhau, "type": "multiple_choice", "answer": 0..3.';
    }

    let contextSection = '';
    if (documentContext.trim()) {
      contextSection = `DƯỚI ĐÂY LÀ VĂN BẢN TRÍCH XUẤT TỪ TÀI LIỆU MÔN HỌC:\n${documentContext}\n\n`;
    } else {
      contextSection = `MÔN HỌC: ${body.course || 'Khóa học'}\nTÀI LIỆU: ${effectiveSourceNames.join(', ') || 'Giáo trình môn học'}\n\n`;
    }

    const allowExternalSource = Boolean(body.allowExternalSource);
    const externalRule = allowExternalSource
      ? 'Được phép đưa thêm các câu hỏi tình huống thực tế ngành, câu hỏi ứng dụng hiện đại và câu hỏi mở rộng tư duy sáng tạo (out-of-the-box).'
      : 'Câu hỏi bám sát tuyệt đối tài liệu môn học được cung cấp.';

    const prompt = `${contextSection}YÊU CẦU SOẠN ĐỀ TRẮC NGHIỆM:
Hãy tạo chính xác ${count} câu hỏi trắc nghiệm tiếng Việt theo chủ đề: "${topic}".
${difficultyDesc}
${typeDesc}
${externalRule}

QUY TẮC BẮT BUỘC:
1. Đối với "type": "multiple_choice" (1 đáp án): "choices" có 4 phương án, "answer": số nguyên 0..3.
2. Đối với "type": "true_false" (Đúng/Sai): "choices": ["Đúng", "Sai"], "answer": 0 (nếu Đúng) hoặc 1 (nếu Sai).
3. Đối với "type": "multiple_select" (Nhiều đáp án): "choices" có 4-5 phương án, "answers": mảng chứa ít nhất 2 chỉ số đúng (ví dụ [0, 2]).
4. "explanation": Giải thích ngắn gọn nhưng đủ ý tại sao các đáp án đó đúng/sai.
5. Trả về đúng JSON object duy nhất có thuộc tính "questions":
{
  "questions": [
    {
      "type": "multiple_choice",
      "q": "Nội dung câu hỏi 1 lựa chọn?",
      "choices": ["Lựa chọn A", "Lựa chọn B", "Lựa chọn C", "Lựa chọn D"],
      "answer": 0,
      "explanation": "Giải thích chi tiết..."
    },
    {
      "type": "true_false",
      "q": "Nhận định này đúng hay sai?",
      "choices": ["Đúng", "Sai"],
      "answer": 0,
      "explanation": "Giải thích chi tiết..."
    },
    {
      "type": "multiple_select",
      "q": "Những khẳng định nào sau đây là ĐÚNG? (Chọn nhiều đáp án)",
      "choices": ["Lựa chọn A", "Lựa chọn B", "Lựa chọn C", "Lựa chọn D"],
      "answers": [0, 2],
      "explanation": "Giải thích chi tiết..."
    }
  ]
}
Không bao gồm markdown hay văn bản ngoài JSON.`;

    // 3. AI Execution via unified model registry
    try {
      const result = await generateText(body.model, {
        system: 'Bạn là chuyên gia khảo thí và sư phạm đại học. Luôn đảm bảo tuyệt đối tính chính xác của câu hỏi, đáp án đúng và lời giải thích dựa trên sự thật lịch sử và khoa học, chống ảo giác 100%. Trả về đúng JSON schema.',
        userPrompt: prompt,
        temperature: 0.2,
        jsonMode: true,
      });

      if (result.text) {
        const parsed = JSON.parse(result.text);
        const questionsList = parsed.questions || parsed.quiz || (Array.isArray(parsed) ? parsed : []);
        if (Array.isArray(questionsList) && questionsList.length > 0) {
          const normalized = questionsList.slice(0, count).map((item: any, idx: number) => {
            const rawChoices = item.choices || item.options || [];
            let qType: 'multiple_choice' | 'true_false' | 'multiple_select' = 'multiple_choice';

            if (
              item.type === 'true_false' ||
              item.type === 'truefalse' ||
              (rawChoices.length === 2 && (rawChoices[0].toLowerCase().includes('đúng') || rawChoices[0].toLowerCase().includes('true')))
            ) {
              qType = 'true_false';
            } else if (
              item.type === 'multiple_select' ||
              item.type === 'multiselect' ||
              (Array.isArray(item.answers) && item.answers.length > 1) ||
              (Array.isArray(item.answer) && item.answer.length > 1)
            ) {
              qType = 'multiple_select';
            }

            if (qType === 'true_false') {
              const ans = typeof item.answer === 'number' ? item.answer : 0;
              return {
                id: `sq-${idx + 1}-${Date.now()}`,
                type: 'true_false',
                q: item.q || item.questionText || `Câu hỏi ${idx + 1}`,
                choices: ['Đúng', 'Sai'],
                answer: ans === 1 ? 1 : 0,
                explanation: item.explanation || '',
              };
            }

            if (qType === 'multiple_select') {
              const rawAnswers = Array.isArray(item.answers)
                ? item.answers
                : Array.isArray(item.answer)
                ? item.answer
                : [0, 1];
              const choices = rawChoices.length >= 2 ? rawChoices : ['Lựa chọn A', 'Lựa chọn B', 'Lựa chọn C', 'Lựa chọn D'];
              const validAnswers = rawAnswers
                .map(Number)
                .filter((n: number) => !isNaN(n) && n >= 0 && n < choices.length);

              return {
                id: `sq-${idx + 1}-${Date.now()}`,
                type: 'multiple_select',
                q: item.q || item.questionText || `Câu hỏi ${idx + 1}`,
                choices,
                answers: validAnswers.length > 0 ? validAnswers : [0, 1],
                explanation: item.explanation || '',
              };
            }

            // multiple_choice
            const choices = rawChoices.length >= 4 ? rawChoices.slice(0, 4) : [...rawChoices, 'Lựa chọn 1', 'Lựa chọn 2'].slice(0, 4);
            const ans = typeof item.answer === 'number' ? item.answer : 0;
            return {
              id: `sq-${idx + 1}-${Date.now()}`,
              type: 'multiple_choice',
              q: item.q || item.questionText || `Câu hỏi ${idx + 1}`,
              choices,
              answer: Math.min(choices.length - 1, Math.max(0, ans)),
              explanation: item.explanation || '',
            };
          });

          return NextResponse.json({
            questions: normalized,
            count: normalized.length,
            difficulty,
            questionType,
            mode: 'ai',
          });
        }
      }
    } catch (err) {
      console.warn('AI quiz generation failed:', err);
    }

    return NextResponse.json({ error: 'Không thể tạo đề trắc nghiệm lúc này.' }, { status: 500 });
  } catch (error) {
    console.error('Quiz route error:', error);
    return NextResponse.json({ error: 'Lỗi khi tạo đề trắc nghiệm.' }, { status: 500 });
  }
}
