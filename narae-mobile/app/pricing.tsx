import { View, Text, Pressable, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useState, useEffect } from 'react';
import { ArrowLeft, Crown, Plane, Zap, FileDown, Award, Check, Star, RotateCcw } from 'lucide-react-native';
import { colors, fonts, radius } from '@/lib/theme';
import { Button } from '@/components/ui/Button';
import { getPackages, purchasePackage, restorePurchases } from '@/lib/purchases';
import type { PurchasesPackage } from 'react-native-purchases';

const FEATURES = [
  { icon: Plane, label: 'Voyages illimités', desc: 'Créez autant de voyages que vous voulez' },
  { icon: Zap, label: 'Régénération expert', desc: 'Régénérez votre itinéraire à volonté' },
  { icon: FileDown, label: 'Export PDF deluxe', desc: 'Exportez un carnet de voyage premium' },
  { icon: Award, label: 'Badge exclusif', desc: 'Affichez votre statut Narae Pro' },
  { icon: Star, label: 'Support prioritaire', desc: 'Réponse sous 24h garantie' },
];

export default function PricingScreen() {
  const router = useRouter();
  const [packages, setPackages] = useState<PurchasesPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    getPackages().then((pkgs) => {
      setPackages(pkgs);
      setLoading(false);
    });
  }, []);

  const annualPkg = packages.find(p => p.packageType === 'ANNUAL');
  const monthlyPkg = packages.find(p => p.packageType === 'MONTHLY');
  const selectedPkg = annualPkg || monthlyPkg || packages[0];

  const handlePurchase = async () => {
    if (!selectedPkg) {
      Alert.alert('Erreur', 'Aucune offre disponible. Réessayez plus tard.');
      return;
    }
    setPurchasing(true);
    try {
      const info = await purchasePackage(selectedPkg);
      if (info) {
        Alert.alert('Bienvenue Pro !', 'Votre abonnement est activé.', [
          { text: 'OK', onPress: () => router.back() },
        ]);
      }
    } catch {
      Alert.alert('Erreur', 'L\'achat a échoué. Veuillez réessayer.');
    } finally {
      setPurchasing(false);
    }
  };

  const handleRestore = async () => {
    setRestoring(true);
    try {
      const info = await restorePurchases();
      const isPro = info?.entitlements.active['pro'] !== undefined;
      if (isPro) {
        Alert.alert('Restauré', 'Votre abonnement Pro a été restauré.', [
          { text: 'OK', onPress: () => router.back() },
        ]);
      } else {
        Alert.alert('Aucun abonnement', 'Aucun achat précédent trouvé.');
      }
    } catch {
      Alert.alert('Erreur', 'La restauration a échoué.');
    } finally {
      setRestoring(false);
    }
  };

  const priceLabel = selectedPkg?.product?.priceString
    ? `S'abonner — ${selectedPkg.product.priceString}/${annualPkg ? 'an' : 'mois'}`
    : 'S\'abonner — 29.99€/an';

  const subtitleLabel = selectedPkg?.product?.price
    ? annualPkg
      ? `soit ${(selectedPkg.product.price / 12).toFixed(2)}€/mois`
      : ''
    : 'soit 2.49€/mois — 58% d\'économie';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 }}>
        <Pressable onPress={() => router.canGoBack() ? router.back() : router.replace("/(tabs)")} hitSlop={12}>
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
          {loading ? (
            <ActivityIndicator color={colors.gold} />
          ) : (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
                <Text style={{ color: colors.gold, fontSize: 44, fontFamily: fonts.display }}>
                  {selectedPkg?.product?.priceString || '29.99€'}
                </Text>
                <Text style={{ color: colors.gold, fontSize: 16 }}>/{annualPkg ? 'an' : 'mois'}</Text>
              </View>
              {subtitleLabel ? (
                <Text style={{ color: colors.textMuted, fontSize: 13 }}>{subtitleLabel}</Text>
              ) : null}
            </>
          )}
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

        <Button onPress={handlePurchase} disabled={purchasing || loading}>
          {purchasing ? 'Traitement...' : priceLabel}
        </Button>

        <Pressable onPress={handleRestore} disabled={restoring} style={{ alignItems: 'center', paddingVertical: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <RotateCcw size={14} color={colors.textMuted} />
            <Text style={{ color: colors.textMuted, fontSize: 13 }}>
              {restoring ? 'Restauration...' : 'Restaurer un achat'}
            </Text>
          </View>
        </Pressable>

        <Text style={{ color: colors.textDim, fontSize: 11, textAlign: 'center' }}>
          Annulation possible à tout moment. Pas d&apos;engagement.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
