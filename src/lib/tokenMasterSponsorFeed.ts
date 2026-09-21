export type TokenMasterSponsorCampaign = {
  id: string
  active: boolean
  label: string
  headline: string
  body: string
  cta: string
  url: string
  startsAt?: string
  endsAt?: string
}

export type TokenMasterSponsorFeed = {
  version: 1
  refreshMinutes: number
  campaigns: TokenMasterSponsorCampaign[]
}

const fallbackFeed: TokenMasterSponsorFeed = {
  version: 1,
  refreshMinutes: 180,
  campaigns: [
    {
      id: 'agm-home-001',
      active: true,
      label: 'Sponsored',
      headline: 'AI Grant Mentor',
      body: 'Discover practical guidance for scholarships, AI tools, and student growth.',
      cta: 'Visit site',
      url: 'https://aigrantmentor.com/'
    }
  ]
}

function isHttpsUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https:\/\//i.test(value)
}

function isCampaign(value: unknown): value is TokenMasterSponsorCampaign {
  const campaign = value as Partial<TokenMasterSponsorCampaign>
  return Boolean(
    campaign &&
    typeof campaign.id === 'string' &&
    typeof campaign.active === 'boolean' &&
    typeof campaign.label === 'string' &&
    typeof campaign.headline === 'string' &&
    typeof campaign.body === 'string' &&
    typeof campaign.cta === 'string' &&
    isHttpsUrl(campaign.url)
  )
}

function isFeed(value: unknown): value is TokenMasterSponsorFeed {
  const feed = value as Partial<TokenMasterSponsorFeed>
  return Boolean(
    feed &&
    feed.version === 1 &&
    typeof feed.refreshMinutes === 'number' &&
    Number.isFinite(feed.refreshMinutes) &&
    feed.refreshMinutes >= 30 &&
    Array.isArray(feed.campaigns) &&
    feed.campaigns.every(isCampaign)
  )
}

export function getTokenMasterSponsorFeed(): TokenMasterSponsorFeed {
  const configuredFeed = process.env.TOKEN_MASTER_SPONSOR_FEED_JSON
  if (!configuredFeed) return fallbackFeed

  try {
    const parsed = JSON.parse(configuredFeed)
    if (isFeed(parsed)) return parsed
    console.warn('[TokenMasterSponsorFeed] TOKEN_MASTER_SPONSOR_FEED_JSON is invalid; using fallback feed.')
  } catch (error) {
    console.warn('[TokenMasterSponsorFeed] Failed to parse TOKEN_MASTER_SPONSOR_FEED_JSON; using fallback feed.', error)
  }

  return fallbackFeed
}
