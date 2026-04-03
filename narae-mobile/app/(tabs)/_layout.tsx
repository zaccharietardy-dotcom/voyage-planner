import { Tabs } from 'expo-router';
import { View, Text, Platform, StyleSheet } from 'react-native';
import { Map, Compass, Plus, Globe, User } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { colors, fonts, goldGradient } from '@/lib/theme';
import type { LucideIcon } from 'lucide-react-native';

function TabIcon({ icon: Icon, label, focused, isCentral }: {
  icon: LucideIcon;
  label: string;
  focused: boolean;
  isCentral?: boolean;
}) {
  if (isCentral) {
    return (
      <View style={styles.centralButtonContainer}>
        {/* Glow behind central button */}
        <View style={styles.centralGlow} />
        
        <LinearGradient
          colors={[...goldGradient]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.centralButton}
        >
          <Plus size={32} color="#020617" strokeWidth={2.5} />
        </LinearGradient>
      </View>
    );
  }

  return (
    <View style={styles.tabItem}>
      {focused && <View style={styles.activeDot} />}
      
      <View style={{ transform: [{ scale: focused ? 1.1 : 1 }] }}>
        <Icon
          size={24}
          color={focused ? colors.gold : 'rgba(255,255,255,0.4)'}
          strokeWidth={focused ? 2.5 : 2}
        />
      </View>

      {focused && (
        <Text style={styles.activeLabel}>
          {label}
        </Text>
      )}
    </View>
  );
}

export default function TabLayout() {
  const { bottom } = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          position: 'absolute',
          bottom: Math.max(bottom, 8) + 8,
          left: 16,
          right: 16,
          height: 68,
          backgroundColor: Platform.OS === 'ios' ? 'rgba(2,6,23,0.4)' : colors.card,
          borderTopWidth: 0,
          borderRadius: 34,
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.12)',
          paddingBottom: 0,
          paddingTop: 0,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 12 },
          shadowOpacity: 0.5,
          shadowRadius: 24,
          elevation: 24,
          overflow: 'visible',
        },
        tabBarBackground: () => (
          Platform.OS === 'ios' ? (
            <BlurView intensity={90} tint="dark" style={{ ...StyleSheet.absoluteFillObject, borderRadius: 34 }} />
          ) : null
        ),
        tabBarShowLabel: false,
        tabBarActiveTintColor: colors.gold,
        tabBarInactiveTintColor: 'rgba(255,255,255,0.4)',
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Voyages',
          tabBarIcon: ({ focused }) => <TabIcon icon={Map} label="Voyages" focused={focused} />,
        }}
        listeners={{
          tabPress: () => Haptics.selectionAsync(),
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: 'Explorer',
          tabBarIcon: ({ focused }) => <TabIcon icon={Compass} label="Explorer" focused={focused} />,
        }}
        listeners={{
          tabPress: () => Haptics.selectionAsync(),
        }}
      />
      <Tabs.Screen
        name="plan"
        options={{
          title: 'Creer',
          tabBarIcon: ({ focused }) => <TabIcon icon={Plus} label="Creer" focused={focused} isCentral />,
        }}
        listeners={{
          tabPress: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
        }}
      />
      <Tabs.Screen
        name="trips"
        options={{
          title: 'Globe',
          tabBarIcon: ({ focused }) => <TabIcon icon={Globe} label="Globe" focused={focused} />,
        }}
        listeners={{
          tabPress: () => Haptics.selectionAsync(),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profil',
          tabBarIcon: ({ focused }) => <TabIcon icon={User} label="Profil" focused={focused} />,
        }}
        listeners={{
          tabPress: () => Haptics.selectionAsync(),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabItem: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    height: '100%',
    minWidth: 60,
  },
  activeDot: {
    position: 'absolute',
    top: 10,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.gold,
    shadowColor: colors.gold,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 1,
    shadowRadius: 6,
    elevation: 4,
  },
  activeLabel: {
    color: colors.gold,
    fontSize: 8,
    fontFamily: fonts.sansBold,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginTop: 2,
  },
  centralButtonContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
  },
  centralGlow: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(197,160,89,0.25)',
    transform: [{ translateY: -12 }],
  },
  centralButton: {
    width: 64,
    height: 64,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    transform: [{ translateY: -18 }],
    shadowColor: colors.gold,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.5,
    shadowRadius: 15,
    elevation: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
});
