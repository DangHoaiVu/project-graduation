import { extractText } from 'unpdf';

// In-memory cache for parsed document texts during the session
const MAX_PARSED_CACHE = 50;
const documentTextCache = new Map<string, string>();

/**
 * Purges cached document text from memory.
 * If keyPattern is provided, only deletes entries containing the pattern.
 * Otherwise, clears all cached document texts.
 */
export function clearDocumentCache(keyPattern?: string): number {
  if (!keyPattern) {
    const count = documentTextCache.size;
    documentTextCache.clear();
    return count;
  }

  const lower = keyPattern.toLowerCase();
  let deleted = 0;
  for (const key of documentTextCache.keys()) {
    if (key.toLowerCase().includes(lower)) {
      documentTextCache.delete(key);
      deleted++;
    }
  }
  return deleted;
}

function setDocumentCache(key: string, value: string): void {
  if (documentTextCache.size >= MAX_PARSED_CACHE) {
    const oldestKey = documentTextCache.keys().next().value;
    if (oldestKey) {
      documentTextCache.delete(oldestKey);
    }
  }
  documentTextCache.set(key, value);
}

export async function parseDocumentFromUrl(
  url: string,
  fileName: string,
  options?: { authToken?: string }
): Promise<string> {
  const cacheKey = `${fileName}::${url}`;
  if (documentTextCache.has(cacheKey)) {
    return documentTextCache.get(cacheKey)!;
  }

  try {
    let fetchUrl = url;
    const headers: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml,text/plain,application/pdf;q=0.9,*/*;q=0.8',
    };

    if (options?.authToken && !fetchUrl.includes('token=')) {
      headers['Authorization'] = `Bearer ${options.authToken}`;
    }

    // If it's a direct public web link (not localhost, not moodle view.php wrapper), try Jina Reader directly
    const isPublicWeb =
      fetchUrl.startsWith('http') &&
      !fetchUrl.includes('localhost') &&
      !fetchUrl.includes('127.0.0.1') &&
      !fetchUrl.includes('/mod/url/view.php') &&
      !fetchUrl.includes('/mod/resource/view.php') &&
      !fetchUrl.includes('pluginfile.php');

    if (isPublicWeb) {
      try {
        const jinaUrl = `https://r.jina.ai/${fetchUrl}`;
        const jinaRes = await fetch(jinaUrl, {
          headers: {
            'X-Return-Format': 'markdown',
            'X-With-Generated-Alt': 'true',
            Accept: 'text/markdown, text/plain',
          },
          signal: AbortSignal.timeout(8000),
        });

        if (jinaRes.ok) {
          const markdown = await jinaRes.text();
          if (markdown && markdown.trim().length > 120 && !markdown.includes('403 Forbidden') && !markdown.includes('Access Denied')) {
            setDocumentCache(cacheKey, markdown.trim());
            return markdown.trim();
          }
        }
      } catch (jinaErr) {
        console.warn(`Jina Reader direct attempt for ${fetchUrl} skipped/failed:`, jinaErr);
      }
    }

    const response = await fetch(fetchUrl, { headers, signal: AbortSignal.timeout(10000) });
    if (!response.ok) {
      console.warn(`Failed to fetch document from ${fetchUrl}: status ${response.status}`);
      return '';
    }

    const contentType = response.headers.get('content-type') || '';
    const arrayBuffer = await response.arrayBuffer();

    const lowerName = fileName.toLowerCase();
    const isPdf =
      lowerName.endsWith('.pdf') ||
      contentType.includes('application/pdf') ||
      fetchUrl.toLowerCase().includes('.pdf');

    if (isPdf) {
      const { text } = await extractText(new Uint8Array(arrayBuffer));
      let fullText = '';
      if (Array.isArray(text)) {
        fullText = text.map((pageStr, idx) => `[Trang ${idx + 1}]\n${pageStr}`).join('\n\n');
      } else {
        fullText = String(text || '');
      }
      if (fullText.trim()) {
        setDocumentCache(cacheKey, fullText);
        return fullText;
      }
    }

    // For plain text files
    if (lowerName.endsWith('.txt') || contentType.includes('text/plain')) {
      const decoder = new TextDecoder('utf-8');
      const text = decoder.decode(arrayBuffer);
      setDocumentCache(cacheKey, text);
      return text;
    }

    // For Web links, HTML pages, and Moodle URL resources
    let targetUrl = fetchUrl;
    const decoder = new TextDecoder('utf-8');
    const rawHtml = decoder.decode(arrayBuffer);

    // Check if the URL is a Moodle wrapper or contains a redirect link
    if (fetchUrl.includes('/mod/url/view.php') || rawHtml.includes('urlworkaround')) {
      const match =
        rawHtml.match(/<div class="urlworkaround"[^>]*>\s*<a\s+[^>]*href="([^"]+)"/i) ||
        rawHtml.match(/<a\s+[^>]*class="urlworkaround"[^>]*href="([^"]+)"/i) ||
        rawHtml.match(/<div class="resourcecontent"[^>]*>\s*<a\s+[^>]*href="([^"]+)"/i);
      if (match && match[1] && match[1].startsWith('http')) {
        targetUrl = match[1].replace(/&amp;/g, '&');
      }
    }

    // TIER 1: Jina Reader API for parsed targetUrl
    const isLocalHost =
      targetUrl.includes('localhost') ||
      targetUrl.includes('127.0.0.1') ||
      targetUrl.includes('192.168.') ||
      targetUrl.includes('.local');

    if (targetUrl.startsWith('http') && !isLocalHost) {
      try {
        const jinaUrl = `https://r.jina.ai/${targetUrl}`;
        const jinaRes = await fetch(jinaUrl, {
          headers: {
            'X-Return-Format': 'markdown',
            'X-With-Generated-Alt': 'true',
            Accept: 'text/markdown, text/plain',
          },
          signal: AbortSignal.timeout(7000),
        });

        if (jinaRes.ok) {
          const markdown = await jinaRes.text();
          if (markdown && markdown.trim().length > 100 && !markdown.includes('403 Forbidden')) {
            setDocumentCache(cacheKey, markdown.trim());
            return markdown.trim();
          }
        }
      } catch (jinaErr) {
        console.warn(`Jina Reader attempt for ${targetUrl} skipped/failed:`, jinaErr);
      }
    }

    // TIER 2: Direct Scraper Fallback (Fetch destination directly if targetUrl is different)
    let htmlToClean = rawHtml;
    if (targetUrl !== fetchUrl) {
      try {
        const extRes = await fetch(targetUrl, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
          signal: AbortSignal.timeout(6000),
        });
        if (extRes.ok) {
          htmlToClean = await extRes.text();
        }
      } catch (fetchErr) {
        console.warn(`Direct fetch for ${targetUrl} failed:`, fetchErr);
      }
    }

    const extractedText = extractTextFromHtml(htmlToClean);
    if (extractedText.trim()) {
      setDocumentCache(cacheKey, extractedText);
      return extractedText;
    }

    return '';
  } catch (error) {
    console.warn(`Error parsing document ${fileName} from ${url}:`, error);
    return '';
  }
}

/**
 * Strips HTML tags, scripts, styles, navigations, and extracts structured, readable text.
 */
export function extractTextFromHtml(html: string): string {
  if (!html) return '';

  // 1. Remove script, style, svg, noscript, nav, header, footer, iframe tags and their contents
  let cleaned = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, ' ')
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ')
    .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, ' ')
    .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, ' ')
    .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, ' ')
    .replace(/<aside\b[^<]*(?:(?!<\/aside>)<[^<]*)*<\/aside>/gi, ' ')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, ' ');

  // 2. Format Headings with Markdown equivalents
  cleaned = cleaned
    .replace(/<h1\b[^>]*>(.*?)<\/h1>/gi, '\n\n# $1\n\n')
    .replace(/<h2\b[^>]*>(.*?)<\/h2>/gi, '\n\n## $1\n\n')
    .replace(/<h3\b[^>]*>(.*?)<\/h3>/gi, '\n\n### $1\n\n')
    .replace(/<h[4-6]\b[^>]*>(.*?)<\/h[4-6]>/gi, '\n\n#### $1\n\n');

  // 3. Format Code Blocks and Pre tags
  cleaned = cleaned
    .replace(/<pre\b[^>]*><code\b[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '\n\n```\n$1\n```\n\n')
    .replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, '\n\n```\n$1\n```\n\n')
    .replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');

  // 4. Replace structural block tags with newlines
  cleaned = cleaned
    .replace(/<\/(p|div|section|article|blockquote|tr)>/gi, '\n\n')
    .replace(/<br\s*[\/]?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n• ')
    .replace(/<\/(td|th)>/gi, ' | ');

  // 5. Remove all remaining HTML tags
  cleaned = cleaned.replace(/<[^>]+>/g, ' ');

  // 6. Decode common HTML entities
  cleaned = cleaned
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#x2F;/gi, '/')
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)));

  // 7. Clean up whitespace
  return cleaned
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .join('\n\n');
}

export async function parseDocumentBuffer(buffer: ArrayBuffer | Uint8Array, fileName: string): Promise<string> {
  try {
    const lowerName = fileName.toLowerCase();
    if (lowerName.endsWith('.pdf')) {
      const { text } = await extractText(new Uint8Array(buffer));
      if (Array.isArray(text)) {
        return text.map((pageStr, idx) => `[Trang ${idx + 1}]\n${pageStr}`).join('\n\n');
      }
      return String(text || '');
    }
    if (lowerName.endsWith('.txt')) {
      const decoder = new TextDecoder('utf-8');
      return decoder.decode(buffer);
    }
    return '';
  } catch (error) {
    console.warn(`Error parsing buffer for ${fileName}:`, error);
    return '';
  }
}
