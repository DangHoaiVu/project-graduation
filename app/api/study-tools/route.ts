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

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      type?: 'summary' | 'mindmap' | 'flashcards';
      topic?: string;
      course?: string;
      courseCode?: string;
      courseId?: string | number;
      sourceNames?: string[];
      sources?: SourceItem[];
      level?: 'simple' | 'standard' | 'complex';
      allowExternalSource?: boolean;
      model?: string;
    };

    const toolType = body.type || 'summary';
    const level = body.level || 'standard';
    const topic = body.topic || 'Nội dung học tập';

    const effectiveSources: SourceItem[] =
      body.sources && body.sources.length > 0
        ? body.sources
        : (body.sourceNames || []).map(name => ({ name }));

    const effectiveSourceNames = effectiveSources.map(s => s.name);

    // 1. Gather document context
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
        console.warn('Could not query Supabase documents in study-tools:', dbErr);
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
        console.warn('RAG retrieval warning in study-tools:', ragErr);
        const maxPerDoc = Math.max(2500, Math.floor(25000 / compiledDocs.length));
        documentContext = compiledDocs
          .map((doc, idx) => `[TÀI LIỆU ${idx + 1}: "${doc.title}"]\n${doc.text.slice(0, maxPerDoc)}`)
          .join('\n\n');
      }
    }

    // 2. Define Level Prompts and Shapes
    let levelInstruction = '';
    let shapeDesc = '';

    if (toolType === 'summary') {
      if (level === 'simple') {
        levelInstruction = 'CẤP ĐỘ CƠ BẢN: Tóm tắt cực kỳ ngắn gọn, 1 đoạn tổng quan súc tích và chính xác 3-4 ý chính trọng tâm nhất.';
        shapeDesc = '{ "title": "Tiêu đề", "overview": "Tóm tắt 2-3 câu ngắn", "points": ["Ý 1", "Ý 2", "Ý 3"] }';
      } else if (level === 'complex') {
        levelInstruction = 'CẤP ĐỘ CHUYÊN SÂU: Phân tích chuyên sâu toàn diện, đa chiều, chi tiết từng thành phần, thuật toán/công thức/cấu trúc và bài học ứng dụng thực tiễn với 8-12 luận điểm sâu sắc.';
        shapeDesc = '{ "title": "Tiêu đề chuyên sâu", "overview": "Bản phân tích tổng quan chi tiết và sâu sắc", "points": ["Luận điểm 1", "Luận điểm 2", "Luận điểm 3", "Luận điểm 4", "Luận điểm 5", "Luận điểm 6", "Luận điểm 7", "Luận điểm 8"] }';
      } else {
        levelInstruction = 'CẤP ĐỘ TIÊU CHUẨN: Tóm tắt có cấu trúc đầy đủ, rõ ràng gồm 1 đoạn tổng quan và 5-7 ý chính quan trọng.';
        shapeDesc = '{ "title": "Tiêu đề", "overview": "Tổng quan môn học/chủ đề", "points": ["Ý 1", "Ý 2", "Ý 3", "Ý 4", "Ý 5", "Ý 6"] }';
      }
    } else if (toolType === 'mindmap') {
      if (level === 'simple') {
        levelInstruction = 'CẤP ĐỘ CƠ BẢN: Sơ đồ tư duy 3-4 nhánh chính, mỗi nhánh gồm 2-3 từ khóa trọng tâm.';
        shapeDesc = '{ "root": "Chủ đề cốt lõi", "branches": [ { "title": "Nhánh chính 1", "items": ["Từ khóa 1", "Từ khóa 2"] } ] }';
      } else if (level === 'complex') {
        levelInstruction = 'CẤP ĐỘ CHUYÊN SÂU: Sơ đồ tư duy phân cấp chi tiết 5-8 nhánh chính, mỗi nhánh chứa 4-6 mục con giải thích bản chất, cơ chế hoạt động và ứng dụng.';
        shapeDesc = '{ "root": "Chủ đề bao quát", "branches": [ { "title": "Nhánh chuyên sâu", "items": ["Mục con 1: chi tiết", "Mục con 2: cơ chế", "Mục con 3: ứng dụng", "Mục con 4: lưu ý"] } ] }';
      } else {
        levelInstruction = 'CẤP ĐỘ TIÊU CHUẨN: Sơ đồ tư duy 4-6 nhánh cân đối, mỗi nhánh chứa 3-4 khái niệm cốt lõi.';
        shapeDesc = '{ "root": "Chủ đề chính", "branches": [ { "title": "Nhánh 1", "items": ["Mục 1", "Mục 2", "Mục 3"] } ] }';
      }
    } else {
      // flashcards
      const cardCount = level === 'simple' ? 5 : level === 'complex' ? 15 : 10;
      levelInstruction = `CẤP ĐỘ ${level.toUpperCase()}: Tạo chính xác ${cardCount} thẻ ghi nhớ (flashcard) ${level === 'complex' ? 'chuyên sâu kèm câu hỏi tình huống, bẫy trắc nghiệm và giải thích chi tiết' : 'tập trung vào các khái niệm then chốt'}.`;
      shapeDesc = '{ "flashcards": [ { "front": "Câu hỏi / Khái niệm", "back": "Câu trả lời / Giải thích rõ ràng" } ] }';
    }

    let contextPart = '';
    if (documentContext.trim()) {
      contextPart = `DƯỚI ĐÂY LÀ VĂN BẢN TÀI LIỆU MÔN HỌC:\n${documentContext}\n\n`;
    } else {
      contextPart = `MÔN HỌC: ${body.course || 'Khóa học'}\nDANH SÁCH TÀI LIỆU: ${effectiveSourceNames.join(', ') || 'Giáo trình môn học'}\n\n`;
    }

    const allowExternalSource = Boolean(body.allowExternalSource);
    const externalInstruction = allowExternalSource
      ? 'CHẾ ĐỘ MỞ RỘNG (EXTERNAL ALLOWED): Ưu tiên tài liệu được cấp, đồng thời được phép liên hệ thực tế, ứng dụng công nghệ hiện đại và mở rộng tư duy sáng tạo (out-of-the-box).'
      : 'CHẾ ĐỘ BÁM SÁT: Chỉ tổng hợp dựa trên ngữ cảnh tài liệu môn học được cung cấp.';

    const prompt = `${contextPart}YÊU CẦU:
Hãy tạo ${toolType} tiếng Việt cho chủ đề: "${topic}".
${levelInstruction}
${externalInstruction}

BẮT BUỘC trả về đúng một JSON object duy nhất theo định dạng:
${shapeDesc}
Không bao gồm bất kỳ văn bản ngoài hay markdown.`;

    // 3. AI Execution via unified model registry
    try {
      const result = await generateText(body.model, {
        system: 'Bạn là chuyên gia sư phạm và kiến trúc tri thức. Luôn bảo đảm tuyệt đối tính chính xác lịch sử/khoa học, chống ảo giác và trả về JSON hợp lệ 100%.',
        userPrompt: prompt,
        temperature: 0.15,
        jsonMode: true,
      });

      if (result.text) {
        const parsed = JSON.parse(result.text);
        const data = toolType === 'flashcards' ? (parsed.flashcards || parsed.cards || (Array.isArray(parsed) ? parsed : [])) : parsed;
        return NextResponse.json({ data, mode: 'ai', level });
      }
    } catch (err) {
      console.warn('AI study-tools generation failed:', err);
    }

    return NextResponse.json({ error: 'Không thể tạo học liệu lúc này.' }, { status: 500 });
  } catch (error) {
    console.error('Study tool error:', error);
    return NextResponse.json({ error: 'Lỗi xử lý yêu cầu.' }, { status: 500 });
  }
}
