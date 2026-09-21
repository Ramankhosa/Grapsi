# TT Filler sponsor feed

Grapsi serves TT Filler's extension campaign feed at:

```text
https://aigrantmentor.com/token-master/feed.json
```

The route is implemented at `src/app/token-master/feed.json/route.ts`. It is public by design because browser extensions need to read it without a Grapsi login.

## Updating campaigns

The route uses a safe fallback campaign by default. To override it without editing code, set `TOKEN_MASTER_SPONSOR_FEED_JSON` to a JSON string with this shape:

```json
{
  "version": 1,
  "refreshMinutes": 180,
  "campaigns": [
    {
      "id": "agm-home-001",
      "active": true,
      "label": "Sponsored",
      "headline": "AI Grant Mentor",
      "body": "Discover practical guidance for scholarships, AI tools, and student growth.",
      "cta": "Visit site",
      "url": "https://aigrantmentor.com/"
    }
  ]
}
```

Keep campaign URLs on HTTPS. The current extension shows sponsor messages only inside the extension UI and does not use browser notifications.
