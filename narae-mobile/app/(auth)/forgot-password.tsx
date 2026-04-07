import { useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase/client';
import { ArrowLeft } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { colors, fonts, radius, goldGradient } from '@/lib/theme';
import { useTranslation } from '@/lib/i18n';
import { PremiumBackground } from '@/components/ui/PremiumBackground';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const { t } = useTranslation();

  const handleReset = async () => {
    if (!email) return;
    setIsLoading(true);
    await supabase.auth.resetPasswordForEmail(email);
    setSent(true);
    setIsLoading(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  if (sent) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <PremiumBackground />
        <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ flex: 1 }} contentContainerStyle={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
            <View style={{
              width: 80, height: 80, borderRadius: 24, borderCurve: 'continuous',
              backgroundColor: 'rgba(34,197,94,0.15)',
              alignItems: 'center', justifyContent: 'center', marginBottom: 24,
            }}>
              <Text style={{ fontSize: 40 }}>✉️</Text>
            </View>
            <Text style={{ color: colors.text, fontSize: 28, fontFamily: fonts.display, fontWeight: 'bold', textAlign: 'center', marginBottom: 12 }}>
              {t('auth.forgot.success.title')}
            </Text>
            <Text style={{ color: '#94a3b8', fontSize: 16, fontFamily: fonts.sans, textAlign: 'center', lineHeight: 24 }}>
              {t('auth.forgot.success.subtitle')}
            </Text>
            <Pressable
              onPress={() => { Haptics.selectionAsync(); router.replace('/(auth)/login'); }}
              style={{ marginTop: 40, width: '100%' }}
            >
              <LinearGradient
                colors={goldGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{
                  borderRadius: radius.button, borderCurve: 'continuous', paddingVertical: 20, alignItems: 'center',
                  boxShadow: '0 6px 12px rgba(197,160,89,0.35)',
                }}
              >
                <Text style={{ color: colors.bg, fontSize: 17, fontFamily: fonts.sansSemiBold, fontWeight: '800' }}>{t('auth.forgot.success.backLink')}</Text>
              </LinearGradient>
            </Pressable>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <PremiumBackground />
      <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ flex: 1 }} contentContainerStyle={{ padding: 24, paddingTop: 20 }}>
          <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.canGoBack() ? router.back() : router.replace("/(tabs)"); }} style={{ marginBottom: 32, alignSelf: 'flex-start' }}>
            <ArrowLeft size={24} color="#94a3b8" />
          </Pressable>

          <Text style={{ color: colors.text, fontSize: 36, fontFamily: fonts.display, fontWeight: 'bold', marginBottom: 8 }}>
            {t('auth.forgot.title')}
          </Text>
          <Text style={{ color: '#94a3b8', fontSize: 16, fontFamily: fonts.sans, marginBottom: 32 }}>
            {t('auth.forgot.subtitle')}
          </Text>

          <Text style={{ color: '#94a3b8', fontSize: 11, fontFamily: fonts.sansSemiBold, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8, marginLeft: 4 }}>{t('auth.forgot.email.label')}</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder={t('auth.forgot.email.placeholder')}
            placeholderTextColor="#475569"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            style={{
              backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: radius.xl, borderCurve: 'continuous', paddingVertical: 18, paddingHorizontal: 20,
              color: '#f8fafc', fontSize: 16, fontFamily: fonts.sans, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', marginBottom: 24,
            }}
          />

          <Pressable
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); handleReset(); }}
            disabled={isLoading}
          >
            <LinearGradient
              colors={goldGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{
                borderRadius: radius.button, borderCurve: 'continuous', paddingVertical: 20, alignItems: 'center', opacity: isLoading ? 0.7 : 1,
                boxShadow: '0 6px 12px rgba(197,160,89,0.35)',
              }}
            >
              {isLoading ? <ActivityIndicator color={colors.bg} /> : <Text style={{ color: colors.bg, fontSize: 17, fontFamily: fonts.sansSemiBold, fontWeight: '800' }}>{t('auth.forgot.submit')}</Text>}
            </LinearGradient>
          </Pressable>
      </ScrollView>
    </View>
  );
}
