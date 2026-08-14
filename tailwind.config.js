/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    // Root-level components/ holds the reviewer's editors and panels. Without
    // this glob any class used only there is purged from the built CSS.
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // ── Cobalt design system ────────────────────────────────────────────
        // A quiet white ground, exactly three grays, and one working blue.
        // Used by the researcher workspace: profile, research fit, finder chat,
        // and the funding directory.
        ground: '#ffffff',
        inset: '#f7f8fa',
        hairline: '#e4e7ec',
        ink: {
          DEFAULT: '#101828',
          soft: '#344054',
        },
        muted: {
          DEFAULT: '#667085',
          soft: '#98a2b3',
        },
        // ── Nickel ──────────────────────────────────────────────────────────
        // The machined chassis the dashboards are built from: a cool, faintly
        // metallic neutral ramp. Nickel carries the whole surface; cobalt is
        // the only colour that means "live" or "act here".
        nickel: {
          25: '#fbfcfd',
          50: '#f5f7f9',
          100: '#eceff3',
          200: '#dfe3e9',
          300: '#c8ced7',
          // 400 is a decorative tone — icons, borders, placeholders. It does not
          // clear AA on the ground, so it must never carry body text.
          400: '#8b95a3',
          // 500 is the lowest tone allowed for text: 5.0:1 on the ground,
          // 4.8:1 on inset surfaces.
          500: '#666e7c',
          600: '#4d5764',
          700: '#3a424e',
          800: '#252b34',
          900: '#171b21',
          950: '#0f1216',
        },
        cobalt: {
          50: '#eff4ff',
          100: '#dce7fe',
          200: '#c0d3fd',
          300: '#94b4fc',
          400: '#608df9',
          500: '#3b68f5',
          600: '#1d4ed8',
          700: '#1b41b4',
          800: '#1c3891',
          900: '#1b3175',
        },
        // PatentNest AI Palette
        'ai-blue': {
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
          800: '#075985',
          900: '#0c4a6e',
          950: '#082f49',
        },
        'ai-graphite': {
          50: '#f8fafc',
          100: '#f1f5f9',
          200: '#e2e8f0',
          300: '#cbd5e1',
          400: '#94a3b8',
          500: '#64748b',
          600: '#475569',
          700: '#334155',
          800: '#1e293b',
          900: '#0f172a',
          950: '#020617',
        },
        // Keep existing for compatibility until full migration
        'gpt-gray': {
          50: '#f9fafb',
          100: '#f3f4f6',
          200: '#e5e7eb',
          300: '#d1d5db',
          400: '#9ca3af',
          500: '#6b7280',
          600: '#4b5563',
          700: '#374151',
          800: '#1f2937',
          900: '#111827',
        },
        'gpt-blue': {
          50: '#eff6ff',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
        },
        'gpt-green': {
          500: '#10b981',
          600: '#059669',
        },
        prep: {
          surface: '#f4fbf8',
          border: '#d6eee4',
          accent: '#0f766e',
          accentDark: '#115e59',
          muted: '#64748b',
          chatUser: '#0f766e',
          chatAssistant: '#f8fafc',
          inputBg: '#f1f5f9',
          chipStrong: '#ccfbf1',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        serif: ['var(--font-cormorant)', 'serif'],
        'home-v2-sans': ['var(--font-home-v2-sans)', 'Inter', 'sans-serif'],
        'home-v2-mono': ['var(--font-home-v2-mono)', 'monospace'],
      },
      boxShadow: {
        // Cobalt system: near-flat surfaces, one lift for overlays only.
        'cb-pop': '0 12px 32px -8px rgba(16, 24, 40, 0.18), 0 2px 6px -2px rgba(16, 24, 40, 0.08)',
        'cb-sheet': '0 24px 64px -12px rgba(16, 24, 40, 0.24)',
        // Nickel: machined edges, not drop shadows. Light falls from above.
        'nk-plate': 'inset 0 1px 0 rgba(255,255,255,0.9), 0 1px 1.5px rgba(23,27,33,0.05)',
        'nk-live': 'inset 0 1px 0 rgba(255,255,255,0.28), 0 1px 2px rgba(29,78,216,0.28)',
        'nk-lift': '0 1px 2px rgba(23,27,33,0.04), 0 8px 24px -12px rgba(23,27,33,0.16)',
        'nk-sheet': '0 24px 64px -16px rgba(23,27,33,0.28), 0 2px 8px rgba(23,27,33,0.08)',
        'prep-card': '0 10px 25px rgba(15, 23, 42, 0.08)',
        'prep-card-hover': '0 16px 40px rgba(15, 23, 42, 0.12)',
        'prep-float': '0 28px 70px rgba(15, 23, 42, 0.18)',
      },
      animation: {
        'pulse-slow': 'prepPulse 2.4s ease-in-out infinite',
      },
      keyframes: {
        prepPulse: {
          '0%, 100%': { transform: 'scale(1)', opacity: '0.2' },
          '50%': { transform: 'scale(1.05)', opacity: '0.32' },
        },
      },
    },
  },
  plugins: [],
}

