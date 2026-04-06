import { View, Text, Pressable, ScrollView, Alert, ActivityIndicator, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useState, useEffect } from 'react';
import { ArrowLeft, Crown, Plane, Zap, FileDown, Users, Check, Star, RotateCcw, Settings } from 'lucide-react-native';
import { colors, fonts, radius } from '@/lib/theme';
import { Button } from '@/components/ui/Button';
import { getPackages, purchasePackage, restorePurchases, checkProStatus } from '@/lib/purchases';
import { useAuth } from '@/hooks/useAuth';
import type { PurchasesPackage } from 'react-native-purchases';

const FEATURES = [
  { icon: Plane, label: 'Voyages illimités', desc: 'Créez autant de voyages que vous voulez' },
  { icon: Zap, label: 'Régénération expert', desc: 'Régénérez et optimisez à volonté' },
  { icon: Users, label: 'Collaboration groupe', desc: 'Planifiez et partagez les dépenses entre amis' },
  { icon: FileDown, label: 'Export PDF premium', desc: 'Carnet de voyage complet à imprimer' },
  { icon: Star, label: 'Support prioritaire', desc: 'Réponse sous 24h garantie' },
];

type PlanType = 'annual' | 'monthly' | 'single';

interface PlanOption {
  type: PlanType;
  label: string;
  priceFallback: string;
  periodFallback: string;
  badge?: string;
  desc?: string;
}

const PLANS: PlanOption[] = [
  { type: 'annual', label: 'Annuel', priceFallback: '29.99€', periodFallback: '/an', badge: '-58%', desc: 'soit 2.49€/mois' },
  { type: 'monthly', label: 'Mensuel', priceFallback: '4.99€', periodFallback: '/mois' },
  { type: 'single', label: 'Voyage unique', priceFallback: '1.99€', periodFallback: '', desc: '1 voyage généré par IA' },
];

export default function PricingScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const [packages, setPackages] = useState<PurchasesPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<PlanType>('annual');
  const isPro = profile?.subscription_status === 'pro';

  useEffect(() => {
    getPackages().then((pkgs) => {
      setPackages(pkgs);
      setLoading(false);
    });
  }, []);

  const findPkg = (type: PlanType): PurchasesPackage | undefined => {
    if (type === 'annual') return packages.find(p => p.packageType === 'ANNUAL');
    if (type === 'monthly') return packages.find(p => p.packageType === 'MONTHLY');
    return packages.find(p => p.packageType === 'CUSTOM' || p.identifier === 'narae_trip_single');
  };

  const getPrice = (plan: PlanOption): string => {
    const pkg = findPkg(plan.type);
    return pkg?.product?.priceString || plan.priceFallback;
  };

  const handlePurchase = async () => {
    const pkg = findPkg(selectedPlan);
    if (!pkg) {
      Alert.alert('Erreur', 'Offre non disponible. Réessayez plus tard.');
      return;
    }
    setPurchasing(true);
    try {
      const info = await purchasePackage(pkg);
      if (info) {
        const msg = selectedPlan === 'single'
          ? 'Votre voyage est prêt à être généré !'
          : 'Bienvenue dans Narae Pro !';
        Alert.alert('Merci !', msg, [
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
      const hasPro = info?.entitlements.active['pro'] !== undefined;
      if (hasPro) {
        Alert.alert('Restauré !', 'Votre abonnement Pro est actif.', [
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

  const handleManageSubscription = () => {
    Linking.openURL('https://apps.apple.com/account/subscriptions');
  };

  // ── Already subscribed ──
  if (isPro) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 }}>
          <Pressable onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)')} hitSlop={12}>
            <ArrowLeft size={24} color={colors.text} />
          </Pressable>
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700' }}>Abonnement</Text>
        </View>

        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 24 }}>
          <View style={{
            width: 80, height: 80, borderRadius: 24,
            backgroundColor: colors.goldBg, alignItems: 'center', justifyContent: 'center',
          }}>
            <Crown size={40} color={colors.gold} />
          </View>
          <Text style={{ color: colors.text, fontSize: 28, fontFamily: fonts.display, textAlign: 'center' }}>
            Vous êtes <Text style={{ color: colors.gold }}>Pro</Text>
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: 15, textAlign: 'center', lineHeight: 22 }}>
            Profitez de vos voyages illimités, de la collaboration groupe et de toutes les fonctionnalités premium.
          </Text>

          <View style={{ width: '100%', gap: 12, marginTop: 16 }}>
            <Button icon={Settings} onPress={handleManageSubscription}>
              Gérer mon abonnement
            </Button>
            <Text style={{ color: colors.textDim, fontSize: 12, textAlign: 'center' }}>
              Modifiez, changez de formule ou annulez depuis les réglages Apple.
            </Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ── Purchase flow ──
  const buttonLabel = purchasing
    ? 'Traitement...'
    : selectedPlan === 'single'
      ? `Acheter — ${getPrice(PLANS[2])}`
      : `S'abonner — ${getPrice(PLANS.find(p => p.type === selectedPlan)!)}${PLANS.find(p => p.type === selectedPlan)!.periodFallback}`;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 }}>
        <Pressable onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)')} hitSlop={12}>
          <ArrowLeft size={24} color={colors.text} />
        </Pressable>
        <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700' }}>Abonnement</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60, gap: 20 }}>
        {/* Hero */}
        <View style={{ alignItems: 'center', paddingVertical: 16 }}>
          <View style={{
            width: 64, height: 64, borderRadius: 20,
            backgroundColor: colors.goldBg, alignItems: 'center', justifyContent: 'center',
            marginBottom: 12,
          }}>
            <Crown size={32} color={colors.gold} />
          </View>
          <Text style={{ color: colors.text, fontSize: 26, fontFamily: fonts.display, textAlign: 'center' }}>
            Narae <Text style={{ color: colors.gold }}>Pro</Text>
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: 14, textAlign: 'center', marginTop: 6 }}>
            Débloquez tout le potentiel de votre voyage
          </Text>
        </View>

        {/* Plan selector */}
        <View style={{ gap: 10 }}>
          {PLANS.map((plan) => {
            const isSelected = selectedPlan === plan.type;
            return (
              <Pressable
                key={plan.type}
                onPress={() => setSelectedPlan(plan.type)}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 14,
                  backgroundColor: isSelected ? colors.card : colors.surface,
                  borderRadius: 16, padding: 16,
                  borderWidth: 2,
                  borderColor: isSelected ? colors.gold : colors.borderSubtle,
                }}
              >
                <View style={{
                  width: 22, height: 22, borderRadius: 11,
                  borderWidth: 2,
                  borderColor: isSelected ? colors.gold : colors.textMuted,
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  {isSelected ? (
                    <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: colors.gold }} />
                  ) : null}
                </View>

                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700' }}>{plan.label}</Text>
                    {plan.badge ? (
                      <View style={{ backgroundColor: colors.goldBg, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 }}>
                        <Text style={{ color: colors.gold, fontSize: 11, fontWeight: '800' }}>{plan.badge}</Text>
                      </View>
                    ) : null}
                  </View>
                  {plan.desc ? (
                    <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>{plan.desc}</Text>
                  ) : null}
                </View>

                <Text style={{ color: isSelected ? colors.gold : colors.textSecondary, fontSize: 17, fontWeight: '800' }}>
                  {getPrice(plan)}<Text style={{ fontSize: 12, fontWeight: '500' }}>{plan.periodFallback}</Text>
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Features */}
        <View style={{ gap: 10 }}>
          {FEATURES.map((f) => (
            <View key={f.label} style={{
              flexDirection: 'row', alignItems: 'center', gap: 12,
              paddingVertical: 10, paddingHorizontal: 4,
            }}>
              <View style={{
                width: 36, height: 36, borderRadius: 10,
                backgroundColor: colors.goldBg, alignItems: 'center', justifyContent: 'center',
              }}>
                <f.icon size={18} color={colors.gold} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600' }}>{f.label}</Text>
                <Text style={{ color: colors.textMuted, fontSize: 12 }}>{f.desc}</Text>
              </View>
              <Check size={16} color={colors.gold} />
            </View>
          ))}
        </View>

        {/* CTA */}
        {loading ? (
          <ActivityIndicator color={colors.gold} style={{ paddingVertical: 16 }} />
        ) : (
          <Button onPress={handlePurchase} disabled={purchasing}>
            {buttonLabel}
          </Button>
        )}

        {/* Restore + legal */}
        <Pressable onPress={handleRestore} disabled={restoring} style={{ alignItems: 'center', paddingVertical: 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <RotateCcw size={13} color={colors.textMuted} />
            <Text style={{ color: colors.textMuted, fontSize: 13 }}>
              {restoring ? 'Restauration...' : 'Restaurer un achat'}
            </Text>
          </View>
        </Pressable>

        <Text style={{ color: colors.textDim, fontSize: 11, textAlign: 'center', lineHeight: 16 }}>
          Paiement via votre compte Apple. Abonnement renouvelé automatiquement sauf annulation au moins 24h avant la fin de la période. Gérez dans Réglages {'>'} Apple ID {'>'} Abonnements.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
