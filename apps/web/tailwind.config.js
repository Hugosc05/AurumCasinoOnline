/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        noche: '#060A13',
        abismo: '#0D1526',
        marino: '#16223D',
        linea: '#24324F',
        oro: { DEFAULT: '#CFAE6B', claro: '#EBD9A6', oscuro: '#8E7340' },
        tapete: { DEFAULT: '#0D4733', claro: '#14614A', oscuro: '#08301F' },
        rubi: '#B02A3C',
        marfil: '#EEE7D7',
        niebla: '#8A93A6',
        exito: '#4FBF8B',
        aviso: '#E0A84B',
      },
      fontFamily: {
        display: ['"Bodoni Moda Variable"', 'Bodoni Moda', 'Didot', 'Georgia', 'serif'],
        sans: ['"Manrope Variable"', 'Manrope', 'system-ui', 'Segoe UI', 'sans-serif'],
      },
      boxShadow: {
        panel: '0 1px 0 rgba(235,217,166,0.06) inset, 0 18px 40px -18px rgba(0,0,0,0.75)',
        hondo: '0 30px 80px -30px rgba(0,0,0,0.9)',
        oro: '0 0 0 1px rgba(207,174,107,0.45), 0 8px 30px -10px rgba(207,174,107,0.35)',
      },
      transitionTimingFunction: {
        casino: 'cubic-bezier(0.22, 1, 0.36, 1)',
      },
    },
  },
  plugins: [],
};
