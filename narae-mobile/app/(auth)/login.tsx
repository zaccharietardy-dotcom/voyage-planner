import { useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase/client';
import { Apple, Globe, Mail, Eye, EyeOff, ArrowLeft } from 'lucide-react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { SITE_URL } from '@/lib/constants';
import { colors, fonts } from '@/lib/theme';

export default function LoginScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleEmailLogin = async () => {
    if (!email || !password) {
      setError('Veuillez remplir tous les champs');
      return;
    }
    setIsLoading(true);
    setError(null);

    try {
      // Rate limit check
      const rl = await fetch(`${SITE_URL}/api/auth/login`, { method: 'POST' });
      if (rl.status === 429) {
        setError('Trop de tentatives. Réessayez dans quelques minutes.');
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) {
        if (signInError.message.includes('Invalid login credentials')) {
          setError('Email ou mot de passe incorrect');
        } else if (signInError.message.includes('Email not confirmed')) {
          setError('Veuillez confirmer votre email');
        } else {
          setError(signInError.message);
        }
        return;
      }
      router.replace('/(tabs)');
    } catch {
      setError('Une erreur est survenue');
    } finally {
      setIsLoading(false);
    }
  };

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
      // Get the OAuth URL without auto-opening browser
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

      // Open in-app browser and wait for redirect back
      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUrl);

      if (result.type === 'success' && result.url) {
        // Extract tokens from the redirect URL
        const url = new URL(result.url);
        // Supabase returns tokens as hash fragments
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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#020617' }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 20 }}>
          {/* Back button */}
          <Pressable onPress={() => router.back()} style={{ marginBottom: 32 }}>
            <ArrowLeft size={24} color="#94a3b8" />
          </Pressable>

          {/* Header */}
          <Text style={{ color: colors.text, fontSize: 32, fontFamily: fonts.display, marginBottom: 8 }}>
            Bon retour
          </Text>
          <Text style={{ color: '#94a3b8', fontSize: 16, marginBottom: 32 }}>
            Accédez à vos carnets de route
          </Text>

          {/* OAuth buttons */}
          <Pressable
            onPress={handleAppleLogin}
            style={{
              backgroundColor: '#fff', borderRadius: 16, paddingVertical: 16,
              flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10,
              marginBottom: 12,
            }}
          >
            <Apple size={22} color="#000" />
            <Text style={{ color: '#000', fontSize: 16, fontWeight: '700' }}>Continuer avec Apple</Text>
          </Pressable>

          <Pressable
            onPress={handleGoogleLogin}
            style={{
              backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 16, paddingVertical: 16,
              borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
              flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10,
              marginBottom: 32,
            }}
          >
            <Globe size={22} color="#f8fafc" />
            <Text style={{ color: '#f8fafc', fontSize: 16, fontWeight: '700' }}>Continuer avec Google</Text>
          </Pressable>

          {/* Divider */}
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 32 }}>
            <View style={{ flex: 1, height: 1, backgroundColor: '#1e293b' }} />
            <Text style={{ color: '#64748b', fontSize: 11, fontWeight: '700', letterSpacing: 1, paddingHorizontal: 16, textTransform: 'uppercase' }}>
              Ou avec email
            </Text>
            <View style={{ flex: 1, height: 1, backgroundColor: '#1e293b' }} />
          </View>

          {/* Email */}
          <Text style={{ color: '#94a3b8', fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>
            Email
          </Text>
          <TextInput
            value={email}
            onChangeText={(t) => { setEmail(t); setError(null); }}
            placeholder="votre@email.com"
            placeholderTextColor="#475569"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            style={{
              backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 16, paddingVertical: 16, paddingHorizontal: 20,
              color: '#f8fafc', fontSize: 16, borderWidth: 1, borderColor: '#1e293b', marginBottom: 16,
            }}
          />

          {/* Password */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <Text style={{ color: '#94a3b8', fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' }}>
              Mot de passe
            </Text>
            <Pressable onPress={() => router.push('/(auth)/forgot-password')}>
              <Text style={{ color: '#c5a059', fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' }}>
                Oublié ?
              </Text>
            </Pressable>
          </View>
          <View style={{ position: 'relative' }}>
            <TextInput
              value={password}
              onChangeText={(t) => { setPassword(t); setError(null); }}
              placeholder="••••••••"
              placeholderTextColor="#475569"
              secureTextEntry={!showPassword}
              autoComplete="password"
              style={{
                backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 16, paddingVertical: 16, paddingHorizontal: 20,
                color: '#f8fafc', fontSize: 16, borderWidth: 1, borderColor: '#1e293b', paddingRight: 50,
              }}
            />
            <Pressable
              onPress={() => setShowPassword(!showPassword)}
              style={{ position: 'absolute', right: 16, top: 16 }}
            >
              {showPassword ? <EyeOff size={20} color="#64748b" /> : <Eye size={20} color="#64748b" />}
            </Pressable>
          </View>

          {/* Error */}
          {error && (
            <View style={{
              backgroundColor: 'rgba(239,68,68,0.1)', borderRadius: 16, padding: 16,
              borderWidth: 1, borderColor: 'rgba(239,68,68,0.2)', marginTop: 16,
            }}>
              <Text style={{ color: '#f87171', fontSize: 14, fontWeight: '500' }}>{error}</Text>
            </View>
          )}

          {/* Submit */}
          <Pressable
            onPress={handleEmailLogin}
            disabled={isLoading}
            style={{
              backgroundColor: '#c5a059', borderRadius: 16, paddingVertical: 18,
              marginTop: 24, alignItems: 'center', opacity: isLoading ? 0.7 : 1,
            }}
          >
            {isLoading ? (
              <ActivityIndicator color="#020617" />
            ) : (
              <Text style={{ color: '#020617', fontSize: 16, fontWeight: '800' }}>Se connecter</Text>
            )}
          </Pressable>

          {/* Register link */}
          <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 24, gap: 4 }}>
            <Text style={{ color: '#94a3b8', fontSize: 14 }}>Pas encore de compte ?</Text>
            <Pressable onPress={() => router.push('/(auth)/register')}>
              <Text style={{ color: '#c5a059', fontSize: 14, fontWeight: '700', textDecorationLine: 'underline' }}>
                Créer un compte
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
