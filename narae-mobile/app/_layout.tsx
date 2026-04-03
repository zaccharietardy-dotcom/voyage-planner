import { DarkTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { View, Text, ActivityIndicator, Animated, StyleSheet } from 'react-native';
import { Plane } from 'lucide-react-native';
import 'react-native-reanimated';
import '../global.css';

import {
  PlayfairDisplay_400Regular,
  PlayfairDisplay_500Medium,
  PlayfairDisplay_600SemiBold,
  PlayfairDisplay_700Bold,
} from '@expo-google-fonts/playfair-display';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';

import { AuthProvider } from '@/hooks/useAuth';
import { colors } from '@/lib/theme';

export { ErrorBoundary } from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

// Keep the splash screen visible while we fetch resources
SplashScreen.preventAutoHideAsync();

const NaraeTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: '#020617',
    card: '#0a1128',
    text: '#f8fafc',
    border: '#1e293b',
    primary: '#c5a059',
  },
};

function PremiumSplashScreen() {
  const pulseAnim = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.6,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, []);

  return (
    <View style={styles.splashContainer}>
      <Animated.View style={[styles.logoContainer, { opacity: pulseAnim }]}>
        <View style={styles.iconBox}>
          <Plane size={32} color={colors.bg} strokeWidth={2.5} />
        </View>
        <Text style={styles.logoText}>NARAE</Text>
      </Animated.View>
      <ActivityIndicator size="small" color={colors.gold} style={styles.loader} />
    </View>
  );
}

export default function RootLayout() {
  const [loaded, error] = useFonts({
    PlayfairDisplay_400Regular,
    PlayfairDisplay_500Medium,
    PlayfairDisplay_600SemiBold,
    PlayfairDisplay_700Bold,
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync();
    }
  }, [loaded, error]);

  if (!loaded && !error) {
    return <PremiumSplashScreen />;
  }

  return (
    <AuthProvider>
      <ThemeProvider value={NaraeTheme}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="(auth)" options={{ presentation: 'modal' }} />
          <Stack.Screen name="trip/[id]" />
          <Stack.Screen name="preferences" options={{ presentation: 'modal' }} />
          <Stack.Screen name="user/[id]" />
          <Stack.Screen name="pricing" options={{ presentation: 'modal' }} />
        </Stack>
        <StatusBar style="light" />
      </ThemeProvider>
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  splashContainer: {
    flex: 1,
    backgroundColor: '#020617',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoContainer: {
    alignItems: 'center',
  },
  iconBox: {
    width: 64,
    height: 64,
    borderRadius: 20,
    borderCurve: 'continuous',
    backgroundColor: '#c5a059',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  logoText: {
    color: '#c5a059',
    fontSize: 20,
    letterSpacing: 6,
    fontWeight: '700',
    fontFamily: 'System', // Playfair not loaded yet
  },
  loader: {
    marginTop: 40,
  },
});
