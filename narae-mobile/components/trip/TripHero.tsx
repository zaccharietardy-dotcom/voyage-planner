import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowLeft, Share2 } from 'lucide-react-native';
import { colors, fonts, radius } from '@/lib/theme';

interface Props {
  imageUrl: string;
  title: string;
  destination: string;
  dateRange: string;
  onBack: () => void;
  onShare: () => void;
}

export function TripHero({ imageUrl, title, destination, dateRange, onBack, onShare }: Props) {
  const { top } = useSafeAreaInsets();

  return (
    <View style={styles.container}>
      <Image source={{ uri: imageUrl }} style={styles.image} resizeMode="cover" />
      <LinearGradient
        colors={['rgba(2,6,23,0.16)', 'rgba(2,6,23,0.38)', 'rgba(2,6,23,0.96)']}
        style={styles.overlay}
      />

      <View style={[styles.topBar, { top: top + 10 }]}>
        <Pressable onPress={onBack} hitSlop={12} style={styles.topAction}>
          <ArrowLeft size={22} color={colors.text} />
        </Pressable>
        <Pressable onPress={onShare} hitSlop={12} style={styles.topAction}>
          <Share2 size={20} color={colors.text} />
        </Pressable>
      </View>

      <View style={styles.copyWrap}>
        <Text style={styles.kicker}>Carnet de voyage</Text>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.meta}>
          {destination} · {dateRange}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: 300,
    position: 'relative',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
  },
  topBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  topAction: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(2,6,23,0.45)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  copyWrap: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 22,
    gap: 6,
  },
  kicker: {
    color: colors.goldLight,
    fontSize: 10,
    fontFamily: fonts.sansBold,
    textTransform: 'uppercase',
    letterSpacing: 1.8,
  },
  title: {
    color: colors.text,
    fontSize: 30,
    fontFamily: fonts.display,
    lineHeight: 36,
  },
  meta: {
    color: colors.textSecondary,
    fontSize: 14,
    fontFamily: fonts.sansMedium,
  },
});
