/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./src/**/*.{html,ts}'],
  theme: {
    extend: {
      colors: {
        // App surface palette (dark-first).
        surface: {
          950: '#0b0f17',
          900: '#111827',
          800: '#1f2937',
          700: '#374151',
        },
      },
    },
  },
  plugins: [],
};
