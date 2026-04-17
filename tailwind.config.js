/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
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
      },
      boxShadow: {
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

