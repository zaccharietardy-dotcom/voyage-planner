/**
 * In-memory store for the last generation profiling data.
 * Survives within a single serverless instance invocation.
 * Read via GET /api/generate/profiling
 */

export interface ProfilingEntry {
  timestamp: string;
  destination: string;
  durationDays: number;
  status: 'running' | 'done' | 'timeout' | 'error';
  totalElapsedMs: number;
  apiTimings: Array<{ label: string; durationMs: number; status: 'ok' | 'error' }>;
  stepTimings: Array<{ step: number; name: string; durationMs: number }>;
  error?: string;
}

let lastProfiling: ProfilingEntry | null = null;

export function storeProfilingData(entry: ProfilingEntry): void {
  lastProfiling = entry;
}

export function getLastProfiling(): ProfilingEntry | null {
  return lastProfiling;
}
