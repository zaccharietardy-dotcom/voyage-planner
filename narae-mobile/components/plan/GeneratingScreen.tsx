import { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { Plane, Check, Loader } from 'lucide-react-native';
import { colors, fonts } from '@/lib/theme';
import type { GenerateProgress } from '@/lib/api/trips';

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
  'Saviez-vous ? Notre algorithme compare plus de 500 activités.',
  'Chaque restaurant est vérifié à moins de 800m de votre parcours.',
  'Votre itinéraire respecte les horaires d\'ouverture de chaque lieu.',
  'Nous optimisons votre parcours pour minimiser les trajets inutiles.',
  'Les alternatives restaurant proposent toujours des cuisines différentes.',
];

export function GeneratingScreen({ destination, progress, error, onRetry }: Props) {
  const [factIndex, setFactIndex] = useState(0);
  const currentStep = progress?.step ?? 0;
  const totalSteps = progress?.total ?? PIPELINE_LABELS.length;

  useEffect(() => {
    const interval = setInterval(() => {
      setFactIndex((i) => (i + 1) % FUN_FACTS.length);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  if (error) {
    return (
      <View style={{ flex: 1, backgroundColor: '#020617', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
        <View style={{
          width: 72, height: 72, borderRadius: 20,
          backgroundColor: 'rgba(239,68,68,0.1)',
          alignItems: 'center', justifyContent: 'center', marginBottom: 20,
        }}>
          <Text style={{ fontSize: 32 }}>😞</Text>
        </View>
        <Text style={{ color: '#f8fafc', fontSize: 18, fontWeight: '700', textAlign: 'center', marginBottom: 8 }}>
          Erreur de génération
        </Text>
        <Text style={{ color: '#94a3b8', fontSize: 14, textAlign: 'center', marginBottom: 24 }}>
          {error}
        </Text>
        <Animated.View entering={FadeIn}>
          <View style={{
            paddingHorizontal: 24, paddingVertical: 14, borderRadius: 14,
            backgroundColor: '#c5a059',
          }}>
            <Text onPress={onRetry} style={{ color: '#020617', fontSize: 15, fontWeight: '700' }}>
              Réessayer
            </Text>
          </View>
        </Animated.View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#020617', alignItems: 'center', justifyContent: 'center', padding: 40 }}>
      {/* Animated plane */}
      <Animated.View entering={FadeInDown.springify()} style={{ marginBottom: 32 }}>
        <View style={{
          width: 80, height: 80, borderRadius: 24,
          backgroundColor: 'rgba(197,160,89,0.1)',
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Plane size={36} color="#c5a059" />
        </View>
      </Animated.View>

      {/* Title */}
      <Text style={{ color: colors.text, fontSize: 22, fontFamily: fonts.display, textAlign: 'center', marginBottom: 6 }}>
        Création en cours...
      </Text>
      <Text style={{ color: colors.gold, fontSize: 17, fontFamily: fonts.displayMedium, textAlign: 'center', marginBottom: 28 }}>
        {destination}
      </Text>

      {/* Progress steps */}
      <View style={{ width: '100%', gap: 10, marginBottom: 32 }}>
        {PIPELINE_LABELS.slice(0, Math.max(totalSteps, PIPELINE_LABELS.length)).map((label, i) => {
          const displayLabel = progress?.label && i === currentStep ? progress.label : label;
          const isDone = i < currentStep;
          const isCurrent = i === currentStep;

          return (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={{
                width: 24, height: 24, borderRadius: 12,
                backgroundColor: isDone ? 'rgba(34,197,94,0.15)' : isCurrent ? 'rgba(197,160,89,0.15)' : 'rgba(255,255,255,0.05)',
                alignItems: 'center', justifyContent: 'center',
              }}>
                {isDone ? (
                  <Check size={14} color="#4ade80" />
                ) : isCurrent ? (
                  <Loader size={14} color="#c5a059" />
                ) : (
                  <Text style={{ color: '#475569', fontSize: 10 }}>{i + 1}</Text>
                )}
              </View>
              <Text style={{
                color: isDone ? '#4ade80' : isCurrent ? '#c5a059' : '#475569',
                fontSize: 13, fontWeight: isCurrent ? '600' : '400',
              }}>
                {displayLabel}
              </Text>
            </View>
          );
        })}
      </View>

      {/* Fun fact */}
      <Animated.View key={factIndex} entering={FadeIn}>
        <Text style={{ color: '#64748b', fontSize: 12, textAlign: 'center', fontStyle: 'italic' }}>
          {FUN_FACTS[factIndex]}
        </Text>
      </Animated.View>
    </View>
  );
}
