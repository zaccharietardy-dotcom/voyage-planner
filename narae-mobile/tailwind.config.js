/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,tsx,ts}', './components/**/*.{js,tsx,ts}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        gold: {
          DEFAULT: '#c5a059',
          light: '#e8d5a3',
          dark: '#a8863a',
        },
        background: '#020617',
        foreground: '#f8fafc',
        muted: '#1e293b',
        'muted-foreground': '#94a3b8',
        border: '#1e293b',
        primary: '#c5a059',
        'primary-foreground': '#020617',
      },
      fontFamily: {
        display: ['PlayfairDisplay'],
        sans: ['GeistSans'],
        mono: ['GeistMono'],
      },
    },
  },
  plugins: [],
};
