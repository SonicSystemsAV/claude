/**
 * Sonic the Ledgerhog — Tailwind preset.
 * Use in tailwind.config.js:
 *   import sonic from './design/tailwind.sonic.js'
 *   export default { presets: [sonic], content: [...], ... }
 */
/** @type {import('tailwindcss').Config} */
export default {
  theme: {
    extend: {
      colors: {
        sonic: {
          black: '#0B0B0B',
          orange: '#F26A32',
          ember: '#D05824',
          link: '#B84A1A',
          'link-hover': '#8A3612',
        },
        ground: '#F4F2EF',
        surface: '#FFFFFF',
        rule: { DEFAULT: '#E4E0DA', soft: '#EFECE7' },
        control: '#CFC9C1',
        ink: '#141312',
        muted: '#5E5A55',
        subtle: '#9A958F',
        nav: { text: '#D9D6D2', active: '#1F1D1B', line: '#2E2B28', input: '#161514' },
        credit: { DEFAULT: '#17695A', bg: '#E3F0EC' },
        debit: { DEFAULT: '#A8321E', bg: '#F6E1DE' },
        review: { DEFAULT: '#8A3612', bg: '#FBE7DD' },
        neutral: { DEFAULT: '#4A4642', bg: '#EFECE7' },
        'chart-out': '#3A3734',
        // Old teal `brand` scale remapped to orange so existing brand-* classes keep working.
        brand: {
          50: '#FEF3EC',
          100: '#FDE3D3',
          200: '#FBC4A5',
          300: '#F8A072',
          400: '#F5824B',
          500: '#F26A32',
          600: '#D05824',
          700: '#B84A1A',
          800: '#8A3612',
          900: '#5E250C',
        },
      },
      fontFamily: {
        display: ['Urbanist', 'system-ui', 'sans-serif'],
        sans: ['"DM Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'Consolas', 'monospace'],
      },
      fontSize: {
        'page-title': ['40px', { lineHeight: '1.1', letterSpacing: '-0.5px', fontWeight: '300' }],
        kpi: ['28px', { lineHeight: '1.2', letterSpacing: '-0.5px', fontWeight: '500' }],
        eyebrow: ['13px', { lineHeight: '1.3', letterSpacing: '1.2px' }],
      },
      borderRadius: {
        card: '14px',
        control: '10px',
        nav: '8px',
        badge: '6px',
      },
      minHeight: { touch: '44px' },
      spacing: { sidebar: '240px' },
    },
  },
}
