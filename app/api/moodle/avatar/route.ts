import { NextResponse } from 'next/server';
import { runtimeEnv } from '../../../../db/runtime';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tokenFromQuery = searchParams.get('token');
  const authorization = request.headers.get('authorization');
  const clientToken = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  const { MOODLE_URL, MOODLE_TOKEN } = runtimeEnv();
  const token = tokenFromQuery || clientToken || MOODLE_TOKEN;

  if (!MOODLE_URL || !token) {
    return new NextResponse('Missing Moodle credentials', { status: 401 });
  }

  const moodleBase = MOODLE_URL.replace(/\/$/, '');

  try {
    // 1. Get site info to retrieve user id & default userpictureurl
    const siteUrl = `${moodleBase}/webservice/rest/server.php?wstoken=${encodeURIComponent(token)}&wsfunction=core_webservice_get_site_info&moodlewsrestformat=json`;
    const siteRes = await fetch(siteUrl);
    if (!siteRes.ok) {
      return new NextResponse('Failed to connect to Moodle', { status: 502 });
    }
    const siteData = (await siteRes.json()) as { userid?: number; userpictureurl?: string };
    const userid = siteData.userid;

    let targetUrl = siteData.userpictureurl;

    // 2. Try fetching full user profile to get high-res profileimageurl
    if (userid) {
      try {
        const userUrl = `${moodleBase}/webservice/rest/server.php?wstoken=${encodeURIComponent(token)}&wsfunction=core_user_get_users_by_field&field=id&values[0]=${userid}&moodlewsrestformat=json`;
        const userRes = await fetch(userUrl);
        if (userRes.ok) {
          const users = (await userRes.json()) as Array<{ profileimageurl?: string; profileimageurlsmall?: string }>;
          if (users?.[0]?.profileimageurl) {
            targetUrl = users[0].profileimageurl;
          }
        }
      } catch {
        // fallback to siteData.userpictureurl
      }
    }

    if (!targetUrl) {
      return new NextResponse('No picture URL available', { status: 404 });
    }

    // 3. Ensure webservice token is attached and URL points to webservice endpoint if needed
    let fetchUrl = targetUrl;
    if (fetchUrl.includes('/pluginfile.php') && !fetchUrl.includes('/webservice/pluginfile.php')) {
      fetchUrl = fetchUrl.replace('/pluginfile.php', '/webservice/pluginfile.php');
    }
    if (!fetchUrl.includes('token=')) {
      fetchUrl += (fetchUrl.includes('?') ? '&' : '?') + `token=${encodeURIComponent(token)}`;
    }

    // 4. Fetch the image directly from Moodle
    const imgRes = await fetch(fetchUrl);
    if (!imgRes.ok) {
      // If webservice/pluginfile.php failed, try original URL with token
      if (fetchUrl !== targetUrl) {
        const altUrl = targetUrl + (targetUrl.includes('?') ? '&' : '?') + `token=${encodeURIComponent(token)}`;
        const altRes = await fetch(altUrl);
        if (altRes.ok) {
          const contentType = altRes.headers.get('content-type') || 'image/jpeg';
          const buffer = await altRes.arrayBuffer();
          return new NextResponse(buffer, {
            headers: {
              'Content-Type': contentType,
              'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
            },
          });
        }
      }
      return new NextResponse('Could not fetch avatar from Moodle', { status: imgRes.status });
    }

    const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
    const buffer = await imgRes.arrayBuffer();

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
      },
    });
  } catch {
    return new NextResponse('Internal server error fetching avatar', { status: 500 });
  }
}

