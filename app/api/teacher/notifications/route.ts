import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const courseId = searchParams.get('courseId') || searchParams.get('moodleCourseId');

    if (!supabaseAdmin) {
      return NextResponse.json({ success: false, error: 'Database unavailable' }, { status: 503 });
    }

    let query = supabaseAdmin
      .from('events')
      .select('*')
      .eq('event_type', 'manual')
      .order('deliver_time', { ascending: true });

    if (courseId) {
      query = query.eq('moodle_course_id', Number(courseId));
    }

    const { data, error } = await query;
    if (error) {
      throw new Error(error.message);
    }

    const mapped = (data || []).map(item => ({
      id: item.id,
      moodleEventId: item.moodle_event_id,
      moodleCourseId: item.moodle_course_id,
      eventType: item.event_type,
      title: item.title,
      deliverTime: item.deliver_time,
      timestamp: item.deliver_time ? new Date(item.deliver_time).getTime() : Date.now(),
      sentReminders: item.sent_reminders || [],
      eventDetails: item.event_details || '',
      createdAt: item.created_at,
    }));

    return NextResponse.json({ success: true, events: mapped });
  } catch (error) {
    console.error('Error fetching teacher manual events:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Lỗi lấy danh sách thông báo' },
      { status: 500 }
    );
  }
}

interface TeacherCreateNotificationBody {
  courseId?: number | string | null;
  moodleCourseId?: number | string | null;
  title: string;
  deliverTime: string;
  eventDetails?: string;
  customReminders?: number[];
  reminders?: number[];
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as TeacherCreateNotificationBody;
    const courseId = body.courseId ?? body.moodleCourseId;
    const moodleCourseId = courseId ? Number(courseId) : null;
    const title = body.title?.trim();
    const eventDetails = body.eventDetails?.trim() || null;
    const rawTime = body.deliverTime;

    if (!title) {
      return NextResponse.json({ success: false, error: 'Tiêu đề thông báo không được để trống' }, { status: 400 });
    }

    if (!rawTime) {
      return NextResponse.json({ success: false, error: 'Thời gian diễn ra không được để trống' }, { status: 400 });
    }

    const deliverTime = new Date(rawTime).toISOString();

    const rawReminders = body.customReminders || body.reminders || [60, 0];
    const reminders = Array.isArray(rawReminders) && rawReminders.length > 0
      ? Array.from(new Set(rawReminders.map(Number).filter(n => !isNaN(n)))).sort((a, b) => b - a)
      : [60, 0];

    if (!supabaseAdmin) {
      return NextResponse.json({ success: false, error: 'Database unavailable' }, { status: 503 });
    }

    const { data, error } = await supabaseAdmin
      .from('events')
      .insert({
        moodle_event_id: null,
        moodle_course_id: moodleCourseId,
        event_type: 'manual',
        title,
        deliver_time: deliverTime,
        sent_reminders: reminders,
        event_details: eventDetails,
      })
      .select()
      .single();

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({ success: true, event: data });
  } catch (error) {
    console.error('Error creating teacher manual notification:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Lỗi tạo thông báo' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ success: false, error: 'id is required' }, { status: 400 });
    }

    if (!supabaseAdmin) {
      return NextResponse.json({ success: false, error: 'Database unavailable' }, { status: 503 });
    }

    const { error } = await supabaseAdmin.from('events').delete().eq('id', id);
    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({ success: true, deletedId: id });
  } catch (error) {
    console.error('Error deleting event:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Lỗi xóa thông báo' },
      { status: 500 }
    );
  }
}

