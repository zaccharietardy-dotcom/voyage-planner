import { useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase/client';
import { ArrowLeft, Eye, EyeOff } from 'lucide-react-native';
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
            <Text style={{ color: '#94a3b8', fontSize: 16, marginBottom: 32 }}>
              Créez votre compte en quelques secondes
            </Text>

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
                style={{ backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: radius.xl, paddingVertical: 18, paddingHorizontal: 20, color: '#f8fafc', fontSize: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', paddingRight: 50 }}
              />
              <Pressable onPress={() => { Haptics.selectionAsync(); setShowPassword(!showPassword); }} style={{ position: 'absolute', right: 20, top: 20 }}>
                {showPassword ? <EyeOff size={20} color="#64748b" /> : <Eye size={20} color="#64748b" />}
              </Pressable>
            </View>

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
                  borderRadius: radius.xl, paddingVertical: 20, alignItems: 'center', opacity: isLoading ? 0.7 : 1,
                  shadowColor: colors.gold, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 12,
                }}
              >
                {isLoading ? <ActivityIndicator color={colors.bg} /> : <Text style={{ color: colors.bg, fontSize: 17, fontWeight: '800' }}>Créer mon compte</Text>}
              </LinearGradient>
            </Pressable>

            <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 32, gap: 6, marginBottom: 20 }}>
              <Text style={{ color: '#94a3b8', fontSize: 15 }}>Déjà un compte ?</Text>
              <Pressable onPress={() => { Haptics.selectionAsync(); router.push('/(auth)/login'); }}>
                <Text style={{ color: colors.gold, fontSize: 15, fontWeight: '800', textDecorationLine: 'underline' }}>Se connecter</Text>
              </Pressable>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}
