import { useEffect, useMemo, useState } from 'react';
import { View, Text, ActivityIndicator, Pressable, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import Animated, { FadeIn, FadeInDown, withRepeat, withTiming, useAnimatedStyle, useSharedValue, Easing } from 'react-native-reanimated';
import { Plane, Check, Compass, Info } from 'lucide-react-native';
import { colors, fonts, radius } from '@/lib/theme';
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

type FunFact = { emoji: string; category: string; text: string };

const DESTINATION_FACTS: Record<string, FunFact[]> = {
  paris: [
    { emoji: '🏛️', category: 'HISTOIRE', text: 'La Tour Eiffel devait être démontée après 20 ans. Elle a été sauvée parce qu\'elle servait d\'antenne radio.' },
    { emoji: '🍽️', category: 'GASTRONOMIE', text: 'Paris compte plus de 70 restaurants étoilés Michelin, un record mondial.' },
    { emoji: '🎨', category: 'CULTURE', text: 'Le Louvre possède 380 000 œuvres d\'art. Il faudrait 100 jours pour tout voir.' },
    { emoji: '🚇', category: 'TRANSPORT', text: 'Le métro parisien a 302 stations. Aucune n\'est à plus de 500m l\'une de l\'autre.' },
    { emoji: '☕', category: 'CAFÉ', text: 'Le plus vieux café de Paris, Le Procope, existe depuis 1686.' },
    { emoji: '🌳', category: 'NATURE', text: 'Paris possède plus de 400 parcs et jardins, soit 2 300 hectares de verdure.' },
  ],
  tokyo: [
    { emoji: '🗼', category: 'ARCHITECTURE', text: 'La Tokyo Skytree mesure 634m, c\'est la plus haute tour de radiodiffusion du monde.' },
    { emoji: '🍣', category: 'GASTRONOMIE', text: 'Tokyo possède plus de restaurants étoilés Michelin que n\'importe quelle autre ville.' },
    { emoji: '🚄', category: 'TRANSPORT', text: 'Le Shinkansen est si ponctuel que le retard moyen annuel est de 36 secondes.' },
    { emoji: '🌸', category: 'NATURE', text: 'La saison des cerisiers en fleur dure seulement 2 semaines par an.' },
    { emoji: '🎮', category: 'CULTURE', text: 'Akihabara compte plus de 250 magasins dédiés aux mangas et jeux vidéo.' },
    { emoji: '⛩️', category: 'TRADITION', text: 'Il y a plus de 3 000 temples et sanctuaires dans l\'agglomération de Tokyo.' },
  ],
  rome: [
    { emoji: '🏛️', category: 'HISTOIRE', text: 'Le Colisée pouvait accueillir 80 000 spectateurs, plus que la plupart des stades modernes.' },
    { emoji: '⛲', category: 'TRADITION', text: 'On jette environ 3 000€ par jour dans la Fontaine de Trevi.' },
    { emoji: '🍝', category: 'GASTRONOMIE', text: 'Les vrais carbonara romains n\'utilisent jamais de crème fraîche.' },
    { emoji: '🎨', category: 'ART', text: 'Michel-Ange a mis 4 ans pour peindre le plafond de la Chapelle Sixtine.' },
    { emoji: '😸', category: 'INSOLITE', text: 'Rome abrite une colonie de 300 chats qui vivent dans les ruines du Largo di Torre Argentina.' },
    { emoji: '🏺', category: 'ARCHÉOLOGIE', text: 'Le Panthéon a presque 2000 ans et son dôme est toujours le plus grand dôme en béton non armé.' },
  ],
};

const DEFAULT_FACTS: FunFact[] = [
  { emoji: '🏛️', category: 'HISTOIRE', text: 'Chaque destination recèle des trésors cachés que notre algorithme sélectionne pour vous.' },
  { emoji: '🍽️', category: 'GASTRONOMIE', text: 'Chaque restaurant est vérifié à moins de 800m de votre prochaine activité.' },
  { emoji: '🗺️', category: 'ITINÉRAIRE', text: 'Notre algorithme compare plus de 500 activités pour trouver les meilleures.' },
  { emoji: '⏰', category: 'HORAIRES', text: 'Votre itinéraire respecte les horaires d\'ouverture de chaque lieu.' },
  { emoji: '🚶', category: 'TRANSPORT', text: 'Nous optimisons vos trajets pour gagner du temps entre chaque activité.' },
  { emoji: '💡', category: 'ASTUCE', text: 'Les restaurants proposent des cuisines variées adaptées à vos préférences.' },
];

function getFactsForDestination(destination: string): FunFact[] {
  const lower = destination.toLowerCase();
  for (const [city, facts] of Object.entries(DESTINATION_FACTS)) {
    if (lower.includes(city)) return facts;
  }
  return DEFAULT_FACTS;
}

export function GeneratingScreen({ origin, destination, durationDays, progress, snapshot, error, question, onAnswer, onRetry }: Props) {
  const facts = useMemo(() => getFactsForDestination(destination), [destination]);
  const [factIndex, setFactIndex] = useState(0);
  const currentStep = Math.max(0, Math.min(PIPELINE_LABELS.length - 1, (progress?.step ?? 1) - 1));
  const progressPercent = PIPELINE_LABELS.length > 0 ? ((currentStep + 1) / PIPELINE_LABELS.length) : 0;
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
      setFactIndex((i) => (i + 1) % facts.length);
    }, 6000);
    return () => clearInterval(interval);
  }, [anim, facts.length]);

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
        <View style={styles.bottomPanel}>
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[styles.bottomScroll, compact ? styles.bottomScrollCompact : null]}
          >
            <View style={styles.kickerRow}>
              <Animated.View style={[planeStyle, styles.planeBadge]}>
                <Plane size={28} color={colors.bg} strokeWidth={2.4} />
              </Animated.View>
              <Text style={styles.panelTitle}>Conception Narae</Text>
              <Text style={styles.kickerText}>
                {destination.toUpperCase()} · {durationDays ?? 3} JOURS
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
                {progress?.label || PIPELINE_LABELS[currentStep]}
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
                      <Text style={{ fontSize: 20 }}>{facts[factIndex].emoji}</Text>
                    </View>
                    <Text style={styles.factLabel}>{facts[factIndex].category}</Text>
                  </View>
                  <Text style={styles.factCopy}>{facts[factIndex].text}</Text>
                </Animated.View>
                {/* Dots */}
                <View style={styles.factDots}>
                  {facts.map((_, i) => (
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
});
