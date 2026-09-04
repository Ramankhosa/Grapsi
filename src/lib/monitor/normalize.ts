import * as cheerio from "cheerio";
import { createHash } from "crypto";

/**
 * Extract readable text from HTML, scoped to an optional CSS selector.
 * Anchor links are preserved as "text — url" so the triage step and the
 * reviewer can follow through to the actual call page.
 */
export function extractText(html: string, baseUrl: string, selector?: string | null): string {
  // Give block-level elements line breaks before cheerio flattens everything.
  const withBreaks = html.replace(
    /<\/(p|div|li|h[1-6]|tr|th|td|section|article|header|footer|dt|dd|blockquote)>/gi,
    "</$1>\n",
  );
  const $ = cheerio.load(withBreaks);
  $("script, style, noscript, iframe, svg").remove();

  // Rewrite anchors so their target survives text extraction.
  $("a[href]").each((_, el) => {
    const $el = $(el);
    const href = $el.attr("href") ?? "";
    if (href.startsWith("#") || href.toLowerCase().startsWith("javascript:")) return;
    let abs: string;
    try {
      abs = new URL(href, baseUrl).toString();
    } catch {
      return;
    }
    const label = $el.text().trim();
    if (label) $el.text(`${label} — ${abs}`);
  });

  let scope = selector?.trim() ? $(selector.trim()) : $("body");
  if (selector?.trim() && scope.length === 0) {
    // Selector no longer matches anything — fall back to body so the check
    // still works, and let the caller surface the mismatch.
    scope = $("body");
  }

  const raw = scope
    .map((_, el) => $(el).text())
    .get()
    .join("\n");

  return raw
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

export function selectorMatches(html: string, selector: string): boolean {
  try {
    const $ = cheerio.load(html);
    return $(selector.trim()).length > 0;
  } catch {
    return false;
  }
}

/** Drop lines matching any ignore rule (regex when valid, literal otherwise). */
export function applyIgnoreRules(text: string, patterns: string[]): string {
  if (patterns.length === 0) return text;
  const matchers = patterns.map((p) => {
    try {
      return new RegExp(p, "i");
    } catch {
      return p.toLowerCase();
    }
  });
  return text
    .split("\n")
    .filter((line) => {
      for (const m of matchers) {
        if (typeof m === "string") {
          if (line.toLowerCase().includes(m)) return false;
        } else if (m.test(line)) {
          return false;
        }
      }
      return true;
    })
    .join("\n");
}

export function hashText(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
