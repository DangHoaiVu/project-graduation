import { NextResponse } from 'next/server';
import { generateText } from '@/models/registry';
import { supabaseAdmin } from '@/lib/supabase';
import { parseDocumentFromUrl } from '@/lib/document-parser';
import {
  scoreAndSelectChunks,
  formatChunksForPrompt,
  chunkDocument,
  type DocumentChunk,
} from '@/lib/rag';
import { getPersonalMaterials } from '@/lib/firebase-data';
import {
  getStoredCourseEmbeddings,
  vectorizeAndStoreLmsSource,
  getExistingCourseFileIds,
} from '@/lib/supabase-vector';

interface ChatHistoryItem {
  role: 'user' | 'ai' | 'model' | 'assistant';
  text: string;
}

interface SourceItem {
  id?: string;
  name: string;
  url?: string;
  type?: string;
  fileId?: number;
  moduleId?: number;
  sectionId?: number;
  sectionName?: string;
  chapter?: string | number;
  isStudentUpload?: boolean;
  content?: string;
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

interface UpcomingEventItem {
  title: string;
  due?: string;
  type?: string;
}

export async function POST(request: Request) {
  try {
    const {
      question = '',
      course = '',
      courseCode = '',
      courseId,
      sources = [],
      sourceNames = [],
      history = [],
      model = 'auto',
      students,
      gradeColumns = [],
      upcomingEvents = [],
      allowExternalSource = false,
      answerStyle = 'concise',
    } = (await request.json()) as {
      question?: string;
      course?: string;
      courseCode?: string;
      courseId?: string | number;
      sources?: SourceItem[];
      sourceNames?: string[];
      history?: ChatHistoryItem[];
      model?: string;
      students?: StudentItem[] | StudentSummary;
      gradeColumns?: GradeColumnSummary[];
      upcomingEvents?: UpcomingEventItem[];
      allowExternalSource?: boolean;
      answerStyle?: 'concise' | 'detailed';
    };

    if (!question.trim()) {
      return NextResponse.json({ error: 'Câu hỏi không được để trống.' }, { status: 400 });
    }

    const moodleCourseId = Number(courseId) || undefined;
    const effectiveSources = Array.isArray(sources) ? sources : [];
    const effectiveSourceNames = Array.isArray(sourceNames) && sourceNames.length > 0
      ? sourceNames
      : effectiveSources.map(s => s.name);

    // 1. Retrieve ONLY checked course documents for RAG grounding
    let documentContext = '';
    const docMap = new Map<string, string>();
    const isStudentUploadSource = (src: SourceItem) =>
      Boolean(
        src.isStudentUpload ||
        src.id?.startsWith('mat-') ||
        src.id?.startsWith('upload-') ||
        src.id?.startsWith('url-') ||
        src.id?.startsWith('note-')
      );

    const checkedUploadSources = effectiveSources.filter(isStudentUploadSource);
    const checkedLmsSources = effectiveSources.filter(s => !isStudentUploadSource(s));

    // A. For checked LMS sources in Supabase pgvector:
    let storedLmsChunks: DocumentChunk[] = [];
    if (moodleCourseId && checkedLmsSources.length > 0) {
      try {
        const existingLmsFileIds = await getExistingCourseFileIds(moodleCourseId);
        const lmsToIngest = checkedLmsSources.filter(src => {
          const fid = Number(src.fileId || src.moduleId);
          return fid && !existingLmsFileIds.has(fid);
        });

        if (lmsToIngest.length > 0) {
          await Promise.allSettled(
            lmsToIngest.map(async src => {
              if (!src.url) return;
              try {
                const extractedText = await parseDocumentFromUrl(src.url, src.name);
                if (extractedText && extractedText.trim().length > 20) {
                  const fid = Number(src.fileId || src.moduleId) || 1;
                  await vectorizeAndStoreLmsSource({
                    moodleCourseId,
                    moodleFileId: fid,
                    documentTitle: src.name,
                    text: extractedText,
                    metadata: {
                      sectionId: src.sectionId,
                      sectionName: src.sectionName,
                      courseId: moodleCourseId,
                      courseCode,
                    },
                  });
                  docMap.set(src.name.toLowerCase(), extractedText);
                }
              } catch (parseErr) {
                console.warn(`Could not vectorize LMS document ${src.name}:`, parseErr);
              }
            })
          );
        }

        // Retrieve stored LMS vectors strictly for checked LMS sources
        const lmsTitles = checkedLmsSources.map(s => s.name);
        storedLmsChunks = await getStoredCourseEmbeddings(moodleCourseId, {
          docTitles: lmsTitles,
        });
      } catch (lmsVecErr) {
        console.warn('Teacher Assistant pgvector retrieval note:', lmsVecErr);
      }
    }

    // B. For checked teacher/user uploaded files or notes:
    // Only search materials matching the checked sources list!
    if (checkedUploadSources.length > 0) {
      // 1. Direct content if passed
      for (const src of checkedUploadSources) {
        if (src.content && src.content.trim()) {
          docMap.set(src.name.toLowerCase(), src.content.trim());
        }
      }

      // 2. Query Firebase personal materials ONLY for matching checked sources
      if (moodleCourseId) {
        try {
          const mats = await getPersonalMaterials({ moodleCourseId, limit: 30 });
          if (mats) {
            const matchingMats = mats.filter(m =>
              checkedUploadSources.some(s =>
                s.name.toLowerCase() === String(m.title).toLowerCase() ||
                (s.id && (s.id.includes(String(m.id)) || String(m.id).includes(s.id)))
              )
            );

            for (const mat of matchingMats) {
              const lowerTitle = String(mat.title).toLowerCase();
              if (mat.storage_url && !docMap.has(lowerTitle)) {
                try {
                  const text = await parseDocumentFromUrl(String(mat.storage_url), String(mat.title));
                  if (text && text.length > 20) {
                    docMap.set(lowerTitle, text);
                  }
                } catch {
                  // ignore
                }
              }
            }
          }
        } catch (firebaseErr) {
          console.warn('Firebase query for teacher upload materials:', firebaseErr);
        }
      }

      // 3. Fallback: Parse URL if provided directly on the checked source
      for (const src of checkedUploadSources) {
        const lowerName = src.name.toLowerCase();
        if (!docMap.has(lowerName) && src.url) {
          try {
            const extractedText = await parseDocumentFromUrl(src.url, src.name);
            if (extractedText && extractedText.trim().length > 20) {
              docMap.set(lowerName, extractedText.trim());
            }
          } catch (urlErr) {
            console.warn(`Could not parse checked upload ${src.name}:`, urlErr);
          }
        }
      }
    }

    // C. Combine Chunks strictly from checked sources
    const inMemoryChunks: DocumentChunk[] = [];
    for (const [title, text] of docMap.entries()) {
      const chunks = chunkDocument(title, text);
      inMemoryChunks.push(...chunks);
    }

    const allCandidateChunks: DocumentChunk[] = [...storedLmsChunks, ...inMemoryChunks];

    // Filter candidate chunks so they ONLY belong to titles in effectiveSources
    const allowedTitles = new Set(effectiveSources.map(s => s.name.toLowerCase().trim()));
    const filteredCandidateChunks = allCandidateChunks.filter(chunk => {
      if (allowedTitles.size === 0) return false;
      const t = chunk.docTitle.toLowerCase().trim();
      return allowedTitles.has(t) || Array.from(allowedTitles).some(at => t.includes(at) || at.includes(t));
    });

    const lowerQ = question.toLowerCase();
    const isOverviewQuery =
      lowerQ.includes('file') ||
      lowerQ.includes('tài liệu') ||
      lowerQ.includes('slide') ||
      lowerQ.includes('nội dung') ||
      lowerQ.includes('tóm tắt') ||
      lowerQ.includes('mục lục') ||
      lowerQ.includes('giới thiệu') ||
      lowerQ.includes('đề tài');

    if (filteredCandidateChunks.length > 0) {
      try {
        const relevantChunks = scoreAndSelectChunks(filteredCandidateChunks, question, {
          topK: 8,
          maxTotalChars: 20000,
          minSimilarity: 0.12,
        });

        // If the question is generic ("nội dung file", "tóm tắt", "slide này nói gì") or no chunk hit high score,
        // guarantee lead chunks of the checked documents are included.
        if (isOverviewQuery || relevantChunks.length < 2) {
          // Prepend lead chunks of each checked document to give the AI full context
          const leadChunks: DocumentChunk[] = [];
          const seenChunkIds = new Set(relevantChunks.map(c => c.id));
          for (const title of allowedTitles) {
            const docChunks = filteredCandidateChunks.filter(c =>
              c.docTitle.toLowerCase().trim() === title ||
              c.docTitle.toLowerCase().includes(title) ||
              title.includes(c.docTitle.toLowerCase())
            );
            docChunks.slice(0, 15).forEach(c => {
              if (!seenChunkIds.has(c.id)) {
                leadChunks.push(c);
                seenChunkIds.add(c.id);
              }
            });
          }
          const merged = [...leadChunks, ...relevantChunks].slice(0, 24);
          documentContext = formatChunksForPrompt(merged);
        } else {
          documentContext = formatChunksForPrompt(relevantChunks);
        }
      } catch (ragErr) {
        console.warn('Teacher Assistant RAG retrieval error:', ragErr);
        // Fallback: take top slices of each available doc
        documentContext = filteredCandidateChunks
          .slice(0, 8)
          .map((c, idx) => `--- [${idx + 1}] "${c.docTitle}" ---\n${c.text.slice(0, 2000)}`)
          .join('\n\n');
      }
    }

    const ragDocuments = filteredCandidateChunks.slice(0, 15).map((c, idx) => ({
      id: c.id || `doc_${idx + 1}`,
      title: c.docTitle || `Tài liệu ${idx + 1}`,
      text: c.text,
    }));

    // 2. Build Upcoming Events context for Course Reference
    let eventsContext = '';
    let upcomingEventsList: Array<{ title: string; due: string; type?: string }> = [];

    if (Array.isArray(upcomingEvents) && upcomingEvents.length > 0) {
      upcomingEventsList = upcomingEvents.map(e => ({
        title: e.title,
        due: e.due || '',
        type: e.type || 'Sự kiện',
      }));
    } else if (moodleCourseId && supabaseAdmin) {
      try {
        const { data: dbEvts } = await supabaseAdmin
          .from('events')
          .select('title, deliver_time, event_type')
          .eq('moodle_course_id', moodleCourseId)
          .gte('deliver_time', new Date().toISOString())
          .order('deliver_time', { ascending: true })
          .limit(8);

        if (dbEvts && dbEvts.length > 0) {
          upcomingEventsList = dbEvts.map(e => ({
            title: e.title,
            due: new Date(e.deliver_time).toLocaleString('vi-VN', {
              hour: '2-digit',
              minute: '2-digit',
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
            }),
            type: e.event_type,
          }));
        }
      } catch (evtErr) {
        console.warn('Teacher Assistant Supabase events query error:', evtErr);
      }
    }

    if (upcomingEventsList.length > 0) {
      eventsContext = upcomingEventsList
        .map((e, idx) => `  ${idx + 1}. [${e.type || 'Sự kiện'}] ${e.title} (Thời gian/Hạn chót: ${e.due || 'Chưa ấn định'})`)
        .join('\n');
    }

    // 3. Build Gradebook context for Course Reference
    let gradebookContext = '';
    if (Array.isArray(students) && students.length > 0) {
      gradebookContext += `- Sĩ số lớp: ${students.length} sinh viên\n`;
      if (gradeColumns.length > 0) {
        gradebookContext += `- Các cột điểm kiểm tra:\n`;
        gradeColumns.forEach((col, i) => {
          gradebookContext += `  ${i + 1}. "${col.name}" (Điểm tối đa: ${col.grademax}đ)\n`;
        });
      }

      gradebookContext += `\n- BẢNG ĐIỂM CHI TIẾT TỪNG SINH VIÊN (DỮ LIỆU ĐIỂM THỰC TẾ):\n`;
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
    } else if (students && typeof students === 'object' && 'total' in students && (students.total ?? 0) > 0) {
      gradebookContext += `- Sĩ số: ${students.total} sinh viên`;
      if (students.names && students.names.length > 0) {
        gradebookContext += `\n- Danh sách: ${students.names.slice(0, 30).join(', ')}`;
      }
    }

    // 4. Build System Instruction with strict separation
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

${allowExternalSource ? `CHẾ ĐỘ MỞ RỘNG KIẾN THỨC & SÁNG TẠO SƯ PHẠM / CÔNG NGHỆ TOÀN DIỆN (EXTERNAL SOURCES ALLOWED):
- Giảng viên ĐANG BẬT chế độ mở rộng.
- HÃY PHÁT HUY TỐI ĐA TRÍ TUỆ, TƯ DUY KIẾN TRÚC, KINH NGHIỆM THỰC CHIẾN VÀ NĂNG LỰC SƯ PHẠM CỦA BẠN:
${answerStyle === 'concise'
  ? `  + VÌ GIẢNG VIÊN ĐANG CHỌN "Nhanh / Trọng tâm": Khi hỏi về lựa chọn công nghệ / framework / giải pháp, BẮT BUỘC CHỌN ĐÚNG 1 PHƯƠNG ÁN TỐI ƯU NHẤT (SINGLE BEST PICK) kèm 1-2 lý do then chốt. CẤM liệt kê nhiều lựa chọn dông dài, CẤM lập bảng Markdown, CẤM mở bài tự xưng chức danh.`
  : `  + VÌ GIẢNG VIÊN ĐANG CHỌN "Chi tiết / Chuyên sâu": Khi hỏi về kiến trúc/công nghệ/bài giảng, hãy phân tầng rõ ràng (Backend, Frontend/Mobile, Real-time/Database), phân tích ưu/nhược điểm, case study thực tế và combo stack lý tưởng.`}
  + TUYỆT ĐỐI KHÔNG mở đầu bằng việc xưng danh "Với vai trò là...", "Tôi là kiến trúc sư...". Đi thẳng vào giải pháp.` : `BỘ QUY TẮC KHÓA KIẾN THỨC NỀN & CHỐNG ẢO GIÁC (REASONING OVER FACT):
- Chế độ tra cứu tài liệu nghiêm ngặt ĐANG ĐƯỢC BẬT (Nguồn ngoài: TẮT).
- SỬ DỤNG TÀI LIỆU ĐƯỢC CUNG CẤP TRONG THẺ <DOCUMENTS> LÀM NỀN TẢNG SỰ THẬT DUY NHẤT (FACTS).
- CẤM BỊA ĐẶT số liệu, định nghĩa, thực thể hoặc kiến thức không có trong tài liệu.
- TUY NHIÊN, BẠN ĐƯỢC PHÉP sử dụng khả năng tư duy logic và chuyên môn sư phạm của mình để giải thích, tóm tắt, so sánh hoặc ngoại suy dựa trên các sự thật đó để phục vụ công tác giảng dạy một cách tốt nhất.
- QUY TRÌNH PHẢN HỒI:
  + Quét thẻ <DOCUMENTS> để tìm các luận điểm, sự thật liên quan.
  + NẾU TÌM THẤY TRONG TÀI LIỆU: Trả lời bám sát sự thật tài liệu, trích dẫn nguồn [1], [2].
  + NẾU KHÔNG TÌM THẤY TRONG TÀI LIỆU: BẮT BUỘC trả về đúng mã [OUT_OF_CONTEXT] kèm lời giải thích:
    "Tài liệu bạn đã tích chọn không đề cập đến nội dung này. Vui lòng tích chọn thêm tài liệu phù hợp ở danh sách bên trái hoặc bật chế độ 'Cho phép nguồn ngoài' để AI tra cứu mở rộng."`}

QUY TẮC PHÂN ĐỊNH NGUỒN DỮ LIỆU TUYỆT ĐỐI (CỰC KỲ QUAN TRỌNG - KHÔNG ĐƯỢC NHẦM LẪN):
1. MỤC "CÁC TÀI LIỆU BÀI GIẢNG / HỌC TẬP ĐƯỢC CHỌN TỪ CỘT TRÁI":
   - Đây là tài liệu giáo trình, bài giảng, slide PowerPoint, tài liệu đồ án... mà Giảng viên ĐÃ TÍCH CHỌN ở danh sách nguồn tài liệu bên trái màn hình.
   - Bạn CHỈ ĐƯỢC đọc và trích dẫn kiến thức bài học từ các tài liệu ĐÃ ĐƯỢC TÍCH CHỌN trong thẻ <DOCUMENTS>.
   - KHI GIẢNG VIÊN HỎI VỀ "file này", "slide này", "tài liệu này", "nội dung của file", "tóm tắt bài giảng" hoặc kiến thức chuyên đề: Bạn BẮT BUỘC phải đọc và trả lời từ mục tài liệu được chọn này.
   - TUYỆT ĐỐI KHÔNG ĐƯỢC nhầm lẫn giữa tài liệu bài giảng/slide với phần SỔ ĐIỂM hay LỊCH SỰ KIỆN!
   - TUYỆT ĐỐI KHÔNG đem bảng điểm số của sinh viên ra để tóm tắt cho câu hỏi về nội dung file/slide bài giảng!

2. MỤC "THÔNG TIN SỔ ĐIỂM & ĐÁNH GIÁ LỚP HỌC":
   - Đây là dữ liệu quản lý điểm số và đánh giá sinh viên của môn học. AI luôn được cung cấp để biết thông tin lớp học.
   - CHỈ SỬ DỤNG dữ liệu này khi giảng viên hỏi về: điểm số, nhận xét sinh viên, phổ điểm, sinh viên nào cần hỗ trợ, thống kê điểm bài kiểm tra.
   - Khi trả lời về điểm: BẮT BUỘC dùng đúng số liệu thực tế, không tự bịa điểm.

3. MỤC "LỊCH TRÌNH & SỰ KIỆN SẮP TỚI":
   - Dùng khi giảng viên hỏi về thời hạn nộp bài tập, lịch thi, sự kiện sắp diễn ra của môn học.

QUY TẮC PHONG CÁCH & ĐỊNH DẠNG SƯ PHẠM (BẮT BUỘC):
1. ĐI THẲNG VÀO NỘI DUNG YÊU CẦU: Không dùng lời chào hỏi xã giao hay kết thúc sáo rỗng. Bắt đầu trực tiếp bằng nội dung tư vấn, phân tích hoặc sản phẩm bài giảng được yêu cầu.
2. PHONG CÁCH & MỨC ĐỘ CHI TIẾT (BẮT BUỘC TUÂN THỦ):
${answerStyle === 'detailed'
  ? '- Đang chọn "Chi tiết / Chuyên sâu": Phân tích toàn diện, sâu sắc, giải thích cặn kẽ nguyên lý, dẫn chứng đầy đủ, lập bảng so sánh hoặc hướng dẫn từng bước.'
  : '- Đang chọn "Nhanh / Trọng tâm": TUÂN THỦ NGHIÊM NGẶT độ dài dưới 80-150 từ (hoặc tối đa 2-3 gạch đầu dòng), đi thẳng vào kết luận/giải pháp then chốt. KHI HỎI NÊN DÙNG GÌ, BẮT BUỘC CHỌN ĐÚNG 1 CÁI DUY NHẤT. CẤM lập bảng Markdown, CẤM chia nhiều mục La Mã, không dông dài.'}
3. VĂN PHONG HỌC THUẬT CHUẨN MỰC: Sử dụng ngôn ngữ chuẩn sư phạm đại học, trang trọng, khúc chiết, chuẩn xác. Tuyệt đối không dùng phong cách suồng sã hay mỉa mai.
4. TOÁN HỌC: Sử dụng LaTeX chuẩn $công_thức$ (ví dụ: $O(n \\log n)$, $\\sum_{i=1}^{n}$).
5. BẢNG BIỂU: ${answerStyle === 'concise' ? 'Ở chế độ "Nhanh / Trọng tâm", CẤM dùng bảng Markdown Table.' : 'Dùng thẻ <br/> xuống dòng trong ô bảng Markdown. Không đặt code block bên trong ô bảng.'}
6. Khi soạn câu hỏi trắc nghiệm, trình bày rõ đáp án đúng và lời giải thích.
7. LIÊN KẾT NGUỒN NGOÀI: ${answerStyle === 'concise' ? 'Tối đa 1 link duy nhất nhúng inline [Tên](url). CẤM spam danh sách link.' : 'Mọi liên kết URL phải nhúng inline trực tiếp vào câu chữ dạng [Tên](https://...). TUYỆT ĐỐI KHÔNG tạo riêng từng gạch đầu dòng chỉ để dán link (như "• [Link](...)"). Tuyệt đối không tự bịa link.'}`;

    // 5. Build Grounded Context Prompt
    let contextSection = `MÔN HỌC: ${course} (Mã môn: ${courseCode || 'N/A'})\n\n`;

    // Document context section (Only checked sources) inside <DOCUMENTS> tags
    contextSection += `=== CÁC TÀI LIỆU BÀI GIẢNG / HỌC TẬP ĐƯỢC CHỌN TỪ CỘT TRÁI ===\n<DOCUMENTS>\n`;
    if (documentContext.trim()) {
      contextSection += `${documentContext}\n</DOCUMENTS>\n\n`;
    } else {
      contextSection += `Danh sách tài liệu đang chọn: ${effectiveSourceNames.join(', ') || '(Không có tài liệu nào được tích chọn)'}\n(Không có tài liệu nào được tích chọn hoặc tài liệu chưa có nội dung văn bản)\n</DOCUMENTS>\n\n`;
    }

    // Gradebook context section (Course reference)
    if (gradebookContext.trim()) {
      contextSection += `=== THÔNG TIN SỔ ĐIỂM & ĐÁNH GIÁ LỚP HỌC (DỮ LIỆU ĐIỂM SỐ NỘI BỘ, KHÔNG PHẢI NỘI DUNG TÀI LIỆU BÀI GIẢNG) ===\n${gradebookContext}\n\n`;
    }

    // Upcoming events context section (Course reference)
    if (eventsContext.trim()) {
      contextSection += `=== LỊCH TRÌNH & SỰ KIỆN SẮP TỚI CỦA KHÓA HỌC (CHỈ DÙNG KHI HỎI VỀ DEADLINE / SỰ KIỆN) ===\n${eventsContext}\n\n`;
    }

    const promptAnchor = answerStyle === 'concise' && !isOverviewQuery
      ? `\n\n[LỆNH TỐI CAO - NGHIÊM NGẶT TUÂN THỦ]:
Giảng viên đang chọn chế độ 'Nhanh / Trọng tâm'.
1. NẾU CÂU HỎI VỀ LỰA CHỌN CÔNG NGHỆ / FRAMEWORK / GIẢI PHÁP: Bạn BẮT BUỘC CHỈ ĐƯỢC CHỌN 1 ĐÁP ÁN DUY NHẤT TỐI ƯU NHẤT (Single Best Pick). Nêu tên trực tiếp ở câu đầu và nêu 1-2 lý do then chốt. CẤM liệt kê nhiều lựa chọn, CẤM phân tầng dài dòng, CẤM tự xưng danh phận.
2. TUYỆT ĐỐI CẤM DÙNG BẢNG BIỂU (Markdown Table). CẤM chèn danh sách nhiều link.
3. ĐỘ DÀI TỐI ĐA: Dưới 150 từ, trả lời thẳng thắn trong 1-2 đoạn văn.`
      : '';

    const userPrompt = `${contextSection}---\nYÊU CẦU CỦA GIẢNG VIÊN: ${question}${promptAnchor}`;

    // 6. Generate AI response
    let aiText = '';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let groundingMetadata: any = null;

    const effectiveTemperature = allowExternalSource
      ? (answerStyle === 'concise' ? 0.35 : 0.7)
      : 0.25;
    const effectiveTopP = allowExternalSource
      ? (answerStyle === 'concise' ? 0.8 : 0.95)
      : 0.3;
    const effectiveDocuments = allowExternalSource ? undefined : ragDocuments;
    const outOfContextStandardMsg = `Tài liệu bạn đã tích chọn không đề cập đến nội dung này. Vui lòng tích chọn thêm tài liệu phù hợp ở danh sách bên trái hoặc bật chế độ **"Cho phép nguồn ngoài"** để AI tra cứu mở rộng.`;

    let maxTokensLimit: number;
    if (isOverviewQuery) {
      maxTokensLimit = 1500;
    } else if (answerStyle === 'concise') {
      maxTokensLimit = 250;
    } else {
      maxTokensLimit = 2500;
    }

    try {
      const result = await generateText(model, {
        system: systemInstruction,
        userPrompt,
        history: history.slice(-8).map(msg => ({
          role: msg.role === 'user' ? ('user' as const) : ('assistant' as const),
          content: msg.text,
        })),
        temperature: effectiveTemperature,
        topP: effectiveTopP,
        maxTokens: maxTokensLimit,
        documents: effectiveDocuments,
        googleSearchGrounding: allowExternalSource,
        allowExternalSource: Boolean(allowExternalSource),
      });
      aiText = result.text;
      groundingMetadata = result.groundingMetadata || null;
    } catch (err) {
      console.warn('Teacher assistant AI generation failed:', err);
    }

    if (!aiText) {
      return NextResponse.json({
        answer: `⚠️ **Không thể kết nối API AI**\n\nVui lòng kiểm tra lại API key trong cấu hình hệ thống.`,
        sources: [],
      });
    }

    const isOutOfContext = aiText.includes('[OUT_OF_CONTEXT]');
    if (isOutOfContext) {
      aiText = outOfContextStandardMsg;
    }

    // 7. Extract grounding sources
    const citedSources: Array<{ name: string; isExternal: boolean; url: string }> = [];
    if (!isOutOfContext && groundingMetadata?.groundingChunks?.length) {
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
              title = 'Nguồn tham khảo';
            }
          }
          if (!seenUrls.has(uri) && citedSources.length < 5) {
            seenUrls.add(uri);
            citedSources.push({ name: title, isExternal: true, url: uri });
          }
        }
      }
    }

    // Include checked document names if they were utilized and not out of context
    if (!isOutOfContext && documentContext.trim() && effectiveSourceNames.length > 0) {
      effectiveSourceNames.slice(0, 3).forEach(name => {
        if (!citedSources.some(c => c.name === name)) {
          citedSources.unshift({
            name,
            isExternal: false,
            url: '',
          });
        }
      });
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
