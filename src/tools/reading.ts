import type { ToolContext } from "./index.js";
import type { LanguageConfig } from "../languages/LanguageConfig.js";

function readLink(ctx: ToolContext, lang: LanguageConfig) {
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

        if (ctx.provider) {
          try {
            const result = await ctx.provider.completeJson<{
              summary: string;
              words: Array<{ word: string; explanation: string }>;
            }>(
              null,
              lang.prompts.readLink(titleCapped, text),
              { temperature: 0.3, maxTokens: 768 },
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

export function createReadingTools(ctx: ToolContext, lang: LanguageConfig) {
  return [readLink(ctx, lang)];
}
