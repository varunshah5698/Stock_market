/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#05050a',
          900: '#08080f',
          850: '#0b0b14',
          800: '#101019',
          700: '#171724',
          600: '#1f1f30',
        },
        violet: {
          400: '#a78bfa',
          500: '#8b5cf6',
          600: '#7c3aed',
        },
        cyanx: '#22d3ee',
        gain: '#34e0a1',
        loss: '#ff6b8a',
        warn: '#fbbf24',
        muted: '#9295ab',
        dim: '#74778c',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Space Grotesk', 'Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        panel: '0 1px 0 rgba(255,255,255,0.04) inset, 0 20px 60px -30px rgba(0,0,0,0.9)',
        violet: '0 0 0 1px rgba(139,92,246,0.28), 0 20px 60px -25px rgba(124,58,237,0.45)',
        card: '0 30px 80px -40px rgba(0,0,0,0.9)',
      },
      animation: {
        'fade-up': 'fadeUp 0.7s cubic-bezier(0.2,0.7,0.2,1) both',
        float: 'float 7s ease-in-out infinite',
        'spin-slow': 'spin 28s linear infinite',
        marquee: 'marquee 40s linear infinite',
        shimmer: 'shimmer 2.2s linear infinite',
        'pulse-soft': 'pulseSoft 3.5s ease-in-out infinite',
      },
      keyframes: {
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(14px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        float: {
          '0%,100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        marquee: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-400px 0' },
          '100%': { backgroundPosition: '400px 0' },
        },
        pulseSoft: {
          '0%,100%': { opacity: '0.55' },
          '50%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}
