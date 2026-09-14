import { NextResponse } from 'next/server';
import { generateText } from '@/models/registry';
import { getDb } from '@/db';
import { personalMaterials } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { supabaseAdmin } from '@/lib/supabase';
import { parseDocumentFromUrl } from '@/lib/document-parser';
import { retrieveRelevantChunks, formatChunksForPrompt } from '@/lib/rag';
import { getPersonalMaterials } from '@/lib/firebase-data';

interface ChatHistoryItem {
  role: 'user' | 'ai' | 'model' | 'assistant';
  text: string;
}

interface SourceItem {
  name: string;
  url?: string;
  type?: string;
}

interface StudentScoreItem {
  columnName: string;
  maxScore: number;
  score: number | null;
}

interface StudentItem {
  id: number | string;
  fullname: string;
  username?: string;
  idnumber?: string;
  scores?: StudentScoreItem[];
}

interface StudentSummary {
  total?: number;
  names?: string[];
}

interface GradeColumnSummary {
  id?: number | string;
  name: string;
  grademax: number;
}

export async function POST(request: Request) {
  try {
    const {
      question = '',
      course = '',
      courseCode = '',
      courseId,
      sources = [],
      history = [],
      model = 'auto',
      students,
      gradeColumns = [],
      gradebookScores = {},
      allowExternalSource = false,
      answerStyle = 'concise',
    } = (await request.json()) as {
      question?: string;
      course?: string;
      courseCode?: string;
      courseId?: string | number;
      sources?: SourceItem[];
      history?: ChatHistoryItem[];
      model?: string;
      students?: StudentItem[] | StudentSummary;
      gradeColumns?: GradeColumnSummary[];
      gradebookScores?: Record<string, Record<string, number | string>>;
      allowExternalSource?: boolean;
      answerStyle?: 'concise' | 'detailed';
    };

    if (!question.trim()) {
      return NextResponse.json({ error: 'Câu hỏi không được để trống.' }, { status: 400 });
    }

    // 1. Retrieve course documents for RAG grounding
    let documentContext = '';
    const db = getDb();
    const docMap = new Map<string, string>();

    const moodleCourseId = Number(courseId) || undefined;
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
        console.warn('Firebase materials query for teacher assistant:', firebaseError);
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
          console.warn('Could not query materials via Supabase for teacher assistant:', sbErr);
        }
      }

      if (db && docMap.size === 0) {
        try {
          const dbDocs = await db
            .select()
            .from(personalMaterials)
            .where(eq(personalMaterials.moodleCourseId, moodleCourseId))
            .limit(10);

          for (const doc of dbDocs) {
            if (doc.storageUrl && !docMap.has(doc.title.toLowerCase())) {
              try {
                const text = await parseDocumentFromUrl(doc.storageUrl, doc.title);
                if (text && text.length > 50) {
                  docMap.set(doc.title.toLowerCase(), text);
                }
              } catch {
                // ignore
              }
            }
          }
        } catch (dbErr) {
          console.warn('Could not query documents for teacher assistant:', dbErr);
        }
      }
    }

    // Fetch URLs from provided sources
    for (const src of sources.slice(0, 5)) {
      const lowerName = src.name.toLowerCase();
      if (!docMap.has(lowerName) && src.url) {
        try {
          const extractedText = await parseDocumentFromUrl(src.url, src.name);
          if (extractedText && extractedText.trim()) {
            docMap.set(lowerName, extractedText);
          }
        } catch {
          // non-fatal
        }
      }
    }

    // Compile and do RAG retrieval
    const compiledDocs: Array<{ title: string; text: string }> = [];
    for (const [title, text] of docMap.entries()) {
      if (text.trim() && !compiledDocs.some(d => d.title === title)) {
        compiledDocs.push({ title, text });
      }
    }

    if (compiledDocs.length > 0) {
      try {
        const relevantChunks = await retrieveRelevantChunks(question, compiledDocs, {
          topK: 8,
          maxTotalChars: 20000,
          minSimilarity: 0.12,
        });
        if (relevantChunks.length > 0) {
          documentContext = formatChunksForPrompt(relevantChunks);
        } else {
          const maxPerDoc = Math.max(3000, Math.floor(25000 / compiledDocs.length));
          documentContext = compiledDocs
            .map((doc, idx) => `--- TÀI LIỆU [${idx + 1}]: "${doc.title}" ---\n${doc.text.slice(0, maxPerDoc)}`)
            .join('\n\n');
        }
      } catch {
        const maxPerDoc = Math.max(3000, Math.floor(25000 / compiledDocs.length));
        documentContext = compiledDocs
          .map((doc, idx) => `--- TÀI LIỆU [${idx + 1}]: "${doc.title}" ---\n${doc.text.slice(0, maxPerDoc)}`)
          .join('\n\n');
      }
    }

    // 2. Build gradebook context if available
    let gradebookContext = '';
    if (Array.isArray(students) && students.length > 0) {
      gradebookContext += `\n\n--- KẾT QUẢ SỔ ĐIỂM THỰC TẾ CỦA LỚP HỌC ---\n`;
      gradebookContext += `- Sĩ số lớp: ${students.length} sinh viên\n`;
      if (gradeColumns.length > 0) {
        gradebookContext += `- Các cột điểm kiểm tra:\n`;
        gradeColumns.forEach((col, i) => {
          gradebookContext += `  ${i + 1}. "${col.name}" (Điểm tối đa: ${col.grademax}đ)\n`;
        });
      }

      gradebookContext += `\n- BẢNG ĐIỂM CHI TIẾT TỪNG SINH VIÊN (DỮ LIỆU THỰC TẾ):\n`;
      students.forEach(s => {
        const idInfo = s.idnumber || s.username ? ` [Mã SV: ${s.idnumber || s.username}]` : '';
        gradebookContext += `  * Sinh viên: **${s.fullname}**${idInfo}\n`;
        if (Array.isArray(s.scores) && s.scores.length > 0) {
          s.scores.forEach(sc => {
            if (sc.score !== null && sc.score !== undefined) {
              const pct = sc.maxScore > 0 ? ` (${Math.round((sc.score / sc.maxScore) * 100)}%)` : '';
              gradebookContext += `      - Cột "${sc.columnName}": **${sc.score}** / ${sc.maxScore}đ${pct}\n`;
            } else {
              gradebookContext += `      - Cột "${sc.columnName}": Chưa có điểm\n`;
            }
          });
        } else {
          gradebookContext += `      - Chưa có điểm ghi nhận\n`;
        }
      });
      gradebookContext += `---------------------------------------------------\n`;
    } else if (students && typeof students === 'object' && 'total' in students && (students.total ?? 0) > 0) {
      gradebookContext += `\n\nTHÔNG TIN LỚP HỌC:\n- Sĩ số: ${students.total} sinh viên`;
      if (students.names && students.names.length > 0) {
        gradebookContext += `\n- Danh sách: ${students.names.slice(0, 30).join(', ')}`;
      }
    }

    // 3. Build Teacher-focused System Prompt
    const subjectName = course || 'môn học hiện tại';

    const systemInstruction = `Bạn là TRỢ LÝ AI CHUYÊN BIỆT CHO GIẢNG VIÊN (Teacher AI Assistant) môn "${subjectName}".

VAI TRÒ & NĂNG LỰC:
Bạn hỗ trợ Giảng viên với TẤT CẢ các công việc giảng dạy, bao gồm:
1. GỢI Ý TÀI LIỆU & NGUỒN HỌC LIỆU: Đề xuất sách giáo khoa, bài báo khoa học, video bài giảng, trang web chuyên ngành, bài tập thực hành phù hợp với nội dung môn ${subjectName}. Ưu tiên nguồn tiếng Việt khi có, kèm nguồn quốc tế uy tín.
2. SOẠN BÀI TẬP VỀ NHÀ (Homework): Tạo bài tập với đề bài rõ ràng, yêu cầu cụ thể, tiêu chí chấm điểm (rubric), và gợi ý thời gian hoàn thành. Phân loại theo mức độ (cơ bản / nâng cao).
3. LẬP KẾ HOẠCH BÀI GIẢNG (Lesson Plan): Soạn kế hoạch bài giảng chi tiết bao gồm: mục tiêu học tập (Learning Outcomes), nội dung chính, hoạt động trên lớp, phương pháp giảng dạy, thời lượng dự kiến từng phần, và tài liệu tham khảo.
4. TẠO CÂU HỎI KIỂM TRA & ÔN TẬP: Soạn câu hỏi trắc nghiệm, tự luận, hoặc bài tập tình huống phù hợp với nội dung môn học. Đảm bảo phân bổ theo các mức độ nhận thức Bloom (Nhớ, Hiểu, Vận dụng, Phân tích, Đánh giá, Sáng tạo).
5. PHÂN TÍCH PHỔ ĐIỂM & HIỆU QUẢ GIẢNG DẠY: Khi có dữ liệu sổ điểm, phân tích chính xác điểm số, xác định sinh viên cần hỗ trợ, đánh giá hiệu quả từng cột điểm.
6. SOẠN NHẬN XÉT SINH VIÊN: Viết feedback chuyên nghiệp, mang tính xây dựng cho từng sinh viên hoặc nhóm dựa trên kết quả học tập.

QUY TẮC ĐẶC BIỆT KHI PHÂN TÍCH BẢNG ĐIỂM (BẮT BUỘC):
- Khi trả lời câu hỏi liên quan đến bảng điểm, đánh giá sinh viên, tìm sinh viên cần cải thiện:
  1. BẮT BUỘC sử dụng CHÍNH XÁC các con số từ phần "KẾT QUẢ SỔ ĐIỂM THỰC TẾ CỦA LỚP HỌC" được cung cấp bên dưới.
  2. TUYỆT ĐỐI KHÔNG TỰ BỊA, TỰ GIẢ ĐỊNH hoặc đổi số điểm của sinh viên (không được tự nghĩ ra điểm 5, 8, 60, 75,... nếu số liệu thật khác).
  3. Luôn đối chiếu điểm với điểm tối đa của cột (ví dụ: điểm 6 / 100đ là 6%, điểm 10 / 10đ là 100%) để nhận định chính xác sinh viên nào làm bài tốt ở cột nào và còn yếu ở cột nào.

QUY TẮC PHẠM VI:
- Tập trung vào môn "${subjectName}" và các chủ đề liên quan trực tiếp.
- ${allowExternalSource ? 'CHẾ ĐỘ MỞ RỘNG (EXTERNAL SOURCES ALLOWED): Ưu tiên tài liệu môn học, đồng thời được phép liên hệ thực tiễn ngành nghề, các giải pháp công nghệ hiện đại, tài liệu học thuật quốc tế và ví dụ thực tế phong phú.' : 'CHẾ ĐỘ BÁM SÁT NGHIÊM NGẶT (STRICT GROUNDING): Bám sát chặt chẽ nội dung tài liệu môn học và bảng điểm được cung cấp dưới đây, không suy diễn kiến thức ngoài giáo trình.'}
- Sử dụng ngôn ngữ chuyên nghiệp, chuẩn sư phạm đại học.

QUY TẮC PHONG CÁCH & ĐỊNH DẠNG SƯ PHẠM (BẮT BUỘC):
1. ĐI THẲNG VÀO NỘI DUNG YÊU CẦU: Không dùng lời chào hỏi xã giao hay kết thúc sáo rỗng. Bắt đầu trực tiếp bằng nội dung tư vấn, phân tích hoặc sản phẩm bài giảng được yêu cầu.
2. ${answerStyle === 'detailed' ? 'MỨC ĐỘ CHI TIẾT: Phân tích chuyên sâu, toàn diện, đa chiều, giải thích cặn kẽ nguyên lý, dẫn chứng đầy đủ và hướng dẫn thực hiện từng bước.' : 'MỨC ĐỘ CHI TIẾT: Phân tích nhanh, súc tích, đi thẳng vào các ý chính và giải pháp trọng tâm.'}
3. VĂN PHONG HỌC THUẬT CHUẨN MỰC: Sử dụng ngôn ngữ chuẩn sư phạm đại học, trang trọng, khúc chiết, chuẩn xác. Tuyệt đối không dùng phong cách suồng sã hay mỉa mai.
4. TOÁN HỌC: Sử dụng LaTeX chuẩn $công_thức$ (ví dụ: $O(n \\log n)$, $\\sum_{i=1}^{n}$).
5. BẢNG BIỂU: Dùng thẻ <br/> xuống dòng trong ô bảng Markdown. Không đặt code block bên trong ô bảng.
6. Khi soạn câu hỏi trắc nghiệm, trình bày rõ đáp án đúng và lời giải thích.`;

    let contextSection = '';
    if (documentContext.trim()) {
      contextSection = `\nTÀI LIỆU MÔN HỌC (làm cơ sở nội dung):\n${documentContext}`;
    } else {
      contextSection = `\nMÔN HỌC: ${course}\nMã môn: ${courseCode || 'N/A'}`;
    }

    if (gradebookContext) {
      contextSection += gradebookContext;
    }

    const userPrompt = `${contextSection}\n---\nYÊU CẦU CỦA GIẢNG VIÊN: ${question}`;

    // 4. Generate AI response
    let aiText = '';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let groundingMetadata: any = null;

    try {
      const result = await generateText(model, {
        system: systemInstruction,
        userPrompt,
        history: history.slice(-8).map(msg => ({
          role: msg.role === 'user' ? 'user' as const : 'assistant' as const,
          content: msg.text,
        })),
        temperature: 0.3,
        googleSearchGrounding: true,
      });
      aiText = result.text;
      groundingMetadata = result.groundingMetadata || null;
    } catch (err) {
      console.warn('Teacher assistant AI generation failed:', err);
    }

    if (!aiText) {
      return NextResponse.json({
        answer: `⚠️ **Không thể kết nối API AI**\n\nVui lòng kiểm tra lại API key trong file \`.dev.vars\` / \`.env.local\`.`,
        sources: [],
      });
    }

    // 5. Extract grounding sources
    let citedSources: Array<{ name: string; isExternal: boolean; url: string }> = [];
    if (groundingMetadata?.groundingChunks?.length) {
      const seenUrls = new Set<string>();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const chunk of groundingMetadata.groundingChunks as any[]) {
        const uri = chunk?.web?.uri;
        let title = chunk?.web?.title || '';
        if (uri) {
          if (!title) {
            try { title = new URL(uri).hostname.replace(/^www\./, ''); } catch { title = 'Nguồn tham khảo'; }
          }
          if (!seenUrls.has(uri) && citedSources.length < 5) {
            seenUrls.add(uri);
            citedSources.push({ name: title, isExternal: true, url: uri });
          }
        }
      }
    }

    if (citedSources.length === 0) {
      const searchQuery = question.replace(/[\r\n]+/g, ' ').trim().slice(0, 80);
      if (searchQuery) {
        citedSources = [{
          name: `Tra cứu: ${searchQuery.length > 50 ? searchQuery.slice(0, 50) + '…' : searchQuery}`,
          isExternal: true,
          url: `https://www.google.com/search?q=${encodeURIComponent(searchQuery + ' ' + course)}`,
        }];
      }
    }

    return NextResponse.json({
      answer: aiText,
      sources: citedSources,
    });
  } catch (error) {
    console.error('Teacher Assistant Error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Lỗi kết nối tới Trợ lý AI.' },
      { status: 500 }
    );
  }
}
