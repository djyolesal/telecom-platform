import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#1B3F6B',
          light: '#2471A3',
          accent: '#0E7C6B',
        },
        severite: {
          critique: '#C0392B',
          majeur: '#E67E22',
          mineur: '#F1C40F',
          informatif: '#3498DB',
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
