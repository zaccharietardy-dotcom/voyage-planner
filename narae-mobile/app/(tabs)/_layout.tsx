import { Tabs } from 'expo-router';
import { View, Text, Platform, StyleSheet } from 'react-native';
import { Home, Compass, Plus, Map, User } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { colors } from '@/lib/theme';
import type { LucideIcon } from 'lucide-react-native';

function TabIcon({ icon: Icon, label, focused, isCentral }: {
  icon: LucideIcon;
  label: string;
  focused: boolean;
  isCentral?: boolean;
}) {
  if (isCentral) {
    return (
      <View style={{
        width: 56,
        height: 56,
        borderRadius: 20,
        backgroundColor: colors.gold,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 24,
        shadowColor: colors.gold,
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.4,
        shadowRadius: 12,
        elevation: 10,
      }}>
        <Plus size={26} color={colors.bg} strokeWidth={2.5} />
      </View>
    );
  }

  return (
    <View style={{ alignItems: 'center', gap: 4, minWidth: 50 }}>
      {/* Active dot indicator */}
      {focused && (
        <View style={{
          position: 'absolute',
          top: -8,
          width: 5,
          height: 5,
          borderRadius: 3,
          backgroundColor: colors.gold,
          shadowColor: colors.gold,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.6,
          shadowRadius: 4,
        }} />
      )}
      <Icon
        size={focused ? 23 : 21}
        color={focused ? colors.gold : colors.textMuted}
        strokeWidth={focused ? 2.2 : 1.8}
      />
      {focused && (
        <Text style={{
          color: colors.gold,
          fontSize: 9,
          fontWeight: '700',
          letterSpacing: 0.5,
        }}>
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
          bottom: Math.max(bottom, 16),
          left: 16,
          right: 16,
          height: 72,
          backgroundColor: Platform.OS === 'ios' ? 'transparent' : 'rgba(10,17,40,0.95)',
          borderTopWidth: 0,
          borderRadius: 36,
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.08)',
          paddingBottom: 0,
          paddingTop: 0,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 10 },
          shadowOpacity: 0.4,
          shadowRadius: 20,
          elevation: 20,
          overflow: 'hidden',
        },
        tabBarBackground: () => (
          Platform.OS === 'ios' ? (
            <BlurView intensity={80} tint="dark" style={StyleSheet.absoluteFill} />
          ) : null
        ),
        tabBarShowLabel: false,
        tabBarActiveTintColor: colors.gold,
        tabBarInactiveTintColor: colors.textMuted,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Accueil',
          tabBarIcon: ({ focused }) => <TabIcon icon={Home} label="Accueil" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: 'Explorer',
          tabBarIcon: ({ focused }) => <TabIcon icon={Compass} label="Explorer" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="plan"
        options={{
          title: 'Créer',
          tabBarIcon: ({ focused }) => <TabIcon icon={Plus} label="Créer" focused={focused} isCentral />,
        }}
      />
      <Tabs.Screen
        name="trips"
        options={{
          title: 'Voyages',
          tabBarIcon: ({ focused }) => <TabIcon icon={Map} label="Voyages" focused={focused} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profil',
          tabBarIcon: ({ focused }) => <TabIcon icon={User} label="Profil" focused={focused} />,
        }}
      />
    </Tabs>
  );
}
