/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      colors: {
        ink: {
          50: '#f5f6f8',
          100: '#e8eaef',
          200: '#d1d5dd',
          300: '#a9b0bd',
          400: '#7a8294',
          500: '#565d6e',
          600: '#3d4351',
          700: '#2a2e39',
          800: '#1c1f27',
          900: '#121419',
          950: '#0a0b0e',
        },
        board: {
          light: '#f0d9b5',
          dark: '#b58863',
          highlight: '#f7ec6b',
          move: '#88b04b',
          check: '#e54444',
        },
        brand: {
          50: '#eef9f4',
          100: '#d6f0e3',
          200: '#aee0c8',
          300: '#7fcaa6',
          400: '#4fb083',
          500: '#2f9468',
          600: '#1f7652',
          700: '#1a5e43',
          800: '#164a36',
          900: '#103a2b',
        },
        accent: {
          400: '#f5a623',
          500: '#e8900a',
          600: '#c97706',
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
