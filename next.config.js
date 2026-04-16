/** @type {import('next').NextConfig} */
const nextConfig = {
  // Minimal config for development
  experimental: {
    webpackBuildWorker: false,
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
}

module.exports = nextConfig

