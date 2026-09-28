import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        cidco: {
          50: '#eef6ff',
          100: '#d9ebff',
          200: '#bcdcff',
          300: '#8ec6ff',
          400: '#59a6ff',
          500: '#3382fc',
          600: '#1c61f1',
          700: '#164cdd',
          800: '#183fb3',
          900: '#19398d',
        },
      },
    },
  },
  plugins: [],
};

export default config;
