import { NextResponse } from 'next/server';
import { generateText } from '@/models/registry';
import { getDb } from '@/db';
import { personalMaterials, chatSessions } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { supabaseAdmin } from '@/lib/supabase';
import { parseDocumentFromUrl } from '@/lib/document-parser';
import { retrieveRelevantChunks, formatChunksForPrompt } from '@/lib/rag';
import { getLearningArtifacts } from '@/lib/learning-artifacts';
import { getPersonalMaterials } from '@/lib/firebase-data';
import type { ExamResult } from '@/app/types';

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
      userId,
      sessionId,
      gradebook = [],
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
      userId?: number;
      sessionId?: string;
      gradebook?: ExamResult[];
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

    // 1. Retrieve or extract course documents from personal_materials / Moodle
    let documentContext = '';
    let artifactContext = '';
    let gradebookContext = '';
    const relevantDocTitles: string[] = [];
    const docMap = new Map<string, string>();
    const moodleCourseId = Number(courseId) || undefined;

    if (Array.isArray(gradebook) && gradebook.length > 0) {
      gradebookContext = gradebook
        .map((result, index) => {
          const score = `${result.score}/${result.maxScore}`;
          return `--- ĐIỂM LMS [${index + 1}] ---\nBài: ${result.name}\nĐiểm: ${score}${result.percentage ? ` (${result.percentage})` : ''}\nNhận xét: ${result.feedback || 'Chưa có nhận xét'}\nTrạng thái: ${result.passed === false ? 'Chưa đạt' : result.passed === true ? 'Đạt' : 'Chưa xác định'}`;
        })
        .join('\n\n');
    }

    if (moodleCourseId) {
      try {
        const artifacts = await getLearningArtifacts({
          userId: Number(userId) || 4,
          moodleCourseId,
          limit: 100,
        });
        if (artifacts.length > 0) {
          artifactContext = artifacts
            .map((artifact, index) => {
              const content = artifact.content_data || artifact.contentData || {};
              return `--- HỌC LIỆU ĐÃ LƯU [${index + 1}] (${artifact.artifact_type || artifact.artifactType}) ---\n${JSON.stringify(content).slice(0, 12000)}`;
            })
            .join('\n\n');
        }
      } catch (artifactErr) {
        console.warn('Could not query learning artifacts in tutor:', artifactErr);
      }
    }

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
        console.warn('Firebase personal_materials query in tutor:', firebaseError);
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
          console.warn('Could not query personal_materials via Supabase in tutor:', sbErr);
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
          console.warn('Could not query personal_materials via Drizzle in tutor:', dbErr);
        }
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
          }
        } catch (parseErr) {
          console.warn(`Could not parse source document ${src.name}:`, parseErr);
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

    // Detect structural / meta queries about the selected documents (TOC, chapters, overview, summary)
    const lowerQ = question.toLowerCase();
    const isDocOverviewQuery =
      lowerQ.includes('mục lục') ||
      lowerQ.includes('tóm tắt') ||
      lowerQ.includes('tổng quan') ||
      lowerQ.includes('tài liệu trên') ||
      lowerQ.includes('tài liệu này') ||
      lowerQ.includes('bao nhiêu chương') ||
      lowerQ.includes('các chương') ||
      lowerQ.includes('nội dung của tài liệu') ||
      lowerQ.includes('gồm những gì') ||
      lowerQ.includes('table of contents') ||
      lowerQ.includes('overview') ||
      lowerQ.includes('outline');

    if (compiledDocs.length > 0) {
      try {
        if (isDocOverviewQuery) {
          // Provide structural overview from each compiled document (first parts contain TOC/headings)
          const maxPerDoc = Math.max(3500, Math.floor(25000 / compiledDocs.length));
          documentContext = compiledDocs
            .map(
              (doc, idx) =>
                `--- TÀI LIỆU [${idx + 1}]: "${doc.title}" (Tổng quan & trích đoạn đầu) ---\n${doc.text.slice(0, maxPerDoc)}`
            )
            .join('\n\n');
        } else {
          const relevantChunks = await retrieveRelevantChunks(question, compiledDocs, {
            topK: 6,
            maxTotalChars: 16000,
            minSimilarity: 0.12,
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
    const selectedTopicsStr = effectiveSourceNames.length > 0
      ? effectiveSourceNames.join('; ')
      : 'Giáo trình và tài liệu môn học';

    const domainGuardrail = allowExternalSource
      ? `CHẾ ĐỘ MỞ RỘNG KIẾN THỨC ĐANG BẬT (EXTERNAL SOURCE MODE - ACTIVE):
- Sinh viên ĐANG BẬT chế độ 'Nguồn mở rộng'.
- Bạn ĐƯỢC PHÉP VÀ KHUYẾN KHÍCH trả lời, phân tích, giải thích chi tiết mọi câu hỏi về các công nghệ, ngôn ngữ lập trình, framework, kiến thức liên quan đến môn học và thực tế ngành.
- TUYỆT ĐỐI KHÔNG từ chối câu hỏi khi chế độ mở rộng đang bật.`
      : `CHẾ ĐỘ BÁM SÁT TÀI LIỆU (STRICT GROUNDED MODE):
- Bạn là Trợ lý Học tập AI chuyên trách cho môn: "${subjectName}".
- Danh sách tài liệu và chủ đề đang được chọn gồm: "${selectedTopicsStr}".
- KHI SINH VIÊN HỎI VỀ BẢN THÂN TÀI LIỆU (Ví dụ: hỏi mục lục, tóm tắt, cấu trúc các chương/phần, nội dung tài liệu này nói về gì...): Bạn PHẢI đọc nội dung văn bản tài liệu được cung cấp bên dưới, tổng hợp và liệt kê mục lục/cấu trúc các phần rõ ràng cho sinh viên. TUYỆT ĐỐI KHÔNG từ chối các câu hỏi về cấu trúc, mục lục hoặc tổng quan tài liệu.
- KHI CÂU HỎI THUỘC NỘI DUNG TÀI LIỆU HOẶC MÔN HỌC: Hãy giải thích đầy đủ, chính xác, sư phạm và nhiệt tình.
- CHỈ từ chối khi câu hỏi hoàn toàn lạc đề, không có chút liên quan nào tới môn học và không xuất hiện trong tài liệu (Ví dụ: hỏi công thức nấu ăn, thời tiết, giải trí). Khi từ chối, hãy phản hồi nhẹ nhàng theo mẫu:
  "Nội dung này hiện không có trong các nguồn tài liệu đang chọn hoặc chưa nằm trong phạm vi kiến thức chúng ta đã học của môn **${subjectName}**.
  
  💡 **Gợi ý cho bạn:**
  - Bạn có thể kiểm tra và tích chọn thêm các nguồn tài liệu liên quan ở danh sách bên trái.
  - Hoặc bật chế độ **'Mở rộng thực tế'** (ở góc dưới) để mình có thể tra cứu và giải đáp mở rộng thêm cho bạn nhé!"`;

    const styleInstruction =
      answerStyle === 'detailed'
        ? `PHONG CÁCH TRẢ LỜI: CHI TIẾT & CHUYÊN SÂU (DETAILED / IN-DEPTH MODE)
- Phân tích toàn diện, sâu sắc, giải thích rõ nguyên lý, cơ chế hoạt động, so sánh ưu/nhược điểm.
- Trình bày bài bản với các đề mục, bảng so sánh Markdown (dùng thẻ <br/> xuống dòng trong ô), kèm ví dụ minh họa và mã code/công thức cụ thể.`
        : `PHONG CÁCH TRẢ LỜI: NHANH & TRỌNG TÂM (QUICK / CONCISE MODE)
- Đi thẳng ngay vào câu trả lời cốt lõi, ngắn gọn, súc tích và mạch lạc.
- Sử dụng gạch đầu dòng rõ ràng, không giải thích lan man hay dài dòng, giúp sinh viên nắm bắt câu trả lời nhanh chóng.`;

    const externalInstruction = allowExternalSource
      ? `HƯỚNG DẪN TRẢ LỜI KHI BẬT MỞ RỘNG (EXTERNAL SOURCE MODE - ACTIVE):
- Lấy các tài liệu môn học làm nền tảng cốt lõi nếu có, đồng thời mở rộng và giải thích toàn diện câu hỏi của sinh viên dựa trên kiến thức chuyên môn thực tế ngành và tra cứu hiện đại.
- TÌM KIẾM & DẪN NGUỒN LIÊN KẾT NGOÀI (EXTERNAL LINK SOURCES - BẮT BUỘC):
  + Khi nhắc đến bất kỳ công nghệ, framework, thư viện, công cụ lập trình, tiêu chuẩn kỹ thuật hoặc tài liệu tham khảo chính thức nào (ví dụ: Electron, Tauri, Flutter, React, Vue, Docker, MDN, npm, GitHub repo...), hãy chủ động tìm và cung cấp đường dẫn chính thức (official website / documentation).
  + ĐỊNH DẠNG ĐƯỜNG DẪN: Bắt buộc định dạng liên kết Markdown chuẩn dạng [Tên Trang hoặc Công nghệ](https://đường-dẫn-chính-thức).
  + TUYỆT ĐỐI KHÔNG để link trong dấu code backtick (\`https://...\`). Hãy luôn dùng cú pháp [Tên](https://...) để sinh viên có thể nhấp mở và lưu trực tiếp vào tài liệu cá nhân.`
      : `HƯỚNG DẪN TRẢ LỜI KHI BÁM SÁT TÀI LIỆU:
- Phân tích và giải thích dựa trên nội dung tài liệu và các chủ đề chuyên môn của môn học ${subjectName} đã chọn ("${selectedTopicsStr}").
- Nếu câu hỏi nằm ngoài các nguồn tài liệu đã chọn, thông báo lịch sự theo mẫu hướng dẫn ở trên.
- Nếu sinh viên chủ động hỏi về tài liệu ngoài, trang web chính thức hoặc liên kết tham khảo, hãy cung cấp đường link Markdown [Tên](https://...) tương ứng để hỗ trợ sinh viên.`;

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

    const isQuizRemediation =
      question.toLowerCase().includes('bài kiểm tra') ||
      question.toLowerCase().includes('kết quả bài') ||
      question.toLowerCase().includes('lỗi sai') ||
      question.toLowerCase().includes('điểm mù') ||
      question.toLowerCase().includes('câu hỏi tôi bị') ||
      question.toLowerCase().includes('thực trạng bài thi');

    const remediationInstruction = isQuizRemediation
      ? `\nQUY TẮC PHÂN TÍCH BÀI THI & SỬA LỖI SAI (ADAPTIVE REMEDIATION - BẮT BUỘC):
- Sinh viên đang cần bạn phân tích các lỗi sai cụ thể trong bài kiểm tra để củng cố điểm số.
- BẮT BUỘC tập trung 100% vào các câu hỏi bị trừ điểm, các lựa chọn sai và các chủ đề yếu (weak concepts) được cung cấp trong câu hỏi.
- TUYỆT ĐỐI KHÔNG mở đầu bằng câu: "Hệ thống cần có nội dung cụ thể của câu hỏi" hay "Để phân tích chính xác nhất cần có đề bài". Toàn bộ nội dung câu hỏi và câu trả lời của sinh viên đã được cung cấp trực tiếp!
- TUYỆT ĐỐI KHÔNG giải thích dàn trải, lan man lý thuyết của toàn bộ môn học hoặc liệt kê toàn bộ các framework/chuyên đề không liên quan đến các câu sai.
- Hãy đi thẳng vào từng câu sai cụ thể: Phân tích tại sao đáp án đúng lại là như vậy, bẫy tư duy hoặc ngộ nhận khiến sinh viên chọn sai, và phương pháp nhớ/vận dụng chuẩn xác theo giáo trình môn học.\n`
      : '';

    const systemInstruction = `Bạn là Trợ lý Học tập AI chuyên trách môn "${subjectName}".

${domainGuardrail}

${factualGuardrail}

${styleInstruction}

${externalInstruction}
${feedbackInstruction}
${remediationInstruction}
QUY TẮC PHONG CÁCH & TRÌNH BÀY HỌC THUẬT (BẮT BUỘC):
1. ĐI THẲNG VÀO NỘI DUNG CHUYÊN MÔN: Tuyệt đối KHÔNG mở đầu bằng câu chào hỏi xã giao (như "Chào bạn", "Kính chào bạn", "Xin chào") và KHÔNG kết thúc bằng những câu chúc sáo rỗng. Bắt đầu ngay lập tức bằng nội dung câu trả lời hoặc phân tích chuyên môn.
2. VĂN PHONG CHUẨN MỰC, SƯ PHẠM: Sử dụng ngôn ngữ khoa học, trang trọng, chính xác, khách quan và mạch lạc. Tuyệt đối không dùng phong cách cợt nhả, suồng sã, mỉa mai hay tiếng lóng mạng xã hội.
3. TOÁN HỌC: Sử dụng LaTeX chuẩn dạng $công_thức$ (ví dụ: $O(1)$, $O(N^2)$, $N - 1$). Tuyệt đối KHÔNG gõ lệch thành \\$ hay $\\.
4. BẢNG BIỂU: Khi lập bảng so sánh (Markdown Table), dùng thẻ <br/> để xuống dòng giữa các ý trong cùng một ô. Không đặt code block 3 dấu nháy (\`\`\`) bên trong ô bảng Markdown; hãy đặt code block ở bên ngoài/dưới bảng.
5. LIÊN KẾT NGUỒN NGOÀI: Mọi liên kết URL dẫn nguồn tham khảo bên ngoài phải viết dưới dạng Markdown [Tên trang hoặc tài liệu](https://...). Tuyệt đối không đặt URL trong dấu backtick \`https://...\`.`;

    let contextSection = '';
    if (gradebookContext.trim()) {
      contextSection += `ĐIỂM VÀ NHẬN XÉT TỪ GRADEBOOK LMS (NGUỒN ẨN, KHÔNG HIỂN THỊ NHƯ TÀI LIỆU):\n${gradebookContext}\n\n`;
    }
    if (artifactContext.trim()) {
      contextSection += `HỌC LIỆU ĐÃ TẠO VÀ LƯU CHO MÔN HỌC:\n${artifactContext}\n\n`;
    }
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
    if (!isNotFoundResponse) {
      const seenUrls = new Set<string>();

      // 1. Extract exact grounded web pages from Google Search Grounding metadata
      if (allowExternalSource && groundingMetadata?.groundingChunks?.length) {
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
            const normUri = uri.trim().toLowerCase().replace(/\/+$/, '');
            if (!seenUrls.has(normUri) && citedSources.length < 6) {
              seenUrls.add(normUri);
              citedSources.push({
                name: title,
                isExternal: true,
                url: uri,
              });
            }
          }
        }
      }

      // 2. Extract markdown links explicitly provided in the AI text response
      const markdownLinkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
      let mdMatch: RegExpExecArray | null;
      while ((mdMatch = markdownLinkRegex.exec(aiText)) !== null) {
        const title = mdMatch[1].trim();
        const url = mdMatch[2].trim();
        const normUrl = url.toLowerCase().replace(/\/+$/, '');
        if (url && !seenUrls.has(normUrl) && citedSources.length < 8) {
          seenUrls.add(normUrl);
          citedSources.push({
            name: title || url,
            isExternal: true,
            url,
          });
        }
      }

      // 3. Extract bare/autolink URLs mentioned in the AI text
      const bareUrlRegex = /(?<!\()(https?:\/\/[^\s)\],`"<>]+)/g;
      let bareMatch: RegExpExecArray | null;
      while ((bareMatch = bareUrlRegex.exec(aiText)) !== null) {
        const url = bareMatch[1].trim();
        const normUrl = url.toLowerCase().replace(/\/+$/, '');
        if (url && !seenUrls.has(normUrl) && citedSources.length < 8) {
          seenUrls.add(normUrl);
          let host = url;
          try {
            host = new URL(url).hostname.replace(/^www\./, '');
          } catch {
            host = 'Nguồn liên kết';
          }
          citedSources.push({
            name: host,
            isExternal: true,
            url,
          });
        }
      }

      // 4. Fallback to direct query search if external mode is on but no sources were extracted
      if (allowExternalSource && citedSources.length === 0) {
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
