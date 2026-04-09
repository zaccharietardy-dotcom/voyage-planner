import { AlertTriangle, CheckCircle2, Link2, MapPinOff, ShieldAlert, Sparkles } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Trip } from '@/lib/types';
import { cn } from '@/lib/utils';
import { getTripQualitySummary } from '@/lib/trip-quality';

interface TripQualitySummaryProps {
  trip: Trip;
}

export function TripQualitySummary({ trip }: TripQualitySummaryProps) {
  const summary = getTripQualitySummary(trip);

  return (
    <Card
      className={cn(
        'border shadow-sm',
        summary.status === 'critical' && 'border-red-200 bg-red-50/70 dark:border-red-900/40 dark:bg-red-900/10',
        summary.status === 'warning' && 'border-amber-200 bg-amber-50/70 dark:border-amber-900/40 dark:bg-amber-900/10',
        summary.status === 'healthy' && 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/40 dark:bg-emerald-900/10',
      )}
    >
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          {summary.status === 'healthy' ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <ShieldAlert className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          )}
          Qualité de l’itinéraire
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric
            icon={Sparkles}
            label="Qualité globale"
            value={summary.score !== null ? `${summary.score}/100` : 'n/a'}
          />
          <Metric
            icon={Link2}
            label="Étapes réservables"
            value={`${summary.bookingCoveragePercent}%`}
          />
          <Metric
            icon={AlertTriangle}
            label="Points bloquants"
            value={String(summary.contractViolationCount)}
          />
          <Metric
            icon={MapPinOff}
            label="Ajustements automatiques"
            value={String(summary.fallbackCount + summary.lowConfidenceCount)}
          />
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">À améliorer</p>
          {summary.reviewPoints.slice(0, 4).map((point) => (
            <p key={point} className="text-sm text-muted-foreground">
              {point}
            </p>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

interface MetricProps {
  icon: typeof Sparkles;
  label: string;
  value: string;
}

function Metric({ icon: Icon, label, value }: MetricProps) {
  return (
    <div className="rounded-xl border border-border/60 bg-background/70 p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        <span>{label}</span>
      </div>
      <p className="mt-2 text-lg font-semibold text-foreground">{value}</p>
    </div>
  );
}
