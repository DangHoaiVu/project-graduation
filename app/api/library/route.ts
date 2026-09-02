import { NextResponse } from 'next/server';
import { currentUserId } from '../../../db/runtime';
import { getDb } from '../../../db';
import { courses, documents } from '../../../db/schema';
import { eq } from 'drizzle-orm';
import { uploadBufferToCloudinary, cloudinary } from '../../../lib/cloudinary';

const allowedTypes = new Set([
  'application/pdf',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
]);
const allowedExtensions = new Set(['pdf', 'txt', 'doc', 'docx', 'ppt', 'pptx']);

export async function GET(request: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'Bạn cần đăng nhập.' }, { status: 401 });

  const db = getDb();
  if (!db) {
    return NextResponse.json({ documents: [], storageUsed: 0, mode: 'preview' });
  }

  const id = new URL(request.url).searchParams.get('id');
  if (id) {
    const docList = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
    if (!docList.length) return NextResponse.json({ error: 'Không tìm thấy tài liệu.' }, { status: 404 });
    const doc = docList[0];
    return NextResponse.json({ document: doc });
  }

  const docs = await db.select().from(documents);
  const formatted = docs.map((d) => ({
    id: d.id,
    name: d.title,
    contentType: 'application/pdf',
    size: d.content.length,
    source: 'personal',
    status: 'indexed',
    createdAt: d.uploadedAt ? new Date(d.uploadedAt).getTime() : Date.now(),
  }));

  const totalSize = docs.reduce((acc, d) => acc + (d.content?.length || 0), 0);

  return NextResponse.json({ documents: formatted, storageUsed: totalSize, mode: 'live' });
}

export async function POST(request: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'Bạn cần đăng nhập.' }, { status: 401 });

  const form = await request.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'Thiếu tài liệu.' }, { status: 400 });
  if (file.size > 50 * 1024 * 1024) return NextResponse.json({ error: 'Tài liệu vượt quá 50 MB.' }, { status: 413 });
  
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!allowedTypes.has(file.type) && !allowedExtensions.has(extension)) {
    return NextResponse.json({ error: 'Định dạng chưa được hỗ trợ.' }, { status: 415 });
  }

  let fileUrl = '';
  if (process.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUDINARY_URL) {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const uploadRes = await uploadBufferToCloudinary(buffer, {
        folder: `lms-assistant/${userId}`,
        resource_type: 'auto',
      });
      fileUrl = uploadRes.secure_url;
    } catch (e) {
      console.warn('Cloudinary upload warning:', e);
    }
  }

  const db = getDb();
  if (!db) {
    return NextResponse.json(
      {
        id: crypto.randomUUID(),
        name: file.name,
        contentType: file.type,
        size: file.size,
        source: 'personal',
        status: 'indexed',
        createdAt: Date.now(),
        fileUrl,
        mode: 'preview',
      },
      { status: 201 }
    );
  }

  // Ensure default course exists
  let courseId = '';
  const existingCourses = await db.select().from(courses).limit(1);
  if (existingCourses.length > 0) {
    courseId = existingCourses[0].id;
  } else {
    const [createdCourse] = await db
      .insert(courses)
      .values({
        moodleCourseId: 1,
        title: 'Tài liệu cá nhân',
      })
      .returning();
    courseId = createdCourse.id;
  }

  let textContent = `[Document File: ${file.name}]${fileUrl ? ` (URL: ${fileUrl})` : ''}`;
  if (file.type === 'text/plain' || extension === 'txt') {
    textContent = await file.text();
  }

  const [newDoc] = await db
    .insert(documents)
    .values({
      courseId,
      title: file.name,
      content: textContent,
    })
    .returning();

  return NextResponse.json(
    {
      id: newDoc.id,
      name: newDoc.title,
      contentType: file.type,
      size: file.size,
      source: 'personal',
      status: 'indexed',
      createdAt: newDoc.uploadedAt ? new Date(newDoc.uploadedAt).getTime() : Date.now(),
      fileUrl,
    },
    { status: 201 }
  );
}

export async function DELETE(request: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: 'Bạn cần đăng nhập.' }, { status: 401 });

  const id = new URL(request.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Thiếu mã tài liệu.' }, { status: 400 });

  const db = getDb();
  if (!db) return NextResponse.json({ deleted: true, mode: 'preview' });

  await db.delete(documents).where(eq(documents.id, id));
  return NextResponse.json({ deleted: true });
}
