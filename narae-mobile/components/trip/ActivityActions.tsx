import { View, Text, Pressable, Alert } from 'react-native';
import { Edit3, Trash2, ArrowUpDown, Repeat } from 'lucide-react-native';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { colors, fonts, radius } from '@/lib/theme';
import type { TripItem } from '@/lib/types/trip';

interface Props {
  item: TripItem | null;
  isOpen: boolean;
  onClose: () => void;
  onDelete?: (id: string) => void;
  onSwapRestaurant?: (item: TripItem) => void;
}

export function ActivityActions({ item, isOpen, onClose, onDelete, onSwapRestaurant }: Props) {
  if (!item) return null;

  const actions = [
    {
      icon: Edit3,
      label: 'Modifier les horaires',
      color: colors.gold,
      onPress: () => {
        onClose();
        Alert.alert('Modifier', 'Fonctionnalité disponible prochainement');
      },
    },
    ...(item.type === 'restaurant' && item.restaurantAlternatives?.length
      ? [{
          icon: Repeat,
          label: 'Voir les alternatives',
          color: colors.restaurant,
          onPress: () => { onClose(); onSwapRestaurant?.(item); },
        }]
      : []),
    {
      icon: ArrowUpDown,
      label: 'Déplacer à un autre jour',
      color: colors.upcoming,
      onPress: () => {
        onClose();
        Alert.alert('Déplacer', 'Fonctionnalité disponible prochainement');
      },
    },
    {
      icon: Trash2,
      label: 'Supprimer',
      color: colors.danger,
      onPress: () => {
        onClose();
        Alert.alert(
          'Supprimer',
          `Retirer "${item.title}" de l'itinéraire ?`,
          [
            { text: 'Annuler', style: 'cancel' },
            { text: 'Supprimer', style: 'destructive', onPress: () => onDelete?.(item.id) },
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
