/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        sidebar: {
          bg: '#FFFFFF',
          border: '#E2E8F0',
          text: '#475569',
          dim: '#64748B',
          activeBg: '#F1F5F9',
          activeBorder: '#2563EB',
          activeText: '#0F172A',
        },
        surface: '#FFFFFF',
        mainBg: '#F8FAFC',
        borderDefault: '#E2E8F0',
        borderSoft: '#F1F5F9',
        textPrimary: '#0F172A',
        textDim: '#475569',
        textFaint: '#94A3B8',
        brandBlue: {
          DEFAULT: '#2563EB',
          bg: '#EFF6FF',
          border: '#DBEAFE',
          text: '#1E40AF'
        },
        brandGreen: {
          DEFAULT: '#059669',
          bg: '#ECFDF5',
          text: '#059669'
        },
        brandAmber: {
          DEFAULT: '#D97706',
          bg: '#FFFBEB',
          border: '#FDE68A',
          text: '#B45309'
        },
        brandRed: {
          DEFAULT: '#DC2626',
          bg: '#FEF2F2',
          border: '#FECACA',
          text: '#B91C1C'
        },
        brandGray: {
          bg: '#F1F5F9',
          text: '#475569'
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
}
