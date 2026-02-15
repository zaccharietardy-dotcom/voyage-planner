'use client';

import { useEffect, useState } from 'react';
import { UserStats, getUserStats } from '@/lib/services/gamificationService';
import { LevelProgress } from './LevelProgress';
import { BadgeShowcase } from './BadgeShowcase';
import { StreakCounter } from './StreakCounter';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, TrendingUp, Trophy, Flame, Award } from 'lucide-react';
import { motion } from 'framer-motion';

interface GamificationSectionProps {
  userId: string;
  isOwnProfile?: boolean;
  className?: string;
}

export function GamificationSection({ userId, isOwnProfile = false, className }: GamificationSectionProps) {
  const [stats, setStats] = useState<UserStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      setLoading(true);
      const data = await getUserStats(userId);
      setStats(data);
      setLoading(false);
    };

    fetchStats();
  }, [userId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!stats) {
    return null;
  }

  // Mock recent activity days (last 7 days)
  // In production, fetch from login tracking
  const recentDays = [true, true, false, true, true, true, true];

  return (
    <div className={className}>
      <Tabs defaultValue="progress" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="progress" className="gap-1">
            <TrendingUp className="w-4 h-4" />
            <span className="hidden sm:inline">Progression</span>
          </TabsTrigger>
          <TabsTrigger value="badges" className="gap-1">
            <Trophy className="w-4 h-4" />
            <span className="hidden sm:inline">Badges</span>
          </TabsTrigger>
          <TabsTrigger value="streak" className="gap-1">
            <Flame className="w-4 h-4" />
            <span className="hidden sm:inline">Série</span>
          </TabsTrigger>
        </TabsList>

        {/* Progress Tab */}
        <TabsContent value="progress" className="space-y-4 mt-4">
          {/* Level progress */}
          <Card>
            <CardContent className="p-4">
              <LevelProgress totalXp={stats.totalXp} showAnimation={isOwnProfile} />
            </CardContent>
          </Card>

          {/* Quick stats grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
            >
              <Card>
                <CardContent className="p-3 text-center">
                  <p className="text-2xl font-bold text-primary">{stats.tripCount}</p>
                  <p className="text-xs text-muted-foreground">Voyages</p>
                </CardContent>
              </Card>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              <Card>
                <CardContent className="p-3 text-center">
                  <p className="text-2xl font-bold text-blue-500">{stats.countryCount}</p>
                  <p className="text-xs text-muted-foreground">Pays</p>
                </CardContent>
              </Card>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
            >
              <Card>
                <CardContent className="p-3 text-center">
                  <p className="text-2xl font-bold text-pink-500">{stats.likeCount}</p>
                  <p className="text-xs text-muted-foreground">Likes</p>
                </CardContent>
              </Card>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
            >
              <Card>
                <CardContent className="p-3 text-center">
                  <p className="text-2xl font-bold text-purple-500">{stats.badges.length}</p>
                  <p className="text-xs text-muted-foreground">Badges</p>
                </CardContent>
              </Card>
            </motion.div>
          </div>

          {/* XP breakdown */}
          <Card>
            <CardContent className="p-4">
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <Award className="w-4 h-4" />
                Sources d&apos;XP
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Voyages créés</span>
                  <span className="font-semibold">{stats.tripCount * 100} XP</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Abonnés</span>
                  <span className="font-semibold">{stats.followerCount * 20} XP</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Likes reçus</span>
                  <span className="font-semibold">{stats.likeCount * 10} XP</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Photos</span>
                  <span className="font-semibold">{stats.photoCount * 5} XP</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Commentaires</span>
                  <span className="font-semibold">{stats.commentCount * 15} XP</span>
                </div>
                <div className="border-t pt-2 flex justify-between font-bold">
                  <span>Total</span>
                  <span className="text-primary">{stats.totalXp} XP</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Badges Tab */}
        <TabsContent value="badges" className="mt-4">
          <BadgeShowcase stats={stats} />
        </TabsContent>

        {/* Streak Tab */}
        <TabsContent value="streak" className="mt-4">
          <StreakCounter
            currentStreak={stats.currentStreak}
            longestStreak={stats.longestStreak}
            recentDays={recentDays}
          />

          {/* Tips to maintain streak */}
          <Card className="mt-4">
            <CardContent className="p-4">
              <h3 className="font-semibold mb-2 flex items-center gap-2">
                <Flame className="w-4 h-4 text-orange-500" />
                Conseils pour maintenir ta série
              </h3>
              <ul className="space-y-1.5 text-sm text-muted-foreground">
                <li className="flex items-start gap-2">
                  <span className="text-primary">•</span>
                  <span>Connecte-toi au moins une fois par jour</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary">•</span>
                  <span>Planifie un nouveau voyage chaque semaine</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary">•</span>
                  <span>Interagis avec la communauté (likes, commentaires)</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-primary">•</span>
                  <span>Ajoute des photos de tes voyages</span>
                </li>
              </ul>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
