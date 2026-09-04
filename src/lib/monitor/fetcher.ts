import * as cheerio from "cheerio";
import robotsParser from "robots-parser";

export const USER_AGENT = "MoniBot/0.1 (funding-opportunity monitor)";

const MAX_BYTES = 2_500_000;
const FETCH_TIMEOUT_MS = 30_000;

export async function fetchUrl(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml,application/rss+xml,*/*",
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const text = await res.text();
    if (text.length > MAX_BYTES) return text.slice(0, MAX_BYTES);
    return text;
  } finally {
    clearTimeout(timer);
  }
}

// --- robots.txt -------------------------------------------------------------

type RobotsEntry = { checker: ReturnType<typeof robotsParser> | null; fetchedAt: number };
const robotsCache = new Map<string, RobotsEntry>();
const ROBOTS_TTL_MS = 6 * 60 * 60 * 1000;

export async function isAllowedByRobots(url: string): Promise<boolean> {
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return false;
  }
  const cached = robotsCache.get(origin);
  if (!cached || Date.now() - cached.fetchedAt > ROBOTS_TTL_MS) {
    let checker: ReturnType<typeof robotsParser> | null = null;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);
      const res = await fetch(`${origin}/robots.txt`, {
        signal: controller.signal,
        headers: { "User-Agent": USER_AGENT },
      });
      clearTimeout(timer);
      if (res.ok) {
        checker = robotsParser(`${origin}/robots.txt`, await res.text());
      }
    } catch {
      // no robots.txt reachable -> treat as allowed
    }
    robotsCache.set(origin, { checker, fetchedAt: Date.now() });
  }
  const entry = robotsCache.get(origin)!;
  if (!entry.checker) return true;
  return entry.checker.isAllowed(url, USER_AGENT) !== false;
}

// --- feed discovery ---------------------------------------------------------

const COMMON_FEED_PATHS = ["/feed", "/rss", "/rss.xml", "/atom.xml", "/feed.xml"];

function looksLikeFeed(body: string): boolean {
  const head = body.slice(0, 500).toLowerCase();
  return head.includes("<rss") || head.includes("<feed") || head.includes("<rdf:rdf");
}

export async function discoverFeed(pageUrl: string, html: string): Promise<string | null> {
  const $ = cheerio.load(html);
  const link = $(
    'link[rel="alternate"][type*="rss"], link[rel="alternate"][type*="atom"], link[rel="alternate"][type*="xml"]',
  ).first();
  const href = link.attr("href");
  if (href) {
    try {
      return new URL(href, pageUrl).toString();
    } catch {
      /* fall through */
    }
  }
  // Try a few conventional paths on the site root.
  let origin: string;
  try {
    origin = new URL(pageUrl).origin;
  } catch {
    return null;
  }
  for (const path of COMMON_FEED_PATHS) {
    try {
      const candidate = `${origin}${path}`;
      const body = await fetchUrl(candidate);
      if (looksLikeFeed(body)) return candidate;
    } catch {
      // keep trying
    }
  }
  return null;
}
