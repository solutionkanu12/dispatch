/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      // Color tokens copied verbatim from assets/dispatch-prototype.html's
      // :root CSS variables (the approved design). `fail` is the one addition:
      // the prototype never rendered a failed order, so it defined no failure
      // color. Task 16 needs failed orders visibly distinct, so this adds a
      // single new token, a warm red that reads as "stopped" against the
      // ember/green pair without fighting the existing warm dark palette.
      colors: {
        bg: '#0E0B08',
        bg2: '#141019',
        panel: '#1A1511',
        panel2: '#211A14',
        line: '#2E2620',
        line2: '#3D332A',
        cream: '#F5EFE6',
        cream2: '#C9BFB2',
        muted: '#8A7F72',
        muted2: '#5F564C',
        ember: '#E8913C',
        emberHot: '#FFA94D',
        emberSoft: 'rgba(232,145,60,0.14)',
        green: '#6FB98F',
        fail: '#E2574C',
        failSoft: 'rgba(226,87,76,0.14)',
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        sans: ['Inter', '-apple-system', 'sans-serif'],
      },
      boxShadow: {
        lg2: '0 24px 60px rgba(0,0,0,0.55), 0 8px 20px rgba(0,0,0,0.4)',
        md2: '0 8px 28px rgba(0,0,0,0.4)',
        glowEmber: '0 0 40px rgba(232,145,60,0.35), 0 12px 30px rgba(0,0,0,0.5)',
      },
      keyframes: {
        livePulse: {
          '0%, 100%': { opacity: 1, transform: 'scale(1)' },
          '50%': { opacity: 0.45, transform: 'scale(0.8)' },
        },
        flicker: {
          '0%, 100%': { opacity: 0.96 },
          '92%': { opacity: 0.96 },
          '94%': { opacity: 0.82 },
          '96%': { opacity: 0.97 },
        },
      },
      animation: {
        livePulse: 'livePulse 1.9s ease-in-out infinite',
        flicker: 'flicker 5s linear infinite',
      },
    },
  },
  plugins: [],
};
