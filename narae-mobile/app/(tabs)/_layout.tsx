import { Tabs } from 'expo-router';
import { View, Text, Platform, StyleSheet } from 'react-native';
import { Home, Compass, Plus, Globe, User } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { colors, fonts, goldGradient } from '@/lib/theme';
import { useTranslation } from '@/lib/i18n';
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
  const { t } = useTranslation();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          position: 'absolute',
          bottom: Math.max(bottom, 8),
          left: 16,
          right: 16,
          height: 72,
          backgroundColor: Platform.OS === 'ios' ? 'rgba(2,6,23,0.4)' : colors.card,
          borderTopWidth: 0,
          borderRadius: 34,
          borderCurve: 'continuous',
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.12)',
          paddingBottom: 0,
          paddingTop: 0,
          boxShadow: '0 20px 40px rgba(0,0,0,0.55)',
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
          title: t('tabs.home'),
          tabBarIcon: ({ focused }) => <TabIcon icon={Home} label={t('tabs.home')} focused={focused} />,
        }}
        listeners={{
          tabPress: () => Haptics.selectionAsync(),
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: t('tabs.explore'),
          tabBarIcon: ({ focused }) => <TabIcon icon={Compass} label={t('tabs.explore')} focused={focused} />,
        }}
        listeners={{
          tabPress: () => Haptics.selectionAsync(),
        }}
      />
      <Tabs.Screen
        name="plan"
        options={{
          title: t('tabs.create'),
          tabBarIcon: ({ focused }) => <TabIcon icon={Plus} label={t('tabs.create')} focused={focused} isCentral />,
          tabBarStyle: { display: 'none' },
        }}
        listeners={{
          tabPress: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
        }}
      />
      <Tabs.Screen
        name="globe"
        options={{
          title: t('tabs.globe'),
          tabBarIcon: ({ focused }) => <TabIcon icon={Globe} label={t('tabs.globe')} focused={focused} />,
        }}
        listeners={{
          tabPress: () => Haptics.selectionAsync(),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('tabs.profile'),
          tabBarIcon: ({ focused }) => <TabIcon icon={User} label={t('tabs.profile')} focused={focused} />,
        }}
        listeners={{
          tabPress: () => Haptics.selectionAsync(),
        }}
      />
      <Tabs.Screen name="trips" options={{ href: null }} />
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
    borderCurve: 'continuous',
    backgroundColor: colors.gold,
    boxShadow: '0 0 6px rgba(197,160,89,1)',
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
    borderCurve: 'continuous',
    backgroundColor: 'rgba(197,160,89,0.25)',
    transform: [{ translateY: -10 }],
  },
  centralButton: {
    width: 64,
    height: 64,
    borderRadius: 28,
    borderCurve: 'continuous',
    justifyContent: 'center',
    alignItems: 'center',
    transform: [{ translateY: -12 }],
    boxShadow: '0 8px 15px rgba(197,160,89,0.5)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
});
