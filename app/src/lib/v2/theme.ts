/**
 * TravelSphere Design System - Dark Mode
 */

export const colors = {
  // Backgrounds
  bgPrimary: '#0a0a0f',
  bgSecondary: '#12121a',
  bgTertiary: '#1a1a24',
  bgElevated: '#22222e',

  // Accent colors
  accentPrimary: '#6366f1',
  accentSecondary: '#8b5cf6',
  accentGlow: '#818cf8',
  accentMuted: '#4f46e5',

  // Text
  textPrimary: '#f8fafc',
  textSecondary: '#94a3b8',
  textMuted: '#64748b',
  textInverse: '#0a0a0f',

  // Status
  success: '#10b981',
  successMuted: '#059669',
  warning: '#f59e0b',
  warningMuted: '#d97706',
  error: '#ef4444',
  errorMuted: '#dc2626',

  // Globe specific - bright accents on dark matte background
  globeAtmosphere: 'rgba(99, 102, 241, 0.25)',
  globeGlow: 'rgba(129, 140, 248, 0.4)',
  arcColor: '#38bdf8', // Brighter cyan
  arcGlow: '#0ea5e9',
  markerColor: '#fbbf24', // Brighter amber
  markerPulse: 'rgba(251, 191, 36, 0.5)',
  markerSelected: '#a78bfa', // Purple for selected

  // Borders & Dividers
  border: '#2a2a38',
  borderLight: '#3a3a4a',
  divider: '#1e1e28',

  // Glassmorphism
  glass: 'rgba(18, 18, 26, 0.8)',
  glassLight: 'rgba(26, 26, 36, 0.6)',
} as const;

export const spacing = {
  xs: '0.25rem',   // 4px
  sm: '0.5rem',    // 8px
  md: '1rem',      // 16px
  lg: '1.5rem',    // 24px
  xl: '2rem',      // 32px
  '2xl': '3rem',   // 48px
  '3xl': '4rem',   // 64px
} as const;

export const borderRadius = {
  sm: '0.375rem',  // 6px
  md: '0.5rem',    // 8px
  lg: '0.75rem',   // 12px
  xl: '1rem',      // 16px
  '2xl': '1.5rem', // 24px
  full: '9999px',
} as const;

export const shadows = {
  sm: '0 1px 2px 0 rgba(0, 0, 0, 0.4)',
  md: '0 4px 6px -1px rgba(0, 0, 0, 0.4), 0 2px 4px -2px rgba(0, 0, 0, 0.3)',
  lg: '0 10px 15px -3px rgba(0, 0, 0, 0.4), 0 4px 6px -4px rgba(0, 0, 0, 0.3)',
  xl: '0 20px 25px -5px rgba(0, 0, 0, 0.4), 0 8px 10px -6px rgba(0, 0, 0, 0.3)',
  glow: '0 0 20px rgba(99, 102, 241, 0.3)',
  glowStrong: '0 0 40px rgba(99, 102, 241, 0.5)',
} as const;

export const transitions = {
  fast: '150ms ease',
  normal: '300ms ease',
  slow: '500ms ease',
  spring: '500ms cubic-bezier(0.34, 1.56, 0.64, 1)',
} as const;

export const zIndex = {
  base: 0,
  dropdown: 10,
  sticky: 20,
  fixed: 30,
  modalBackdrop: 40,
  modal: 50,
  popover: 60,
  tooltip: 70,
  toast: 80,
} as const;

// Tailwind CSS custom classes for v2
export const v2Classes = {
  // Backgrounds
  bgPrimary: 'bg-[#0a0a0f]',
  bgSecondary: 'bg-[#12121a]',
  bgTertiary: 'bg-[#1a1a24]',
  bgElevated: 'bg-[#22222e]',

  // Accent
  accentPrimary: 'bg-indigo-500',
  accentSecondaryBg: 'bg-violet-500',
  textAccent: 'text-indigo-400',

  // Glass effect
  glass: 'bg-[#12121a]/80 backdrop-blur-xl',
  glassLight: 'bg-[#1a1a24]/60 backdrop-blur-lg',

  // Borders
  borderSubtle: 'border-[#2a2a38]',
  borderLight: 'border-[#3a3a4a]',

  // Glow effects
  glowAccent: 'shadow-[0_0_20px_rgba(99,102,241,0.3)]',
  glowStrong: 'shadow-[0_0_40px_rgba(99,102,241,0.5)]',
} as const;
