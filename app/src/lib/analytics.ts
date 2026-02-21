// Simple client-side analytics — buffers events and sends them to /api/analytics
// No external dependencies needed

type EventProperties = Record<string, string | number | boolean | null>;

interface AnalyticsEvent {
  name: string;
  properties?: EventProperties;
  timestamp: number;
  path: string;
}

const BUFFER_KEY = 'voyage-analytics-buffer';
const FLUSH_INTERVAL = 30_000; // 30s
const MAX_BUFFER_SIZE = 50;

let buffer: AnalyticsEvent[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;
let initialized = false;

function getPath(): string {
  if (typeof window === 'undefined') return '';
  return window.location.pathname;
}

export function trackEvent(name: string, properties?: EventProperties): void {
  if (typeof window === 'undefined') return;

  const event: AnalyticsEvent = {
    name,
    properties,
    timestamp: Date.now(),
    path: getPath(),
  };

  buffer.push(event);

  // Auto-flush if buffer is full
  if (buffer.length >= MAX_BUFFER_SIZE) {
    flushEvents();
  }
}

export function trackPageView(path?: string): void {
  trackEvent('page_view', { page: path || getPath() });
}

async function flushEvents(): Promise<void> {
  if (buffer.length === 0) return;

  const events = [...buffer];
  buffer = [];

  try {
    // Store in localStorage as fallback
    const stored = localStorage.getItem(BUFFER_KEY);
    const existing: AnalyticsEvent[] = stored ? JSON.parse(stored) : [];
    const all = [...existing, ...events].slice(-200); // Keep max 200
    localStorage.setItem(BUFFER_KEY, JSON.stringify(all));

    // Try to send to API (fire and forget — if it fails, events stay in localStorage)
    await fetch('/api/analytics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: all }),
      keepalive: true,
    }).then(() => {
      // Clear localStorage on success
      localStorage.removeItem(BUFFER_KEY);
    }).catch(() => {
      // Keep in localStorage for next flush
    });
  } catch {
    // Silently fail
  }
}

export function initAnalytics(): void {
  if (typeof window === 'undefined' || initialized) return;
  initialized = true;

  // Restore buffer from localStorage
  try {
    const stored = localStorage.getItem(BUFFER_KEY);
    if (stored) {
      buffer = JSON.parse(stored);
    }
  } catch {
    buffer = [];
  }

  // Start periodic flush
  flushTimer = setInterval(flushEvents, FLUSH_INTERVAL);

  // Flush on page unload
  window.addEventListener('beforeunload', () => {
    flushEvents();
  });

  // Track initial page view
  trackPageView();
}

export function stopAnalytics(): void {
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  flushEvents();
  initialized = false;
}
