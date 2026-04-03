import { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, Pressable } from 'react-native';
import Animated, { FadeIn, FadeInDown, withRepeat, withTiming, useAnimatedStyle, useSharedValue, Easing } from 'react-native-reanimated';
import { Plane, Check, Compass, Info } from 'lucide-react-native';
import { colors, fonts, radius } from '@/lib/theme';
import type { GenerateProgress } from '@/lib/api/trips';
import { PremiumBackground } from '@/components/ui/PremiumBackground';

interface Props {
  destination: string;
  progress: GenerateProgress | null;
  error: string | null;
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

export function GeneratingScreen({ destination, progress, error, onRetry }: Props) {
  const [factIndex, setFactIndex] = useState(0);
  const currentStep = progress?.step ?? 0;
  const anim = useSharedValue(0);

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
      <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', padding: 40 }}>
        <PremiumBackground />
        <View style={{
          width: 80, height: 80, borderRadius: radius['2xl'],
          borderCurve: 'continuous',
          backgroundColor: 'rgba(239,68,68,0.1)',
          alignItems: 'center', justifyContent: 'center', marginBottom: 24,
        }}>
          <Text style={{ fontSize: 40 }}>😞</Text>
        </View>
        <Text style={{ color: colors.text, fontSize: 24, fontFamily: fonts.display, textAlign: 'center', marginBottom: 12 }}>
          Oups, un imprévu...
        </Text>
        <Text style={{ color: colors.textSecondary, fontSize: 14, fontFamily: fonts.sans, textAlign: 'center', marginBottom: 32, lineHeight: 22 }}>
          {error}
        </Text>
        <Pressable onPress={onRetry} style={{ width: '100%' }}>
          <View style={{
            paddingVertical: 18, borderRadius: radius.xl,
            borderCurve: 'continuous',
            backgroundColor: colors.gold, alignItems: 'center',
          }}>
            <Text style={{ color: colors.bg, fontSize: 16, fontFamily: fonts.sansBold }}>
              Réessayer la génération
            </Text>
          </View>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' }}>
      <PremiumBackground />

      <View style={{ width: '100%', padding: 32, alignItems: 'center' }}>
        {/* Animated plane icon */}
        <Animated.View style={[planeStyle, { marginBottom: 40 }]}>
          <View style={{
            width: 100, height: 100, borderRadius: radius['4xl'],
            borderCurve: 'continuous',
            backgroundColor: colors.gold,
            alignItems: 'center', justifyContent: 'center',
            shadowColor: colors.gold, shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.4, shadowRadius: 20,
          }}>
            <Plane size={48} color={colors.bg} strokeWidth={2.5} />
          </View>
        </Animated.View>

        {/* Title */}
        <Text style={{ color: colors.text, fontSize: 28, fontFamily: fonts.display, textAlign: 'center' }}>
          Conception Narae
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 40 }}>
          <Compass size={16} color={colors.gold} />
          <Text style={{ color: colors.gold, fontSize: 11, fontFamily: fonts.sansBold, textTransform: 'uppercase', letterSpacing: 2 }}>
            {destination}
          </Text>
        </View>

        {/* Status card */}
        <View style={{
          width: '100%', backgroundColor: 'rgba(0,0,0,0.4)', borderRadius: radius['3xl'], borderCurve: 'continuous', padding: 32,
          borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
          shadowColor: '#000', shadowOffset: { width: 0, height: 20 }, shadowOpacity: 0.5, shadowRadius: 40,
        }}>
          <View style={{ gap: 12, marginBottom: 32 }}>
            {PIPELINE_LABELS.map((label, i) => {
              const displayLabel = progress?.label && i === currentStep ? progress.label : label;
              const isDone = i < currentStep;
              const isCurrent = i === currentStep;

              if (!isCurrent && !isDone) return null; // Only show current and completed steps for clarity

              return (
                <Animated.View key={i} entering={FadeInDown} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={{
                    width: 28, height: 28, borderRadius: radius.full,
                    backgroundColor: isDone ? 'rgba(34,197,94,0.2)' : colors.goldBg,
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    {isDone ? (
                      <Check size={16} color="#4ade80" />
                    ) : (
                      <ActivityIndicator size="small" color={colors.gold} />
                    )}
                  </View>
                  <Text style={{
                    color: isDone ? '#4ade80' : colors.text,
                    fontSize: 14, fontFamily: isCurrent ? fonts.sansSemiBold : fonts.sans,
                  }}>
                    {displayLabel}
                  </Text>
                </Animated.View>
              );
            })}
          </View>

          {/* Fun fact area */}
          <View style={{ borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)', paddingTop: 24 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <Info size={14} color={colors.gold} />
              <Text style={{ color: colors.gold, fontSize: 11, fontFamily: fonts.sansBold, textTransform: 'uppercase', letterSpacing: 1.5 }}>
                Le saviez-vous ?
              </Text>
            </View>
            <Animated.View key={factIndex} entering={FadeIn} style={{ minHeight: 60 }}>
              <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14, fontFamily: fonts.sansMedium, lineHeight: 22 }}>
                {FUN_FACTS[factIndex]}
              </Text>
            </Animated.View>
          </View>
        </View>
      </View>
    </View>
  );
}
