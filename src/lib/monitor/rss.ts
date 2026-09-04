import Parser from "rss-parser";

const parser = new Parser({ timeout: 30_000 });

/**
 * Render a feed's items as normalized text lines ("title — link"), newest
 * first, so feeds flow through the same hash/diff pipeline as HTML pages.
 */
export async function feedToText(xml: string): Promise<string> {
  const feed = await parser.parseString(xml);
  const items = (feed.items ?? []).slice(0, 50);
  return items
    .map((item) => {
      const title = (item.title ?? "Untitled").replace(/\s+/g, " ").trim();
      const link = item.link?.trim();
      return link ? `${title} — ${link}` : title;
    })
    .join("\n");
}
