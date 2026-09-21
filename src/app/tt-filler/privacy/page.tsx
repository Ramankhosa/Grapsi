import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'TT Filler Privacy Policy',
  description: 'Privacy policy for the TT Filler browser extension.',
}

const sections = [
  {
    title: 'Summary',
    body: [
      'TT Filler saves temporary tokens and related settings inside the user browser profile. The extension does not send tokens, login credentials, page contents, or browsing history to the developer, AI Grant Mentor, sponsors, or third parties.',
    ],
  },
  {
    title: 'Information stored locally',
    body: [
      'For each website the user chooses, TT Filler stores the website origin, a user-provided token, its expiration time, an optional label, and whether automatic filling is enabled.',
      'This information remains in extension-local storage on the device and is deleted when it expires, when the user deletes it, or when the extension is removed.',
    ],
  },
  {
    title: 'Website access',
    body: [
      'TT Filler includes built-in access to its initially supported token page and asks the user before receiving access to additional HTTPS websites.',
      'Access is used only to identify and fill a likely token field. Automatic validation is disabled by default. When the user enables “Click Validate after fill” for a website, TT Filler may click a clearly labelled validation control after filling that website token.',
    ],
  },
  {
    title: 'Advertising',
    body: [
      'The extension can display a clearly labelled sponsor message in its popup. Sponsor content can be bundled with the extension or fetched from https://aigrantmentor.com/token-master/feed.json.',
      'The feed request does not include tokens, website contents, browsing history, or personal identifiers from TT Filler. A sponsor receives no information unless the user intentionally follows its link, at which point the sponsor website privacy policy applies.',
      'Users can turn off sponsor messages and the online campaign feed from the settings page.',
    ],
  },
  {
    title: 'Data sharing and sale',
    body: [
      'TT Filler does not sell, rent, transfer, or disclose authentication information or browsing activity.',
      'TT Filler does not use tokens or browsing activity for personalized advertising, credit decisions, lending, or profiling.',
    ],
  },
  {
    title: 'Security and retention',
    body: [
      'Tokens are retained only until the expiration selected by the user. Users should protect access to their browser profile and device.',
      'Local storage reduces network exposure, but it does not protect an unlocked device or a compromised browser profile.',
    ],
  },
  {
    title: 'User controls',
    body: [
      'Users can delete an individual token from the popup, delete all stored tokens from the settings page, revoke website access through browser extension settings, or uninstall TT Filler.',
    ],
  },
  {
    title: 'Independence',
    body: [
      'TT Filler is an independent browser utility and is not affiliated with or endorsed by the websites it supports.',
    ],
  },
]

export default function TTFillerPrivacyPage() {
  return (
    <main className="min-h-screen bg-gray-50">
      <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
        <header className="mb-10 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-wide text-ai-blue-600">Browser extension privacy</p>
          <h1 className="mt-2 text-3xl font-bold text-gray-950">TT Filler Privacy Policy</h1>
          <p className="mt-3 text-sm text-gray-600">Version 2.2.0 · Effective 21 September 2026</p>
        </header>

        <div className="space-y-6">
          {sections.map((section) => (
            <section key={section.title} className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-semibold text-gray-950">{section.title}</h2>
              <div className="mt-3 space-y-3 text-gray-700">
                {section.body.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
            </section>
          ))}

          <section className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-gray-950">Contact</h2>
            <p className="mt-3 text-gray-700">
              For questions about TT Filler or this privacy policy, contact Dr. Ramandeep Singh at{' '}
              <a className="font-semibold text-ai-blue-600 hover:underline" href="mailto:ramankhosa@gmail.com">
                ramankhosa@gmail.com
              </a>
              .
            </p>
          </section>
        </div>
      </article>
    </main>
  )
}
