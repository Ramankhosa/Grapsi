/** @type {import('next').NextConfig} */
const nextConfig = {
  // Build a self-contained server bundle in `.next/standalone`. This keeps the
  // deployable artifact small (a few hundred MB instead of the full ~1.2 GB
  // `.next` + node_modules), so we can keep old builds for instant rollback and
  // run zero-downtime reloads. `next start` still works as before — this only
  // adds the standalone output, it does not remove anything.
  output: 'standalone',

  // Build output directory. Defaults to `.next` (what `next start` serves).
  // `scripts/safe-build.sh` sets NEXT_DIST_DIR to a temp dir so a rebuild never
  // overwrites the live `.next` the running server is serving from; it swaps the
  // finished build in only after it succeeds. Serve-time (`next start` with no
  // NEXT_DIST_DIR) always uses `.next`, so this is fully backward compatible.
  distDir: process.env.NEXT_DIST_DIR || '.next',

  // Minimal config for development
  experimental: {
    webpackBuildWorker: true,
    optimizeCss: true,
    serverComponentsExternalPackages: ['pdfjs-dist'],
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
