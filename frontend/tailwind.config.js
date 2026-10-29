/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class', '.theme-dark'],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#1d4ed8',
        primaryDark: '#1e3a8a',
        accent: '#38bdf8',
        surface: '#f5f7ff',
        card: 'rgba(255, 255, 255, 0.9)'
      },
      boxShadow: {
        glow: '0 22px 55px rgba(29, 78, 216, 0.25)',
        soft: '0 12px 40px rgba(15, 23, 42, 0.12)'
      }
    }
  },
  plugins: []
};
