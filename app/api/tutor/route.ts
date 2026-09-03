import { NextResponse } from 'next/server';
import { generateText } from '@/models/registry';
import { getDb } from '@/db';
import { courses, documents } from '@/db/schema';
import { eq, ilike, or } from 'drizzle-orm';
import { parseDocumentFromUrl } from '@/lib/document-parser';
import { retrieveRelevantChunks, formatChunksForPrompt } from '@/lib/rag';

interface ChatHistoryItem {
  role: 'user' | 'ai' | 'model' | 'assistant';
  text: string;
}

interface SourceItem {
  name: string;
  url?: string;
  type?: string;
}

export async function POST(request: Request) {
  try {
    const {
      question = '',
      sourceNames = [],
      sources = [],
      course = '',
      courseCode = '',
      courseId,
      allowExternalSource = false,
      answerStyle = 'concise',
      history = [],
      model = 'auto',
    } = (await request.json()) as {
      question?: string;
      sourceNames?: string[];
      sources?: SourceItem[];
      course?: string;
      courseCode?: string;
      courseId?: string | number;
      allowExternalSource?: boolean;
      answerStyle?: 'concise' | 'detailed';
      history?: ChatHistoryItem[];
      model?: string;
    };

    if (!question.trim()) {
      return NextResponse.json({ error: 'Câu hỏi không được để trống.' }, { status: 400 });
    }

    const effectiveSources: SourceItem[] =
      sources.length > 0
        ? sources
        : sourceNames.map(name => ({ name }));

    const effectiveSourceNames = effectiveSources.map(s => s.name);

    // 1. Retrieve or extract course documents
    let documentContext = '';
    const relevantDocTitles: string[] = [];
    const db = getDb();
    const docMap = new Map<string, string>();

    // A. Check Supabase database first
    if (db) {
      try {
        let dbDocs: Array<{ id: string; title: string; content: string }> = [];

        if (courseId && typeof courseId === 'string' && courseId.includes('-')) {
          dbDocs = await db
            .select({ id: documents.id, title: documents.title, content: documents.content })
            .from(documents)
            .where(eq(documents.courseId, courseId))
            .limit(10);
        } else if (courseCode || course) {
          const matchedCourses = await db
            .select()
            .from(courses)
            .where(
              or(
                courseCode ? ilike(courses.title, `%${courseCode}%`) : undefined,
                course ? ilike(courses.title, `%${course.split('(')[0].trim()}%`) : undefined
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
        console.warn('Could not query Supabase documents:', dbErr);
      }
    }

    // B. For selected sources that have a URL, fetch & parse full text live
    for (const src of effectiveSources) {
      const lowerName = src.name.toLowerCase();
      const currentContent = docMap.get(lowerName) || '';
      if ((!docMap.has(lowerName) || currentContent.length < 50000) && src.url) {
        try {
          const extractedText = await parseDocumentFromUrl(src.url, src.name);
          if (extractedText && extractedText.trim() && extractedText.length > currentContent.length) {
            docMap.set(lowerName, extractedText);

            // If Supabase is connected, asynchronously save the extracted text to Supabase
            if (db) {
              try {
                let targetCourseId = (typeof courseId === 'string' && courseId.includes('-')) ? courseId : '';
                if (!targetCourseId) {
                  const existingCourses = await db.select().from(courses).limit(1);
                  if (existingCourses.length > 0) {
                    targetCourseId = existingCourses[0].id;
                  }
                }
                if (targetCourseId) {
                  await db.insert(documents).values({
                    courseId: targetCourseId,
                    title: src.name,
                    content: extractedText.slice(0, 1000000),
                  });
                }
              } catch {
                // background caching error is non-fatal
              }
            }
          }
        } catch (parseErr) {
          console.warn(`Could not extract document from URL ${src.url}:`, parseErr);
        }
      }
    }

    // Compile documents into context
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
        relevantDocTitles.push(src.name);
      }
    }

    if (compiledDocs.length > 0) {
      try {
        const relevantChunks = await retrieveRelevantChunks(question, compiledDocs, {
          topK: 6,
          maxTotalChars: 16000,
          minSimilarity: 0.15,
        });

        if (relevantChunks.length > 0) {
          documentContext = formatChunksForPrompt(relevantChunks);
        } else {
          const maxPerDoc = Math.max(2500, Math.floor(25000 / compiledDocs.length));
          documentContext = compiledDocs
            .map(
              (doc, idx) =>
                `--- TÀI LIỆU [${idx + 1}]: "${doc.title}" ---\n${doc.text.slice(0, maxPerDoc)}`
            )
            .join('\n\n');
        }
      } catch (ragErr) {
        console.warn('Semantic RAG retrieval error, fallback to basic context:', ragErr);
        const maxPerDoc = Math.max(2500, Math.floor(25000 / compiledDocs.length));
        documentContext = compiledDocs
          .map(
            (doc, idx) =>
              `--- TÀI LIỆU [${idx + 1}]: "${doc.title}" ---\n${doc.text.slice(0, maxPerDoc)}`
          )
          .join('\n\n');
      }
    }

    // 2. Prepare System Prompt with Domain Guardrail & Answer Style
    const subjectName = course || 'môn học hiện tại';

    const domainGuardrail = `QUY TẮC PHẠM VI MÔN HỌC (SUBJECT DOMAIN GUARDRAIL - BẮT BUỘC):
- Bạn là Trợ lý học tập chuyên biệt cho môn: "${subjectName}".
- TUYỆT ĐỐI KHÔNG trả lời những câu hỏi hoàn toàn lạc đề, không liên quan đến môn ${subjectName} (Ví dụ: hỏi bài tập Toán cao cấp trong lớp Lịch sử/Triết học, hỏi công thức nấu ăn/thời tiết trong lớp Lập trình Web).
- NẾU câu hỏi của sinh viên hoàn toàn nằm ngoài phạm vi môn ${subjectName}, hãy TỪ CHỐI LỊCH SỰ và hướng dẫn: "Câu hỏi này nằm ngoài phạm vi môn học ${subjectName}. Bạn vui lòng đặt câu hỏi liên quan đến kiến thức môn ${subjectName} để mình hỗ trợ tốt nhất nhé!".`;

    const styleInstruction =
      answerStyle === 'detailed'
        ? `PHONG CÁCH TRẢ LỜI: CHI TIẾT & CHUYÊN SÂU (DETAILED / IN-DEPTH MODE)
- Phân tích toàn diện, sâu sắc, giải thích rõ nguyên lý, cơ chế hoạt động, so sánh ưu/nhược điểm.
- Trình bày bài bản với các đề mục, bảng so sánh Markdown (dùng thẻ <br/> xuống dòng trong ô), kèm ví dụ minh họa và mã code/công thức cụ thể.`
        : `PHONG CÁCH TRẢ LỜI: NHANH & TRỌNG TÂM (QUICK / CONCISE MODE)
- Đi thẳng ngay vào câu trả lời cốt lõi, ngắn gọn, súc tích và mạch lạc.
- Sử dụng gạch đầu dòng rõ ràng, không giải thích lan man hay dài dòng, giúp sinh viên nắm bắt câu trả lời nhanh chóng.`;

    const externalInstruction = allowExternalSource
      ? `CHẾ ĐỘ MỞ RỘNG (ALLOW EXTERNAL SOURCES - OUT-OF-THE-BOX THINKING):
- Lấy tài liệu môn học làm nền tảng cốt lõi, đồng thời ĐƯỢC PHÉP liên hệ thực tế ngành, công nghệ hiện đại và góc nhìn sáng tạo (out-of-the-box) thuộc lĩnh vực của môn ${subjectName}.
- Khi đưa thêm thông tin thực tế nằm ngoài tài liệu cung cấp, hãy ghi chú rõ '[Mở rộng thực tế]' hoặc '[Góc nhìn chuyên sâu]'.`
      : `CHẾ ĐỘ BÁM SÁT TÀI LIỆU (STRICT GROUNDED MODE):
- Phân tích nghiêm ngặt và chỉ tổng hợp dựa trên văn bản tài liệu môn học được cung cấp bên dưới. Không tự bổ sung thực thể hoàn toàn nằm ngoài tài liệu.`;

    const factualGuardrail = `QUY TẮC BẢO ĐẢM TÍNH XÁC THỰC LỊCH SỬ & SỰ KIỆN (ANTI-HALLUCINATION & FACTUAL ACCURACY - BẮT BUỘC):
- TUYỆT ĐỐI KHÔNG BỊA ĐẶT hay suy diễn sai lệch về: Mốc thời gian (năm/tháng/ngày), địa điểm tổ chức, nhân vật, số liệu và nội dung các kỳ Đại hội/sự kiện lịch sử (Ví dụ: Đại hội I họp 1935 tại Ma Cao, Đại hội II họp 1951 tại Chiêm Hóa - Tuyên Quang, Đại hội III họp 1960 tại Hà Nội, Đại hội IV họp 1976 tại Hà Nội, Đại hội VI Đổi mới họp 1986 tại Hà Nội, Đại hội XIV họp 1/2026 tại Hà Nội).
- NẾU thông tin chi tiết mốc lịch sử/số liệu không có trong tài liệu được cấp và bạn không chắc chắn 100%, PHẢI NÓI RÕ "Thông tin mốc thời gian/địa điểm này cần đối chiếu thêm theo giáo trình chính thức của môn học", TUYỆT ĐỐI KHÔNG TỰ GHÉP NĂM HOẶC ĐỊA ĐIỂM BỪA BÃI.
- KHÔNG dùng một khuôn mẫu hay khẩu hiệu chung chung sao chép lặp lại cho nhiều kỳ Đại hội hay nhiều sự kiện khác nhau.`;

    const isFeedbackReview = question.toLowerCase().includes('nhận xét') || question.toLowerCase().includes('feedback') || question.toLowerCase().includes('bài thi');
    const feedbackInstruction = isFeedbackReview
      ? `\nĐẶC BIỆT KHI SINH VIÊN HỎI VỀ NHẬN XÉT BÀI THI CỦA GIẢNG VIÊN:
- Bạn là Gia sư AI tận tâm, phân tích chính xác nhận xét của giáo viên (str_feedback) được đề cập trong câu hỏi.
- Phản hồi mở đầu truyền cảm hứng, nêu bật nội dung thầy cô lưu ý (ví dụ: "Chào bạn, tôi thấy nhận xét bài kiểm tra yêu cầu tìm hiểu thêm về...").
- Đề xuất ngay các phương án hoặc chủ đề cụ thể để bắt đầu ôn tập từng bước nhằm giải quyết dứt điểm lỗ hổng kiến thức đó.\n`
      : '';

    const systemInstruction = `Bạn là Trợ lý Học tập AI chuyên trách môn "${subjectName}".

${domainGuardrail}

${factualGuardrail}

${styleInstruction}

${externalInstruction}
${feedbackInstruction}
QUY TẮC PHONG CÁCH & TRÌNH BÀY HỌC THUẬT (BẮT BUỘC):
1. ĐI THẲNG VÀO NỘI DUNG CHUYÊN MÔN: Tuyệt đối KHÔNG mở đầu bằng câu chào hỏi xã giao (như "Chào bạn", "Kính chào bạn", "Xin chào") và KHÔNG kết thúc bằng những câu chúc sáo rỗng. Bắt đầu ngay lập tức bằng nội dung câu trả lời hoặc phân tích chuyên môn.
2. VĂN PHONG CHUẨN MỰC, SƯ PHẠM: Sử dụng ngôn ngữ khoa học, trang trọng, chính xác, khách quan và mạch lạc. Tuyệt đối không dùng phong cách cợt nhả, suồng sã, mỉa mai hay tiếng lóng mạng xã hội.
3. TOÁN HỌC: Sử dụng LaTeX chuẩn dạng $công_thức$ (ví dụ: $O(1)$, $O(N^2)$, $N - 1$). Tuyệt đối KHÔNG gõ lệch thành \\$ hay $\\.
4. BẢNG BIỂU: Khi lập bảng so sánh (Markdown Table), dùng thẻ <br/> để xuống dòng giữa các ý trong cùng một ô. Không đặt code block 3 dấu nháy (\`\`\`) bên trong ô bảng Markdown; hãy đặt code block ở bên ngoài/dưới bảng.`;

    let contextSection = '';
    if (documentContext.trim()) {
      contextSection += documentContext;
    } else {
      contextSection += `Môn học: ${course}\nDanh sách tài liệu học tập đang chọn: ${effectiveSourceNames.join(', ') || 'Giáo trình & Tài liệu môn học'}\nChương trình học: Toàn bộ kiến thức, chuyên đề học tập và nội dung của môn ${course}.`;
    }

    const userPrompt = `Ngữ cảnh:
${contextSection}
---
CÂU HỎI CỦA SINH VIÊN: ${question}`;

    // 3. AI Execution via unified model registry
    let aiText = '';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let groundingMetadata: any = null;

    try {
      const result = await generateText(model, {
        system: systemInstruction,
        userPrompt,
        history: history.slice(-6).map(msg => ({
          role: msg.role === 'user' ? 'user' as const : 'assistant' as const,
          content: msg.text,
        })),
        temperature: 0.1,
        googleSearchGrounding: allowExternalSource,
      });
      aiText = result.text;
      groundingMetadata = result.groundingMetadata || null;
    } catch (err) {
      console.warn('AI generation failed:', err);
    }

    if (!aiText) {
      return NextResponse.json({
        answer: `⚠️ **Không thể kết nối API AI**\n\nVui lòng kiểm tra lại API key trong file \`.dev.vars\` / \`.env.local\`.`,
        sources: [],
      });
    }

    // Check if the response was a missing info response
    const isNotFoundResponse =
      aiText.toLowerCase().includes('không có trong tài liệu môn học được cung cấp') ||
      aiText.toLowerCase().includes('không có trong tài liệu được cung cấp') ||
      aiText.toLowerCase().includes('không thuộc phạm vi môn học');

    let citedSources: Array<{ name: string; isExternal: boolean; url: string }> = [];
    if (!isNotFoundResponse && allowExternalSource) {
      // 1. Extract exact grounded web pages from Google Search Grounding metadata
      if (groundingMetadata?.groundingChunks?.length) {
        const seenUrls = new Set<string>();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for (const chunk of groundingMetadata.groundingChunks as any[]) {
          const uri = chunk?.web?.uri;
          let title = chunk?.web?.title || '';
          if (uri) {
            if (!title) {
              try {
                title = new URL(uri).hostname.replace(/^www\./, '');
              } catch {
                title = 'Trang kiểm chứng';
              }
            }
            if (!seenUrls.has(uri) && citedSources.length < 5) {
              seenUrls.add(uri);
              citedSources.push({
                name: title,
                isExternal: true,
                url: uri,
              });
            }
          }
        }
      }

      // 2. Fallback to direct query search if no chunks returned
      if (citedSources.length === 0) {
        const cleanQ = question.replace(/[\r\n]+/g, ' ').trim();
        const searchTarget = cleanQ || course || 'Kiến thức chuyên ngành';
        const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchTarget)}`;
        const displayName = cleanQ ? `Kiểm chứng: ${cleanQ.length > 45 ? cleanQ.slice(0, 45) + '…' : cleanQ}` : 'Nguồn mở rộng thực tế & tra cứu Web';

        citedSources = [
          {
            name: displayName,
            isExternal: true,
            url: searchUrl,
          },
        ];
      }
    }

    return NextResponse.json({
      answer: aiText,
      sources: citedSources,
    });
  } catch (error) {
    console.error('Tutor Error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Lỗi kết nối tới Trợ lý AI.',
      },
      { status: 500 }
    );
  }
}
