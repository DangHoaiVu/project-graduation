import { NextResponse } from 'next/server';
import { generateText, generateTextStream } from '@/models/registry';
import { supabaseAdmin } from '@/lib/supabase';
import { parseDocumentFromUrl } from '@/lib/document-parser';
import {
  retrieveRelevantChunks,
  formatChunksForPrompt,
  extractChapterNumber,
  scoreAndSelectChunks,
  indexDocuments,
  type RawDocument,
  type DocumentChunk,
} from '@/lib/rag';
import {
  getStoredCourseEmbeddings,
  getExistingCourseFileIds,
  vectorizeAndStoreLmsSource,
  sweepOrphanedCourseEmbeddings,
} from '@/lib/supabase-vector';
import { getLearningArtifacts } from '@/lib/learning-artifacts';
import { getPersonalMaterials } from '@/lib/firebase-data';
import type { ExamResult } from '@/app/types';
import { findCachedAnswer, storeCachedAnswer } from '@/lib/semantic-cache';

interface ChatHistoryItem {
  role: 'user' | 'ai' | 'model' | 'assistant';
  text: string;
}

interface SourceItem {
  id?: string;
  name: string;
  url?: string;
  type?: string;
  courseId?: string | number;
  moduleId?: number;
  fileId?: number;
  sectionId?: string | number;
  sectionName?: string;
  chapter?: string | number;
  isStudentUpload?: boolean;
}

interface UpcomingDeadlineItem {
  name: string;
  timestamp: number;
  type?: string;
  url?: string;
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
      userName,
      sessionId,
      gradebook = [],
      upcomingDeadlines = [],
      allowExternalSource = false,
      answerStyle = 'concise',
      history = [],
      model = 'auto',
      stream = false,
      sectionId,
      sectionName,
      chapter,
    } = (await request.json()) as {
      question?: string;
      sourceNames?: string[];
      sources?: SourceItem[];
      course?: string;
      courseCode?: string;
      courseId?: string | number;
      userId?: number;
      userName?: string;
      sessionId?: string;
      gradebook?: ExamResult[];
      upcomingDeadlines?: UpcomingDeadlineItem[];
      allowExternalSource?: boolean;
      answerStyle?: 'concise' | 'detailed';
      history?: ChatHistoryItem[];
      model?: string;
      stream?: boolean;
      sectionId?: string | number;
      sectionName?: string;
      chapter?: string | number;
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

    // 1b. Retrieve upcoming assignments & deadlines for this course (LMS Context Harvesting)
    let deadlineContext = '';
    const nowTimestamp = Date.now();
    let courseDeadlines: Array<{ name: string; due: string; type?: string }> = [];

    if (Array.isArray(upcomingDeadlines) && upcomingDeadlines.length > 0) {
      courseDeadlines = upcomingDeadlines
        .filter(d => d.timestamp > nowTimestamp)
        .slice(0, 6)
        .map(d => ({
          name: d.name,
          due: new Date(d.timestamp).toLocaleString('vi-VN', {
            hour: '2-digit',
            minute: '2-digit',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
          }),
          type: d.type,
        }));
    }

    if (courseDeadlines.length === 0 && moodleCourseId) {
      if (supabaseAdmin) {
        try {
          const { data: dbEvts } = await supabaseAdmin
            .from('events')
            .select('title, deliver_time, event_type')
            .eq('moodle_course_id', moodleCourseId)
            .gte('deliver_time', new Date().toISOString())
            .order('deliver_time', { ascending: true })
            .limit(6);

          if (dbEvts && dbEvts.length > 0) {
            courseDeadlines = dbEvts.map(e => ({
              name: e.title,
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
          console.warn('Could not query events via Supabase in tutor:', evtErr);
        }
      }
    }

    if (courseDeadlines.length > 0) {
      deadlineContext = courseDeadlines
        .map(
          (d, idx) =>
            `- [${idx + 1}] ${d.name} (Hạn chót: ${d.due}${d.type ? ` | Phân loại: ${d.type}` : ''})`
        )
        .join('\n');
    }

    if (moodleCourseId) {
      try {
        const artifacts = await getLearningArtifacts({
          userId: Number(userId) || 4,
          moodleCourseId,
          limit: 10,
        });
        if (artifacts.length > 0) {
          artifactContext = artifacts
            .slice(0, 5)
            .map((artifact, index) => {
              const title = artifact.title || artifact.artifact_type || 'Học liệu';
              return `- [Học liệu ${index + 1}] ${artifact.artifact_type.toUpperCase()}: "${title}"`;
            })
            .join('\n');
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

    }

    // 1c. Separate LMS Course Sources vs Student Personal Uploads
    // LMS sources are persisted in Supabase pgvector (`document_embeddings`)
    // Student personal uploads use traditional in-memory RAG
    const isStudentUploadSource = (src: SourceItem) =>
      Boolean(
        src.isStudentUpload ||
        src.id?.startsWith('mat-') ||
        src.id?.startsWith('upload-') ||
        src.id?.startsWith('url-') ||
        src.id?.startsWith('note-')
      );

    const studentSources = effectiveSources.filter(isStudentUploadSource);
    const lmsSources = effectiveSources.filter(s => !isStudentUploadSource(s));

    // A. For LMS sources in Supabase pgvector:
    let storedLmsChunks: DocumentChunk[] = [];
    if (moodleCourseId && lmsSources.length > 0) {
      try {
        const existingLmsFileIds = await getExistingCourseFileIds(moodleCourseId);

        // Files that need extraction & vectorization into Supabase
        const lmsToIngest = lmsSources.filter(src => {
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
                      chapter: src.chapter || extractChapterNumber(src.name) || undefined,
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

        // Garbage collection / Sweep in background: clean up any orphaned Moodle vectors
        const activeLmsFileIds = lmsSources
          .map(s => Number(s.fileId || s.moduleId))
          .filter(id => Boolean(id) && !isNaN(id));
        if (activeLmsFileIds.length > 0) {
          sweepOrphanedCourseEmbeddings(moodleCourseId, activeLmsFileIds).catch(() => {});
        }

        // Retrieve stored LMS vectors from Supabase
        storedLmsChunks = await getStoredCourseEmbeddings(moodleCourseId, {
          docTitles: lmsSources.map(s => s.name),
        });
      } catch (lmsVecErr) {
        console.warn('LMS pgvector retrieval note:', lmsVecErr);
      }
    }

    // B. For Student personal uploads: Traditional in-memory RAG
    const studentUrlsToFetch = studentSources.filter(
      src => src.url && !docMap.has(src.name.toLowerCase())
    );
    if (studentUrlsToFetch.length > 0) {
      await Promise.allSettled(
        studentUrlsToFetch.map(async src => {
          try {
            const extractedText = await parseDocumentFromUrl(src.url!, src.name);
            if (extractedText && extractedText.trim()) {
              docMap.set(src.name.toLowerCase(), extractedText);
            }
          } catch (parseErr) {
            console.warn(`Could not parse student document ${src.name}:`, parseErr);
          }
        })
      );
    }

    // Compile student documents
    const compiledStudentDocs: RawDocument[] = [];
    for (const src of studentSources) {
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
      if (text && text.trim() && !compiledStudentDocs.some(d => d.title === src.name)) {
        compiledStudentDocs.push({
          title: src.name,
          text,
          metadata: {
            sectionId: src.sectionId,
            sectionName: src.sectionName,
            chapter: src.chapter || extractChapterNumber(src.name) || undefined,
            courseId: moodleCourseId,
            courseCode,
          },
        });
        relevantDocTitles.push(src.name);
      }
    }

    // If LMS pgvector had 0 chunks (e.g. Supabase table empty or offline fallback), also compile LMS docs to memory
    if (storedLmsChunks.length === 0 && lmsSources.length > 0) {
      const remainingUrls = lmsSources.filter(
        src => src.url && !docMap.has(src.name.toLowerCase())
      );
      if (remainingUrls.length > 0) {
        await Promise.allSettled(
          remainingUrls.map(async src => {
            try {
              const extractedText = await parseDocumentFromUrl(src.url!, src.name);
              if (extractedText && extractedText.trim()) {
                docMap.set(src.name.toLowerCase(), extractedText);
              }
            } catch {}
          })
        );
      }

      for (const src of lmsSources) {
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
        if (text && text.trim() && !compiledStudentDocs.some(d => d.title === src.name)) {
          compiledStudentDocs.push({
            title: src.name,
            text,
            metadata: {
              sectionId: src.sectionId,
              sectionName: src.sectionName,
              chapter: src.chapter || extractChapterNumber(src.name) || undefined,
              courseId: moodleCourseId,
              courseCode,
            },
          });
          relevantDocTitles.push(src.name);
        }
      }
    }

    // Index student documents into RAM chunks
    let indexedStudentChunks: DocumentChunk[] = [];
    if (compiledStudentDocs.length > 0) {
      try {
        indexedStudentChunks = await indexDocuments(compiledStudentDocs);
      } catch (idxErr) {
        console.warn('Index student documents error:', idxErr);
      }
    }

    // Combine candidate chunks: Persistent pgvector chunks + In-memory student chunks
    const allCandidateChunks: DocumentChunk[] = [...storedLmsChunks, ...indexedStudentChunks];

    // Detect structural / meta queries about the selected documents (TOC, chapters, overview, summary)
    const lowerQ = question.toLowerCase();
    const isDocOverviewQuery =
      lowerQ.includes('mục lục') ||
      lowerQ.includes('tóm tắt') ||
      lowerQ.includes('tổng hợp') ||
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

    let ragDocuments: Array<{ id?: string; title?: string; text: string }> = [];

    if (allCandidateChunks.length > 0) {
      try {
        if (isDocOverviewQuery) {
          // Provide structural overview from candidate documents (first chunks contain TOC/headings)
          const docTitles = Array.from(new Set(allCandidateChunks.map(c => c.docTitle)));
          const leadChunks: DocumentChunk[] = [];
          documentContext = docTitles
            .map((title, idx) => {
              const docChunks = allCandidateChunks
                .filter(c => c.docTitle === title)
                .sort((a, b) => a.chunkIndex - b.chunkIndex)
                .slice(0, 3);
              leadChunks.push(...docChunks);
              const previewText = docChunks.map(c => c.text).join('\n').slice(0, 3000);
              return `--- TÀI LIỆU [${idx + 1}]: "${title}" (Tổng quan & trích đoạn đầu) ---\n${previewText}`;
            })
            .join('\n\n');
          ragDocuments = leadChunks.slice(0, 15).map(c => ({
            id: c.id,
            title: c.docTitle,
            text: c.text,
          }));
        } else {
          // Metadata Filtering (Chapter / Section)
          let candidateChunks = allCandidateChunks;
          const targetSectionId = sectionId;
          const targetSectionName = sectionName?.toLowerCase();
          const queryChapter = extractChapterNumber(question);
          const targetChapter = chapter ? String(chapter).toLowerCase() : queryChapter;

          if (targetSectionId !== undefined || targetSectionName || targetChapter) {
            const filtered = allCandidateChunks.filter(chunk => {
              const meta = chunk.metadata;
              if (targetSectionId !== undefined && meta?.sectionId !== undefined) {
                if (String(meta.sectionId) === String(targetSectionId)) return true;
              }
              if (targetChapter) {
                const chunkChap = meta?.chapter ? String(meta.chapter).toLowerCase() : null;
                if (chunkChap === targetChapter) return true;
                const lowerTitle = chunk.docTitle.toLowerCase();
                if (
                  lowerTitle.includes(`chương ${targetChapter}`) ||
                  lowerTitle.includes(`chuong ${targetChapter}`) ||
                  lowerTitle.includes(`chapter ${targetChapter}`) ||
                  lowerTitle.includes(`bài ${targetChapter}`) ||
                  lowerTitle.includes(`bai ${targetChapter}`)
                ) {
                  return true;
                }
              }
              if (targetSectionName && meta?.sectionName) {
                if (meta.sectionName.toLowerCase().includes(targetSectionName)) return true;
              }
              return false;
            });

            if (filtered.length > 0) {
              console.log(
                `[RAG Metadata Filter] Restricted vector search from ${allCandidateChunks.length} down to ${filtered.length} chunks`
              );
              candidateChunks = filtered;
            }
          }

          // Score candidate chunks & select with Dynamic Top-K cut-off thresholding
          const relevantChunks = scoreAndSelectChunks(candidateChunks, question, {
            topK: 5,
            maxTotalChars: 8000,
            minSimilarity: 0.78, // Dynamic Cutoff Threshold
            dynamicTopK: true,
          });

          if (relevantChunks.length > 0) {
            documentContext = formatChunksForPrompt(relevantChunks);
            ragDocuments = relevantChunks.map(c => ({
              id: c.id,
              title: c.docTitle,
              text: c.text,
            }));
          } else if (allowExternalSource) {
            const firstChunk = allCandidateChunks[0];
            if (firstChunk) {
              documentContext = `--- TRÍCH ĐOẠN TỔNG QUAN: "${firstChunk.docTitle}" ---\n${firstChunk.text.slice(0, 1200)}`;
              ragDocuments = [{ id: firstChunk.id, title: firstChunk.docTitle, text: firstChunk.text }];
            }
          } else {
            // Strict Mode (No external source): When no chunk meets threshold, leave empty to force [OUT_OF_CONTEXT]
            documentContext = '';
            ragDocuments = [];
          }
        }
      } catch (ragErr) {
        console.warn('Semantic RAG retrieval error, fallback to basic context:', ragErr);
        if (allowExternalSource) {
          const firstChunk = allCandidateChunks[0];
          if (firstChunk) {
            documentContext = `--- TRÍCH ĐOẠN: "${firstChunk.docTitle}" ---\n${firstChunk.text.slice(0, 1500)}`;
            ragDocuments = [{ id: firstChunk.id, title: firstChunk.docTitle, text: firstChunk.text }];
          }
        }
      }
    }

    // 2. Prepare System Prompt with Domain Guardrail & Answer Style
    const subjectName = course || 'môn học hiện tại';
    const selectedTopicsStr = effectiveSourceNames.length > 0
      ? effectiveSourceNames.join('; ')
      : 'Giáo trình và tài liệu môn học';

    const domainGuardrail = allowExternalSource
      ? `CHẾ ĐỘ MỞ RỘNG KIẾN THỨC & SÁNG TẠO KIẾN TRÚC TOÀN DIỆN (EXTERNAL SOURCE MODE - FULL ARCHITECTURAL CREATIVITY):
- Sinh viên ĐANG BẬT chế độ 'Nguồn mở rộng'.
- HÃY PHÁT HUY TỐI ĐA TRÍ TUỆ, TƯ DUY KIẾN TRÚC, KINH NGHIỆM THỰC CHIẾN VÀ SỰ SÁNG TẠO CỦA AI:
  + Bạn đóng vai trò như một Kiến trúc sư Hệ thống Trưởng (Principal Solution Architect) & Tech Lead hàng đầu.
  + Tự do liên hệ thực tiễn ngành công nghệ hiện đại và các giải pháp kiến trúc phần mềm thực tế nổi tiếng thế giới (Meta, Instagram, Netflix, Pinterest, Twitter/X, Discord, TikTok, Uber...).
  + KHI ĐƯỢC HỎI VỀ CÔNG NGHỆ, FRAMEWORK HOẶC GIẢI PHÁP XÂY DỰNG HỆ THỐNG (ví dụ: xây dựng mạng xã hội, e-commerce, hệ thống chat thời gian thực, stream video...):
    * PHÂN TẦNG RÕ RÀNG: Bắt buộc chia thành các khối rõ rệt: **Backend Framework (Phía máy chủ)**, **Frontend & Mobile Framework (Phía người dùng)**, và **Dịch vụ Thời gian thực / Database** nếu cần.
    * ĐƯA RA CÁC ỨNG CỬ VIÊN SÁNG GIÁ NHẤT: Nêu rõ từng framework tiêu biểu (ví dụ: Django, Laravel, Spring Boot, Node.js/Express/NestJS cho Backend; React/Next.js, Vue/Nuxt.js, Flutter cho Frontend/Mobile).
    * LÝ DO & CASE STUDY THỰC TẾ: Với mỗi framework, giải thích ngắn gọn ưu thế vượt trội và dẫn chứng thực tế (ví dụ: Django mạnh về bảo mật & có sẵn admin - Instagram/Pinterest từng dùng; Spring Boot cho hệ thống chịu tải khủng; Express.js/NestJS cho tính năng real-time chat cực nhanh; Next.js cho giao diện tối ưu SEO & SPA).
    * GỢI Ý COMBO TECH STACK LÝ TƯỞNG: Đưa ra đề xuất kết hợp cụ thể (ví dụ: Backend Express + Frontend Next.js + Socket.io + PostgreSQL) để sinh viên có cái nhìn toàn cảnh và bắt tay vào làm được ngay.
  + Trình bày sinh động, chuyên nghiệp, cấu trúc rõ ràng với các gạch đầu dòng và phân nhóm mạch lạc như phong cách Google AI Overview / Senior Tech Advisor.`
      : `BỘ QUY TẮC KHÓA KIẾN THỨC NỀN & CHỐNG ẢO GIÁC (STRICT GROUNDING & ANTI-HALLUCINATION):
- Bạn là hệ thống tra cứu tài liệu nghiêm ngặt môn "${subjectName}". Chế độ tra cứu tài liệu nghiêm ngặt ĐANG ĐƯỢC BẬT (Nguồn ngoài: TẮT).
- Bạn CHỈ ĐƯỢC PHÉP trả lời dựa trên các thông tin nằm trong thẻ <DOCUMENTS> (và dữ liệu Sổ điểm/Lịch trình khóa học được cung cấp bên dưới).
- TUYỆT ĐỐI KHÔNG được sử dụng kiến thức huấn luyện sẵn (pre-trained knowledge / weights) trong não bạn để giải thích kiến thức ngoài tài liệu (Ví dụ: sinh viên hỏi về Java Spring Boot, Vue, Docker, AWS, kiến trúc microservices... mà trong thẻ <DOCUMENTS> không hề có các nội dung này).

QUY TRÌNH PHẢN HỒI BẮT BUỘC THEO THUẬT TOÁN (ALGORITHM):
BƯỚC 1: Quét toàn bộ nội dung trong thẻ <DOCUMENTS> để tìm các đoạn có thông tin trả lời cho câu hỏi.
BƯỚC 2: NẾU TÌM THẤY TRONG TÀI LIỆU:
  - Trả lời bám sát 100% nội dung tài liệu, có trích dẫn nguồn số [1], [2] tương ứng.
BƯỚC 3: NẾU KHÔNG TÌM THẤY TRONG TÀI LIỆU (hoặc tài liệu bạn chọn không đề cập đến chủ đề sinh viên hỏi, hoặc thẻ <DOCUMENTS> rỗng/chưa tích chọn tài liệu phù hợp):
  - TUYỆT ĐỐI KHÔNG tự động dùng kiến thức nền để giảng giải hay trả lời thay thế.
  - BẮT BUỘC trả về đúng một chuỗi mã: [OUT_OF_CONTEXT] kèm lời giải thích:
    "Tài liệu bạn đã tích chọn không đề cập đến nội dung này. Vui lòng tích chọn thêm tài liệu phù hợp ở danh sách bên trái hoặc bật chế độ 'Cho phép nguồn ngoài' để AI tra cứu mở rộng."`;

    const styleInstruction =
      answerStyle === 'detailed'
        ? `PHONG CÁCH TRẢ LỜI: CHI TIẾT & CHUYÊN SÂU (DETAILED / IN-DEPTH MODE)
- Phân tích toàn diện, sâu sắc, giải thích rõ nguyên lý, cơ chế hoạt động, so sánh ưu/nhược điểm.
- Trình bày bài bản với các đề mục, bảng so sánh Markdown (dùng thẻ <br/> xuống dòng trong ô), kèm ví dụ minh họa và mã code/công thức cụ thể.`
        : `PHONG CÁCH TRẢ LỜI: TRỌNG TÂM & ĐỦ Ý (HIGH-IMPACT / WELL-STRUCTURED MODE)
- Trình bày dạng các phân mục và gạch đầu dòng sắc bén, chia khối rõ ràng (Backend, Frontend/Mobile, Database).
- Mỗi ý nêu bật ngay đặc tính cốt lõi và dẫn chứng thực tiễn, không trả lời cụt lủn hay sơ sài chỉ 1-2 dòng chung chung.`;

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

    const studentName = userName?.trim() || 'Sinh viên';
    const studentId = userId || 4;
    const lmsGroundingContext = `NGỮ CẢNH HỌC TẬP & DANH TÍNH SINH VIÊN (LMS GROUNDING):
- Người dùng hiện tại: ${studentName} (Moodle User ID: ${studentId}).
- Môn học đang mở: "${subjectName}"${courseCode ? ` [Mã môn: ${courseCode}]` : ''}${moodleCourseId ? ` [Course ID: ${moodleCourseId}]` : ''}.
${deadlineContext ? `- ÁP LỰC HỌC TẬP & DEADLINE SẮP TỚI CỦA MÔN NÀY:\n${deadlineContext}\n* HƯỚNG DẪN NHẮC NHỞ DEADLINE: Hãy trả lời câu hỏi của sinh viên ngắn gọn, chính xác, bám sát nội dung tài liệu môn học. Khi câu hỏi liên quan đến bài tập, ôn tập, chuẩn bị kiểm tra hoặc kết thúc phần giải thích, hãy khéo léo và tế nhị nhắc nhở sinh viên về hạn nộp bài tập sắp tới để chủ động hoàn thành đúng hạn.` : '- Môn học này hiện không có bài tập hoặc deadline nào sắp đến hạn trong tuần này.'}`;

    const systemInstruction = `Bạn là Trợ lý Học tập AI chuyên trách môn "${subjectName}" trên hệ thống LMS Assistant.

${lmsGroundingContext}

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
5. LIÊN KẾT NGUỒN NGOÀI: Mọi liên kết URL dẫn nguồn tham khảo bên ngoài phải viết dưới dạng Markdown [Tên trang hoặc tài liệu](https://...). Tuyệt đối không đặt URL trong dấu backtick \`https://...\`.
6. TRÍCH DẪN NGUỒN TÀI LIỆU & HỌC LIỆU (TINH GỌN & CHỐNG SPAM):
- Khi tham khảo từ các đoạn trích giáo trình hoặc học liệu đã lưu được cung cấp, nếu cần ghi nhận nguồn, CHỈ dùng số thứ tự ngắn gọn trong ngoặc vuông dạng [1], [2], [5].
- TUYỆT ĐỐI KHÔNG viết từ ngữ dài dòng như "[trích đoạn 5]", "[đoạn trích 5]", "[HỌC LIỆU ĐÃ LƯU 2]" hay "[học liệu 2]".
- TUYỆT ĐỐI KHÔNG lặp lại mã trích dẫn sau mỗi dấu phẩy, mỗi câu ngắn hay mỗi gạch đầu dòng liên tiếp. Trong cùng một đoạn văn hoặc một bảng, chỉ cần trích dẫn 1 lần duy nhất ở luận điểm trọng tâm nhất để đảm bảo văn bản sạch sẽ, thông suốt và dễ theo dõi.
7. TUYỆT ĐỐI KHÔNG LẶP TIÊU ĐỀ: Tuyệt đối KHÔNG sao chép, trích lại hay lặp lại các tiêu đề trích đoạn dạng "[ĐOẠN TRÍCH TÀI LIỆU ...]" hay "--- NỘI DUNG TỪ TÀI LIỆU ---" vào trong câu trả lời. Hãy đi thẳng vào phân tích, giải thích và trình bày mạch lạc nội dung chuyên môn.`;

    let contextSection = '';
    if (gradebookContext.trim()) {
      contextSection += `=== SỔ ĐIỂM CỦA SINH VIÊN (DỮ LIỆU ĐIỂM SỐ NỘI BỘ, KHÔNG PHẢI NỘI DUNG TÀI LIỆU BÀI GIẢNG) ===\n${gradebookContext}\n\n`;
    }
    if (deadlineContext.trim()) {
      contextSection += `=== LỊCH TRÌNH & HẠN CHÓT SẮP TỚI CỦA MÔN HỌC (DÙNG KHI HỎI VỀ DEADLINE/BÀI TẬP/THI) ===\n${deadlineContext}\n\n`;
    }
    if (artifactContext.trim()) {
      contextSection += `=== HỌC LIỆU ĐÃ TẠO VÀ LƯU CHO MÔN HỌC ===\n${artifactContext}\n\n`;
    }
    contextSection += `=== CÁC TÀI LIỆU BÀI GIẢNG / HỌC TẬP ĐƯỢC CHỌN TỪ CỘT TRÁI ===\n<DOCUMENTS>\n`;
    if (documentContext.trim()) {
      contextSection += `${documentContext}\n</DOCUMENTS>\n\n`;
    } else {
      contextSection += `(Không có tài liệu nào được tích chọn hoặc không tìm thấy thông tin phù hợp trong các tài liệu đã chọn)\n</DOCUMENTS>\n\n`;
    }

    const userPrompt = `Ngữ cảnh:
${contextSection}
---
CÂU HỎI CỦA SINH VIÊN: ${question}`;

    const isPersonalQuery = Boolean(gradebookContext.trim());
    let cachedHit = null;
    if (!isPersonalQuery && (!history || history.length <= 1)) {
      try {
        cachedHit = await findCachedAnswer({
          question,
          courseId: moodleCourseId,
          threshold: 0.90, // 90% cosine similarity threshold
        });
      } catch (cacheErr) {
        console.warn('Semantic cache lookup error:', cacheErr);
      }
    }

    const isStream = Boolean(stream || request.headers.get('accept')?.includes('text/event-stream'));
    const effectiveTemperature = allowExternalSource ? 0.75 : 0.0;
    const effectiveTopP = allowExternalSource ? 0.95 : 0.05;
    const effectiveDocuments = allowExternalSource ? undefined : ragDocuments;
    const outOfContextNotice = `Tài liệu bạn đã tích chọn không đề cập đến nội dung này. Vui lòng tích chọn thêm tài liệu phù hợp ở danh sách bên trái hoặc bật chế độ **"Cho phép nguồn ngoài"** để AI tra cứu mở rộng.`;

    if (cachedHit) {
      const citedSources = extractCitedSources(
        cachedHit.answer,
        allowExternalSource,
        question,
        course,
        null
      );

      if (isStream) {
        const encoder = new TextEncoder();
        const readableStream = new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ delta: cachedHit.answer })}\n\n`)
            );
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  done: true,
                  sources: citedSources,
                  model: 'Bộ nhớ đệm (Semantic Cache - 0 token)',
                  modelId: 'cache:semantic',
                  provider: 'cache',
                  cached: true,
                })}\n\n`
              )
            );
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          },
        });

        return new Response(readableStream, {
          headers: {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
          },
        });
      }

      return NextResponse.json({
        answer: cachedHit.answer,
        sources: citedSources,
        model: 'Bộ nhớ đệm (Semantic Cache - 0 token)',
        provider: 'cache',
        cached: true,
      });
    }

    if (isStream) {
      const encoder = new TextEncoder();
      const readableStream = new ReadableStream({
        async start(controller) {
          let accumulatedText = '';
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let streamGroundingMetadata: any = null;

          try {
            const streamResult = await generateTextStream(model, {
              system: systemInstruction,
              userPrompt,
              history: history.slice(-6).map(msg => ({
                role: msg.role === 'user' ? ('user' as const) : ('assistant' as const),
                content: msg.text,
              })),
              temperature: effectiveTemperature,
              topP: effectiveTopP,
              documents: effectiveDocuments,
              googleSearchGrounding: allowExternalSource,
              allowExternalSource: Boolean(allowExternalSource),
              onMeta: (meta) => {
                controller.enqueue(
                  encoder.encode(
                    `data: ${JSON.stringify({
                      meta: true,
                      model: meta.modelName,
                      modelId: meta.modelId,
                      provider: meta.provider,
                    })}\n\n`
                  )
                );
              },
              onDelta: (delta: string) => {
                accumulatedText += delta;
                controller.enqueue(
                  encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`)
                );
              },
            });

            if (!accumulatedText && streamResult.text) {
              accumulatedText = streamResult.text;
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ delta: accumulatedText })}\n\n`)
              );
            }
            streamGroundingMetadata = streamResult.groundingMetadata || null;

            const isOutOfContext = accumulatedText.includes('[OUT_OF_CONTEXT]');
            if (isOutOfContext) {
              accumulatedText = outOfContextNotice;
            }

            if (accumulatedText && !isPersonalQuery && !isOutOfContext) {
              storeCachedAnswer({
                question,
                answer: accumulatedText,
                courseId: moodleCourseId,
              }).catch(() => {});
            }

            const citedSources = isOutOfContext
              ? []
              : extractCitedSources(
                  accumulatedText,
                  allowExternalSource,
                  question,
                  course,
                  streamGroundingMetadata
                );

            const responseModel = streamResult.modelName || streamResult.modelId || 'AI Assistant';
            const responseProvider = streamResult.provider || 'auto';

            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({
                done: true,
                sources: citedSources,
                model: responseModel,
                modelId: streamResult.modelId,
                provider: responseProvider,
              })}\n\n`)
            );
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          } catch (streamErr) {
            console.error('Stream generation error in tutor:', streamErr);
            controller.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  error:
                    streamErr instanceof Error
                      ? streamErr.message
                      : 'Lỗi trong quá trình tạo phản hồi AI.',
                })}\n\n`
              )
            );
          } finally {
            controller.close();
          }
        },
      });

      return new Response(readableStream, {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        },
      });
    }

    // 3. AI Execution via unified model registry (Non-streaming JSON fallback)
    let aiText = '';
    let responseModel = 'AI Assistant';
    let responseProvider = 'auto';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let groundingMetadata: any = null;

    try {
      const result = await generateText(model, {
        system: systemInstruction,
        userPrompt,
        history: history.slice(-6).map(msg => ({
          role: msg.role === 'user' ? ('user' as const) : ('assistant' as const),
          content: msg.text,
        })),
        temperature: effectiveTemperature,
        topP: effectiveTopP,
        documents: effectiveDocuments,
        googleSearchGrounding: allowExternalSource,
        allowExternalSource: Boolean(allowExternalSource),
      });
      aiText = result.text;
      groundingMetadata = result.groundingMetadata || null;
      if (result.modelName) responseModel = result.modelName;
      if (result.provider) responseProvider = result.provider;
    } catch (err) {
      console.warn('AI generation failed:', err);
    }

    if (!aiText) {
      return NextResponse.json({
        answer: `⚠️ **Không thể kết nối API AI**\n\nVui lòng kiểm tra lại API key trong file \`.dev.vars\` / \`.env.local\`.`,
        sources: [],
      });
    }

    const isOutOfContext = aiText.includes('[OUT_OF_CONTEXT]');
    if (isOutOfContext) {
      aiText = outOfContextNotice;
    }

    if (!isPersonalQuery && !isOutOfContext) {
      storeCachedAnswer({
        question,
        answer: aiText,
        courseId: moodleCourseId,
      }).catch(() => {});
    }

    const citedSources = isOutOfContext
      ? []
      : extractCitedSources(
          aiText,
          allowExternalSource,
          question,
          course,
          groundingMetadata
        );

    return NextResponse.json({
      answer: aiText,
      sources: citedSources,
      model: responseModel,
      provider: responseProvider,
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

function extractCitedSources(
  aiText: string,
  allowExternalSource: boolean,
  question: string,
  course: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  groundingMetadata: any
): Array<{ name: string; isExternal: boolean; url: string }> {
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
      const displayName = cleanQ
        ? `Kiểm chứng: ${cleanQ.length > 45 ? cleanQ.slice(0, 45) + '…' : cleanQ}`
        : 'Nguồn mở rộng thực tế & tra cứu Web';

      citedSources = [
        {
          name: displayName,
          isExternal: true,
          url: searchUrl,
        },
      ];
    }
  }

  return citedSources;
}
