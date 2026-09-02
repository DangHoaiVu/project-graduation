import { NextResponse } from 'next/server';
import { runtimeEnv } from '../../../db/runtime';

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
};

type LoginBody = {
  username?: unknown;
  email?: unknown;
  password?: unknown;
};

export async function POST(request: Request) {
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
  if (!MOODLE_URL) {
    return NextResponse.json({ error: 'Chưa cấu hình địa chỉ Moodle.' }, { status: 503 });
  }

  const moodleBaseUrl = MOODLE_URL.replace(/\/$/, '');
  const tokenParams = new URLSearchParams({
    username: identifier.trim(),
    password: body.password,
    service: 'moodle_mobile_app',
  });

  try {
    const tokenResponse = await fetch(
      `${moodleBaseUrl}/login/token.php?${tokenParams.toString()}`,
      { method: 'POST', headers: { Accept: 'application/json' } },
    );

    if (!tokenResponse.ok) {
      return NextResponse.json({ error: 'Mất kết nối tới hệ thống Moodle.' }, { status: 502 });
    }

    const tokenData = (await tokenResponse.json()) as MoodleTokenResponse;
    if (!tokenData.token || tokenData.error) {
      return NextResponse.json({ error: 'Thông tin đăng nhập không hợp lệ.' }, { status: 401 });
    }

    const profileParams = new URLSearchParams({
      wstoken: tokenData.token,
      wsfunction: 'core_webservice_get_site_info',
      moodlewsrestformat: 'json',
    });
    const profileResponse = await fetch(
      `${moodleBaseUrl}/webservice/rest/server.php?${profileParams.toString()}`,
      { method: 'POST', headers: { Accept: 'application/json' } },
    );

    if (!profileResponse.ok) {
      return NextResponse.json({ error: 'Không thể đọc thông tin tài khoản Moodle.' }, { status: 502 });
    }

    const profileData = (await profileResponse.json()) as MoodleProfileResponse;
    if (profileData.exception || profileData.userid === undefined) {
      return NextResponse.json({ error: 'Không thể đọc thông tin tài khoản Moodle.' }, { status: 502 });
    }

    return NextResponse.json({
      success: true,
      moodleToken: tokenData.token,
      user: {
        id: profileData.userid,
        fullname: profileData.fullname ?? '',
        username: profileData.username ?? identifier.trim(),
        avatarUrl: `/api/moodle/avatar?token=${encodeURIComponent(tokenData.token)}&id=${profileData.userid}`,
      },
    });
  } catch {
    return NextResponse.json({ error: 'Mất kết nối tới hệ thống Moodle.' }, { status: 502 });
  }
}
