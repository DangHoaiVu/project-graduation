import { extractText } from 'unpdf';
import JSZip from 'jszip';

/**
 * Extracts plain text from a DOCX (Office Open XML) buffer using JSZip.
 */
export async function extractDocxText(buffer: ArrayBuffer | Uint8Array): Promise<string> {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const docXmlFile = zip.file('word/document.xml');
    if (!docXmlFile) return '';
    const xml = await docXmlFile.async('text');
    const text = xml
      .replace(/<\/w:p>/g, '\n')
      .replace(/<w:tab\/>/g, '\t')
      .replace(/<w:br\/>/g, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .join('\n');
    return text;
  } catch (err) {
    console.warn('Error extracting text from docx:', err);
    return '';
  }
}

/**
 * Extracts slide texts from a PPTX (Office Open XML) buffer using JSZip.
 */
export async function extractPptxText(buffer: ArrayBuffer | Uint8Array): Promise<string> {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const slideFiles = Object.keys(zip.files)
      .filter(f => f.startsWith('ppt/slides/slide') && f.endsWith('.xml'))
      .sort((a, b) => {
        const numA = parseInt(a.replace(/\D/g, ''), 10) || 0;
        const numB = parseInt(b.replace(/\D/g, ''), 10) || 0;
        return numA - numB;
      });

    const slidesText: string[] = [];
    for (let i = 0; i < slideFiles.length; i++) {
      const file = zip.file(slideFiles[i]);
      if (!file) continue;
      const xml = await file.async('text');
      const slideText = xml
        .replace(/<\/a:p>/g, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .join(' ');
      if (slideText) {
        slidesText.push(`[Slide ${i + 1}]\n${slideText}`);
      }
    }
    return slidesText.join('\n\n');
  } catch (err) {
    console.warn('Error extracting text from pptx:', err);
    return '';
  }
}

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

const failedUrls = new Map<string, number>(); // url -> timestamp

function isUrlTemporarilyFailed(url: string): boolean {
  const failedAt = failedUrls.get(url);
  if (!failedAt) return false;
  if (Date.now() - failedAt > 15 * 60 * 1000) {
    failedUrls.delete(url);
    return false;
  }
  return true;
}

function markUrlFailed(url: string) {
  failedUrls.set(url, Date.now());
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

  if (isUrlTemporarilyFailed(url)) {
    return '';
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
          signal: AbortSignal.timeout(3500),
        });

        if (jinaRes.ok) {
          const markdown = await jinaRes.text();
          if (markdown && markdown.trim().length > 120 && !markdown.includes('403 Forbidden') && !markdown.includes('Access Denied')) {
            setDocumentCache(cacheKey, markdown.trim());
            return markdown.trim();
          }
        }
      } catch {
        // Fast skip Jina reader if timeout or blocked
      }
    }

    const response = await fetch(fetchUrl, { headers, signal: AbortSignal.timeout(4000) });
    if (!response.ok) {
      console.warn(`Failed to fetch document from ${fetchUrl}: status ${response.status}`);
      if (response.status === 403 || response.status === 404 || response.status >= 500) {
        markUrlFailed(fetchUrl);
      }
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

    // For Word documents (.docx)
    const isDocx =
      lowerName.endsWith('.docx') ||
      contentType.includes('wordprocessingml') ||
      contentType.includes('application/vnd.openxmlformats-officedocument.wordprocessingml');
    if (isDocx) {
      const docxText = await extractDocxText(arrayBuffer);
      if (docxText.trim()) {
        setDocumentCache(cacheKey, docxText);
        return docxText;
      }
    }

    // For PowerPoint presentations (.pptx)
    const isPptx =
      lowerName.endsWith('.pptx') ||
      contentType.includes('presentationml') ||
      contentType.includes('application/vnd.openxmlformats-officedocument.presentationml');
    if (isPptx) {
      const pptxText = await extractPptxText(arrayBuffer);
      if (pptxText.trim()) {
        setDocumentCache(cacheKey, pptxText);
        return pptxText;
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
    if (lowerName.endsWith('.docx')) {
      return await extractDocxText(buffer);
    }
    if (lowerName.endsWith('.pptx')) {
      return await extractPptxText(buffer);
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
