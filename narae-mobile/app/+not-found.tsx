import { Link, Stack } from 'expo-router';
import { View, Text } from 'react-native';

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: 'Page introuvable' }} />
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20, backgroundColor: '#020617' }}>
        <Text style={{ color: '#f8fafc', fontSize: 20, fontWeight: '800', marginBottom: 16 }}>
          Page introuvable
        </Text>
        <Link href="/">
          <Text style={{ color: '#c5a059', fontSize: 14, fontWeight: '700', textDecorationLine: 'underline' }}>
            Retour à l'accueil
          </Text>
        </Link>
      </View>
    </>
  );
}
