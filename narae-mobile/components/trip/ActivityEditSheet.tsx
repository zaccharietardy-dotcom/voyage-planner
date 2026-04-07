import { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Alert } from 'react-native';
import { Save, Trash2, Clock, DollarSign, FileText, Tag, MapPin } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { colors, fonts, radius } from '@/lib/theme';
import type { TripItem, TripItemType } from '@/lib/types/trip';
import { useTranslation } from '@/lib/i18n';

interface Props {
  item: TripItem | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updated: TripItem) => void;
  onDelete: (id: string) => void;
}

export function ActivityEditSheet({ item, isOpen, onClose, onSave, onDelete }: Props) {
  const { t } = useTranslation();

  const TYPES: { key: TripItemType; label: string }[] = [
    { key: 'activity', label: t('activity.type.activity') },
    { key: 'restaurant', label: t('activity.type.restaurant') },
    { key: 'hotel', label: t('activity.type.hotel') },
    { key: 'transport', label: t('activity.type.transport') },
    { key: 'flight', label: t('activity.type.flight') },
    { key: 'free_time', label: t('activity.type.free_time') },
  ];
  const [title, setTitle] = useState('');
  const [type, setType] = useState<TripItemType>('activity');
  const [description, setDescription] = useState('');
  const [startTime, setStartTime] = useState('');
  const [duration, setDuration] = useState('');
  const [cost, setCost] = useState('');
  const [locationName, setLocationName] = useState('');

  // Sync state when item changes
  const resetForm = () => {
    if (!item) return;
    setTitle(item.title);
    setType(item.type);
    setDescription(item.description || '');
    setStartTime(item.startTime || '');
    setDuration(item.duration?.toString() || '');
    setCost(item.estimatedCost?.toString() || '');
    setLocationName(item.locationName || '');
  };

  // Reset form when sheet opens with a new item
  if (isOpen && item && title === '' && item.title !== '') {
    resetForm();
  }

  const handleSave = () => {
    if (!item || !title.trim()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const durationMin = parseInt(duration, 10) || item.duration || 60;
    const [h, m] = startTime.split(':').map(Number);
    const endH = h + Math.floor((m + durationMin) / 60);
    const endM = (m + durationMin) % 60;
    const endTime = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;

    onSave({
      ...item,
      title: title.trim(),
      type,
      description: description.trim(),
      startTime,
      endTime,
      duration: durationMin,
      estimatedCost: parseFloat(cost) || undefined,
      locationName: locationName.trim(),
    });
    onClose();
  };

  const handleDelete = () => {
    if (!item) return;
    Alert.alert(
      t('activity.edit.delete'),
      t('activity.edit.deleteConfirm', { title: item.title }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: () => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
            onDelete(item.id);
            onClose();
          },
        },
      ],
    );
  };

  const handleClose = () => {
    setTitle('');
    setType('activity');
    setDescription('');
    setStartTime('');
    setDuration('');
    setCost('');
    setLocationName('');
    onClose();
  };

  if (!item) return null;

  return (
    <BottomSheet isOpen={isOpen} onClose={handleClose} height={0.85}>
      <ScrollView contentContainerStyle={{ padding: 20, gap: 20, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Text style={{ color: colors.text, fontSize: 20, fontFamily: fonts.display }}>
          {t('activity.edit.title')}
        </Text>

        {/* Title */}
        <Field label={t('activity.edit.field.title')} icon={FileText}>
          <TextInput
            value={title}
            onChangeText={setTitle}
            style={inputStyle}
            placeholderTextColor={colors.textMuted}
            placeholder={t('activity.edit.field.title.placeholder')}
          />
        </Field>

        {/* Type pills */}
        <Field label={t('activity.edit.field.type')} icon={Tag}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {TYPES.map((t) => (
              <Pressable
                key={t.key}
                onPress={() => { Haptics.selectionAsync(); setType(t.key); }}
                style={{
                  paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10,
                  backgroundColor: type === t.key ? colors.gold : colors.surface,
                  borderWidth: 1, borderColor: type === t.key ? colors.gold : colors.borderSubtle,
                }}
              >
                <Text style={{ color: type === t.key ? '#000' : colors.textSecondary, fontSize: 12, fontFamily: fonts.sansBold }}>
                  {t.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </Field>

        {/* Location */}
        <Field label={t('activity.edit.field.location')} icon={MapPin}>
          <TextInput
            value={locationName}
            onChangeText={setLocationName}
            style={inputStyle}
            placeholderTextColor={colors.textMuted}
            placeholder={t('activity.edit.field.location.placeholder')}
          />
        </Field>

        {/* Time + Duration row */}
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Field label={t('activity.edit.field.time')} icon={Clock}>
              <TextInput
                value={startTime}
                onChangeText={setStartTime}
                style={inputStyle}
                placeholderTextColor={colors.textMuted}
                placeholder="09:00"
                keyboardType="numbers-and-punctuation"
              />
            </Field>
          </View>
          <View style={{ flex: 1 }}>
            <Field label={t('activity.edit.field.duration')} icon={Clock}>
              <TextInput
                value={duration}
                onChangeText={setDuration}
                style={inputStyle}
                placeholderTextColor={colors.textMuted}
                placeholder="60"
                keyboardType="numeric"
              />
            </Field>
          </View>
        </View>

        {/* Cost */}
        <Field label={t('activity.edit.field.cost')} icon={DollarSign}>
          <TextInput
            value={cost}
            onChangeText={setCost}
            style={inputStyle}
            placeholderTextColor={colors.textMuted}
            placeholder="0"
            keyboardType="numeric"
          />
        </Field>

        {/* Description */}
        <Field label={t('activity.edit.field.description')} icon={FileText}>
          <TextInput
            value={description}
            onChangeText={setDescription}
            style={[inputStyle, { minHeight: 80, textAlignVertical: 'top' }]}
            placeholderTextColor={colors.textMuted}
            placeholder={t('activity.edit.field.description.placeholder')}
            multiline
          />
        </Field>

        {/* Actions */}
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 8 }}>
          <Pressable onPress={handleDelete} style={deleteButtonStyle}>
            <Trash2 size={18} color={colors.danger} />
            <Text style={{ color: colors.danger, fontSize: 14, fontFamily: fonts.sansBold }}>{t('activity.edit.delete')}</Text>
          </Pressable>
          <Pressable onPress={handleSave} style={saveButtonStyle}>
            <Save size={18} color="#000" />
            <Text style={{ color: '#000', fontSize: 14, fontFamily: fonts.sansBold }}>{t('activity.edit.save')}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </BottomSheet>
  );
}

function Field({ label, icon: Icon, children }: { label: string; icon: typeof Clock; children: React.ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Icon size={14} color={colors.gold} />
        <Text style={{ color: colors.textSecondary, fontSize: 11, fontFamily: fonts.sansBold, textTransform: 'uppercase', letterSpacing: 1.2 }}>
          {label}
        </Text>
      </View>
      {children}
    </View>
  );
}

const inputStyle = {
  backgroundColor: colors.surface,
  borderRadius: radius.lg,
  borderWidth: 1,
  borderColor: colors.borderSubtle,
  paddingHorizontal: 16,
  paddingVertical: 14,
  color: colors.text,
  fontSize: 15,
  fontFamily: 'Inter-Regular',
} as const;

const saveButtonStyle = {
  flex: 1,
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
  gap: 8,
  backgroundColor: colors.gold,
  borderRadius: radius.lg,
  paddingVertical: 16,
};

const deleteButtonStyle = {
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
  gap: 8,
  backgroundColor: 'rgba(239,68,68,0.1)',
  borderRadius: radius.lg,
  paddingVertical: 16,
  paddingHorizontal: 20,
  borderWidth: 1,
  borderColor: 'rgba(239,68,68,0.2)',
};
