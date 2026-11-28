/**
 * Colours are CSS variables (set in src/index.css), so the Android app can wear its own skin ("neon") while the
 * website keeps the classic one. The `<alpha-value>` part keeps opacity classes like bg-ink-900/80 working.
 */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['"Cormorant Garamond"', 'Cormorant', 'Georgia', 'serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      colors: {
        // "Concierge" palette: deep emerald-black ink, champagne gold brand, copper accent
        ink: {
          50: v('ink-50'),
          100: v('ink-100'), // cream: primary text
          200: v('ink-200'),
          300: v('ink-300'),
          400: v('ink-400'), // muted text
          500: v('ink-500'),
          600: v('ink-600'),
          700: v('ink-700'), // borders / secondary buttons
          800: v('ink-800'), // cards
          900: v('ink-900'), // surfaces
          950: v('ink-950'), // page background
        },
        board: {
          light: '#e9dcc0',
          dark: '#2f6b57',
          highlight: '#c4a574',
          move: '#c4a574',
          check: '#e54444',
        },
        brand: {
          50: v('brand-50'),
          100: v('brand-100'),
          200: v('brand-200'),
          300: v('brand-300'),
          400: v('brand-400'),
          500: v('brand-500'), // champagne gold
          600: v('brand-600'),
          700: v('brand-700'),
          800: v('brand-800'),
          900: v('brand-900'),
        },
        accent: {
          400: v('accent-400'), // copper: warnings / deltas
          500: v('accent-500'),
          600: v('accent-600'),
        },
      },
      animation: {
        'fade-in': 'fadeIn 0.25s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(12px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' },
        },
      },
    },
  },
  plugins: [],
};
