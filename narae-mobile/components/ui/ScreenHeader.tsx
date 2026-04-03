import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ReactNode } from 'react';
import { colors, fonts } from '@/lib/theme';

interface Props {
  title: string;
  subtitle?: string;
  rightAction?: ReactNode;
}

export function ScreenHeader({ title, subtitle, rightAction }: Props) {
  const { top } = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingTop: top + 12 }]}>
      <View style={styles.row}>
        <View style={styles.copy}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        {rightAction}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    paddingBottom: 18,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  copy: {
    flex: 1,
    gap: 4,
  },
  title: {
    color: colors.text,
    fontSize: 34,
    fontFamily: fonts.display,
    lineHeight: 40,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 14,
    fontFamily: fonts.sans,
    lineHeight: 22,
  },
});
