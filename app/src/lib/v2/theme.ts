/**
 * Narae Voyage Design System
 * Inspired by the golden wing on deep blue background
 */

export const colors = {
  // Backgrounds - Deep blue inspired by logo
  bgPrimary: '#0a1628',      // Very dark navy blue
  bgSecondary: '#0d1f35',    // Dark navy
  bgTertiary: '#122a45',     // Medium navy
  bgElevated: '#183352',     // Elevated navy

  // Accent colors - Gold/Amber inspired by the wing
  accentPrimary: '#d4a853',   // Primary gold
  accentSecondary: '#e8c068', // Lighter gold
  accentGlow: '#f0d078',      // Glowing gold
  accentMuted: '#b8923d',     // Muted gold
  accentWarm: '#f5bc42',      // Warm golden yellow

  // Text
  textPrimary: '#f8fafc',
  textSecondary: '#a8c0d8',   // Bluish gray
  textMuted: '#6b8aab',       // Muted blue
  textInverse: '#0a1628',
  textGold: '#e8c068',        // Gold text for emphasis

  // Status
  success: '#10b981',
  successMuted: '#059669',
  warning: '#f59e0b',
  warningMuted: '#d97706',
  error: '#ef4444',
  errorMuted: '#dc2626',

  // Globe specific - Enhanced for blue/gold theme
  globeAtmosphere: 'rgba(212, 168, 83, 0.2)',
  globeGlow: 'rgba(232, 192, 104, 0.3)',
  arcColor: '#d4a853',        // Golden arcs
  arcGlow: '#e8c068',
  markerColor: '#f5bc42',     // Bright gold markers
  markerPulse: 'rgba(245, 188, 66, 0.5)',
  markerSelected: '#f0d078',  // Light gold for selected

  // Borders & Dividers
  border: '#1e3a5f',          // Blue-tinted border
  borderLight: '#2a4a70',
  borderGold: '#d4a85340',    // Subtle gold border
  divider: '#152238',

  // Glassmorphism
  glass: 'rgba(13, 31, 53, 0.85)',
  glassLight: 'rgba(18, 42, 69, 0.7)',
  glassGold: 'rgba(212, 168, 83, 0.1)',
} as const;

export const gradients = {
  // Primary gradients
  goldShine: 'linear-gradient(135deg, #b8923d 0%, #d4a853 25%, #f0d078 50%, #e8c068 75%, #d4a853 100%)',
  goldSubtle: 'linear-gradient(135deg, #d4a853 0%, #e8c068 100%)',
  blueDepth: 'linear-gradient(180deg, #0a1628 0%, #0d1f35 50%, #122a45 100%)',
  goldToTransparent: 'linear-gradient(180deg, rgba(212, 168, 83, 0.2) 0%, transparent 100%)',

  // Card gradients
  cardGlow: 'linear-gradient(135deg, rgba(212, 168, 83, 0.1) 0%, transparent 50%)',
  cardBorder: 'linear-gradient(135deg, #d4a853 0%, #1e3a5f 50%, #d4a853 100%)',

  // Button gradients
  buttonPrimary: 'linear-gradient(135deg, #d4a853 0%, #b8923d 100%)',
  buttonHover: 'linear-gradient(135deg, #e8c068 0%, #d4a853 100%)',
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
  glow: '0 0 20px rgba(212, 168, 83, 0.3)',
  glowStrong: '0 0 40px rgba(212, 168, 83, 0.5)',
  glowGold: '0 0 30px rgba(212, 168, 83, 0.4)',
  inner: 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.3)',
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

// Tailwind CSS custom classes for v2 - Narae Voyage theme
export const v2Classes = {
  // Backgrounds
  bgPrimary: 'bg-[#0a1628]',
  bgSecondary: 'bg-[#0d1f35]',
  bgTertiary: 'bg-[#122a45]',
  bgElevated: 'bg-[#183352]',

  // Accent - Gold
  accentPrimary: 'bg-[#d4a853]',
  accentSecondaryBg: 'bg-[#e8c068]',
  textAccent: 'text-[#d4a853]',
  textGold: 'text-[#e8c068]',

  // Glass effect
  glass: 'bg-[#0d1f35]/85 backdrop-blur-xl',
  glassLight: 'bg-[#122a45]/70 backdrop-blur-lg',
  glassGold: 'bg-[#d4a853]/10 backdrop-blur-xl',

  // Borders
  borderSubtle: 'border-[#1e3a5f]',
  borderLight: 'border-[#2a4a70]',
  borderGold: 'border-[#d4a853]/30',

  // Glow effects
  glowAccent: 'shadow-[0_0_20px_rgba(212,168,83,0.3)]',
  glowStrong: 'shadow-[0_0_40px_rgba(212,168,83,0.5)]',
  glowGold: 'shadow-[0_0_30px_rgba(212,168,83,0.4)]',

  // Gradients as classes
  gradientGold: 'bg-gradient-to-r from-[#d4a853] to-[#e8c068]',
  gradientGoldShine: 'bg-gradient-to-r from-[#b8923d] via-[#f0d078] to-[#d4a853]',
} as const;
