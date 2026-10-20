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
          50: '#fbf6ea',
          100: '#f5ecd9', // cream: primary text
          200: '#e4dcc8',
          300: '#b9c4bb',
          400: '#8fa398', // muted text
          500: '#5f7a70',
          600: '#2f453e',
          700: '#223530', // borders / secondary buttons
          800: '#172622', // cards
          900: '#0f1b18', // surfaces
          950: '#0a1411', // page background
        },
        board: {
          light: '#e9dcc0',
          dark: '#2f6b57',
          highlight: '#c4a574',
          move: '#c4a574',
          check: '#e54444',
        },
        brand: {
          50: '#faf5ea',
          100: '#f1e6cf',
          200: '#e7d6b2',
          300: '#dcc49b',
          400: '#d0b185',
          500: '#c4a574', // champagne gold
          600: '#a98a5a',
          700: '#8a6f45',
          800: '#6a5435',
          900: '#4a3b25',
        },
        accent: {
          400: '#d9915f', // copper: warnings / deltas
          500: '#c27a46',
          600: '#a8643a',
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
