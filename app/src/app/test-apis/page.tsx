'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import {
  Plane, Train, Hotel, UtensilsCrossed, Ticket, MapPin,
  Loader2, CheckCircle2, XCircle, AlertCircle, Clock,
  ExternalLink, Zap, Globe, ArrowRight, Users, Calendar,
  ChevronDown, ChevronUp
} from 'lucide-react';

interface TestItem {
  type: string;
  title: string;
  subtitle: string;
  price?: string;
  duration?: string;
  rating?: string;
  stops?: string;
  co2?: string;
  address?: string;
  amenities?: string;
  recommended?: boolean;
  link?: string | null;
  linkLabel?: string;
  reservationLink?: string | null;
  transitLines?: string;
  transitLegs?: { line: string; from: string; to: string; departure: string; arrival: string }[];
}

interface TestResult {
  category: string;
  name: string;
  status: 'ok' | 'error' | 'not_configured';
  latencyMs: number;
  count?: number;
  items?: TestItem[];
  error?: string;
}

interface ApiResponse {
  testRoute: string;
  dates: string;
  travelers: number;
  totalLatencyMs: number;
  results: TestResult[];
}

const categoryConfig: Record<string, { icon: typeof Plane; color: string; bg: string }> = {
  transport: { icon: Plane, color: 'text-blue-500', bg: 'bg-blue-500/10' },
  hebergement: { icon: Hotel, color: 'text-purple-500', bg: 'bg-purple-500/10' },
  restaurants: { icon: UtensilsCrossed, color: 'text-orange-500', bg: 'bg-orange-500/10' },
  activites: { icon: Ticket, color: 'text-emerald-500', bg: 'bg-emerald-500/10' },
  maps: { icon: MapPin, color: 'text-rose-500', bg: 'bg-rose-500/10' },
};

const typeIcons: Record<string, typeof Plane> = {
  flight: Plane,
  transport: Train,
  hotel: Hotel,
  restaurant: UtensilsCrossed,
  activity: Ticket,
  direction: MapPin,
};

function StatusBadge({ status }: { status: string }) {
  if (status === 'ok') return <span className="flex items-center gap-1 text-emerald-500 text-sm font-medium"><CheckCircle2 className="size-4" /> OK</span>;
  if (status === 'not_configured') return <span className="flex items-center gap-1 text-yellow-500 text-sm font-medium"><AlertCircle className="size-4" /> Non configuré</span>;
  return <span className="flex items-center gap-1 text-red-500 text-sm font-medium"><XCircle className="size-4" /> Erreur</span>;
}

function ResultCard({ result }: { result: TestResult }) {
  const [expanded, setExpanded] = useState(true);
  const config = categoryConfig[result.category] || categoryConfig.transport;
  const Icon = config.icon;

  return (
    <Card className={`overflow-hidden transition-all ${result.status === 'ok' ? 'border-emerald-500/30' : result.status === 'error' ? 'border-red-500/30' : 'border-yellow-500/30'}`}>
      <CardHeader className="cursor-pointer" onClick={() => setExpanded(!expanded)}>
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${config.bg}`}>
            <Icon className={`size-5 ${config.color}`} />
          </div>
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base">{result.name}</CardTitle>
            <CardDescription className="flex items-center gap-3 mt-1">
              <StatusBadge status={result.status} />
              <span className="flex items-center gap-1 text-muted-foreground">
                <Clock className="size-3" />
                {(result.latencyMs / 1000).toFixed(1)}s
              </span>
              {result.count !== undefined && (
                <span className="text-muted-foreground">{result.count} résultat(s)</span>
              )}
            </CardDescription>
          </div>
          {expanded ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
        </div>
      </CardHeader>

      {expanded && (
        <CardContent>
          {result.error && (
            <div className="mb-4 p-3 rounded-lg bg-red-500/10 text-red-500 text-sm">
              {result.error}
            </div>
          )}

          {result.items && result.items.length > 0 && (
            <div className="space-y-3">
              {result.items.map((item, i) => {
                const ItemIcon = typeIcons[item.type] || Globe;
                return (
                  <div key={i} className="p-3 rounded-lg bg-muted/50 border border-border/50 hover:border-primary/30 transition-colors">
                    <div className="flex items-start gap-3">
                      <ItemIcon className={`size-4 mt-0.5 ${config.color} shrink-0`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{item.title}</span>
                          {item.recommended && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-500 font-medium">
                              Recommandé
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">{item.subtitle}</p>

                        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs">
                          {item.price && (
                            <span className="font-semibold text-primary">{item.price}</span>
                          )}
                          {item.duration && (
                            <span className="text-muted-foreground flex items-center gap-1">
                              <Clock className="size-3" /> {item.duration}
                            </span>
                          )}
                          {item.rating && (
                            <span className="text-yellow-500">{item.rating}</span>
                          )}
                          {item.stops && (
                            <span className="text-muted-foreground">{item.stops}</span>
                          )}
                          {item.co2 && (
                            <span className="text-emerald-500">{item.co2}</span>
                          )}
                          {item.address && (
                            <span className="text-muted-foreground truncate max-w-[200px]">{item.address}</span>
                          )}
                          {item.transitLines && (
                            <span className="text-blue-400">{item.transitLines}</span>
                          )}
                        </div>

                        {item.transitLegs && item.transitLegs.length > 0 && (
                          <div className="mt-2 space-y-1">
                            {item.transitLegs.map((leg, j) => (
                              <div key={j} className="text-[11px] text-muted-foreground flex items-center gap-1">
                                <Train className="size-3" />
                                <span className="font-medium">{leg.line}</span>
                                <span>{leg.from}</span>
                                <ArrowRight className="size-3" />
                                <span>{leg.to}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="flex gap-2 mt-2">
                          {item.link && (
                            <a
                              href={item.link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80 font-medium transition-colors"
                            >
                              <ExternalLink className="size-3" />
                              {item.linkLabel || 'Voir'}
                            </a>
                          )}
                          {item.reservationLink && item.reservationLink !== item.link && (
                            <a
                              href={item.reservationLink}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-orange-500 hover:text-orange-400 font-medium transition-colors"
                            >
                              <ExternalLink className="size-3" />
                              Réserver (TheFork)
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

export default function TestApisPage() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runTests() {
    setLoading(true);
    setError(null);
    setData(null);

    try {
      const res = await fetch('/api/test-apis');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (err: any) {
      setError(err.message || 'Erreur inconnue');
    } finally {
      setLoading(false);
    }
  }

  const okCount = data?.results.filter(r => r.status === 'ok').length ?? 0;
  const totalCount = data?.results.length ?? 0;

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30">
      <div className="max-w-4xl mx-auto px-4 py-12">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-4">
            <Zap className="size-4" />
            Test des APIs
          </div>
          <h1 className="text-3xl font-bold tracking-tight mb-2">
            Diagnostic des APIs Narae
          </h1>
          <p className="text-muted-foreground max-w-lg mx-auto">
            Teste toutes les APIs en conditions réelles : vols, trains, hôtels, restaurants,
            activités et directions avec des vrais résultats et liens de réservation.
          </p>
        </div>

        {/* Launch button */}
        <div className="flex justify-center mb-8">
          <Button
            onClick={runTests}
            disabled={loading}
            size="lg"
            className="px-8 gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="size-5 animate-spin" />
                Test en cours... (30-60s)
              </>
            ) : (
              <>
                <Zap className="size-5" />
                Lancer le test complet
              </>
            )}
          </Button>
        </div>

        {/* Test config info */}
        {(loading || data) && (
          <div className="flex justify-center gap-6 mb-8 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Globe className="size-4" />
              {data?.testRoute || 'Paris → Barcelona'}
            </span>
            <span className="flex items-center gap-1.5">
              <Calendar className="size-4" />
              4 nuits
            </span>
            <span className="flex items-center gap-1.5">
              <Users className="size-4" />
              2 voyageurs
            </span>
          </div>
        )}

        {/* Loading skeleton */}
        {loading && (
          <div className="space-y-4">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <Card key={i} className="animate-pulse">
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-muted" />
                    <div className="flex-1">
                      <div className="h-4 bg-muted rounded w-48 mb-2" />
                      <div className="h-3 bg-muted rounded w-32" />
                    </div>
                  </div>
                </CardHeader>
              </Card>
            ))}
          </div>
        )}

        {/* Error */}
        {error && (
          <Card className="border-red-500/30">
            <CardContent className="pt-6">
              <div className="flex items-center gap-3 text-red-500">
                <XCircle className="size-5" />
                <span className="font-medium">Erreur: {error}</span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Results */}
        {data && (
          <>
            {/* Summary bar */}
            <div className="mb-6 p-4 rounded-xl bg-card border flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${okCount === totalCount ? 'bg-emerald-500/10' : 'bg-yellow-500/10'}`}>
                  {okCount === totalCount ? (
                    <CheckCircle2 className="size-5 text-emerald-500" />
                  ) : (
                    <AlertCircle className="size-5 text-yellow-500" />
                  )}
                </div>
                <div>
                  <p className="font-semibold text-sm">
                    {okCount}/{totalCount} APIs fonctionnelles
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Temps total: {(data.totalLatencyMs / 1000).toFixed(1)}s
                  </p>
                </div>
              </div>
              <div className="flex gap-1">
                {data.results.map((r, i) => (
                  <div
                    key={i}
                    className={`w-3 h-3 rounded-full ${
                      r.status === 'ok' ? 'bg-emerald-500' :
                      r.status === 'not_configured' ? 'bg-yellow-500' :
                      'bg-red-500'
                    }`}
                    title={r.name}
                  />
                ))}
              </div>
            </div>

            {/* Result cards */}
            <div className="space-y-4">
              {data.results.map((result, i) => (
                <ResultCard key={i} result={result} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
