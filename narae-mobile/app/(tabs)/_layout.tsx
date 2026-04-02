import { Tabs } from 'expo-router';
import { View, Text, Platform, StyleSheet, Pressable } from 'react-native';
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
      <View style={{ alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        {/* Glow behind the central button */}
        <View style={{
          position: 'absolute',
          width: 80,
          height: 80,
          borderRadius: 40,
          backgroundColor: 'rgba(197,160,89,0.25)',
          transform: [{ translateY: -12 }],
        }} />
        
        <LinearGradient
          colors={[...goldGradient]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{
            width: 60,
            height: 60,
            borderRadius: 24,
            justifyContent: 'center',
            alignItems: 'center',
            transform: [{ translateY: -15 }],
            shadowColor: colors.gold,
            shadowOffset: { width: 0, height: 8 },
            shadowOpacity: 0.5,
            shadowRadius: 15,
            elevation: 12,
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.2)',
          }}
        >
          <Plus size={32} color="#020617" strokeWidth={2.5} />
        </LinearGradient>
      </View>
    );
  }

  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', gap: 4, height: '100%', minWidth: 60 }}>
      {/* Active indicator dot */}
      {focused && (
        <View style={{
          position: 'absolute',
          top: 10,
          width: 6,
          height: 6,
          borderRadius: 3,
          backgroundColor: colors.gold,
          shadowColor: colors.gold,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 1,
          shadowRadius: 8,
        }} />
      )}
      
      <View style={{
        transform: [{ scale: focused ? 1.15 : 1 }, { translateY: focused ? -2 : 0 }],
        opacity: focused ? 1 : 0.5,
      }}>
        <Icon
          size={24}
          color={focused ? colors.gold : colors.text}
          strokeWidth={focused ? 2.5 : 2}
        />
      </View>

      {focused && (
        <Text style={{
          color: colors.gold,
          fontSize: 9,
          fontFamily: fonts.sansBold,
          textTransform: 'uppercase',
          letterSpacing: 1.2,
          marginTop: 2,
        }}>
          {label}
        </Text>
      )}
    </View>
  );
}

function CustomLogoIcon({ focused }: { focused: boolean }) {
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', height: '100%', minWidth: 60 }}>
      <View style={{ 
        alignItems: 'center', 
        opacity: focused ? 1 : 0.6,
        transform: [{ scale: focused ? 1.05 : 1 }]
      }}>
        <View style={{
          width: 24,
          height: 24,
          borderRadius: 6,
          backgroundColor: focused ? colors.gold : 'transparent',
          borderWidth: focused ? 0 : 1.5,
          borderColor: colors.gold,
          justifyContent: 'center',
          alignItems: 'center',
          marginBottom: 2,
        }}>
          <Map size={14} color={focused ? '#020617' : colors.gold} strokeWidth={2.5} />
        </View>
        <Text style={{
          color: colors.gold,
          fontSize: 7,
          fontFamily: fonts.display,
          fontWeight: 'bold',
          letterSpacing: 1.5,
        }}>
          VOYAGES
        </Text>
      </View>
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
          bottom: Math.max(bottom, 8),
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
        tabBarInactiveTintColor: colors.textMuted,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Voyages',
          tabBarIcon: ({ focused }) => <CustomLogoIcon focused={focused} />,
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
          title: 'Créer',
          tabBarIcon: ({ focused }) => <TabIcon icon={Plus} label="Créer" focused={focused} isCentral />,
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

