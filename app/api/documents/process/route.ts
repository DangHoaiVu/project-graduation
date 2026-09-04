import { NextResponse } from 'next/server';
import { getDb } from '@/db';
import { courses, documents } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { uploadBufferToCloudinary } from '@/lib/cloudinary';
import { indexDocuments } from '@/lib/rag';
import { parseDocumentFromUrl } from '@/lib/document-parser';

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get('content-type') || '';
    let title = '';
    let content = '';
    let courseId = '';
    let moodleCourseId: number | null = null;
    let fileUrl: string | null = null;

    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const file = formData.get('file') as File | null;
      title = (formData.get('title') as string) || (file ? file.name : 'Untitled Document');
      courseId = (formData.get('courseId') as string) || '';
      const moodleCourseIdStr = formData.get('moodleCourseId') as string | null;
      if (moodleCourseIdStr) moodleCourseId = parseInt(moodleCourseIdStr, 10);
      content = (formData.get('content') as string) || '';

      if (file) {
        // Upload to Cloudinary if configured
        if (process.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_URL) {
          try {
            const arrayBuffer = await file.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            const uploadResult = await uploadBufferToCloudinary(buffer, {
              folder: 'lms-assistant/documents',
              resource_type: 'auto',
            });
            fileUrl = uploadResult.secure_url;
          } catch (uploadError) {
            console.warn('Cloudinary upload warning:', uploadError);
          }
        }

        // If content wasn't provided, read basic text or store placeholder for PDF/Doc
        if (!content) {
          if (file.type === 'text/plain' || file.name.endsWith('.txt')) {
            content = await file.text();
          } else if (fileUrl) {
            try {
              content = await parseDocumentFromUrl(fileUrl, file.name);
            } catch {
              content = `[Document File: ${file.name}] (URL: ${fileUrl})`;
            }
          } else {
            content = `[Document File: ${file.name}]`;
          }
        }
      }
    } else {
      const body = (await request.json()) as {
        title?: string;
        content?: string;
        courseId?: string;
        moodleCourseId?: number | string;
        fileUrl?: string;
      };
      title = body.title || 'Untitled Document';
      content = body.content || '';
      courseId = body.courseId || '';
      moodleCourseId = body.moodleCourseId ? Number(body.moodleCourseId) : null;
      fileUrl = body.fileUrl || null;
    }

    // If content is empty but a web link is provided, parse the web content directly
    if (!content && fileUrl && fileUrl.startsWith('http')) {
      try {
        const parsed = await parseDocumentFromUrl(fileUrl, title);
        if (parsed && parsed.trim().length > 50) {
          content = parsed.trim();
        }
      } catch (err) {
        console.warn('Auto crawl web document on process warning:', err);
      }
    }

    if (!title || (!content && !fileUrl)) {
      return NextResponse.json(
        { error: 'Vui lòng cung cấp tiêu đề và nội dung/tệp tài liệu.' },
        { status: 400 }
      );
    }

    const db = getDb();
    if (!db) {
      return NextResponse.json({
        success: true,
        mode: 'preview',
        message: 'DATABASE_URL chưa được cấu hình. Dữ liệu xử lý ở chế độ demo.',
        document: {
          title,
          contentPreview: content.slice(0, 200),
          fileUrl,
        },
      });
    }

    let targetCourseUuid = courseId;

    // If moodleCourseId is provided, find or create course
    if (moodleCourseId && !targetCourseUuid) {
      const existingCourse = await db
        .select()
        .from(courses)
        .where(eq(courses.moodleCourseId, moodleCourseId))
        .limit(1);

      if (existingCourse.length > 0) {
        targetCourseUuid = existingCourse[0].id;
      } else {
        const [newCourse] = await db
          .insert(courses)
          .values({
            moodleCourseId,
            title: title.includes(' - ') ? title.split(' - ')[0] : `Môn học #${moodleCourseId}`,
          })
          .returning();
        targetCourseUuid = newCourse.id;
      }
    }

    if (!targetCourseUuid) {
      // Create a default course if none exists
      const existingCourses = await db.select().from(courses).limit(1);
      if (existingCourses.length > 0) {
        targetCourseUuid = existingCourses[0].id;
      } else {
        const [defaultCourse] = await db
          .insert(courses)
          .values({
            moodleCourseId: 1,
            title: 'Tài liệu chung',
          })
          .returning();
        targetCourseUuid = defaultCourse.id;
      }
    }

    const [newDoc] = await db
      .insert(documents)
      .values({
        courseId: targetCourseUuid,
        title,
        content: content || `[Document URL: ${fileUrl}]`,
      })
      .returning();

    if (content && content.length > 50) {
      indexDocuments([{ title, text: content }]).catch(err => {
        console.warn('Background RAG indexing warning:', err);
      });
    }

    return NextResponse.json({
      success: true,
      document: newDoc,
      fileUrl,
    });
  } catch (error) {
    console.error('Error processing document:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Lỗi xử lý tài liệu.' },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const courseId = searchParams.get('courseId');
    const db = getDb();

    if (!db) {
      return NextResponse.json({
        documents: [],
        mode: 'preview',
      });
    }

    let query = db.select().from(documents);
    if (courseId) {
      query = query.where(eq(documents.courseId, courseId)) as typeof query;
    }

    const docs = await query;
    return NextResponse.json({ documents: docs, mode: 'live' });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Lỗi lấy danh sách tài liệu.' },
      { status: 500 }
    );
  }
}
