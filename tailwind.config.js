import sonic from './design/tailwind.sonic.js'

/** @type {import('tailwindcss').Config} */
export default {
  presets: [sonic],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  plugins: [],
}
