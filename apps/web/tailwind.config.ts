import type { Config } from 'tailwindcss';

/**
 * Tailwind maps semantic NAMES to the CSS custom properties declared in
 * `app/globals.css :root`. Components reference `bg-surface`, `border-hairline`,
 * `text-accent-cyan`, etc. — never raw hex. The hex lives in exactly one place
 * (the token layer), and the semantic status→accent mapping lives in
 * `lib/status-theme.ts`. Keep it that way.
 */
const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  // Accent utilities are sometimes composed dynamically (`text-accent-${key}`), which
  // the JIT can't see by scanning source. Safelist the full accent surface so any
  // status→color resolution renders. (Atoms prefer CSS-var inline styles regardless.)
  safelist: [
    {
      pattern: /(text|bg|border)-accent-(cyan|green|amber|purple|blue|red)/,
    },
    {
      pattern: /shadow-glow-(cyan|green|amber|purple|blue|red)/,
    },
  ],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        'bg-deep': 'var(--bg-deep)',
        surface: 'var(--surface)',
        'surface-2': 'var(--surface-2)',
        'surface-3': 'var(--surface-3)',
        hairline: 'var(--border)',
        'hairline-strong': 'var(--border-strong)',
        text: 'var(--text)',
        muted: 'var(--text-muted)',
        faint: 'var(--text-faint)',
        accent: {
          cyan: 'var(--accent-cyan)',
          green: 'var(--accent-green)',
          amber: 'var(--accent-amber)',
          purple: 'var(--accent-purple)',
          blue: 'var(--accent-blue)',
          red: 'var(--accent-red)',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '0.875rem', letterSpacing: '0.02em' }],
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        DEFAULT: 'var(--radius)',
        md: 'var(--radius)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
      },
      boxShadow: {
        'glow-cyan': 'var(--glow-cyan)',
        'glow-green': 'var(--glow-green)',
        'glow-amber': 'var(--glow-amber)',
        'glow-purple': 'var(--glow-purple)',
        'glow-blue': 'var(--glow-blue)',
        'glow-red': 'var(--glow-red)',
        elevation: 'var(--elevation)',
      },
      spacing: {
        rail: 'var(--rail-h)',
      },
      keyframes: {
        'pulse-dot': {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.45', transform: 'scale(0.85)' },
        },
        'flow-dash': {
          to: { strokeDashoffset: '-16' },
        },
        scan: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(100%)' },
        },
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(2px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        blink: {
          '0%, 49%': { opacity: '1' },
          '50%, 100%': { opacity: '0' },
        },
        sweep: {
          '0%': { opacity: '0.15' },
          '50%': { opacity: '0.5' },
          '100%': { opacity: '0.15' },
        },
      },
      animation: {
        'pulse-dot': 'pulse-dot 2s ease-in-out infinite',
        'flow-dash': 'flow-dash 0.8s linear infinite',
        scan: 'scan 2.4s ease-in-out infinite',
        'fade-in': 'fade-in 0.18s ease-out',
        blink: 'blink 1.1s step-end infinite',
        sweep: 'sweep 3s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};

export default config;
