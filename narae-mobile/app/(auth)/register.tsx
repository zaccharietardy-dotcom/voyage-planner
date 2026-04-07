import { View, Text, StyleSheet, Pressable, ScrollView, KeyboardAvoidingView, Alert, Platform } from 'react-native';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import Svg, { Path } from 'react-native-svg';
import { Check } from 'lucide-react-native';
import { supabase } from '@/lib/supabase/client';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { SITE_URL } from '@/lib/constants';
import { colors, fonts, radius } from '@/lib/theme';
import { useTranslation } from '@/lib/i18n';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { PremiumBackground } from '@/components/ui/PremiumBackground';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { goldGradient } from '@/lib/theme';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getSafeRedirectPath } from '@/lib/redirect';

function AppleLogo() {
  return (
    <Svg width="20" height="24" viewBox="0 0 20 24" fill="#000">
      <Path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </Svg>
  );
}

function GoogleLogo() {
  return (
    <Svg width="20" height="20" viewBox="0 0 20 20">
      <Path d="M19.6 10.22c0-.7-.06-1.38-.18-2.03H10v3.84h5.38c-.23 1.25-.94 2.31-2 2.98v2.48h3.24c1.89-1.74 2.98-4.3 2.98-7.27z" fill="#4285F4" />
      <Path d="M10 20c2.7 0 4.96-.9 6.62-2.43l-3.24-2.48c-.9.6-2.06.96-3.38.96-2.6 0-4.81-1.76-5.6-4.12H1.14v2.54C2.79 17.75 6.14 20 10 20z" fill="#34A853" />
      <Path d="M4.4 11.93c-.2-.6-.32-1.25-.32-1.93s.12-1.33.32-1.93V5.53H1.14C.41 6.97 0 8.44 0 10s.41 3.03 1.14 4.47l3.26-2.54z" fill="#FBBC05" />
      <Path d="M10 3.97c1.47 0 2.79.5 3.82 1.49l2.87-2.87C14.95.89 12.7 0 10 0 6.14 0 2.79 2.25 1.14 5.53l3.26 2.54c.79-2.36 3-4.1 5.6-4.1z" fill="#EA4335" />
    </Svg>
  );
}

export default function RegisterScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ redirect?: string }>();
  const insets = useSafeAreaInsets();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const { t } = useTranslation();
  const redirectPath = getSafeRedirectPath(params.redirect, '/(tabs)');

  const passwordCriteria = [
    { label: t('auth.register.criteria.length'), met: password.length >= 8 },
    { label: t('auth.register.criteria.uppercase'), met: /[A-Z]/.test(password) },
    { label: t('auth.register.criteria.digit'), met: /[0-9]/.test(password) },
    { label: t('auth.register.criteria.special'), met: /[^A-Za-z0-9]/.test(password) },
  ];

  const handleAppleLogin = async () => {
    try {
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });
      if (credential.identityToken) {
        const { error } = await supabase.auth.signInWithIdToken({ provider: 'apple', token: credential.identityToken });
        if (error) throw error;
        router.replace(redirectPath as Href);
      }
    } catch (e: any) {
      if (e.code === 'ERR_REQUEST_CANCELED') return;
      Alert.alert(t('auth.login.error.apple'), e?.message || t('auth.login.error.appleUnavailable'));
    }
  };

  const handleGoogleLogin = async () => {
    try {
      const redirectUrl = Linking.createURL('auth/callback');
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: redirectUrl, skipBrowserRedirect: true },
      });
      if (error || !data.url) { Alert.alert(t('common.error'), t('auth.login.error.google')); return; }

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUrl);
      if (result.type === 'success' && result.url) {
        const hashParams = new URLSearchParams(new URL(result.url).hash.substring(1));
        const accessToken = hashParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token');
        if (accessToken && refreshToken) {
          await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
          router.replace(redirectPath as Href);
        }
      }
    } catch {
      Alert.alert(t('common.error'), t('auth.login.error.google'));
    }
  };

  const handleRegister = async () => {
    if (!firstName || !lastName || !email || !password) {
      setError(t('auth.register.error.empty'));
      return;
    }
    if (password.length < 8) {
      setError(t('auth.register.error.passwordLength'));
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: `${firstName} ${lastName}`, first_name: firstName, last_name: lastName } },
      });

      if (signUpError) {
        if (signUpError.message.includes('already registered')) {
          setError(t('auth.register.error.exists'));
        } else {
          setError(signUpError.message);
        }
        return;
      }

      // Best-effort email send — don't block registration if it fails
      fetch(`${SITE_URL}/api/auth/send-verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, firstName }),
      }).catch(() => {});

      setSuccess(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      setError(t('auth.register.error.generic'));
    } finally {
      setIsLoading(false);
    }
  };

  if (success) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <PremiumBackground />
        <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ flex: 1 }} contentContainerStyle={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <View style={{ width: 80, height: 80, borderRadius: 24, borderCurve: 'continuous', backgroundColor: 'rgba(34,197,94,0.15)', alignItems: 'center', justifyContent: 'center', marginBottom: 24 }}>
            <Text style={{ fontSize: 40 }}>✉️</Text>
          </View>
          <Text style={{ color: colors.text, fontSize: 28, fontFamily: fonts.display, textAlign: 'center', marginBottom: 12 }}>
            {t('auth.register.success.title')}
          </Text>
          <Text style={{ color: colors.textSecondary, fontSize: 16, fontFamily: fonts.sans, textAlign: 'center', lineHeight: 24 }}>
            {t('auth.register.success.subtitle')}{'\n'}
            <Text style={{ color: colors.gold, fontFamily: fonts.sansBold }}>{email}</Text>
          </Text>
          <Pressable onPress={() => router.replace({ pathname: '/(auth)/login', params: { redirect: redirectPath } })} style={{ marginTop: 40, width: '100%' }}>
            <LinearGradient colors={goldGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: radius.button, borderCurve: 'continuous', paddingVertical: 20, alignItems: 'center' }}>
              <Text style={{ color: colors.bg, fontSize: 17, fontFamily: fonts.sansSemiBold }}>{t('auth.register.success.backLink')}</Text>
            </LinearGradient>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <PremiumBackground />
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <ScrollView
            contentInsetAdjustmentBehavior="never"
            contentContainerStyle={[
              styles.container,
              {
                paddingTop: insets.top + 28,
                paddingBottom: insets.bottom + 32,
              },
            ]}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.header}>
              <Text style={styles.title}>{t('auth.register.title')}</Text>
              <Text style={styles.subtitle}>{t('auth.register.subtitle')}</Text>
            </View>

            <View style={styles.socialContainer}>
              <Pressable style={styles.appleButton} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); handleAppleLogin(); }}>
                <AppleLogo />
                <Text style={styles.appleButtonText}>{t('auth.register.apple')}</Text>
              </Pressable>
              <Pressable style={styles.googleButton} onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); handleGoogleLogin(); }}>
                <GoogleLogo />
                <Text style={styles.googleButtonText}>{t('auth.register.google')}</Text>
              </Pressable>
            </View>

            <View style={styles.dividerContainer}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>{t('auth.register.divider')}</Text>
              <View style={styles.dividerLine} />
            </View>

            <View style={styles.form}>
              <View style={styles.row}>
                <View style={[styles.inputGroup, { flex: 1 }]}>
                  <Text style={styles.label}>{t('auth.register.firstName.label')}</Text>
                  <Input value={firstName} onChangeText={setFirstName} placeholder={t('auth.register.firstName.placeholder')} />
                </View>
                <View style={[styles.inputGroup, { flex: 1 }]}>
                  <Text style={styles.label}>{t('auth.register.lastName.label')}</Text>
                  <Input value={lastName} onChangeText={setLastName} placeholder={t('auth.register.lastName.placeholder')} />
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>{t('auth.register.email.label')}</Text>
                <Input value={email} onChangeText={(v) => { setEmail(v); setError(null); }} placeholder={t('auth.login.email.placeholder')} autoCapitalize="none" keyboardType="email-address" />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>{t('auth.register.password.label')}</Text>
                <Input value={password} onChangeText={(v) => { setPassword(v); setError(null); }} placeholder={t('auth.login.password.placeholder')} secureTextEntry />
                <View style={styles.criteriaContainer}>
                  {passwordCriteria.map((c, i) => (
                    <View key={i} style={styles.criteriaItem}>
                      {c.met ? <Check size={12} color={colors.active} strokeWidth={3} /> : <View style={styles.criteriaDot} />}
                      <Text style={[styles.criteriaText, { color: c.met ? colors.text : colors.textMuted }]}>{c.label}</Text>
                    </View>
                  ))}
                </View>
              </View>

              {error && (
                <View style={styles.errorContainer}>
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              )}

              <Button variant="primary" size="lg" onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); handleRegister(); }} isLoading={isLoading} style={{ marginTop: 12 }}>
                {t('auth.register.submit')}
              </Button>
            </View>

            <View style={styles.footer}>
              <Text style={styles.footerText}>{t('auth.register.loginPrompt')}</Text>
              <Pressable onPress={() => router.push({ pathname: '/(auth)/login', params: { redirect: redirectPath } })}>
                <Text style={styles.footerLink}>{t('auth.register.loginLink')}</Text>
              </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, paddingTop: 40, paddingBottom: 40 },
  header: { marginBottom: 40 },
  title: { color: colors.text, fontSize: 36, fontFamily: fonts.display, marginBottom: 8 },
  subtitle: { color: colors.textSecondary, fontSize: 16, fontFamily: fonts.sans, lineHeight: 24 },
  socialContainer: { gap: 12, marginBottom: 32 },
  appleButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, height: 56, backgroundColor: '#FFFFFF', borderRadius: 18, borderCurve: 'continuous' },
  appleButtonText: { color: '#000000', fontSize: 16, fontFamily: fonts.sansSemiBold },
  googleButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, height: 56, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 18, borderCurve: 'continuous', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  googleButtonText: { color: colors.text, fontSize: 16, fontFamily: fonts.sansSemiBold },
  dividerContainer: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 32 },
  dividerLine: { flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.08)' },
  dividerText: { color: colors.textMuted, fontSize: 11, fontFamily: fonts.sansBold, letterSpacing: 1.5 },
  form: { gap: 20 },
  row: { flexDirection: 'row', gap: 12 },
  inputGroup: { gap: 8 },
  label: { color: colors.textSecondary, fontSize: 11, fontFamily: fonts.sansBold, letterSpacing: 1.5, marginLeft: 4 },
  criteriaContainer: { marginTop: 8, gap: 6 },
  criteriaItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  criteriaDot: { width: 12, height: 12, borderRadius: 6, borderCurve: 'continuous', backgroundColor: 'rgba(255,255,255,0.1)' },
  criteriaText: { fontSize: 13, fontFamily: fonts.sans },
  errorContainer: { backgroundColor: 'rgba(239,68,68,0.1)', borderRadius: radius.xl, borderCurve: 'continuous', padding: 16, borderWidth: 1, borderColor: 'rgba(239,68,68,0.2)' },
  errorText: { color: '#f87171', fontSize: 14, fontFamily: fonts.sansMedium },
  footer: { flexDirection: 'row', justifyContent: 'center', marginTop: 40 },
  footerText: { color: colors.textSecondary, fontSize: 15, fontFamily: fonts.sans },
  footerLink: { color: colors.gold, fontSize: 15, fontFamily: fonts.sansSemiBold, textDecorationLine: 'underline' },
});
