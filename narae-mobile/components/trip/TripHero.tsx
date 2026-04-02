import { View, Text, Image, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
    <View style={{ height: 280, position: 'relative' }}>
      <Image
        source={{ uri: imageUrl }}
        style={{ width: '100%', height: '100%' }}
        resizeMode="cover"
      />

      {/* Gradient overlay */}
      <View
        style={{
          position: 'absolute', bottom: 0, left: 0, right: 0,
          height: 160,
          backgroundColor: 'rgba(2,6,23,0.7)',
        }}
      />

      {/* Top bar */}
      <View
        style={{
          position: 'absolute', top: top + 8, left: 16, right: 16,
          flexDirection: 'row', justifyContent: 'space-between',
        }}
      >
        <Pressable
          onPress={onBack}
          hitSlop={12}
          style={{
            width: 40, height: 40, borderRadius: 999,
            backgroundColor: 'rgba(0,0,0,0.4)',
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <ArrowLeft size={22} color="#f8fafc" />
        </Pressable>
        <Pressable
          onPress={onShare}
          hitSlop={12}
          style={{
            width: 40, height: 40, borderRadius: 999,
            backgroundColor: 'rgba(0,0,0,0.4)',
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Share2 size={20} color="#f8fafc" />
        </Pressable>
      </View>

      {/* Title overlay */}
      <View style={{ position: 'absolute', bottom: 20, left: 20, right: 20 }}>
        <Text style={{ color: colors.text, fontSize: 26, fontFamily: fonts.display, marginBottom: 4 }}>
          {title}
        </Text>
        <Text style={{ color: colors.textSecondary, fontSize: 14, fontFamily: fonts.sansMedium }}>
          {destination} · {dateRange}
        </Text>
      </View>
    </View>
  );
}
