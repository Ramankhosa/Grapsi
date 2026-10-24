import * as cheerio from "cheerio";

import { decodeBody, defaultRobotsPolicy, defaultSafeFetch, sourceWatchUserAgent } from "./safeFetch";

/**
 * Legacy-engine fetch helpers, now thin wrappers over safeFetch: every
 * request — the checker's, the preview's, feed discovery's — gets the same
 * address checks, redirect validation, streamed size cap, pacing and
 * RFC 9309 robots handling as the v2 engine. (The original helper fetched any
 * URL it was given, private addresses included, and read whole bodies before
 * truncating them.)
 */

export const USER_AGENT = sourceWatchUserAgent();

const MAX_BYTES = 2_500_000;

export async function fetchUrl(url: string): Promise<string> {
  const result = await defaultSafeFetch()(url, { maxBytes: MAX_BYTES });
  return decodeBody(result);
}

// --- robots.txt -------------------------------------------------------------

/**
 * RFC 9309 semantics: a robots file that cannot be read because the server
 * failed (5xx, unreachable) is NOT permission — the check answers false and
 * the caller defers. A 4xx robots file means "no rules", as before.
 */
export async function isAllowedByRobots(url: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const decision = await defaultRobotsPolicy().check(parsed);
  return decision.allowed;
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
