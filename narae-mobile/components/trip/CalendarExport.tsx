import { View, Text, Pressable, Alert, Linking, ScrollView, StyleSheet } from 'react-native';
import { Calendar, Globe, FileDown, FileText, ChevronRight } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { colors, fonts, radius } from '@/lib/theme';
import { exportTripToAppleCalendar, getGoogleCalendarUrl } from '@/lib/calendar';
import { shareICSFile } from '@/lib/ics';
import { exportTripPdf } from '@/lib/exportPdf';
import type { Trip } from '@/lib/types/trip';
import type { LucideIcon } from 'lucide-react-native';
import { useTranslation } from '@/lib/i18n';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  trip: Trip;
}

export function CalendarExport({ isOpen, onClose, trip }: Props) {
  const { t } = useTranslation();

  const handleApple = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const count = await exportTripToAppleCalendar(trip);
      onClose();
      if (count > 0) {
        Alert.alert(t('export.success.apple'), t('export.success.apple.msg', { count, plural: count > 1 ? 's' : '' }));
      }
    } catch {
      Alert.alert(t('common.error'), t('export.error.apple'));
    }
  };

  const handleGoogle = () => {
    Haptics.selectionAsync();
    const firstItem = trip.days?.[0]?.items?.[0];
    const firstDay = trip.days?.[0];
    if (firstItem && firstDay) {
      const url = getGoogleCalendarUrl(firstItem, firstDay);
      Linking.openURL(url);
    }
    onClose();
  };

  const handleICS = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await shareICSFile(trip);
      onClose();
    } catch {
      Alert.alert(t('common.error'), t('export.error.ics'));
    }
  };

  const handlePdf = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await exportTripPdf(trip);
      onClose();
    } catch {
      Alert.alert(t('common.error'), t('export.error.pdf'));
    }
  };

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} height={0.48}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <Text style={s.title}>{t('export.title')}</Text>

        <View style={s.section}>
          <Text style={s.sectionLabel}>{t('export.calendar')}</Text>
          <ExportRow
            icon={Calendar}
            iconColor="#f87171"
            label={t('export.apple.title')}
            desc={t('export.apple.desc')}
            onPress={handleApple}
          />
          <ExportRow
            icon={Globe}
            iconColor="#60a5fa"
            label={t('export.google.title')}
            desc={t('export.google.desc')}
            onPress={handleGoogle}
          />
          <ExportRow
            icon={FileDown}
            iconColor="#4ade80"
            label={t('export.ics.title')}
            desc={t('export.ics.desc')}
            onPress={handleICS}
            isLast
          />
        </View>

        <View style={s.section}>
          <Text style={s.sectionLabel}>{t('export.document')}</Text>
          <ExportRow
            icon={FileText}
            iconColor={colors.gold}
            label={t('export.pdf.title')}
            desc={t('export.pdf.desc')}
            onPress={handlePdf}
            isLast
          />
        </View>
      </ScrollView>
    </BottomSheet>
  );
}

function ExportRow({ icon: Icon, iconColor, label, desc, onPress, isLast }: {
  icon: LucideIcon; iconColor: string; label: string; desc: string; onPress: () => void; isLast?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.row, pressed && s.rowPressed, !isLast && s.rowBorder]}
    >
      <View style={[s.iconWrap, { backgroundColor: `${iconColor}15` }]}>
        <Icon size={18} color={iconColor} />
      </View>
      <View style={s.rowContent}>
        <Text style={s.rowLabel}>{label}</Text>
        <Text style={s.rowDesc}>{desc}</Text>
      </View>
      <ChevronRight size={16} color={colors.textDim} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  content: {
    padding: 20,
    gap: 18,
  },
  title: {
    color: colors.text,
    fontSize: 20,
    fontFamily: fonts.display,
  },
  section: {
    borderRadius: 16,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
  },
  sectionLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontFamily: fonts.sansBold,
    letterSpacing: 1.5,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  rowPressed: {
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.04)',
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowContent: { flex: 1, gap: 1 },
  rowLabel: { color: colors.text, fontSize: 14, fontFamily: fonts.sansSemiBold },
  rowDesc: { color: colors.textMuted, fontSize: 11, fontFamily: fonts.sans },
});
