/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Override Tailwind grays with cool-slate tinted palette
        gray: {
          50:  '#f8fafc',
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
        // UPTECH red
        red: {
          50:  '#fff0f0',
          100: '#ffd8d8',
          200: '#ffb3b3',
          300: '#ff8080',
          400: '#ff4d4d',
          500: '#E30613',
          600: '#c0000e',
          700: '#a0000b',
          800: '#800008',
          900: '#600006',
        },
      },
      fontFamily: {
        sans: ['Inter', 'Poppins', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'xs':  '0 1px 2px rgba(15,23,42,0.05)',
        'sm':  '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)',
        'md':  '0 4px 16px rgba(15,23,42,0.07), 0 1px 3px rgba(15,23,42,0.05)',
        'lg':  '0 12px 40px rgba(15,23,42,0.10), 0 4px 12px rgba(15,23,42,0.06)',
        'xl':  '0 24px 64px rgba(15,23,42,0.13), 0 8px 24px rgba(15,23,42,0.08)',
        'card':'0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)',
      },
      borderRadius: {
        'xl':  '12px',
        '2xl': '16px',
        '3xl': '24px',
      },
    },
  },
  plugins: [],
}
