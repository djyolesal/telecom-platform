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
          // <alpha-value> : Tailwind y injecte l'opacité de la classe, donc
          // `bg-brand/20` fonctionne comme avec une couleur en dur.
          DEFAULT: 'rgb(var(--brand) / <alpha-value>)',
          light: 'rgb(var(--brand-light) / <alpha-value>)',
          accent: 'rgb(var(--accent) / <alpha-value>)',
          accentLight: 'rgb(var(--accent-light) / <alpha-value>)',
          tint: 'rgb(var(--brand-tint) / <alpha-value>)',
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
