import { BuddyDb } from "../db.js";
import { llmCompleteJson } from "../llm.js";

export interface ToolContext {
  db: BuddyDb;
  apiKey: string | null;
}

function readLink(ctx: ToolContext) {
  return {
    name: "miguelito_read_link",
    description: "Fetch a URL the user pasted, extract the article text, and paraphrase it in Spanish at the user's level with vocabulary extraction. Returns a level-adapted summary and key words. Falls back to raw text if the LLM paraphrase is unavailable.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Full URL starting with http:// or https://.",
        },
      },
      required: ["url"],
    },
    execute: async (args: Record<string, string>) => {
      const url = (args.url ?? "").trim();
      if (!url.startsWith("http://") && !url.startsWith("https://")) {
        return { ok: false, error: "invalid_url: URL must start with http:// or https://" };
      }

      try {
        const resp = await fetch(url, {
          headers: { "User-Agent": "Miguelito/1.0 (Spanish learning bot)" },
          signal: AbortSignal.timeout(15_000),
        });
        if (!resp.ok) return { ok: false, error: `http_${resp.status}` };
        const ct = resp.headers.get("content-type") ?? "";
        if (!ct.includes("text/html") && !ct.includes("text/plain") && !ct.includes("application/xhtml")) {
          return { ok: false, error: `non_text_content: ${ct}` };
        }
        const html = await resp.text();
        const { title, body } = htmlToText(html);
        const text = body.slice(0, 3000);
        const truncated = body.length > 3000;
        const titleCapped = title.slice(0, 200);

        if (ctx.apiKey) {
          const profile = await ctx.db.getProfile();
          const level = profile?.level ?? "A2";
          const nativeLang = profile?.native_language ?? "inglés";
          try {
            const result = await llmCompleteJson<{
              summary: string;
              words: Array<{ word: string; translation: string }>;
            }>(
              ctx.apiKey,
              null,
              `Eres un asistente de aprendizaje de español.\n\nArtículo: "${titleCapped}"\n\nTexto: ${text}\n\nTareas:\n1. Escribe un resumen de 3-5 frases en español a nivel ${level}.\n2. Extrae 3-5 palabras españolas interesantes del texto. Para cada una, da la traducción en ${nativeLang}.\n\nResponde SOLO con JSON:\n{"summary": "...", "words": [{"word": "...", "translation": "..."}]}`,
              0.3,
              768,
            );
            return {
              ok: true,
              url,
              title: titleCapped,
              content_type: ct,
              original_length: text.length,
              truncated,
              summary: result.summary,
              words: result.words,
              text,
            };
          } catch {
            // fallback to raw text
          }
        }

        return {
          ok: true,
          url,
          title: titleCapped,
          content_type: ct,
          char_count: text.length,
          truncated,
          text,
        };
      } catch (e: any) {
        return { ok: false, error: e.message };
      }
    },
  };
}

function readingSuggest(ctx: ToolContext) {
  return {
    name: "miguelito_reading_suggest",
    description: "Find an interesting Spanish article matching the user's interests at their CEFR level+1. Tries preferred Spanish reading sources first (yorokobu.es, ethic.es, jotdown.es, etc.), then falls back to DuckDuckGo. Fetches the best result, summarizes it at the target level via LLM, and extracts 1-2 vocabulary words. Pass interests (comma-separated), level (A1-C2), and native_language. If these are omitted, reads from the user profile. Returns ok:true with url, title, summary, and words array. Returns ok:false on failure.",
    parameters: {
      type: "object",
      properties: {
        interests: {
          type: "string",
          description: "Comma-separated user interests, e.g. 'naturaleza, historia'. If omitted, reads from profile.",
        },
        level: {
          type: "string",
          description: "User's CEFR level (A1/A2/B1/B2/C1/C2). If omitted, reads from profile.",
        },
        native_language: {
          type: "string",
          description: "User's native language for vocabulary translations (e.g. 'ruso', 'inglés'). If omitted, reads from profile.",
        },
      },
    },
    execute: async (args: Record<string, string>) => {
      const profile = await ctx.db.getProfile();
      const interests = args.interests || profile?.interests || "cultura viajes tecnología";
      const level = args.level || profile?.level || "B1";
      const nativeLang = args.native_language || profile?.native_language || "inglés";
      const targetLevel = levelToIPlusOne(level);

      try {
        const rssResults = await fetchRssArticles(interests);
        if (rssResults.length > 0) {
          return await processArticles(ctx, rssResults, interests, targetLevel, nativeLang, `rss:${interests}`);
        }

        const query = `${interests} en español`;
        const ddgResults = await searchDuckDuckGo(query);
        if (ddgResults.length === 0) {
          return { ok: false, error: "no_results", query };
        }
        return await processArticles(ctx, ddgResults, interests, targetLevel, nativeLang, query);
      } catch (e: any) {
        return { ok: false, error: e.message };
      }
    },
  };
}

function levelToIPlusOne(level: string): string {
  const map: Record<string, string> = { A1: "A2", A2: "B1", B1: "B2", B2: "C1", C1: "C2", C2: "C2" };
  return map[level.toUpperCase()] ?? "B1";
}

async function searchDuckDuckGo(query: string): Promise<Array<{ url: string; title: string; snippet: string }>> {
  const resp = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!resp.ok) return [];
  const html = await resp.text();
  const results: Array<{ url: string; title: string; snippet: string }> = [];
  const linkRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRe = /<a class="result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippets: string[] = [];
  let sm: RegExpExecArray | null;
  while ((sm = snippetRe.exec(html)) !== null) snippets.push(sm[1].replace(/<[^>]+>/g, "").trim());
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = linkRe.exec(html)) !== null && results.length < 5) {
    let url = m[1];
    if (url.includes("uddg=")) {
      const idx = url.indexOf("uddg=");
      url = decodeURIComponent(url.slice(idx + 5).split("&")[0]);
    }
    const title = m[2].replace(/<[^>]+>/g, "").trim();
    results.push({ url, title, snippet: snippets[i] ?? "" });
    i++;
  }
  return results;
}

async function fetchRssArticles(interests: string): Promise<Array<{ url: string; title: string; snippet: string }>> {
  const feeds = [
    "https://www.yorokobu.es/feed/",
    "https://ethic.es/feed/",
    "https://www.jotdown.es/feed/",
    "https://www.muyinteresante.com/rss/",
    "https://www.playgroundweb.com/feed/",
  ];
  const results: Array<{ url: string; title: string; snippet: string }> = [];
  for (const feed of feeds) {
    try {
      const resp = await fetch(feed, { headers: { "User-Agent": "Miguelito/1.0 (Spanish learning bot)" }, signal: AbortSignal.timeout(15_000) });
      if (!resp.ok) continue;
      const xml = await resp.text();
      const items = extractRssItems(xml);
      for (const item of items) {
        if (interestsMatch(item, interests)) {
          results.push({ url: item.url, title: item.title, snippet: item.desc });
          if (results.length >= 5) return results;
        }
      }
      if (results.length > 0) return results;
    } catch { continue; }
  }
  return results;
}

function extractRssItems(xml: string): Array<{ url: string; title: string; desc: string }> {
  const items: Array<{ url: string; title: string; desc: string }> = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(xml)) !== null) {
    const block = m[1];
    const title = (block.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "").trim();
    const link = (block.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1] ?? "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
    const desc = (block.match(/<description[^>]*>([\s\S]*?)<\/description>/i)?.[1] ?? "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, "").trim();
    if (title && link && link.startsWith("http")) items.push({ url: link, title, desc });
    if (items.length >= 10) break;
  }
  return items;
}

function interestsMatch(article: { title: string; desc?: string; snippet?: string }, interests: string): boolean {
  if (!interests || interests === "noticias fáciles en español") return true;
  const haystack = `${article.title} ${article.desc ?? article.snippet ?? ""}`.toLowerCase();
  return interests.split(",").flatMap(kw => kw.trim().split(/\s+/)).filter(t => t.length > 2).some(token => haystack.includes(token.toLowerCase()));
}

async function processArticles(
  ctx: ToolContext,
  results: Array<{ url: string; title: string; snippet: string }>,
  interests: string,
  targetLevel: string,
  nativeLang: string,
  searchQuery: string,
): Promise<Record<string, unknown>> {
  for (const result of results.slice(0, 3)) {
    try {
      const resp = await fetch(result.url, {
        headers: { "User-Agent": "Miguelito/1.0 (Spanish learning bot)" },
        signal: AbortSignal.timeout(30_000),
      });
      if (!resp.ok) continue;
      const html = await resp.text();
      const { title: fetchTitle, body } = htmlToText(html);
      const text = body.slice(0, 2000);
      if (text.length < 100) continue;
      const displayTitle = fetchTitle || result.title;

      if (ctx.apiKey) {
        try {
          const llmResult = await llmCompleteJson<{
            summary: string;
            words: Array<{ word: string; translation: string }>;
          }>(
            ctx.apiKey,
            null,
            `Eres un asistente de aprendizaje de español.\n\nArtículo: "${displayTitle}"\n\nTexto: ${text}\n\nTareas:\n1. Escribe un resumen de 2-3 frases en español a nivel ${targetLevel}.\n2. Extrae 1-2 palabras españolas interesantes del texto. Para cada una, da la traducción en ${nativeLang}.\n\nResponde SOLO con JSON:\n{"summary": "...", "words": [{"word": "...", "translation": "..."}]}`,
            0.3,
            512,
          );
          return {
            ok: true,
            title: displayTitle,
            url: result.url,
            summary: llmResult.summary,
            words: llmResult.words,
            search_query: searchQuery,
            used_interest: interests,
            target_level: targetLevel,
          };
        } catch {
          continue;
        }
      }
      return { ok: true, title: displayTitle, url: result.url, char_count: text.length, text };
    } catch { continue; }
  }
  return { ok: false, error: "all_fetches_failed", query: searchQuery };
}

function htmlToText(html: string): { title: string; body: string } {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim()?.replace(/\s+/g, " ") ?? "";
  let doc = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, " ")
    .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, " ")
    .replace(/<form[^>]*>[\s\S]*?<\/form>/gi, " ")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, " ")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, " ")
    .replace(/<aside[^>]*>[\s\S]*?<\/aside>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|tr|blockquote|section|article)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title, body: doc };
}

export function createReadingTools(ctx: ToolContext) {
  return [readLink(ctx), readingSuggest(ctx)];
}
