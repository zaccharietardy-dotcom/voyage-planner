'use client';

import { useState } from 'react';
import { Badge, BADGES, CATEGORY_LABELS, BadgeCategory } from '@/lib/constants/badges';
import { BadgeCard } from './BadgeCard';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { UserStats, getBadgeProgress } from '@/lib/services/gamificationService';
import { Trophy, Filter } from 'lucide-react';
import { motion } from 'framer-motion';

interface BadgeShowcaseProps {
  stats: UserStats;
  className?: string;
}

export function BadgeShowcase({ stats, className }: BadgeShowcaseProps) {
  const [activeCategory, setActiveCategory] = useState<BadgeCategory | 'all'>('all');

  // Calculate earned badges
  const earnedBadgeIds = new Set(stats.badges);
  const earnedCount = stats.badges.length;
  const totalCount = BADGES.length;

  // Filter badges by category
  const filteredBadges = activeCategory === 'all'
    ? BADGES
    : BADGES.filter(b => b.category === activeCategory);

  // Sort: earned first, then by tier
  const tierOrder: Record<string, number> = { bronze: 1, silver: 2, gold: 3, platinum: 4 };
  const sortedBadges = [...filteredBadges].sort((a, b) => {
    const aEarned = earnedBadgeIds.has(a.id);
    const bEarned = earnedBadgeIds.has(b.id);

    if (aEarned !== bEarned) return aEarned ? -1 : 1;
    return tierOrder[a.tier] - tierOrder[b.tier];
  });

  return (
    <div className={className}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Trophy className="w-5 h-5 text-yellow-500" />
          <h2 className="text-lg font-bold">Badges</h2>
        </div>
        <div className="text-sm font-semibold text-muted-foreground">
          {earnedCount}/{totalCount}
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-6">
        <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${(earnedCount / totalCount) * 100}%` }}
            transition={{ duration: 1, ease: 'easeOut' }}
            className="h-full bg-gradient-to-r from-yellow-500 to-orange-500 rounded-full"
          />
        </div>
        <p className="text-xs text-muted-foreground text-center mt-2">
          {Math.floor((earnedCount / totalCount) * 100)}% complété
        </p>
      </div>

      {/* Category filters */}
      <Tabs value={activeCategory} onValueChange={(v) => setActiveCategory(v as BadgeCategory | 'all')} className="mb-4">
        <TabsList className="w-full grid grid-cols-3 lg:grid-cols-6 gap-1">
          <TabsTrigger value="all" className="text-xs">
            Tous
          </TabsTrigger>
          {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
            <TabsTrigger key={key} value={key} className="text-xs">
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Badge grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
        {sortedBadges.map((badge, index) => {
          const isEarned = earnedBadgeIds.has(badge.id);
          const progress = isEarned ? 100 : getBadgeProgress(badge, stats);

          return (
            <motion.div
              key={badge.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05, duration: 0.3 }}
            >
              <BadgeCard
                badge={badge}
                isEarned={isEarned}
                progress={progress}
                showProgress={!isEarned}
              />
            </motion.div>
          );
        })}
      </div>

      {/* Empty state */}
      {sortedBadges.length === 0 && (
        <div className="text-center py-10">
          <Filter className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">Aucun badge dans cette catégorie</p>
        </div>
      )}
    </div>
  );
}
