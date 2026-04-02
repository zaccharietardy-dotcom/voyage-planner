import { useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase/client';
import { ArrowLeft, Eye, EyeOff, Check } from 'lucide-react-native';
import Svg, { Path } from 'react-native-svg';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { SITE_URL } from '@/lib/constants';
import { colors, fonts, radius, goldGradient } from '@/lib/theme';
import { PremiumBackground } from '@/components/ui/PremiumBackground';

export default function RegisterScreen() {
  const router = useRouter();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const passwordCriteria = [
    { label: 'Au moins 8 caractères', met: password.length >= 8 },
    { label: 'Au moins une majuscule', met: /[A-Z]/.test(password) },
    { label: 'Au moins un chiffre', met: /[0-9]/.test(password) },
    { label: 'Au moins un caractère spécial', met: /[^A-Za-z0-9]/.test(password) },
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
        const { error } = await supabase.auth.signInWithIdToken({
          provider: 'apple',
          token: credential.identityToken,
        });
        if (error) throw error;
        router.replace('/(tabs)');
      }
    } catch (e: any) {
      if (e.code === 'ERR_REQUEST_CANCELED') return;
      const msg = e?.message || 'Connexion Apple impossible';
      Alert.alert('Erreur Apple Sign-In', msg);
    }
  };

  const handleGoogleLogin = async () => {
    try {
      const redirectUrl = Linking.createURL('auth/callback');
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: redirectUrl,
          skipBrowserRedirect: true,
        },
      });

      if (error || !data.url) {
        Alert.alert('Erreur', 'Connexion Google impossible');
        return;
      }

      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUrl);

      if (result.type === 'success' && result.url) {
        const url = new URL(result.url);
        const hashParams = new URLSearchParams(url.hash.substring(1));
        const accessToken = hashParams.get('access_token');
        const refreshToken = hashParams.get('refresh_token');

        if (accessToken && refreshToken) {
          await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
          router.replace('/(tabs)');
        }
      }
    } catch {
      Alert.alert('Erreur', 'Connexion Google impossible');
    }
  };

  const handleRegister = async () => {
    if (!firstName || !lastName || !email || !password) {
      setError('Veuillez remplir tous les champs');
      return;
    }
    if (password.length < 8) {
      setError('Le mot de passe doit faire au moins 8 caractères');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const { error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: `${firstName} ${lastName}`,
            first_name: firstName,
            last_name: lastName,
          },
        },
      });

      if (signUpError) {
        if (signUpError.message.includes('already registered')) {
          setError('Un compte existe déjà avec cet email');
        } else {
          setError(signUpError.message);
        }
        return;
      }

      // Send verification email
      await fetch(`${SITE_URL}/api/auth/send-verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, firstName }),
      });

      setSuccess(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      setError('Une erreur est survenue');
    } finally {
      setIsLoading(false);
    }
  };

  if (success) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <PremiumBackground />
        <SafeAreaView style={{ flex: 1 }}>
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
            <View style={{
              width: 80, height: 80, borderRadius: 24,
              backgroundColor: 'rgba(34,197,94,0.15)',
              alignItems: 'center', justifyContent: 'center', marginBottom: 24,
            }}>
              <Text style={{ fontSize: 40 }}>✉️</Text>
            </View>
            <Text style={{ color: colors.text, fontSize: 28, fontFamily: fonts.display, fontWeight: 'bold', textAlign: 'center', marginBottom: 12 }}>
              Vérifiez votre email
            </Text>
            <Text style={{ color: '#94a3b8', fontSize: 16, textAlign: 'center', lineHeight: 24 }}>
              Un lien de confirmation a été envoyé à{'\n'}
              <Text style={{ color: colors.gold, fontWeight: '800' }}>{email}</Text>
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
                  borderRadius: radius.xl, paddingVertical: 20, alignItems: 'center',
                  shadowColor: colors.gold, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 12,
                }}
              >
                <Text style={{ color: colors.bg, fontSize: 17, fontWeight: '800' }}>Retour à la connexion</Text>
              </LinearGradient>
            </Pressable>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <PremiumBackground />
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 20 }}>
            <Pressable onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.back(); }} style={{ marginBottom: 32, alignSelf: 'flex-start' }}>
              <ArrowLeft size={24} color="#94a3b8" />
            </Pressable>

            <Text style={{ color: colors.text, fontSize: 36, fontFamily: fonts.display, fontWeight: 'bold', marginBottom: 8 }}>
              Rejoindre Narae
            </Text>
            <Text style={{ color: '#94a3b8', fontSize: 16, fontFamily: fonts.sans, marginBottom: 32 }}>
              Créez votre compte en quelques secondes
            </Text>

            {/* OAuth buttons */}
            <Pressable
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); handleAppleLogin(); }}
              style={{
                backgroundColor: '#fff', borderRadius: radius.button, paddingVertical: 18,
                flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 12,
                marginBottom: 14, shadowColor: '#fff', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 10,
              }}
            >
              <Svg width={22} height={22} viewBox="0 0 24 24" fill="#000">
                <Path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
              </Svg>
              <Text style={{ color: '#000', fontSize: 16, fontFamily: fonts.sansSemiBold, fontWeight: '800' }}>Continuer avec Apple</Text>
            </Pressable>

            <Pressable
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); handleGoogleLogin(); }}
              style={{
                backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: radius.button, paddingVertical: 18,
                borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
                flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 12,
                marginBottom: 32,
              }}
            >
              <Svg width={22} height={22} viewBox="0 0 24 24">
                <Path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                <Path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <Path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18A10.96 10.96 0 0 0 1 12c0 1.77.42 3.45 1.18 4.93l3.66-2.84z" />
                <Path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </Svg>
              <Text style={{ color: '#f8fafc', fontSize: 16, fontFamily: fonts.sansSemiBold, fontWeight: '800' }}>Continuer avec Google</Text>
            </Pressable>

            {/* Divider */}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 32 }}>
              <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.1)' }} />
              <Text style={{ color: '#64748b', fontSize: 11, fontFamily: fonts.sansSemiBold, fontWeight: '800', letterSpacing: 1.5, paddingHorizontal: 16, textTransform: 'uppercase' }}>
                Ou s'inscrire avec email
              </Text>
              <View style={{ flex: 1, height: 1, backgroundColor: 'rgba(255,255,255,0.1)' }} />
            </View>

            {/* Name row */}
            <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#94a3b8', fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8, marginLeft: 4 }}>Prénom</Text>
                <TextInput
                  value={firstName}
                  onChangeText={setFirstName}
                  placeholder="Jean"
                  placeholderTextColor="#475569"
                  style={{ backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: radius.xl, paddingVertical: 18, paddingHorizontal: 20, color: '#f8fafc', fontSize: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: '#94a3b8', fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8, marginLeft: 4 }}>Nom</Text>
                <TextInput
                  value={lastName}
                  onChangeText={setLastName}
                  placeholder="Dupont"
                  placeholderTextColor="#475569"
                  style={{ backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: radius.xl, paddingVertical: 18, paddingHorizontal: 20, color: '#f8fafc', fontSize: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' }}
                />
              </View>
            </View>

            <Text style={{ color: '#94a3b8', fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8, marginLeft: 4 }}>Email</Text>
            <TextInput
              value={email}
              onChangeText={(t) => { setEmail(t); setError(null); }}
              placeholder="votre@email.com"
              placeholderTextColor="#475569"
              keyboardType="email-address"
              autoCapitalize="none"
              style={{ backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: radius.xl, paddingVertical: 18, paddingHorizontal: 20, color: '#f8fafc', fontSize: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', marginBottom: 20 }}
            />

            <Text style={{ color: '#94a3b8', fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8, marginLeft: 4 }}>Mot de passe</Text>
            <View style={{ position: 'relative', marginBottom: 16 }}>
              <TextInput
                value={password}
                onChangeText={(t) => { setPassword(t); setError(null); }}
                placeholder="8 caractères minimum"
                placeholderTextColor="#475569"
                secureTextEntry={!showPassword}
                style={{ backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: radius.xl, paddingVertical: 18, paddingHorizontal: 20, color: '#f8fafc', fontSize: 16, fontFamily: fonts.sans, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', paddingRight: 50 }}
              />
              <Pressable onPress={() => { Haptics.selectionAsync(); setShowPassword(!showPassword); }} style={{ position: 'absolute', right: 20, top: 20 }}>
                {showPassword ? <EyeOff size={20} color="#64748b" /> : <Eye size={20} color="#64748b" />}
              </Pressable>
            </View>

            {/* Password strength indicator */}
            {password.length > 0 && (
              <View style={{ marginBottom: 16, gap: 6 }}>
                {passwordCriteria.map((c) => (
                  <View key={c.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Check size={14} color={c.met ? '#4ade80' : '#475569'} />
                    <Text style={{ color: c.met ? '#4ade80' : '#64748b', fontSize: 13, fontFamily: fonts.sans }}>{c.label}</Text>
                  </View>
                ))}
              </View>
            )}

            {error && (
              <View style={{ backgroundColor: 'rgba(239,68,68,0.1)', borderRadius: radius.xl, padding: 16, borderWidth: 1, borderColor: 'rgba(239,68,68,0.2)', marginBottom: 16, marginTop: 4 }}>
                <Text style={{ color: '#f87171', fontSize: 14, fontWeight: '600' }}>{error}</Text>
              </View>
            )}

            <Pressable
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); handleRegister(); }}
              disabled={isLoading}
              style={{ marginTop: 24 }}
            >
              <LinearGradient
                colors={goldGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{
                  borderRadius: radius.button, paddingVertical: 20, alignItems: 'center', opacity: isLoading ? 0.7 : 1,
                  shadowColor: colors.gold, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 12,
                }}
              >
                {isLoading ? <ActivityIndicator color={colors.bg} /> : <Text style={{ color: colors.bg, fontSize: 17, fontFamily: fonts.sansSemiBold, fontWeight: '800' }}>Créer mon compte</Text>}
              </LinearGradient>
            </Pressable>

            <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 32, gap: 6, marginBottom: 20 }}>
              <Text style={{ color: '#94a3b8', fontSize: 15, fontFamily: fonts.sans }}>Déjà un compte ?</Text>
              <Pressable onPress={() => { Haptics.selectionAsync(); router.push('/(auth)/login'); }}>
                <Text style={{ color: colors.gold, fontSize: 15, fontFamily: fonts.sansSemiBold, fontWeight: '800', textDecorationLine: 'underline' }}>Se connecter</Text>
              </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
