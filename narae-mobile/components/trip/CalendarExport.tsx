import { View, Text, Pressable, Alert, Linking } from 'react-native';
import { CalendarPlus, Apple, Globe, FileDown } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { colors, fonts, radius } from '@/lib/theme';
import { exportTripToAppleCalendar } from '@/lib/calendar';
import { shareICSFile } from '@/lib/ics';
import type { Trip } from '@/lib/types/trip';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  trip: Trip;
}

export function CalendarExport({ isOpen, onClose, trip }: Props) {
  const handleApple = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const count = await exportTripToAppleCalendar(trip);
      onClose();
      if (count > 0) {
        Alert.alert('Exporté !', `${count} événement${count > 1 ? 's' : ''} ajouté${count > 1 ? 's' : ''} à votre calendrier Apple.`);
      }
    } catch (e) {
      Alert.alert('Erreur', 'Impossible d\'exporter vers Apple Calendar');
    }
  };

  const handleGoogle = () => {
    Haptics.selectionAsync();
    // Open first day's first activity in Google Calendar as example
    const firstItem = trip.days?.[0]?.items?.[0];
    const firstDay = trip.days?.[0];
    if (firstItem && firstDay) {
      const { getGoogleCalendarUrl } = require('@/lib/calendar');
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
      Alert.alert('Erreur', 'Impossible de générer le fichier .ics');
    }
  };

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} height={0.42}>
      <View style={{ padding: 20, gap: 12 }}>
        <Text style={{ color: colors.text, fontSize: 18, fontFamily: fonts.display, marginBottom: 4 }}>
          Ajouter au calendrier
        </Text>
        <Text style={{ color: colors.textMuted, fontSize: 13, marginBottom: 8 }}>
          Exportez votre itinéraire vers votre calendrier
        </Text>

        <ExportOption
          icon={Apple}
          label="Apple Calendar"
          desc="Ajoute tous les événements dans votre calendrier iOS"
          onPress={handleApple}
        />
        <ExportOption
          icon={Globe}
          label="Google Calendar"
          desc="Ouvre Google Calendar avec l'itinéraire"
          onPress={handleGoogle}
        />
        <ExportOption
          icon={FileDown}
          label="Fichier .ics"
          desc="Téléchargez un fichier compatible tous calendriers"
          onPress={handleICS}
        />
      </View>
    </BottomSheet>
  );
}

function ExportOption({ icon: Icon, label, desc, onPress }: {
  icon: typeof Apple; label: string; desc: string; onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: 14,
        backgroundColor: pressed ? 'rgba(255,255,255,0.06)' : colors.surface,
        borderRadius: radius.xl, padding: 16,
        borderWidth: 1, borderColor: colors.borderSubtle,
      })}
    >
      <View style={{
        width: 42, height: 42, borderRadius: 14,
        backgroundColor: colors.goldBg,
        alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon size={20} color={colors.gold} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.text, fontSize: 15, fontWeight: '700' }}>{label}</Text>
        <Text style={{ color: colors.textMuted, fontSize: 11, marginTop: 2 }}>{desc}</Text>
      </View>
    </Pressable>
  );
}
