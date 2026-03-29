import { View, Text, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, Crown, Plane, Zap, FileDown, Award, Check, Star } from 'lucide-react-native';
import { colors, fonts, radius } from '@/lib/theme';
import { Button } from '@/components/ui/Button';

const FEATURES = [
  { icon: Plane, label: 'Voyages illimités', desc: 'Créez autant de voyages que vous voulez' },
  { icon: Zap, label: 'Régénération expert', desc: 'Régénérez votre itinéraire à volonté' },
  { icon: FileDown, label: 'Export PDF deluxe', desc: 'Exportez un carnet de voyage premium' },
  { icon: Award, label: 'Badge exclusif', desc: 'Affichez votre statut Narae Pro' },
  { icon: Star, label: 'Support prioritaire', desc: 'Réponse sous 24h garantie' },
];

export default function PricingScreen() {
  const router = useRouter();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 }}>
        <Pressable onPress={() => router.back()} hitSlop={12}>
          <ArrowLeft size={24} color={colors.text} />
        </Pressable>
        <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700' }}>Abonnement</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60, gap: 24 }}>
        {/* Hero */}
        <View style={{ alignItems: 'center', paddingVertical: 24 }}>
          <View style={{
            width: 72, height: 72, borderRadius: 22,
            backgroundColor: colors.goldBg, alignItems: 'center', justifyContent: 'center',
            marginBottom: 16,
          }}>
            <Crown size={36} color={colors.gold} />
          </View>
          <Text style={{ color: colors.text, fontSize: 28, fontFamily: fonts.display, textAlign: 'center' }}>
            Narae <Text style={{ color: colors.gold }}>Pro</Text>
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: 14, textAlign: 'center', marginTop: 8 }}>
            Débloquez tout le potentiel de votre voyage
          </Text>
        </View>

        {/* Pricing card */}
        <View style={{
          backgroundColor: colors.card, borderRadius: radius['3xl'],
          borderWidth: 1, borderColor: colors.goldBorder, padding: 24,
          alignItems: 'center', gap: 8,
        }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
            <Text style={{ color: colors.gold, fontSize: 44, fontFamily: fonts.display }}>9.99</Text>
            <Text style={{ color: colors.gold, fontSize: 16 }}>€/an</Text>
          </View>
          <Text style={{ color: colors.textMuted, fontSize: 13 }}>soit 0.83€/mois</Text>
        </View>

        {/* Features */}
        <View style={{ gap: 12 }}>
          {FEATURES.map((f) => (
            <View key={f.label} style={{
              flexDirection: 'row', alignItems: 'center', gap: 14,
              backgroundColor: colors.surface, borderRadius: radius.xl, padding: 16,
              borderWidth: 1, borderColor: colors.borderSubtle,
            }}>
              <View style={{
                width: 40, height: 40, borderRadius: 12,
                backgroundColor: colors.goldBg, alignItems: 'center', justifyContent: 'center',
              }}>
                <f.icon size={20} color={colors.gold} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontSize: 14, fontWeight: '700' }}>{f.label}</Text>
                <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>{f.desc}</Text>
              </View>
              <Check size={16} color={colors.gold} />
            </View>
          ))}
        </View>

        <Button onPress={() => {}}>S'abonner — 9.99€/an</Button>
        <Text style={{ color: colors.textDim, fontSize: 11, textAlign: 'center' }}>
          Annulation possible à tout moment. Pas d'engagement.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
