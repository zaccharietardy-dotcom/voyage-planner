'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';

// Admin emails whitelist
const ADMIN_EMAILS = ['zaccharietardy@gmail.com'];

type PipelineEvent = {
  type: 'step_start' | 'step_done' | 'api_call' | 'api_done' | 'info' | 'warning' | 'error';
  step?: number;
  stepName?: string;
  label?: string;
  durationMs?: number;
  detail?: string;
  timestamp: number;
};

type EventEntry = PipelineEvent & { id: number };

export default function AdminPage() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [events, setEvents] = useState<EventEntry[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [destination, setDestination] = useState('Rome');
  const [origin, setOrigin] = useState('Paris');
  const [duration, setDuration] = useState(4);
  const [totalTime, setTotalTime] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [runStartTime, setRunStartTime] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const eventIdRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const startTimeRef = useRef<number>(0);

  // Check admin access
  useEffect(() => {
    const checkAdmin = async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (user && ADMIN_EMAILS.includes(user.email || '')) {
        setIsAdmin(true);
      } else {
        setIsAdmin(false);
      }
    };
    checkAdmin();
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events]);

  useEffect(() => {
    if (!isGenerating) return;

    const timer = setInterval(() => {
      setElapsedSeconds(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);

    return () => clearInterval(timer);
  }, [isGenerating]);

  const handleGenerate = useCallback(async () => {
    setEvents([]);
    setIsGenerating(true);
    setTotalTime(null);
    setError(null);
    eventIdRef.current = 0;
    const now = Date.now();
    startTimeRef.current = now;
    setRunStartTime(now);
    setElapsedSeconds(0);

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          origin,
          destination,
          startDate: new Date(Date.now() + 7 * 86400000).toISOString(),
          durationDays: duration,
          groupSize: 2,
          groupType: 'couple',
          budgetLevel: 'moderate',
          activities: ['culture', 'gastronomy', 'walking'],
        }),
      });

      if (!res.ok || !res.body) {
        setError(`HTTP ${res.status}`);
        setIsGenerating(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.status === 'progress' && data.event) {
              setEvents(prev => [...prev, { ...data.event, id: eventIdRef.current++ }]);
            } else if (data.status === 'done') {
              setTotalTime(Date.now() - startTimeRef.current);
              setIsGenerating(false);
            } else if (data.status === 'error') {
              setError(data.error);
              setIsGenerating(false);
            }
            // Ignore 'generating' keepalive
          } catch {
            // malformed JSON, skip
          }
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setIsGenerating(false);
  }, [origin, destination, duration]);

  // Stats
  const apiCalls = events.filter(e => e.type === 'api_call').length;
  const apiDone = events.filter(e => e.type === 'api_done');
  const apiErrors = apiDone.filter(e => e.detail?.startsWith('ERROR'));
  const steps = events.filter(e => e.type === 'step_done');

  if (isAdmin === null) {
    return <div className="flex items-center justify-center min-h-screen text-gray-400">Chargement...</div>;
  }

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-500 mb-2">Acces refuse</h1>
          <p className="text-gray-400">Cette page est reservee aux administrateurs.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold">Pipeline Monitor</h1>
          <p className="text-gray-400 text-sm">Suivi en temps reel des appels API du pipeline V2</p>
        </div>

        {/* Form */}
        <div className="bg-gray-900 rounded-lg p-4 mb-6 flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Origine</label>
            <input
              type="text"
              value={origin}
              onChange={e => setOrigin(e.target.value)}
              className="bg-gray-800 rounded px-3 py-2 text-sm w-32 border border-gray-700 focus:border-blue-500 focus:outline-none"
              disabled={isGenerating}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Destination</label>
            <input
              type="text"
              value={destination}
              onChange={e => setDestination(e.target.value)}
              className="bg-gray-800 rounded px-3 py-2 text-sm w-32 border border-gray-700 focus:border-blue-500 focus:outline-none"
              disabled={isGenerating}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Jours</label>
            <input
              type="number"
              value={duration}
              onChange={e => setDuration(Number(e.target.value))}
              min={1}
              max={14}
              className="bg-gray-800 rounded px-3 py-2 text-sm w-20 border border-gray-700 focus:border-blue-500 focus:outline-none"
              disabled={isGenerating}
            />
          </div>
          <button
            onClick={handleGenerate}
            disabled={isGenerating}
            className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
              isGenerating
                ? 'bg-gray-700 text-gray-400 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-500 text-white'
            }`}
          >
            {isGenerating ? 'Generation en cours...' : 'Generer'}
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-4 gap-3 mb-6">
          <StatCard label="API Calls" value={apiCalls} color="blue" />
          <StatCard label="Reponses" value={apiDone.length} color="green" />
          <StatCard label="Erreurs" value={apiErrors.length} color="red" />
          <StatCard
            label="Duree totale"
            value={totalTime ? `${(totalTime / 1000).toFixed(1)}s` : isGenerating ? `${elapsedSeconds}s...` : '--'}
            color="purple"
          />
        </div>

        {/* Steps overview */}
        {steps.length > 0 && (
          <div className="bg-gray-900 rounded-lg p-4 mb-6">
            <h2 className="text-sm font-medium text-gray-400 mb-3">Pipeline Steps</h2>
            <div className="flex flex-wrap gap-2">
              {steps.map(s => (
                <span
                  key={s.id}
                  className="inline-flex items-center gap-1.5 bg-gray-800 rounded-full px-3 py-1 text-xs"
                >
                  <span className="text-green-400">Step {s.step}</span>
                  <span className="text-gray-400">{s.stepName}</span>
                  <span className="text-yellow-400 font-mono">{s.durationMs ? `${(s.durationMs / 1000).toFixed(1)}s` : ''}</span>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Event Timeline */}
        <div className="bg-gray-900 rounded-lg">
          <div className="px-4 py-3 border-b border-gray-800 flex items-center justify-between">
            <h2 className="text-sm font-medium text-gray-400">Event Timeline</h2>
            <span className="text-xs text-gray-500">{events.length} events</span>
          </div>
          <div ref={scrollRef} className="max-h-[500px] overflow-y-auto p-2 space-y-0.5 font-mono text-xs">
            {events.length === 0 && !isGenerating && (
              <div className="text-center py-8 text-gray-500">
                Lancez une generation pour voir les events en temps reel
              </div>
            )}
            {events.map(event => (
              <EventRow key={event.id} event={event} t0={runStartTime} />
            ))}
            {isGenerating && (
              <div className="flex items-center gap-2 py-1 px-2 text-blue-400">
                <span className="animate-pulse">...</span>
                <span>En attente...</span>
              </div>
            )}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mt-4 bg-red-900/30 border border-red-800 rounded-lg p-4 text-red-300 text-sm">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string | number; color: string }) {
  const colors: Record<string, string> = {
    blue: 'text-blue-400',
    green: 'text-green-400',
    red: 'text-red-400',
    purple: 'text-purple-400',
  };
  return (
    <div className="bg-gray-900 rounded-lg p-3">
      <div className="text-xs text-gray-400 mb-1">{label}</div>
      <div className={`text-xl font-bold font-mono ${colors[color] || 'text-gray-100'}`}>{value}</div>
    </div>
  );
}

function EventRow({ event, t0 }: { event: EventEntry; t0: number }) {
  const elapsed = ((event.timestamp - t0) / 1000).toFixed(1);

  const configs: Record<string, { icon: string; color: string }> = {
    step_start: { icon: '>>>', color: 'text-blue-400' },
    step_done: { icon: ' OK', color: 'text-green-400' },
    api_call: { icon: ' ->', color: 'text-cyan-400' },
    api_done: { icon: ' <-', color: event.detail?.startsWith('ERROR') ? 'text-red-400' : 'text-emerald-400' },
    info: { icon: '  i', color: 'text-gray-300' },
    warning: { icon: ' !!', color: 'text-yellow-400' },
    error: { icon: 'ERR', color: 'text-red-500' },
  };

  const cfg = configs[event.type] || { icon: '???', color: 'text-gray-400' };

  let text = '';
  if (event.type === 'step_start') {
    text = `Step ${event.step}: ${event.stepName}...`;
  } else if (event.type === 'step_done') {
    text = `Step ${event.step}: ${event.stepName} (${event.durationMs ? (event.durationMs / 1000).toFixed(1) + 's' : '0ms'})`;
    if (event.detail) text += ` - ${event.detail}`;
  } else if (event.type === 'api_call') {
    text = event.label || 'API call';
  } else if (event.type === 'api_done') {
    text = `${event.label || 'API'} (${event.durationMs ? (event.durationMs / 1000).toFixed(1) + 's' : '?'})`;
    if (event.detail) text += ` - ${event.detail}`;
  } else {
    text = event.detail || event.label || event.stepName || '';
  }

  return (
    <div className="flex items-start gap-2 py-0.5 px-2 hover:bg-gray-800/50 rounded">
      <span className="text-gray-600 w-12 text-right flex-shrink-0">{elapsed}s</span>
      <span className={`w-8 flex-shrink-0 ${cfg.color}`}>{cfg.icon}</span>
      <span className={cfg.color}>{text}</span>
    </div>
  );
}
