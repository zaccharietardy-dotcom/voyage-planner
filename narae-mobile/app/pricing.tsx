import { View, Text, Pressable, ScrollView, Alert, ActivityIndicator, Linking } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useState, useEffect } from 'react';
import { ArrowLeft, Crown, Plane, Zap, FileDown, Users, Check, Star, RotateCcw, Settings } from 'lucide-react-native';
import { colors, fonts, radius } from '@/lib/theme';
import { Button } from '@/components/ui/Button';
import { getPackages, purchasePackage, restorePurchases, checkProStatus } from '@/lib/purchases';
import { useAuth } from '@/hooks/useAuth';
import { useTranslation, type TranslationKey } from '@/lib/i18n';
import type { PurchasesPackage } from 'react-native-purchases';

const FEATURE_KEYS = [
  { icon: Plane, labelKey: 'pricing.features.unlimited', descKey: 'pricing.features.unlimited.desc' },
  { icon: Zap, labelKey: 'pricing.features.regen', descKey: 'pricing.features.regen.desc' },
  { icon: Users, labelKey: 'pricing.features.collab', descKey: 'pricing.features.collab.desc' },
  { icon: FileDown, labelKey: 'pricing.features.export', descKey: 'pricing.features.export.desc' },
  { icon: Star, labelKey: 'pricing.features.support', descKey: 'pricing.features.support.desc' },
] as const;

type PlanType = 'annual' | 'monthly' | 'single';

interface PlanOption {
  type: PlanType;
  labelKey: TranslationKey;
  priceFallback: string;
  periodKey?: TranslationKey;
  badgeKey?: TranslationKey;
  descKey?: TranslationKey;
}

const PLAN_KEYS: PlanOption[] = [
  { type: 'annual', labelKey: 'pricing.plan.annual', priceFallback: '29.99€', periodKey: 'pricing.plan.annual.period', badgeKey: 'pricing.plan.annual.badge', descKey: 'pricing.plan.annual.desc' },
  { type: 'monthly', labelKey: 'pricing.plan.monthly', priceFallback: '4.99€', periodKey: 'pricing.plan.monthly.period' },
  { type: 'single', labelKey: 'pricing.plan.single', priceFallback: '1.99€', descKey: 'pricing.plan.single.desc' },
];

export default function PricingScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const { t } = useTranslation();
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
      Alert.alert(t('common.error'), t('pricing.error.unavailable'));
      return;
    }
    setPurchasing(true);
    try {
      const info = await purchasePackage(pkg);
      if (info) {
        const msg = selectedPlan === 'single'
          ? t('pricing.success.single')
          : t('pricing.success.subscription');
        Alert.alert(t('pricing.success.title'), msg, [
          { text: t('common.ok'), onPress: () => router.back() },
        ]);
      }
    } catch {
      Alert.alert(t('common.error'), t('pricing.error.purchase'));
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
        Alert.alert(t('pricing.success.title'), t('pricing.success.restore'), [
          { text: t('common.ok'), onPress: () => router.back() },
        ]);
      } else {
        Alert.alert(t('pricing.error.noSubscription'), t('pricing.error.noRestores'));
      }
    } catch {
      Alert.alert(t('common.error'), t('pricing.error.restore'));
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
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700' }}>{t('pricing.title')}</Text>
        </View>

        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 24 }}>
          <View style={{
            width: 80, height: 80, borderRadius: 24,
            backgroundColor: colors.goldBg, alignItems: 'center', justifyContent: 'center',
          }}>
            <Crown size={40} color={colors.gold} />
          </View>
          <Text style={{ color: colors.text, fontSize: 28, fontFamily: fonts.display, textAlign: 'center' }}>
            {t('pricing.pro.title').replace('{highlight}', '')}
            <Text style={{ color: colors.gold }}>{t('pricing.pro.highlight')}</Text>
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: 15, textAlign: 'center', lineHeight: 22 }}>
            {t('pricing.pro.desc')}
          </Text>

          <View style={{ width: '100%', gap: 12, marginTop: 16 }}>
            <Button icon={Settings} onPress={handleManageSubscription}>
              {t('pricing.pro.manage')}
            </Button>
            <Text style={{ color: colors.textDim, fontSize: 12, textAlign: 'center' }}>
              {t('pricing.pro.subtitle')}
            </Text>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  // ── Purchase flow ──
  const selectedPlanObj = PLAN_KEYS.find(p => p.type === selectedPlan)!;
  const buttonLabel = purchasing
    ? t('pricing.button.processing')
    : selectedPlan === 'single'
      ? t('pricing.button.buy').replace('{price}', getPrice(PLAN_KEYS[2]))
      : t('pricing.button.subscribe').replace('{price}', getPrice(selectedPlanObj)).replace('{period}', selectedPlanObj.periodKey ? t(selectedPlanObj.periodKey) : '');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 }}>
        <Pressable onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)')} hitSlop={12}>
          <ArrowLeft size={24} color={colors.text} />
        </Pressable>
        <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700' }}>{t('pricing.title')}</Text>
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
            {t('pricing.hero.title').replace('{highlight}', '')}<Text style={{ color: colors.gold }}>{t('pricing.pro.highlight')}</Text>
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: 14, textAlign: 'center', marginTop: 6 }}>
            {t('pricing.hero.subtitle')}
          </Text>
        </View>

        {/* Plan selector */}
        <View style={{ gap: 10 }}>
          {PLAN_KEYS.map((plan) => {
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
                    <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700' }}>{t(plan.labelKey)}</Text>
                    {plan.badgeKey ? (
                      <View style={{ backgroundColor: colors.goldBg, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 8 }}>
                        <Text style={{ color: colors.gold, fontSize: 11, fontWeight: '800' }}>{t(plan.badgeKey)}</Text>
                      </View>
                    ) : null}
                  </View>
                  {plan.descKey ? (
                    <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }}>{t(plan.descKey)}</Text>
                  ) : null}
                </View>

                <Text style={{ color: isSelected ? colors.gold : colors.textSecondary, fontSize: 17, fontWeight: '800' }}>
                  {getPrice(plan)}<Text style={{ fontSize: 12, fontWeight: '500' }}>{plan.periodKey ? t(plan.periodKey) : ''}</Text>
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* Features */}
        <View style={{ gap: 10 }}>
          {FEATURE_KEYS.map((f) => (
            <View key={f.labelKey} style={{
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
                <Text style={{ color: colors.text, fontSize: 14, fontWeight: '600' }}>{t(f.labelKey)}</Text>
                <Text style={{ color: colors.textMuted, fontSize: 12 }}>{t(f.descKey)}</Text>
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
              {restoring ? t('pricing.restore.loading') : t('pricing.restore')}
            </Text>
          </View>
        </Pressable>

        <Text style={{ color: colors.textDim, fontSize: 11, textAlign: 'center', lineHeight: 16 }}>
          {t('pricing.disclaimer')}
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}
