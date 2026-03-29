import { useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, ScrollView, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase/client';
import { ArrowLeft, Eye, EyeOff } from 'lucide-react-native';
import { SITE_URL } from '@/lib/constants';

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
    } catch {
      setError('Une erreur est survenue');
    } finally {
      setIsLoading(false);
    }
  };

  if (success) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#020617' }}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <Text style={{ fontSize: 48, marginBottom: 24 }}>✉️</Text>
          <Text style={{ color: '#f8fafc', fontSize: 24, fontWeight: '800', textAlign: 'center', marginBottom: 12 }}>
            Vérifiez votre email
          </Text>
          <Text style={{ color: '#94a3b8', fontSize: 16, textAlign: 'center', lineHeight: 24 }}>
            Un lien de confirmation a été envoyé à{'\n'}
            <Text style={{ color: '#c5a059', fontWeight: '700' }}>{email}</Text>
          </Text>
          <Pressable
            onPress={() => router.replace('/(auth)/login')}
            style={{ backgroundColor: '#c5a059', borderRadius: 16, paddingVertical: 16, paddingHorizontal: 32, marginTop: 32 }}
          >
            <Text style={{ color: '#020617', fontSize: 16, fontWeight: '800' }}>Retour à la connexion</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#020617' }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 24, paddingTop: 20 }}>
          <Pressable onPress={() => router.back()} style={{ marginBottom: 32 }}>
            <ArrowLeft size={24} color="#94a3b8" />
          </Pressable>

          <Text style={{ color: '#f8fafc', fontSize: 32, fontWeight: '800', marginBottom: 8 }}>
            Rejoindre Narae
          </Text>
          <Text style={{ color: '#94a3b8', fontSize: 16, marginBottom: 32 }}>
            Créez votre compte en quelques secondes
          </Text>

          {/* Name row */}
          <View style={{ flexDirection: 'row', gap: 12, marginBottom: 16 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#94a3b8', fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>Prénom</Text>
              <TextInput
                value={firstName}
                onChangeText={setFirstName}
                placeholder="Jean"
                placeholderTextColor="#475569"
                style={{ backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 16, padding: 16, color: '#f8fafc', fontSize: 16, borderWidth: 1, borderColor: '#1e293b' }}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: '#94a3b8', fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>Nom</Text>
              <TextInput
                value={lastName}
                onChangeText={setLastName}
                placeholder="Dupont"
                placeholderTextColor="#475569"
                style={{ backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 16, padding: 16, color: '#f8fafc', fontSize: 16, borderWidth: 1, borderColor: '#1e293b' }}
              />
            </View>
          </View>

          <Text style={{ color: '#94a3b8', fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>Email</Text>
          <TextInput
            value={email}
            onChangeText={(t) => { setEmail(t); setError(null); }}
            placeholder="votre@email.com"
            placeholderTextColor="#475569"
            keyboardType="email-address"
            autoCapitalize="none"
            style={{ backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 16, padding: 16, color: '#f8fafc', fontSize: 16, borderWidth: 1, borderColor: '#1e293b', marginBottom: 16 }}
          />

          <Text style={{ color: '#94a3b8', fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>Mot de passe</Text>
          <View style={{ position: 'relative', marginBottom: 16 }}>
            <TextInput
              value={password}
              onChangeText={(t) => { setPassword(t); setError(null); }}
              placeholder="8 caractères minimum"
              placeholderTextColor="#475569"
              secureTextEntry={!showPassword}
              style={{ backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 16, padding: 16, color: '#f8fafc', fontSize: 16, borderWidth: 1, borderColor: '#1e293b', paddingRight: 50 }}
            />
            <Pressable onPress={() => setShowPassword(!showPassword)} style={{ position: 'absolute', right: 16, top: 16 }}>
              {showPassword ? <EyeOff size={20} color="#64748b" /> : <Eye size={20} color="#64748b" />}
            </Pressable>
          </View>

          {error && (
            <View style={{ backgroundColor: 'rgba(239,68,68,0.1)', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: 'rgba(239,68,68,0.2)', marginBottom: 16 }}>
              <Text style={{ color: '#f87171', fontSize: 14, fontWeight: '500' }}>{error}</Text>
            </View>
          )}

          <Pressable
            onPress={handleRegister}
            disabled={isLoading}
            style={{ backgroundColor: '#c5a059', borderRadius: 16, paddingVertical: 18, alignItems: 'center', opacity: isLoading ? 0.7 : 1 }}
          >
            {isLoading ? <ActivityIndicator color="#020617" /> : <Text style={{ color: '#020617', fontSize: 16, fontWeight: '800' }}>Créer mon compte</Text>}
          </Pressable>

          <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 24, gap: 4 }}>
            <Text style={{ color: '#94a3b8', fontSize: 14 }}>Déjà un compte ?</Text>
            <Pressable onPress={() => router.push('/(auth)/login')}>
              <Text style={{ color: '#c5a059', fontSize: 14, fontWeight: '700', textDecorationLine: 'underline' }}>Se connecter</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
