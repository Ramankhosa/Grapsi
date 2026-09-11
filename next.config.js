/** @type {import('next').NextConfig} */

// ---------------------------------------------------------------------------
// Build-cost switches
// ---------------------------------------------------------------------------
// A full `next build` here compiles 110 App Router pages, 467 route handlers and
// ~1,570 source files, so every phase we can skip is worth real minutes on the
// production box. These three env vars let the prod deploy skip work it does not
// need while a plain local `npm run build` still does everything.
//
//   NEXT_OUTPUT_STANDALONE=1  emit `.next/standalone` (only the /srv/grapsi +
//                             ecosystem.config.js layout runs that server; the
//                             live box runs `next start`, which never reads it)
//   NEXT_SKIP_CHECKS=1        skip the in-build ESLint + TypeScript pass
//                             (scripts/safe-build.sh sets this; run
//                             `npm run lint` and `npx tsc --noEmit` locally)
const standalone = process.env.NEXT_OUTPUT_STANDALONE === '1'
const skipChecks = process.env.NEXT_SKIP_CHECKS === '1'

const nextConfig = {
  // Self-contained server bundle in `.next/standalone`, for the release-dir
  // layout described in ecosystem.config.js. Off by default: producing it means
  // tracing every server file through ~1.7 GB of node_modules and then copying
  // the result, which is the single longest phase of the build, and the live
  // deploy (`next start` from the checkout) never loads that output.
  ...(standalone ? { output: 'standalone' } : {}),

  // File tracing exists to tell a standalone/serverless bundle which files to
  // copy. `next start` serves from the checkout and needs none of it, so with
  // standalone off we skip the whole "Collecting build traces" phase.
  // (Next 14 logs a deprecation notice for this; it still works.)
  outputFileTracing: standalone,

  // Build output directory. Defaults to `.next` (what `next start` serves).
  // `scripts/safe-build.sh` sets NEXT_DIST_DIR to a temp dir so a rebuild never
  // overwrites the live `.next` the running server is serving from; it swaps the
  // finished build in only after it succeeds. Serve-time (`next start` with no
  // NEXT_DIST_DIR) always uses `.next`, so this is fully backward compatible.
  distDir: process.env.NEXT_DIST_DIR || '.next',

  // Linting and type checking are a local/CI concern. Running them inside the
  // production build re-checks ~1,750 files, and the generated Prisma client
  // declaration file alone is 26 MB, so the type pass is expensive on its own.
  eslint: { ignoreDuringBuilds: skipChecks },
  typescript: { ignoreBuildErrors: skipChecks },

  experimental: {
    webpackBuildWorker: true,
    // `optimizeCss` (critters) was inlining 1.8 kB of a 285 kB stylesheet, i.e.
    // nothing, while costing ~130 ms on each of 218 prerendered pages. Removed.
    serverComponentsExternalPackages: ['pdfjs-dist', '@resvg/resvg-js'],
  },

  // Webpack configuration to handle offline scenarios
  webpack: (config, { dev }) => {
    // Exclude problematic libraries from bundling
    config.externals = config.externals || []
    config.externals.push({
      'pdf2text': 'pdf2text',
      'canvas': 'canvas',
    })

    if (dev) {
      // Disable external version checking in development
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
      }
    }
    return config
  },

  async redirects() {
    return [
      {
        source: '/app-selector',
        destination: '/dashboard',
        permanent: false,
      },
    ]
  },
}

module.exports = nextConfig
