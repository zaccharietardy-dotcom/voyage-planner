import { View, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts } from '@/lib/theme';
import type { ReactNode } from 'react';

interface Props {
  title: string;
  subtitle?: string;
  rightAction?: ReactNode;
}

export function ScreenHeader({ title, subtitle, rightAction }: Props) {
  const { top } = useSafeAreaInsets();

  return (
    <View style={{ paddingTop: top + 12, paddingHorizontal: 20, paddingBottom: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          <Text style={{
            color: colors.text,
            fontSize: 28,
            fontFamily: fonts.display,
          }}>
            {title}
          </Text>
          {subtitle && (
            <Text style={{ color: colors.textSecondary, fontSize: 14, marginTop: 4 }}>{subtitle}</Text>
          )}
        </View>
        {rightAction}
      </View>
    </View>
  );
}
