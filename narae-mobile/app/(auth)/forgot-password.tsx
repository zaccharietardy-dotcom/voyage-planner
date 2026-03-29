import { useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { supabase } from '@/lib/supabase/client';
import { ArrowLeft } from 'lucide-react-native';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleReset = async () => {
    if (!email) return;
    setIsLoading(true);
    await supabase.auth.resetPasswordForEmail(email);
    setSent(true);
    setIsLoading(false);
  };

  if (sent) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#020617' }}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 }}>
          <Text style={{ fontSize: 48, marginBottom: 24 }}>📧</Text>
          <Text style={{ color: '#f8fafc', fontSize: 24, fontWeight: '800', textAlign: 'center', marginBottom: 12 }}>
            Email envoyé
          </Text>
          <Text style={{ color: '#94a3b8', fontSize: 16, textAlign: 'center', lineHeight: 24 }}>
            Vérifiez votre boîte mail pour réinitialiser votre mot de passe.
          </Text>
          <Pressable
            onPress={() => router.replace('/(auth)/login')}
            style={{ backgroundColor: '#c5a059', borderRadius: 16, paddingVertical: 16, paddingHorizontal: 32, marginTop: 32 }}
          >
            <Text style={{ color: '#020617', fontSize: 16, fontWeight: '800' }}>Retour</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#020617' }}>
      <View style={{ padding: 24, paddingTop: 20 }}>
        <Pressable onPress={() => router.back()} style={{ marginBottom: 32 }}>
          <ArrowLeft size={24} color="#94a3b8" />
        </Pressable>

        <Text style={{ color: '#f8fafc', fontSize: 32, fontWeight: '800', marginBottom: 8 }}>
          Mot de passe oublié
        </Text>
        <Text style={{ color: '#94a3b8', fontSize: 16, marginBottom: 32 }}>
          Entrez votre email, on vous envoie un lien de réinitialisation.
        </Text>

        <Text style={{ color: '#94a3b8', fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>Email</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="votre@email.com"
          placeholderTextColor="#475569"
          keyboardType="email-address"
          autoCapitalize="none"
          style={{ backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 16, padding: 16, color: '#f8fafc', fontSize: 16, borderWidth: 1, borderColor: '#1e293b', marginBottom: 24 }}
        />

        <Pressable
          onPress={handleReset}
          disabled={isLoading}
          style={{ backgroundColor: '#c5a059', borderRadius: 16, paddingVertical: 18, alignItems: 'center', opacity: isLoading ? 0.7 : 1 }}
        >
          {isLoading ? <ActivityIndicator color="#020617" /> : <Text style={{ color: '#020617', fontSize: 16, fontWeight: '800' }}>Envoyer le lien</Text>}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
