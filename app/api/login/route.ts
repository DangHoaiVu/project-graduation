import { NextResponse } from 'next/server';
import { runtimeEnv } from '../../../db/runtime';
import { supabaseAdmin } from '../../../lib/supabase';
import { getDb } from '../../../db';
import { users } from '../../../db/schema';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

type MoodleTokenResponse = {
  token?: string;
  error?: string;
};

type MoodleProfileResponse = {
  userid?: number;
  fullname?: string;
  username?: string;
  userpictureurl?: string;
  exception?: string;
  userissiteadmin?: boolean | number;
};

type LoginBody = {
  username?: unknown;
  email?: unknown;
  password?: unknown;
};

export async function POST(request: Request) {
  try {
    let body: LoginBody;

    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Dữ liệu đăng nhập không hợp lệ.' }, { status: 400 });
    }

    const identifier = typeof body.email === 'string' ? body.email : body.username;
    if (
      typeof identifier !== 'string' ||
      typeof body.password !== 'string' ||
      !identifier.trim() ||
      !body.password
    ) {
      return NextResponse.json({ error: 'Vui lòng nhập tên đăng nhập và mật khẩu.' }, { status: 400 });
    }

    const { MOODLE_URL } = runtimeEnv();
    const effectiveMoodleUrl = MOODLE_URL || 'https://moodletvk.duckdns.org';

    const moodleBaseUrl = effectiveMoodleUrl.replace(/\/$/, '');
    const tokenParams = new URLSearchParams({
      username: identifier.trim(),
      password: body.password,
      service: 'moodle_mobile_app',
    });

    let tokenData: MoodleTokenResponse;
    try {
      const tokenResponse = await fetch(
        `${moodleBaseUrl}/login/token.php?${tokenParams.toString()}`,
        { method: 'POST', headers: { Accept: 'application/json' } },
      );

      if (!tokenResponse.ok) {
        return NextResponse.json({ error: 'Mất kết nối tới hệ thống Moodle.' }, { status: 502 });
      }

      tokenData = (await tokenResponse.json()) as MoodleTokenResponse;
    } catch (moodleErr) {
      console.warn('Moodle token fetch failed:', moodleErr);
      return NextResponse.json({ error: 'Không thể kết nối đến máy chủ Moodle.' }, { status: 502 });
    }

    if (!tokenData.token || tokenData.error) {
      return NextResponse.json({ error: 'Thông tin đăng nhập không hợp lệ.' }, { status: 401 });
    }

    let profileData: MoodleProfileResponse = {};
    try {
      const profileParams = new URLSearchParams({
        wstoken: tokenData.token,
        wsfunction: 'core_webservice_get_site_info',
        moodlewsrestformat: 'json',
      });
      const profileResponse = await fetch(
        `${moodleBaseUrl}/webservice/rest/server.php?${profileParams.toString()}`,
        { method: 'POST', headers: { Accept: 'application/json' } },
      );

      if (profileResponse.ok) {
        profileData = (await profileResponse.json()) as MoodleProfileResponse;
      }
    } catch (profErr) {
      console.warn('Moodle site info fetch warning:', profErr);
    }

    const userId = Number(profileData.userid) || 4;
    const fullname = profileData.fullname ?? '';
    const username = profileData.username ?? identifier.trim();

    // Determine user role: user ID 2 (Admin User), site admin, or teacher
    let userRole = (userId === 2 || Boolean(profileData.userissiteadmin)) ? 'teacher' : 'student';

    // Sync user to users table via Supabase if configured
    if (supabaseAdmin) {
      try {
        const { data: existingUser } = await supabaseAdmin
          .from('users')
          .select('role')
          .eq('moodle_user_id', userId)
          .maybeSingle();

        if (existingUser?.role === 'teacher') {
          userRole = 'teacher';
        }

        await supabaseAdmin.from('users').upsert(
          {
            moodle_user_id: userId,
            role: userRole,
            name: fullname || username,
          },
          { onConflict: 'moodle_user_id' }
        );
      } catch (sbErr) {
        console.warn('Supabase login sync warning:', sbErr);
      }
    }

    // Sync user to users table via Drizzle if configured
    try {
      const db = getDb();
      if (db) {
        const existing = await db.select().from(users).where(eq(users.moodleUserId, userId)).limit(1);
        if (existing.length === 0) {
          await db.insert(users).values({
            moodleUserId: userId,
            role: userRole,
            name: fullname || username,
          });
        } else if (existing[0].role !== userRole && userRole === 'teacher') {
          await db.update(users).set({ role: userRole }).where(eq(users.moodleUserId, userId));
        }
      }
    } catch (dbErr) {
      console.warn('Drizzle login sync warning:', dbErr);
    }

    return NextResponse.json({
      success: true,
      moodleToken: tokenData.token,
      user: {
        id: userId,
        fullname,
        username,
        role: userRole,
        avatarUrl: `/api/moodle/avatar?token=${encodeURIComponent(tokenData.token)}&id=${userId}`,
      },
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : 'Lỗi hệ thống';
    console.error('Unhandled login error:', err);
    return NextResponse.json({ error: `Lỗi xử lý đăng nhập: ${errorMsg}` }, { status: 500 });
  }
}
