// Narae Voyage — Design System
// Mirror of webapp globals.css + tailwind config

export const colors = {
  // Backgrounds
  bg: '#020617',
  card: '#0a1128',
  cardDark: '#0e1220',
  cardHover: '#0f1629',
  surface: '#0f172a',
  border: '#1e293b',
  borderSubtle: 'rgba(255,255,255,0.05)',
  borderWhite8: 'rgba(255,255,255,0.08)',
  borderWhite10: 'rgba(255,255,255,0.10)',
  borderWhite20: 'rgba(255,255,255,0.20)',

  // Text
  text: '#f8fafc',
  textSecondary: '#94a3b8',
  textMuted: '#64748b',
  textDim: '#475569',
  textWhite60: 'rgba(255,255,255,0.6)',
  textWhite40: 'rgba(255,255,255,0.4)',
  textWhite20: 'rgba(255,255,255,0.2)',

  // Whitealpha
  white2: 'rgba(255,255,255,0.02)',
  white3: 'rgba(255,255,255,0.03)',
  white5: 'rgba(255,255,255,0.05)',
  white8: 'rgba(255,255,255,0.08)',
  white10: 'rgba(255,255,255,0.10)',

  // Gold (primary)
  gold: '#c5a059',
  goldLight: '#dfc28d',
  goldDark: '#a37f3d',
  goldBg: 'rgba(197,160,89,0.1)',
  goldBorder: 'rgba(197,160,89,0.2)',

  // Status
  upcoming: '#60a5fa',
  upcomingBg: 'rgba(59,130,246,0.15)',
  active: '#4ade80',
  activeBg: 'rgba(34,197,94,0.15)',
  past: '#94a3b8',
  pastBg: 'rgba(100,116,139,0.15)',
  danger: '#ef4444',
  dangerBg: 'rgba(239,68,68,0.1)',

  // Trip item types
  activity: '#3B82F6',
  restaurant: '#F97316',
  hotel: '#8B5CF6',
  transport: '#10B981',
  flight: '#EC4899',
  parking: '#6B7280',
  freeTime: '#22C55E',

  // Chart
  chartFlights: '#EC4899',
  chartAccommodation: '#8B5CF6',
  chartActivities: '#3B82F6',
  chartFood: '#F97316',
  chartTransport: '#10B981',
} as const;

// Gold gradient colors (for LinearGradient)
export const goldGradient = ['#E2B35C', '#C5A059', '#8B6E37'] as const;

export const fonts = {
  display: 'PlayfairDisplay_700Bold',
  displaySemiBold: 'PlayfairDisplay_600SemiBold',
  displayMedium: 'PlayfairDisplay_500Medium',
  displayRegular: 'PlayfairDisplay_400Regular',
  sans: 'Inter_400Regular',
  sansMedium: 'Inter_500Medium',
  sansSemiBold: 'Inter_600SemiBold',
  sansBold: 'Inter_700Bold',
  mono: undefined as string | undefined,
} as const;

export const radius = {
  sm: 10,
  md: 12,
  lg: 14,
  xl: 18,
  '2xl': 22,
  '3xl': 26,
  '4xl': 30,
  button: 32,  // pill-shaped buttons (web rounded-2xl/full)
  card: 25,    // card corners (web 2.5rem)
  full: 999,
} as const;

export const spacing = {
  screenPadding: 20,
  cardPadding: 16,
  sectionGap: 24,
  itemGap: 12,
} as const;
