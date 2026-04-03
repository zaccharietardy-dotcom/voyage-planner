import { useEffect, useMemo, useState } from 'react';
import { View, Text, ActivityIndicator, Pressable, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import Animated, { FadeIn, FadeInDown, withRepeat, withTiming, useAnimatedStyle, useSharedValue, Easing } from 'react-native-reanimated';
import { Plane, Check, Compass, Info } from 'lucide-react-native';
import { colors, fonts, radius } from '@/lib/theme';
import type { GenerateProgress } from '@/lib/api/trips';
import type { PipelineMapSnapshot, PipelineQuestion } from '@/lib/types/pipeline';
import { PremiumBackground } from '@/components/ui/PremiumBackground';
import { QuestionCard } from '@/components/plan/QuestionCard';
import { GenerationMap } from '@/components/plan/GenerationMap';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface Props {
  origin?: string;
  destination: string;
  progress: GenerateProgress | null;
  snapshot?: PipelineMapSnapshot | null;
  error: string | null;
  question?: PipelineQuestion | null;
  onAnswer?: (questionId: string, selectedOptionId: string) => void;
  onRetry: () => void;
}

const PIPELINE_LABELS = [
  'Recherche des attractions...',
  'Analyse des restaurants...',
  'Sélection de l\'hébergement...',
  'Planification du transport...',
  'Optimisation de l\'itinéraire...',
  'Validation qualité...',
  'Finalisation...',
];

const FUN_FACTS = [
  'Notre algorithme compare plus de 500 activités.',
  'Chaque restaurant est vérifié à moins de 800m.',
  'Votre itinéraire respecte les horaires d\'ouverture.',
  'Nous optimisons vos trajets pour gagner du temps.',
  'Les restaurants proposent des cuisines variées.',
];

export function GeneratingScreen({ origin, destination, progress, snapshot, error, question, onAnswer, onRetry }: Props) {
  const [factIndex, setFactIndex] = useState(0);
  const currentStep = Math.max(0, Math.min(PIPELINE_LABELS.length - 1, (progress?.step ?? 1) - 1));
  const anim = useSharedValue(0);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const compact = height < 760;
  const mapHeight = useMemo(() => Math.round(height * (compact ? 0.34 : 0.42)), [compact, height]);

  useEffect(() => {
    anim.value = withRepeat(
      withTiming(1, { duration: 4000, easing: Easing.inOut(Easing.quad) }),
      -1,
      true
    );
    const interval = setInterval(() => {
      setFactIndex((i) => (i + 1) % FUN_FACTS.length);
    }, 6000);
    return () => clearInterval(interval);
  }, [anim]);

  const planeStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: anim.value * -15 },
      { rotate: `${anim.value * 10 - 5}deg` }
    ]
  }));

  if (error) {
    return (
      <View style={styles.errorScreen}>
        <PremiumBackground />
        <View style={styles.errorIconWrap}>
          <Text style={{ fontSize: 40 }}>😞</Text>
        </View>
        <Text style={styles.errorTitle}>
          Oups, un imprévu...
        </Text>
        <Text style={styles.errorCopy}>
          {error}
        </Text>
        <Pressable onPress={onRetry} style={{ width: '100%' }}>
          <View style={styles.errorCta}>
            <Text style={{ color: colors.bg, fontSize: 16, fontFamily: fonts.sansBold }}>
              Réessayer la génération
            </Text>
          </View>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <PremiumBackground />
      <View style={[styles.layout, { paddingTop: insets.top + 14, paddingBottom: insets.bottom + 12 }]}>
        <View style={[styles.mapWrap, { height: mapHeight }]}>
          <GenerationMap snapshot={snapshot} origin={origin} destination={destination} />
        </View>

        <View style={styles.bottomPanel}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[styles.bottomScroll, compact ? styles.bottomScrollCompact : null]}
          >
            <View style={styles.kickerRow}>
              <Animated.View style={[planeStyle, styles.planeBadge]}>
                <Plane size={18} color={colors.bg} strokeWidth={2.4} />
              </Animated.View>
              <View style={{ flex: 1, gap: 4 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Compass size={14} color={colors.gold} />
                  <Text style={styles.kickerText}>Conception Narae</Text>
                </View>
                <Text style={styles.panelTitle}>L’itinéraire prend forme</Text>
              </View>
            </View>

            <View style={styles.progressBlock}>
              {PIPELINE_LABELS.map((label, i) => {
                const displayLabel = progress?.label && i === currentStep ? progress.label : label;
                const isDone = i < currentStep;
                const isCurrent = i === currentStep;

                if (!isCurrent && !isDone) return null;

                return (
                  <Animated.View key={i} entering={FadeInDown} style={styles.progressRow}>
                    <View
                      style={[
                        styles.progressBullet,
                        isDone ? styles.progressBulletDone : styles.progressBulletCurrent,
                      ]}
                    >
                      {isDone ? (
                        <Check size={16} color="#4ade80" />
                      ) : (
                        <ActivityIndicator size="small" color={colors.gold} />
                      )}
                    </View>
                    <View style={{ flex: 1, gap: 3 }}>
                      <Text style={[styles.progressLabel, isDone ? styles.progressLabelDone : null]}>
                        {displayLabel}
                      </Text>
                      {progress?.detail && isCurrent ? (
                        <Text style={styles.progressDetail}>{progress.detail}</Text>
                      ) : null}
                    </View>
                  </Animated.View>
                );
              })}
            </View>

            {question && onAnswer ? (
              <View style={styles.sectionBlock}>
                <QuestionCard question={question} onAnswer={onAnswer} />
              </View>
            ) : (
              <View style={styles.sectionBlock}>
                <View style={styles.factHeader}>
                  <Info size={14} color={colors.gold} />
                  <Text style={styles.factLabel}>Le saviez-vous ?</Text>
                </View>
                <Animated.View key={factIndex} entering={FadeIn} style={{ minHeight: 54 }}>
                  <Text style={styles.factCopy}>{FUN_FACTS[factIndex]}</Text>
                </Animated.View>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  layout: {
    flex: 1,
    paddingHorizontal: 16,
    gap: 14,
  },
  mapWrap: {
    overflow: 'hidden',
  },
  bottomPanel: {
    flex: 1,
    borderRadius: radius['3xl'],
    borderCurve: 'continuous',
    backgroundColor: 'rgba(6,16,31,0.84)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.35,
    shadowRadius: 32,
  },
  bottomScroll: {
    padding: 22,
    gap: 20,
  },
  bottomScrollCompact: {
    paddingHorizontal: 18,
    paddingVertical: 18,
  },
  kickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  planeBadge: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderCurve: 'continuous',
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.gold,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.26,
    shadowRadius: 16,
  },
  kickerText: {
    color: colors.gold,
    fontSize: 11,
    fontFamily: fonts.sansBold,
    textTransform: 'uppercase',
    letterSpacing: 1.6,
  },
  panelTitle: {
    color: colors.text,
    fontSize: 28,
    fontFamily: fonts.display,
  },
  progressBlock: {
    gap: 12,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  progressBullet: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressBulletCurrent: {
    backgroundColor: colors.goldBg,
  },
  progressBulletDone: {
    backgroundColor: 'rgba(34,197,94,0.2)',
  },
  progressLabel: {
    color: colors.text,
    fontSize: 14,
    fontFamily: fonts.sansSemiBold,
  },
  progressLabelDone: {
    color: '#86efac',
  },
  progressDetail: {
    color: colors.textSecondary,
    fontSize: 12,
    fontFamily: fonts.sans,
  },
  sectionBlock: {
    paddingTop: 18,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  factHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  factLabel: {
    color: colors.gold,
    fontSize: 11,
    fontFamily: fonts.sansBold,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  factCopy: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 14,
    fontFamily: fonts.sansMedium,
    lineHeight: 22,
  },
  errorScreen: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  errorIconWrap: {
    width: 80,
    height: 80,
    borderRadius: radius['2xl'],
    borderCurve: 'continuous',
    backgroundColor: 'rgba(239,68,68,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  errorTitle: {
    color: colors.text,
    fontSize: 24,
    fontFamily: fonts.display,
    textAlign: 'center',
    marginBottom: 12,
  },
  errorCopy: {
    color: colors.textSecondary,
    fontSize: 14,
    fontFamily: fonts.sans,
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 22,
  },
  errorCta: {
    paddingVertical: 18,
    borderRadius: radius.xl,
    borderCurve: 'continuous',
    backgroundColor: colors.gold,
    alignItems: 'center',
  },
});
