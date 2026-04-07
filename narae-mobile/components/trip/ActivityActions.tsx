import { View, Text, Pressable, Alert } from 'react-native';
import { Edit3, Trash2, ArrowUpDown, Repeat, Calendar } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { colors, fonts, radius } from '@/lib/theme';
import type { TripItem } from '@/lib/types/trip';
import { useTranslation } from '@/lib/i18n';

interface Props {
  item: TripItem | null;
  isOpen: boolean;
  onClose: () => void;
  onEdit?: (item: TripItem) => void;
  onDelete?: (id: string) => void;
  onMove?: (item: TripItem) => void;
  onSwapRestaurant?: (item: TripItem) => void;
  availableDays?: number[];
}

export function ActivityActions({ item, isOpen, onClose, onEdit, onDelete, onMove, onSwapRestaurant, availableDays }: Props) {
  const { t } = useTranslation();

  if (!item) return null;

  const actions = [
    {
      icon: Edit3,
      label: t('activity.actions.edit'),
      color: colors.gold,
      onPress: () => {
        onClose();
        Haptics.selectionAsync();
        onEdit?.(item);
      },
    },
    ...(item.type === 'restaurant' && item.restaurantAlternatives?.length
      ? [{
          icon: Repeat,
          label: t('activity.actions.alternatives'),
          color: colors.restaurant,
          onPress: () => { onClose(); onSwapRestaurant?.(item); },
        }]
      : []),
    {
      icon: ArrowUpDown,
      label: t('activity.actions.move'),
      color: colors.upcoming,
      onPress: () => {
        onClose();
        Haptics.selectionAsync();
        if (onMove) {
          onMove(item);
        }
      },
    },
    {
      icon: Trash2,
      label: t('activity.actions.delete'),
      color: colors.danger,
      onPress: () => {
        onClose();
        Alert.alert(
          t('activity.actions.delete'),
          t('activity.actions.deleteConfirm', { title: item.title }),
          [
            { text: t('common.cancel'), style: 'cancel' },
            {
              text: t('common.delete'),
              style: 'destructive',
              onPress: () => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                onDelete?.(item.id);
              },
            },
          ],
        );
      },
    },
  ];

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} height={0.4}>
      <View style={{ padding: 20, gap: 8 }}>
        <Text style={{ color: colors.text, fontSize: 17, fontFamily: fonts.display, marginBottom: 8 }}>
          {item.title}
        </Text>
        {actions.map((action) => (
          <Pressable
            key={action.label}
            onPress={action.onPress}
            style={({ pressed }) => ({
              flexDirection: 'row', alignItems: 'center', gap: 14,
              backgroundColor: pressed ? 'rgba(255,255,255,0.05)' : colors.surface,
              borderRadius: radius.lg, padding: 14,
              borderWidth: 1, borderColor: colors.borderSubtle,
            })}
          >
            <View style={{
              width: 36, height: 36, borderRadius: 10,
              backgroundColor: `${action.color}15`,
              alignItems: 'center', justifyContent: 'center',
            }}>
              <action.icon size={18} color={action.color} />
            </View>
            <Text style={{ color: action.color === colors.danger ? colors.danger : colors.text, fontSize: 14, fontWeight: '600' }}>
              {action.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </BottomSheet>
  );
}

// Separate sheet for moving to another day
interface MoveDayProps {
  item: TripItem | null;
  isOpen: boolean;
  onClose: () => void;
  onMoveToDay: (item: TripItem, dayNumber: number) => void;
  availableDays: number[];
}

export function MoveToDaySheet({ item, isOpen, onClose, onMoveToDay, availableDays }: MoveDayProps) {
  const { t } = useTranslation();

  if (!item) return null;

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} height={0.45}>
      <View style={{ padding: 20, gap: 12 }}>
        <Text style={{ color: colors.text, fontSize: 18, fontFamily: fonts.display }}>
          {t('activity.actions.moveTitle')}
        </Text>
        <Text style={{ color: colors.textMuted, fontSize: 13, marginBottom: 8 }}>
          {item.title}
        </Text>
        {availableDays.map((day) => (
          <Pressable
            key={day}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              onMoveToDay(item, day);
              onClose();
            }}
            disabled={day === item.dayNumber}
            style={({ pressed }) => ({
              flexDirection: 'row', alignItems: 'center', gap: 12,
              backgroundColor: day === item.dayNumber ? 'rgba(197,160,89,0.1)' : pressed ? 'rgba(255,255,255,0.05)' : colors.surface,
              borderRadius: radius.lg, padding: 14,
              borderWidth: 1,
              borderColor: day === item.dayNumber ? colors.gold : colors.borderSubtle,
              opacity: day === item.dayNumber ? 0.5 : 1,
            })}
          >
            <View style={{
              width: 36, height: 36, borderRadius: 10,
              backgroundColor: day === item.dayNumber ? colors.goldBg : colors.surface,
              alignItems: 'center', justifyContent: 'center',
              borderWidth: 1, borderColor: colors.borderSubtle,
            }}>
              <Calendar size={16} color={day === item.dayNumber ? colors.gold : colors.textSecondary} />
            </View>
            <Text style={{ color: day === item.dayNumber ? colors.gold : colors.text, fontSize: 14, fontFamily: fonts.sansBold }}>
              {t('trip.day', { n: day })}{day === item.dayNumber ? ` ${t('activity.actions.moveCurrent')}` : ''}
            </Text>
          </Pressable>
        ))}
      </View>
    </BottomSheet>
  );
}
