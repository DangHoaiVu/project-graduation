import { NextResponse } from 'next/server';
import { runtimeEnv } from '../../../../db/runtime';

export const dynamic = 'force-dynamic';

function generateDefaultSvgAvatar(displayName: string): string {
  const cleanName = (displayName || '').trim();
  const words = cleanName.split(/\s+/).filter(Boolean);
  let initials = 'U';
  if (words.length >= 2) {
    initials = (words[words.length - 2][0] + words[words.length - 1][0]).toUpperCase();
  } else if (words.length === 1 && words[0].length > 0) {
    initials = words[0].slice(0, Math.min(2, words[0].length)).toUpperCase();
  }

  // Deterministic gradient selection based on name hash
  const gradients = [
    ['#4f46e5', '#7c3aed'], // Indigo -> Purple
    ['#2563eb', '#06b6d4'], // Blue -> Cyan
    ['#db2777', '#f43f5e'], // Pink -> Rose
    ['#059669', '#10b981'], // Teal -> Emerald
    ['#d97706', '#f59e0b'], // Amber -> Yellow
    ['#7c3aed', '#c026d3'], // Purple -> Fuchsia
  ];
  let hash = 0;
  for (let i = 0; i < cleanName.length; i++) {
    hash = (hash << 5) - hash + cleanName.charCodeAt(i);
    hash |= 0;
  }
  const [startColor, endColor] = gradients[Math.abs(hash) % gradients.length];

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120" width="120" height="120">
  <defs>
    <linearGradient id="avatarGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${startColor}" />
      <stop offset="100%" stop-color="${endColor}" />
    </linearGradient>
  </defs>
  <circle cx="60" cy="60" r="60" fill="url(#avatarGrad)" />
  <text x="60" y="66" font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif" font-size="44" font-weight="700" fill="#ffffff" text-anchor="middle" dominant-baseline="middle">${initials}</text>
</svg>`;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tokenFromQuery = searchParams.get('token');
  const idFromQuery = searchParams.get('id') || searchParams.get('v');
  const nameFromQuery = searchParams.get('name') || '';

  const authorization = request.headers.get('authorization');
  const clientToken = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';

  const { MOODLE_URL, MOODLE_TOKEN } = runtimeEnv();
  const token = tokenFromQuery || clientToken || MOODLE_TOKEN || '01d7d856ac230e78e269dd83bf8cee3d';
  const effectiveMoodleUrl = MOODLE_URL || 'https://moodletvk.duckdns.org';
  const moodleBase = effectiveMoodleUrl.replace(/\/$/, '');

  let targetUrl: string | undefined;
  let resolvedName = nameFromQuery;

  try {
    // 1. If user ID is provided, query core_user_get_users_by_field
    if (idFromQuery) {
      try {
        const userUrl = `${moodleBase}/webservice/rest/server.php?wstoken=${encodeURIComponent(token)}&wsfunction=core_user_get_users_by_field&field=id&values[0]=${encodeURIComponent(idFromQuery)}&moodlewsrestformat=json`;
        const userRes = await fetch(userUrl, { signal: AbortSignal.timeout(6000) });
        if (userRes.ok) {
          const users = (await userRes.json()) as Array<{ fullname?: string; profileimageurl?: string }>;
          if (users?.[0]) {
            targetUrl = users[0].profileimageurl;
            resolvedName = users[0].fullname || resolvedName;
          }
        }
      } catch (err) {
        console.warn('Avatar user lookup warning:', err);
      }
    }

    // 2. Fallback to core_webservice_get_site_info if no target URL found
    if (!targetUrl && token) {
      try {
        const siteUrl = `${moodleBase}/webservice/rest/server.php?wstoken=${encodeURIComponent(token)}&wsfunction=core_webservice_get_site_info&moodlewsrestformat=json`;
        const siteRes = await fetch(siteUrl, { signal: AbortSignal.timeout(6000) });
        if (siteRes.ok) {
          const siteData = (await siteRes.json()) as { fullname?: string; userpictureurl?: string };
          targetUrl = siteData.userpictureurl;
          resolvedName = siteData.fullname || resolvedName;
        }
      } catch (err) {
        console.warn('Avatar site info lookup warning:', err);
      }
    }

    // 3. If targetUrl points to a custom uploaded image, try fetching it directly
    if (targetUrl && !targetUrl.includes('/u/f1') && !targetUrl.includes('/u/f2')) {
      // Keep pluginfile.php as-is (do NOT rewrite to webservice/pluginfile.php)
      let fetchUrl = targetUrl;
      if (!fetchUrl.includes('token=') && token) {
        fetchUrl += (fetchUrl.includes('?') ? '&' : '?') + `token=${encodeURIComponent(token)}`;
      }

      try {
        let imgRes = await fetch(fetchUrl, { signal: AbortSignal.timeout(6000) });
        let contentType = imgRes.headers.get('content-type') || '';

        // If with-token request returned JSON error or non-image, try raw target URL
        if (!imgRes.ok || contentType.includes('application/json')) {
          if (fetchUrl !== targetUrl) {
            const rawRes = await fetch(targetUrl, { signal: AbortSignal.timeout(6000) });
            const rawType = rawRes.headers.get('content-type') || '';
            if (rawRes.ok && !rawType.includes('application/json')) {
              imgRes = rawRes;
              contentType = rawType;
            }
          }
        }

        // If we got a real image, return it with caching headers
        if (imgRes.ok && !contentType.includes('application/json') && contentType.startsWith('image/')) {
          const buffer = await imgRes.arrayBuffer();
          return new NextResponse(buffer, {
            headers: {
              'Content-Type': contentType,
              'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
            },
          });
        }
      } catch (fetchErr) {
        console.warn('Direct avatar image fetch warning:', fetchErr);
      }
    }
  } catch (outerErr) {
    console.warn('Avatar route unhandled error:', outerErr);
  }

  // 4. Fallback: Return a clean, responsive SVG avatar with initials
  const svg = generateDefaultSvgAvatar(resolvedName || idFromQuery || 'U');
  return new NextResponse(svg, {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
    },
  });
}
