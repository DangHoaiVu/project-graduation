import { NextResponse } from 'next/server';
import { generateText } from '@/models/registry';
import { getDb } from '@/db';
import { personalMaterials } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { supabaseAdmin } from '@/lib/supabase';
import { saveLearningArtifact } from '@/lib/learning-artifacts';
import { parseDocumentFromUrl } from '@/lib/document-parser';
import { retrieveRelevantChunks, formatChunksForPrompt } from '@/lib/rag';
import { getPersonalMaterials } from '@/lib/firebase-data';

interface SourceItem {
  name: string;
  url?: string;
  type?: string;
}

const cancelledRequests = new Map<string, number>();
const CANCEL_EXPIRY_MS = 10 * 60 * 1000;

class RequestAbortedError extends Error {
  constructor() {
    super('Request aborted');
    this.name = 'AbortError';
  }
}

function throwIfRequestAborted(request: Request, requestId?: string) {
  const now = Date.now();
  for (const [id, cancelledAt] of cancelledRequests) {
    if (now - cancelledAt > CANCEL_EXPIRY_MS) cancelledRequests.delete(id);
  }
  if (request.signal.aborted || (requestId && cancelledRequests.has(requestId))) {
    throw new RequestAbortedError();
  }
}

function parseGeneratedJson(text: string): unknown {
  const normalized = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

  try {
    return JSON.parse(normalized);
  } catch {
    const objectStart = normalized.indexOf('{');
    const objectEnd = normalized.lastIndexOf('}');
    if (objectStart >= 0 && objectEnd > objectStart) {
      return JSON.parse(normalized.slice(objectStart, objectEnd + 1));
    }
    throw new Error('Mô hình AI không trả về JSON hợp lệ. Vui lòng thử lại hoặc đổi mô hình.');
  }
}

export async function POST(request: Request) {
  let requestId: string | undefined;
  let isCancelRequest = false;
  try {
    const body = (await request.json()) as {
      action?: 'cancel';
      requestId?: string;
      type?: 'summary' | 'mindmap' | 'flashcards' | 'slides' | 'slide' | 'presentation';
      topic?: string;
      course?: string;
      courseCode?: string;
      courseId?: string | number;
      userId?: number;
      sourceNames?: string[];
      sources?: SourceItem[];
      level?: 'simple' | 'standard' | 'complex';
      allowExternalSource?: boolean;
      model?: string;
    };

    requestId = body.requestId;
    isCancelRequest = body.action === 'cancel';
    if (isCancelRequest) {
      if (requestId) cancelledRequests.set(requestId, Date.now());
      return NextResponse.json({ success: true });
    }

    throwIfRequestAborted(request, requestId);

    const toolType = body.type || 'summary';
    const level = body.level || 'standard';
    const topic = body.topic || 'Nội dung học tập';

    const effectiveSources: SourceItem[] =
      body.sources && body.sources.length > 0
        ? body.sources
        : (body.sourceNames || []).map(name => ({ name }));

    const effectiveSourceNames = effectiveSources.map(s => s.name);

    // 1. Gather document context from personal_materials / Moodle
    let documentContext = '';
    const docMap = new Map<string, string>();
    const moodleCourseId = Number(body.courseId) || undefined;

    if (moodleCourseId) {
      try {
        const mats = await getPersonalMaterials({ moodleCourseId, limit: 10 });
        if (mats) {
          for (const mat of mats) {
            if (mat.storage_url && mat.title && !docMap.has(String(mat.title).toLowerCase())) {
              try {
                const text = await parseDocumentFromUrl(String(mat.storage_url), String(mat.title));
                if (text && text.length > 50) docMap.set(String(mat.title).toLowerCase(), text);
              } catch {
                // ignore unavailable material
              }
            }
          }
        }
      } catch (firebaseError) {
        console.warn('Firebase personal_materials query in study-tools:', firebaseError);
      }

      if (supabaseAdmin) {
        try {
          const { data: mats } = await supabaseAdmin
            .from('personal_materials')
            .select('*')
            .eq('moodle_course_id', moodleCourseId)
            .limit(10);

          if (mats) {
            for (const mat of mats) {
              if (mat.storage_url && !docMap.has(mat.title.toLowerCase())) {
                try {
                  const text = await parseDocumentFromUrl(mat.storage_url, mat.title);
                  if (text && text.length > 50) {
                    docMap.set(mat.title.toLowerCase(), text);
                  }
                } catch {
                  // ignore
                }
              }
            }
          }
        } catch (sbErr) {
          console.warn('Supabase personal_materials query in study-tools:', sbErr);
        }
      }

      const db = getDb();
      if (db && docMap.size === 0) {
        try {
          const mats = await db
            .select()
            .from(personalMaterials)
            .where(eq(personalMaterials.moodleCourseId, moodleCourseId))
            .limit(10);

          for (const mat of mats) {
            if (mat.storageUrl && !docMap.has(mat.title.toLowerCase())) {
              try {
                const text = await parseDocumentFromUrl(mat.storageUrl, mat.title);
                if (text && text.length > 50) {
                  docMap.set(mat.title.toLowerCase(), text);
                }
              } catch {
                // ignore
              }
            }
          }
        } catch (dbErr) {
          console.warn('Drizzle personal_materials query in study-tools:', dbErr);
        }
      }
    }

    // Parse URL documents if needed
    for (const src of effectiveSources) {
      throwIfRequestAborted(request, requestId);
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
    } else if (toolType === 'slides' || toolType === 'slide' || toolType === 'presentation') {
      const slideCount = level === 'simple' ? '4-6' : level === 'complex' ? '10-14' : '7-9';
      levelInstruction = `CẤP ĐỘ ${level.toUpperCase()}: Tạo chính xác một bộ slide bài giảng (${slideCount} trang slide). Cấu trúc bao gồm:
      - Trang 1: Slide Tiêu đề & Giới thiệu bài giảng
      - Các trang tiếp theo: Trọng tâm kiến thức, định nghĩa, phân tích chuyên môn, ví dụ thực tế / ứng dụng
      - Trang kết thúc: Tổng kết bài giảng & Câu hỏi thảo luận
      Mỗi slide phải có title (tiêu đề trang), subtitle (tiêu đề phụ ngắn nếu có), bullets (danh sách 3-5 ý chính rõ ràng), keyTakeaway (1 câu đúc kết ghi nhớ quan trọng), và notes (lời dẫn thuyết trình chi tiết cho giảng viên/người trình bày).`;
      shapeDesc = `{
  "title": "Tiêu đề bài giảng / Bài thuyết trình",
  "topic": "${topic}",
  "slides": [
    {
      "slideNumber": 1,
      "title": "Tên Slide",
      "subtitle": "Phụ đề / Ngữ cảnh",
      "bullets": ["Ý chính 1", "Ý chính 2", "Ý chính 3"],
      "keyTakeaway": "Điểm cốt lõi cần nhớ",
      "notes": "Lời giảng chi tiết cho giảng viên khi thuyết trình trang này..."
    }
  ]
}`;
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
      throwIfRequestAborted(request, requestId);
      const result = await generateText(body.model, {
        system: 'Bạn là chuyên gia sư phạm và kiến trúc tri thức. Luôn bảo đảm tuyệt đối tính chính xác lịch sử/khoa học, chống ảo giác và trả về JSON hợp lệ 100%.',
        userPrompt: prompt,
        signal: request.signal,
        temperature: 0.15,
        jsonMode: true,
      });

      throwIfRequestAborted(request, requestId);

      if (result.text) {
        const parsed = parseGeneratedJson(result.text) as Record<string, unknown> | unknown[];
        let data: unknown = parsed;
        if (toolType === 'flashcards' && !Array.isArray(parsed)) {
          data = parsed.flashcards || parsed.cards || (Array.isArray(parsed) ? parsed : []);
        } else if (toolType === 'slides' || toolType === 'slide' || toolType === 'presentation') {
          data = !Array.isArray(parsed) && parsed.slides
            ? parsed
            : { title: topic, topic, slides: Array.isArray(parsed) ? parsed : [] };
        }

        // Save learning artifact to database
        throwIfRequestAborted(request, requestId);
        const numericUserId = body.userId || 4;
        const targetCourseId = moodleCourseId || 1;
        const savedArtifact = await saveLearningArtifact({
          userId: numericUserId,
          moodleCourseId: targetCourseId,
          artifactType: toolType,
          contentData: { name: topic, topic, level, data: data as Record<string, unknown> },
        }).catch(saveErr => {
          console.warn('saveLearningArtifact warning in study-tools:', saveErr);
        });

        return NextResponse.json({ data, mode: 'ai', level, artifactId: savedArtifact?.id || null });
      }
    } catch (err) {
      if (err instanceof RequestAbortedError || request.signal.aborted) {
        return new Response(null, { status: 499 });
      }
      console.warn('AI study-tools generation failed:', err);
    }

    return NextResponse.json({ error: 'Không thể tạo học liệu lúc này.' }, { status: 500 });
  } catch (error) {
    if (error instanceof RequestAbortedError || request.signal.aborted) {
      return new Response(null, { status: 499 });
    }
    console.error('Study tool error:', error);
    return NextResponse.json({ error: 'Lỗi xử lý yêu cầu.' }, { status: 500 });
  }
}
