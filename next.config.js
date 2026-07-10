/** @type {import('next').NextConfig} */
const nextConfig = {
  // Build a self-contained server bundle in `.next/standalone`. This keeps the
  // deployable artifact small (a few hundred MB instead of the full ~1.2 GB
  // `.next` + node_modules), so we can keep old builds for instant rollback and
  // run zero-downtime reloads. `next start` still works as before — this only
  // adds the standalone output, it does not remove anything.
  output: 'standalone',

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
