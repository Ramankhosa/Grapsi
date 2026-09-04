import * as cheerio from "cheerio";
import { extractText } from "./normalize";

export type SelectorSuggestion = {
  selector: string;
  linkCount: number;
  preview: string[];
};

const IDENT = /^[A-Za-z][\w-]*$/;

/**
 * Finders shouldn't have to write CSS selectors. Score the page's link-dense
 * containers (lists, tables, sections) and offer the best few as one-click
 * suggestions, preferring the innermost container that still holds the links.
 */
export function suggestSelectors(html: string, baseUrl: string): SelectorSuggestion[] {
  const $ = cheerio.load(html);
  $("script, style, noscript, nav, header, footer").remove();

  type Candidate = { el: any; links: number };
  const all: Candidate[] = [];
  $("ul, ol, table, section, main, div").each((_, el) => {
    const links = $(el).find("a[href]").length;
    if (links >= 3) all.push({ el, links });
  });

  // Drop outer wrappers whose links mostly live in an inner candidate.
  const inner = all.filter(
    (c) =>
      !all.some(
        (other) =>
          other !== c &&
          other.links >= c.links * 0.8 &&
          $(other.el).parents().toArray().includes(c.el),
      ),
  );

  function buildSelector(el: any): string | null {
    const id = $(el).attr("id");
    if (id && IDENT.test(id)) return `#${id}`;
    const tag: string = el.tagName ?? el.name;
    const classes = ($(el).attr("class") ?? "").split(/\s+/).filter((c) => IDENT.test(c));
    for (const cls of classes) {
      if ($(`${tag}.${cls}`).length === 1) return `${tag}.${cls}`;
    }
    const parentId = $(el).parents("[id]").first().attr("id");
    if (parentId && IDENT.test(parentId)) {
      for (const cls of classes) {
        if ($(`#${parentId} ${tag}.${cls}`).length === 1) return `#${parentId} ${tag}.${cls}`;
      }
      if ($(`#${parentId} > ${tag}`).length === 1) return `#${parentId} > ${tag}`;
    }
    return null;
  }

  const suggestions: SelectorSuggestion[] = [];
  const seenSelectors = new Set<string>();
  for (const candidate of inner.sort((a, b) => b.links - a.links)) {
    const selector = buildSelector(candidate.el);
    if (!selector || seenSelectors.has(selector)) continue;
    seenSelectors.add(selector);
    const preview = extractText($.html(candidate.el), baseUrl)
      .split("\n")
      .slice(0, 3);
    suggestions.push({ selector, linkCount: candidate.links, preview });
    if (suggestions.length >= 3) break;
  }
  return suggestions;
}
