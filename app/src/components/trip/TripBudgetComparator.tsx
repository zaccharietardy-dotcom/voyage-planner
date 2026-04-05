'use client';

import { useState, useEffect, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Plane,
  Bed,
  MapPin,
  Utensils,
  Bus,
  TrendingDown,
  Lightbulb,
  DollarSign,
  Loader2,
  AlertCircle,
  PieChart,
} from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { Trip, TripCostSummary } from '@/lib/types';
import { motion } from 'framer-motion';

// ---------------------------------------------------------------------------
// TripBudgetBreakdown — standalone visual breakdown (no API call)
// ---------------------------------------------------------------------------

interface TripBudgetBreakdownProps {
  trip: Trip;
}

export function TripBudgetBreakdown({ trip }: TripBudgetBreakdownProps) {
  const { t } = useTranslation();

  const breakdown = trip.costBreakdown || {
    flights: 0,
    accommodation: 0,
    food: 0,
    activities: 0,
    transport: 0,
    parking: 0,
    other: 0,
  };

  const categories = useMemo(
    () =>
      [
        { label: t('budget.category.flights'), value: breakdown.flights, color: '#EC4899', icon: Plane },
        { label: t('budget.category.accommodation'), value: breakdown.accommodation, color: '#8B5CF6', icon: Bed },
        { label: t('budget.category.activities'), value: breakdown.activities, color: '#3B82F6', icon: MapPin },
        { label: t('budget.category.food'), value: breakdown.food, color: '#F97316', icon: Utensils },
        { label: t('budget.category.localTransport'), value: breakdown.transport, color: '#10B981', icon: Bus },
      ].filter((c) => c.value > 0),
    [breakdown, t]
  );

  const total = useMemo(
    () => categories.reduce((sum, c) => sum + c.value, 0) || trip.totalEstimatedCost || 0,
    [categories, trip.totalEstimatedCost]
  );

  const perPerson = trip.preferences.groupSize
    ? Math.round(total / trip.preferences.groupSize)
    : total;
  const perDay = trip.days.length > 0 ? Math.round(total / trip.days.length) : total;

  // SVG donut segments
  const donutSegments = useMemo(() => {
    let cumulative = 0;
    return categories.map((cat) => {
      const percentage = total > 0 ? cat.value / total : 0;
      const start = cumulative;
      cumulative += percentage;
      return { ...cat, start, percentage };
    });
  }, [categories, total]);

  // Per-day costs
  const dailyCosts = useMemo(
    () =>
      trip.days.map((day) => ({
        dayNumber: day.dayNumber,
        total:
          day.dailyBudget?.total ||
          day.items.reduce((sum, item) => sum + (item.estimatedCost || 0), 0),
      })),
    [trip.days]
  );
  const maxDailyCost = Math.max(...dailyCosts.map((d) => d.total), 1);

  if (total === 0) return null;

  return (
    <Card className="p-6">
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-center gap-2 mb-1">
          <div className="p-1.5 rounded-lg bg-primary/10">
            <PieChart className="h-4 w-4 text-primary" />
          </div>
          <h3 className="font-semibold">{t('budget.title')}</h3>
        </div>

        {/* Total */}
        <div className="text-center">
          <p className="text-3xl font-bold">{total.toLocaleString('fr-FR')}&euro;</p>
          <p className="text-sm text-muted-foreground mt-1">
            {perPerson.toLocaleString('fr-FR')}&euro;{t('budget.perPerson')}
            {' · '}
            {perDay.toLocaleString('fr-FR')}&euro;{t('budget.perDay')}
          </p>
        </div>

        {/* Donut chart */}
        {categories.length > 1 && (
          <div className="flex justify-center">
            <svg viewBox="0 0 100 100" className="w-32 h-32">
              {donutSegments.map((seg, i) => {
                const r = 40;
                const circumference = 2 * Math.PI * r;
                const rotation = seg.start * 360 - 90;
                return (
                  <circle
                    key={i}
                    cx="50"
                    cy="50"
                    r={r}
                    fill="none"
                    stroke={seg.color}
                    strokeWidth="12"
                    strokeDasharray={`${circumference * seg.percentage} ${circumference}`}
                    transform={`rotate(${rotation} 50 50)`}
                    className="transition-all duration-500"
                  />
                );
              })}
            </svg>
          </div>
        )}

        {/* Category bars */}
        <div className="space-y-2.5">
          {categories.map((cat, idx) => {
            const Icon = cat.icon;
            return (
              <motion.div
                key={cat.label}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.07 }}
                className="flex items-center gap-2"
              >
                <div
                  className="p-1 rounded"
                  style={{ backgroundColor: `${cat.color}20`, color: cat.color }}
                >
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <span className="text-xs font-medium w-28 truncate">{cat.label}</span>
                <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${total > 0 ? (cat.value / total) * 100 : 0}%` }}
                    transition={{ delay: idx * 0.07 + 0.15, duration: 0.45 }}
                    className="h-full rounded-full"
                    style={{ backgroundColor: cat.color }}
                  />
                </div>
                <span className="text-xs font-medium w-16 text-right tabular-nums">
                  {cat.value.toLocaleString('fr-FR')}&euro;
                </span>
              </motion.div>
            );
          })}
        </div>

        {/* Per-day cost bars */}
        {dailyCosts.length > 1 && (
          <div>
            <p className="text-xs font-medium mb-2 text-muted-foreground">{t('budget.costPerDay')}</p>
            <div className="flex items-end gap-1 h-16">
              {dailyCosts.map((day) => (
                <div
                  key={day.dayNumber}
                  className="flex-1 flex flex-col items-center gap-0.5"
                >
                  <div
                    className="w-full bg-primary/20 rounded-t transition-all duration-500"
                    style={{ height: `${(day.total / maxDailyCost) * 100}%` }}
                  />
                  <span className="text-[9px] text-muted-foreground">J{day.dayNumber}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// TripBudgetComparator — API-based price comparison (existing)
// ---------------------------------------------------------------------------

interface TripBudgetComparatorProps {
  trip: Trip;
}

export function TripBudgetComparator({ trip }: TripBudgetComparatorProps) {
  const { t } = useTranslation();
  const [summary, setSummary] = useState<TripCostSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadSummary();
  }, [trip.id]);

  const loadSummary = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/compare-prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'trip-summary', params: { trip } }),
      });

      if (!response.ok) {
        throw new Error(t('budget.errorCalc'));
      }

      const { data } = await response.json();
      setSummary(data);
    } catch (err) {
      console.error('Error loading trip budget summary:', err);
      setError(err instanceof Error ? err.message : t('budget.unknownError'));
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>{t('budget.calculating')}</span>
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="p-6 border-destructive/50">
        <div className="flex items-center gap-2 text-destructive">
          <AlertCircle className="h-5 w-5" />
          <span>{error}</span>
        </div>
      </Card>
    );
  }

  if (!summary) {
    return null;
  }

  const categories = [
    {
      icon: Bed,
      label: t('budget.category.accommodation'),
      current: summary.accommodation.total,
      best: summary.accommodation.bestTotal,
      savings: summary.accommodation.savings,
      color: '#8B5CF6',
    },
    {
      icon: Plane,
      label: t('budget.category.flights'),
      current: summary.flights.total,
      best: summary.flights.bestTotal,
      savings: summary.flights.savings,
      color: '#EC4899',
    },
    {
      icon: MapPin,
      label: t('budget.category.activities'),
      current: summary.activities.total,
      best: summary.activities.bestTotal,
      savings: summary.activities.savings,
      color: '#3B82F6',
    },
    {
      icon: Utensils,
      label: t('budget.category.dining'),
      current: summary.estimatedFood,
      best: summary.estimatedFood,
      savings: 0,
      color: '#F97316',
    },
    {
      icon: Bus,
      label: t('budget.category.localTransport'),
      current: summary.estimatedTransport,
      best: summary.estimatedTransport,
      savings: 0,
      color: '#10B981',
    },
  ];

  const maxValue = Math.max(...categories.map((c) => c.current));
  const perPersonBudget = Math.round(summary.grandTotal / trip.preferences.groupSize);
  const perPersonBestBudget = Math.round(summary.bestGrandTotal / trip.preferences.groupSize);
  const perDayBudget = Math.round(perPersonBudget / trip.preferences.durationDays);

  return (
    <div className="space-y-6">
      {/* Header with savings highlight */}
      <Card className="p-6 bg-gradient-to-br from-emerald-500/10 to-emerald-500/5 border-emerald-500/20">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <h2 className="text-xl font-bold mb-2 flex items-center gap-2">
              <DollarSign className="h-5 w-5 text-emerald-600" />
              {t('budget.comparison')}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t('budget.findBestDeals')}
            </p>
          </div>

          {summary.totalSavings > 0 && (
            <Badge className="bg-emerald-500 text-white text-base px-4 py-2">
              <TrendingDown className="h-4 w-4 mr-2" />
              {t('budget.save')} {summary.totalSavings}&euro; ({summary.savingsPercent}%)
            </Badge>
          )}
        </div>

        {/* Budget summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
          <div className="bg-background rounded-lg p-4 border">
            <div className="text-xs text-muted-foreground mb-1">{t('budget.currentBudget')}</div>
            <div className="text-2xl font-bold text-foreground">{summary.grandTotal}&euro;</div>
            <div className="text-xs text-muted-foreground mt-1">
              {perPersonBudget}&euro;{t('budget.perPerson')} · {perDayBudget}&euro;{t('budget.perDay')}
            </div>
          </div>

          <div className="bg-background rounded-lg p-4 border border-emerald-500/30">
            <div className="text-xs text-emerald-600 dark:text-emerald-400 mb-1">{t('budget.optimizedBudget')}</div>
            <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
              {summary.bestGrandTotal}&euro;
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {perPersonBestBudget}&euro;{t('budget.perPerson')} · {Math.round(perPersonBestBudget / trip.preferences.durationDays)}&euro;{t('budget.perDay')}
            </div>
          </div>

          <div className="bg-background rounded-lg p-4 border">
            <div className="text-xs text-muted-foreground mb-1">{t('budget.possibleSavings')}</div>
            <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
              {summary.totalSavings}€
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {Math.round(summary.totalSavings / trip.preferences.groupSize)}€/pers
            </div>
          </div>
        </div>
      </Card>

      {/* Per-category breakdown */}
      <Card className="p-6">
        <h3 className="font-semibold mb-4">{t('budget.categoryDetail')}</h3>
        <div className="space-y-4">
          {categories.map((cat, idx) => {
            const Icon = cat.icon;
            const savingsPercent = cat.current > 0 ? Math.round((cat.savings / cat.current) * 100) : 0;

            return (
              <motion.div
                key={cat.label}
                initial={{ opacity: 0, x: -4 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.1 }}
                className="space-y-2"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div
                      className="p-1.5 rounded-lg"
                      style={{ backgroundColor: `${cat.color}20`, color: cat.color }}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <span className="font-medium text-sm">{cat.label}</span>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      {cat.savings > 0 ? (
                        <>
                          <span className="text-sm line-through text-muted-foreground">{cat.current}€</span>
                          <span className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 ml-2">
                            {cat.best}€
                          </span>
                        </>
                      ) : (
                        <span className="text-sm font-semibold">{cat.current}€</span>
                      )}
                    </div>

                    {cat.savings > 0 && (
                      <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-600">
                        -{savingsPercent}%
                      </Badge>
                    )}
                  </div>
                </div>

                {/* Progress bar */}
                <div className="relative">
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${(cat.current / maxValue) * 100}%` }}
                      transition={{ delay: idx * 0.1 + 0.2, duration: 0.5 }}
                      className="h-full rounded-full"
                      style={{ backgroundColor: cat.color }}
                    />
                  </div>
                  {cat.savings > 0 && (
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${(cat.best / maxValue) * 100}%` }}
                      transition={{ delay: idx * 0.1 + 0.4, duration: 0.5 }}
                      className="absolute top-0 h-2 rounded-full border-2 border-emerald-500"
                      style={{ backgroundColor: 'transparent' }}
                    />
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      </Card>

      {/* Per-day breakdown */}
      <Card className="p-6">
        <h3 className="font-semibold mb-4">{t('budget.dailyBreakdown')}</h3>
        <div className="space-y-2">
          {trip.days.map((day, idx) => {
            const dayBudget = day.dailyBudget || {
              activities: 0,
              food: 0,
              transport: 0,
              total: 0,
            };

            const maxDayBudget = Math.max(...trip.days.map((d) => d.dailyBudget?.total || 0));
            const percentage = maxDayBudget > 0 ? (dayBudget.total / maxDayBudget) * 100 : 0;

            return (
              <div key={day.dayNumber} className="flex items-center gap-3">
                <div className="w-16 text-xs text-muted-foreground">
                  {t('budget.day')} {day.dayNumber}
                </div>
                <div className="flex-1">
                  <Progress value={percentage} className="h-2" />
                </div>
                <div className="w-20 text-right text-sm font-medium">
                  {dayBudget.total}€
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Savings tips */}
      {summary.totalSavings > 0 && (
        <Card className="p-6 bg-blue-500/5 border-blue-500/20">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-lg bg-blue-500/10">
              <Lightbulb className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="flex-1">
              <h3 className="font-semibold mb-2">{t('budget.savingsTips')}</h3>
              <ul className="space-y-1.5 text-sm text-muted-foreground">
                {summary.accommodation.savings > 0 && (
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 dark:text-blue-400 mt-0.5">•</span>
                    <span>
                      Réservez sur Airbnb au lieu de Booking.com pour économiser jusqu&apos;à{' '}
                      {summary.accommodation.savings}€ sur l&apos;hébergement
                    </span>
                  </li>
                )}
                {summary.flights.savings > 0 && (
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 dark:text-blue-400 mt-0.5">•</span>
                    <span>
                      Comparez les prix sur plusieurs plateformes de vols (Aviasales, Omio) pour économiser{' '}
                      {summary.flights.savings}€
                    </span>
                  </li>
                )}
                {summary.activities.savings > 0 && (
                  <li className="flex items-start gap-2">
                    <span className="text-blue-600 dark:text-blue-400 mt-0.5">•</span>
                    <span>
                      Réservez vos activités sur GetYourGuide ou Tiqets pour économiser jusqu&apos;à{' '}
                      {summary.activities.savings}€
                    </span>
                  </li>
                )}
                <li className="flex items-start gap-2">
                  <span className="text-blue-600 dark:text-blue-400 mt-0.5">•</span>
                  <span>
                    Privilégiez les restaurants locaux et les marchés pour réduire vos dépenses alimentaires
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-600 dark:text-blue-400 mt-0.5">•</span>
                  <span>
                    Utilisez les transports en commun plutôt que les taxis pour économiser sur les déplacements
                  </span>
                </li>
              </ul>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
