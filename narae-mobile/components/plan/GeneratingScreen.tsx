import { useEffect, useMemo, useState } from 'react';
import { View, Text, ActivityIndicator, Pressable, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import Animated, { FadeIn, FadeInDown, withRepeat, withTiming, useAnimatedStyle, useSharedValue, Easing } from 'react-native-reanimated';
import { Plane, Check, Compass, Info, ArrowLeft } from 'lucide-react-native';
import { colors, fonts, radius } from '@/lib/theme';
import { useTranslation } from '@/lib/i18n';
import type { GenerateProgress } from '@/lib/api/trips';
import type { PipelineMapSnapshot, PipelineQuestion } from '@/lib/types/pipeline';
import { PremiumBackground } from '@/components/ui/PremiumBackground';
import { QuestionCard } from '@/components/plan/QuestionCard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

interface Props {
  origin?: string;
  destination: string;
  durationDays?: number;
  progress: GenerateProgress | null;
  snapshot?: PipelineMapSnapshot | null;
  error: string | null;
  question?: PipelineQuestion | null;
  onAnswer?: (questionId: string, selectedOptionId: string) => void;
  onRetry: () => void;
  onBack?: () => void;
}

const PIPELINE_LABEL_KEYS = [
  'generation.step1',
  'generation.step2',
  'generation.step3',
  'generation.step4',
  'generation.step5',
  'generation.step6',
  'generation.step7',
] as const;

type FunFactDef = { emoji: string; category: string; textKey: string };

const DESTINATION_FACT_DEFS: Record<string, FunFactDef[]> = {
  paris: [
    { emoji: '🏛️', category: 'HISTOIRE', textKey: 'facts.paris.1' },
    { emoji: '🍽️', category: 'GASTRONOMIE', textKey: 'facts.paris.2' },
    { emoji: '🎨', category: 'CULTURE', textKey: 'facts.paris.3' },
    { emoji: '🚇', category: 'TRANSPORT', textKey: 'facts.paris.4' },
    { emoji: '☕', category: 'CAFÉ', textKey: 'facts.paris.5' },
    { emoji: '🌳', category: 'NATURE', textKey: 'facts.paris.6' },
  ],
  tokyo: [
    { emoji: '🗼', category: 'ARCHITECTURE', textKey: 'facts.tokyo.1' },
    { emoji: '🍣', category: 'GASTRONOMIE', textKey: 'facts.tokyo.2' },
    { emoji: '🚄', category: 'TRANSPORT', textKey: 'facts.tokyo.3' },
    { emoji: '🌸', category: 'NATURE', textKey: 'facts.tokyo.4' },
    { emoji: '🎮', category: 'CULTURE', textKey: 'facts.tokyo.5' },
    { emoji: '⛩️', category: 'TRADITION', textKey: 'facts.tokyo.6' },
  ],
  rome: [
    { emoji: '🏛️', category: 'HISTOIRE', textKey: 'facts.rome.1' },
    { emoji: '⛲', category: 'TRADITION', textKey: 'facts.rome.2' },
    { emoji: '🍝', category: 'GASTRONOMIE', textKey: 'facts.rome.3' },
    { emoji: '🎨', category: 'ART', textKey: 'facts.rome.4' },
    { emoji: '😸', category: 'INSOLITE', textKey: 'facts.rome.5' },
    { emoji: '🏺', category: 'ARCHÉOLOGIE', textKey: 'facts.rome.6' },
  ],
};

const DEFAULT_FACT_DEFS: FunFactDef[] = [
  { emoji: '🏛️', category: 'HISTOIRE', textKey: 'facts.default.1' },
  { emoji: '🍽️', category: 'GASTRONOMIE', textKey: 'facts.default.2' },
  { emoji: '🗺️', category: 'ITINÉRAIRE', textKey: 'facts.default.3' },
  { emoji: '⏰', category: 'HORAIRES', textKey: 'facts.default.4' },
  { emoji: '🚶', category: 'TRANSPORT', textKey: 'facts.default.5' },
  { emoji: '💡', category: 'ASTUCE', textKey: 'facts.default.6' },
];

function getFactDefsForDestination(destination: string): FunFactDef[] {
  const lower = destination.toLowerCase();
  for (const [city, defs] of Object.entries(DESTINATION_FACT_DEFS)) {
    if (lower.includes(city)) return defs;
  }
  return DEFAULT_FACT_DEFS;
}

export function GeneratingScreen({ origin, destination, durationDays, progress, snapshot, error, question, onAnswer, onRetry, onBack }: Props) {
  const { t } = useTranslation();
  const factDefs = useMemo(() => getFactDefsForDestination(destination), [destination]);
  const [factIndex, setFactIndex] = useState(0);
  const currentStep = Math.max(0, Math.min(PIPELINE_LABEL_KEYS.length - 1, (progress?.step ?? 1) - 1));
  const progressPercent = PIPELINE_LABEL_KEYS.length > 0 ? ((currentStep + 1) / PIPELINE_LABEL_KEYS.length) : 0;
  const anim = useSharedValue(0);
  const progressWidth = useSharedValue(0);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const compact = height < 760;

  useEffect(() => {
    progressWidth.value = withTiming(progressPercent, { duration: 800, easing: Easing.out(Easing.quad) });
  }, [progressPercent, progressWidth]);

  useEffect(() => {
    anim.value = withRepeat(
      withTiming(1, { duration: 4000, easing: Easing.inOut(Easing.quad) }),
      -1,
      true
    );
    const interval = setInterval(() => {
      setFactIndex((i) => (i + 1) % factDefs.length);
    }, 6000);
    return () => clearInterval(interval);
  }, [anim, factDefs.length]);

  const planeStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: anim.value * -15 },
      { rotate: `${anim.value * 10 - 5}deg` }
    ]
  }));

  const progressBarStyle = useAnimatedStyle(() => ({
    width: `${progressWidth.value * 100}%`,
  }));

  if (error) {
    return (
      <View style={styles.errorScreen}>
        <PremiumBackground />
        {onBack && (
          <Pressable onPress={onBack} style={styles.errorBackBtn}>
            <ArrowLeft size={20} color={colors.text} />
          </Pressable>
        )}
        <View style={styles.errorIconWrap}>
          <Text style={{ fontSize: 40 }}>😞</Text>
        </View>
        <Text style={styles.errorTitle}>
          {t('generation.error.title')}
        </Text>
        <Text style={styles.errorCopy}>
          {error}
        </Text>
        <View style={{ width: '100%', gap: 12 }}>
          <Pressable onPress={onRetry}>
            <View style={styles.errorCta}>
              <Text style={{ color: colors.bg, fontSize: 16, fontFamily: fonts.sansBold }}>
                {t('generation.error.retry')}
              </Text>
            </View>
          </Pressable>
          {onBack && (
            <Pressable onPress={onBack}>
              <View style={styles.errorBackCta}>
                <Text style={{ color: colors.textSecondary, fontSize: 14, fontFamily: fonts.sansSemiBold }}>
                  {t('common.back')}
                </Text>
              </View>
            </Pressable>
          )}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <PremiumBackground />
      <View style={[styles.layout, { paddingTop: insets.top + 14, paddingBottom: insets.bottom + 12 }]}>
        <View style={styles.bottomPanel}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[styles.bottomScroll, compact ? styles.bottomScrollCompact : null]}
          >
            <View style={styles.kickerRow}>
              <Animated.View style={[planeStyle, styles.planeBadge]}>
                <Plane size={28} color={colors.bg} strokeWidth={2.4} />
              </Animated.View>
              <Text style={styles.panelTitle}>{t('generation.title')}</Text>
              <Text style={styles.kickerText}>
                {destination.toUpperCase()} · {durationDays ?? 3} {t('plan.when.duration.plural')}
              </Text>
            </View>

            {/* Gold progress bar */}
            <View style={styles.progressBarTrack}>
              <Animated.View style={[styles.progressBarFill, progressBarStyle]} />
            </View>

            {/* Current step label */}
            <View style={styles.stepLabelRow}>
              <ActivityIndicator size="small" color={colors.gold} />
              <Text style={styles.stepLabelText}>
                {progress?.label || t(PIPELINE_LABEL_KEYS[currentStep] as any)}
              </Text>
            </View>

            {question && onAnswer ? (
              <View style={styles.sectionBlock}>
                <QuestionCard question={question} onAnswer={onAnswer} />
              </View>
            ) : (
              <View style={styles.factCard}>
                <Animated.View key={factIndex} entering={FadeIn} style={{ gap: 12 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                    <View style={styles.factEmojiWrap}>
                      <Text style={{ fontSize: 20 }}>{factDefs[factIndex].emoji}</Text>
                    </View>
                    <Text style={styles.factLabel}>{factDefs[factIndex].category}</Text>
                  </View>
                  <Text style={styles.factCopy}>{t(factDefs[factIndex].textKey as any)}</Text>
                </Animated.View>
                {/* Dots */}
                <View style={styles.factDots}>
                  {factDefs.map((_, i) => (
                    <View
                      key={i}
                      style={[
                        styles.factDot,
                        i === factIndex && styles.factDotActive,
                      ]}
                    />
                  ))}
                </View>
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
    justifyContent: 'center',
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
    alignItems: 'center',
    gap: 12,
  },
  planeBadge: {
    width: 72,
    height: 72,
    borderRadius: 22,
    borderCurve: 'continuous',
    backgroundColor: colors.gold,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.gold,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.3,
    shadowRadius: 24,
  },
  kickerText: {
    color: colors.gold,
    fontSize: 11,
    fontFamily: fonts.sansBold,
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  panelTitle: {
    color: colors.text,
    fontSize: 32,
    fontFamily: fonts.display,
    letterSpacing: -0.5,
  },
  // Gold progress bar
  progressBarTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: colors.gold,
  },
  // Step label row
  stepLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stepLabelText: {
    color: colors.textSecondary,
    fontSize: 14,
    fontFamily: fonts.sansMedium,
  },
  sectionBlock: {
    paddingTop: 18,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
  },
  // Fun fact card — matches web rounded-[2.5rem] border-white/5 bg-black/40
  factCard: {
    borderRadius: 40,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    backgroundColor: 'rgba(0,0,0,0.4)',
    padding: 24,
    gap: 16,
  },
  factEmojiWrap: {
    width: 40,
    height: 40,
    borderRadius: 14,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(197,160,89,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  factLabel: {
    color: colors.gold,
    fontSize: 11,
    fontFamily: fonts.sansBold,
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  factCopy: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 15,
    fontFamily: fonts.sansMedium,
    lineHeight: 24,
  },
  factDots: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
    paddingTop: 4,
  },
  factDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  factDotActive: {
    width: 20,
    backgroundColor: colors.gold,
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
  errorBackCta: {
    paddingVertical: 14,
    borderRadius: radius.xl,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
  },
  errorBackBtn: {
    position: 'absolute',
    top: 60,
    left: 20,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
