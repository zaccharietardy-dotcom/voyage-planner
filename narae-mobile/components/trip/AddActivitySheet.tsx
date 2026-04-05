import { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, FlatList } from 'react-native';
import { Plus, Search, Clock, DollarSign, FileText, Tag, MapPin, Star } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { colors, fonts, radius } from '@/lib/theme';
import type { TripItem, TripItemType, Trip } from '@/lib/types/trip';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (item: Omit<TripItem, 'id' | 'orderIndex'>, dayNumber: number) => void;
  trip: Trip;
  targetDay: number;
}

const TYPES: { key: TripItemType; label: string }[] = [
  { key: 'activity', label: 'Activité' },
  { key: 'restaurant', label: 'Restaurant' },
  { key: 'hotel', label: 'Hébergement' },
  { key: 'free_time', label: 'Temps libre' },
];

type Tab = 'pool' | 'manual';

export function AddActivitySheet({ isOpen, onClose, onAdd, trip, targetDay }: Props) {
  const [tab, setTab] = useState<Tab>('pool');
  const [search, setSearch] = useState('');

  // Manual form state
  const [title, setTitle] = useState('');
  const [type, setType] = useState<TripItemType>('activity');
  const [description, setDescription] = useState('');
  const [startTime, setStartTime] = useState('');
  const [duration, setDuration] = useState('60');
  const [cost, setCost] = useState('');
  const [locationName, setLocationName] = useState('');

  const pool = (trip.attractionPool ?? []) as any[];
  const filteredPool = search
    ? pool.filter((a: any) => a.name?.toLowerCase().includes(search.toLowerCase()))
    : pool;

  const handleAddFromPool = (attraction: any) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onAdd({
      dayNumber: targetDay,
      title: attraction.name || 'Activité',
      type: attraction.type || 'activity',
      description: attraction.description || '',
      startTime: '10:00',
      endTime: '11:00',
      duration: attraction.duration || 60,
      locationName: attraction.address || attraction.locationName || '',
      latitude: attraction.latitude || 0,
      longitude: attraction.longitude || 0,
      estimatedCost: attraction.estimatedCost || attraction.cost,
      rating: attraction.rating,
      imageUrl: attraction.imageUrl,
      googleMapsPlaceUrl: attraction.googleMapsUrl,
    }, targetDay);
    onClose();
    resetForm();
  };

  const handleAddManual = () => {
    if (!title.trim()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const dur = parseInt(duration, 10) || 60;
    const [h, m] = (startTime || '10:00').split(':').map(Number);
    const endH = h + Math.floor((m + dur) / 60);
    const endM = (m + dur) % 60;

    onAdd({
      dayNumber: targetDay,
      title: title.trim(),
      type,
      description: description.trim(),
      startTime: startTime || '10:00',
      endTime: `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`,
      duration: dur,
      locationName: locationName.trim(),
      latitude: 0,
      longitude: 0,
      estimatedCost: parseFloat(cost) || undefined,
    }, targetDay);
    onClose();
    resetForm();
  };

  const resetForm = () => {
    setTitle('');
    setType('activity');
    setDescription('');
    setStartTime('');
    setDuration('60');
    setCost('');
    setLocationName('');
    setSearch('');
  };

  return (
    <BottomSheet isOpen={isOpen} onClose={() => { onClose(); resetForm(); }} height={0.85}>
      <View style={{ flex: 1, padding: 20, gap: 16 }}>
        <Text style={{ color: colors.text, fontSize: 20, fontFamily: fonts.display }}>
          Ajouter au Jour {targetDay}
        </Text>

        {/* Tab pills */}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {([['pool', 'Pool'], ['manual', 'Manuel']] as [Tab, string][]).map(([key, label]) => (
            <Pressable
              key={key}
              onPress={() => { Haptics.selectionAsync(); setTab(key); }}
              style={{
                flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center',
                backgroundColor: tab === key ? colors.gold : colors.surface,
                borderWidth: 1, borderColor: tab === key ? colors.gold : colors.borderSubtle,
              }}
            >
              <Text style={{ color: tab === key ? '#000' : colors.textSecondary, fontSize: 13, fontFamily: fonts.sansBold }}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>

        {tab === 'pool' ? (
          <>
            {/* Search */}
            <View style={{
              flexDirection: 'row', alignItems: 'center', gap: 10,
              backgroundColor: colors.surface, borderRadius: radius.lg,
              paddingHorizontal: 14, borderWidth: 1, borderColor: colors.borderSubtle,
            }}>
              <Search size={16} color={colors.textMuted} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                style={{ flex: 1, paddingVertical: 12, color: colors.text, fontSize: 14 }}
                placeholderTextColor={colors.textMuted}
                placeholder="Rechercher dans le pool..."
              />
            </View>

            {filteredPool.length === 0 ? (
              <View style={{ alignItems: 'center', paddingVertical: 40 }}>
                <Text style={{ color: colors.textMuted, fontSize: 14, fontFamily: fonts.sans }}>
                  {pool.length === 0 ? 'Aucune activité dans le pool' : 'Aucun résultat'}
                </Text>
              </View>
            ) : (
              <FlatList
                data={filteredPool}
                keyExtractor={(item, i) => item.id || String(i)}
                contentContainerStyle={{ gap: 8, paddingBottom: 20 }}
                renderItem={({ item: attraction }) => (
                  <Pressable
                    onPress={() => handleAddFromPool(attraction)}
                    style={({ pressed }) => ({
                      flexDirection: 'row', alignItems: 'center', gap: 12,
                      backgroundColor: pressed ? 'rgba(255,255,255,0.06)' : colors.surface,
                      borderRadius: radius.lg, padding: 14,
                      borderWidth: 1, borderColor: colors.borderSubtle,
                    })}
                  >
                    <View style={{
                      width: 44, height: 44, borderRadius: 12,
                      backgroundColor: colors.goldBg, alignItems: 'center', justifyContent: 'center',
                    }}>
                      <MapPin size={20} color={colors.gold} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.text, fontSize: 14, fontFamily: fonts.sansBold }} numberOfLines={1}>
                        {attraction.name}
                      </Text>
                      <View style={{ flexDirection: 'row', gap: 8, marginTop: 2 }}>
                        {attraction.rating ? (
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                            <Star size={10} color={colors.gold} fill={colors.gold} />
                            <Text style={{ color: colors.textSecondary, fontSize: 11 }}>{attraction.rating.toFixed(1)}</Text>
                          </View>
                        ) : null}
                        {attraction.duration ? (
                          <Text style={{ color: colors.textMuted, fontSize: 11 }}>{attraction.duration} min</Text>
                        ) : null}
                        {attraction.estimatedCost || attraction.cost ? (
                          <Text style={{ color: colors.textMuted, fontSize: 11 }}>{attraction.estimatedCost || attraction.cost}€</Text>
                        ) : null}
                      </View>
                    </View>
                    <View style={{
                      width: 32, height: 32, borderRadius: 10,
                      backgroundColor: colors.goldBg, alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Plus size={16} color={colors.gold} />
                    </View>
                  </Pressable>
                )}
              />
            )}
          </>
        ) : (
          <ScrollView contentContainerStyle={{ gap: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
            {/* Title */}
            <View style={{ gap: 6 }}>
              <Label icon={FileText} text="Titre" />
              <TextInput value={title} onChangeText={setTitle} style={inputStyle} placeholderTextColor={colors.textMuted} placeholder="Nom de l'activité" />
            </View>

            {/* Type */}
            <View style={{ gap: 6 }}>
              <Label icon={Tag} text="Type" />
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
            </View>

            {/* Location */}
            <View style={{ gap: 6 }}>
              <Label icon={MapPin} text="Lieu" />
              <TextInput value={locationName} onChangeText={setLocationName} style={inputStyle} placeholderTextColor={colors.textMuted} placeholder="Adresse ou nom" />
            </View>

            {/* Time + Duration */}
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1, gap: 6 }}>
                <Label icon={Clock} text="Heure" />
                <TextInput value={startTime} onChangeText={setStartTime} style={inputStyle} placeholderTextColor={colors.textMuted} placeholder="10:00" keyboardType="numbers-and-punctuation" />
              </View>
              <View style={{ flex: 1, gap: 6 }}>
                <Label icon={Clock} text="Durée (min)" />
                <TextInput value={duration} onChangeText={setDuration} style={inputStyle} placeholderTextColor={colors.textMuted} placeholder="60" keyboardType="numeric" />
              </View>
            </View>

            {/* Cost */}
            <View style={{ gap: 6 }}>
              <Label icon={DollarSign} text="Coût (€)" />
              <TextInput value={cost} onChangeText={setCost} style={inputStyle} placeholderTextColor={colors.textMuted} placeholder="0" keyboardType="numeric" />
            </View>

            {/* Description */}
            <View style={{ gap: 6 }}>
              <Label icon={FileText} text="Description" />
              <TextInput value={description} onChangeText={setDescription} style={[inputStyle, { minHeight: 70, textAlignVertical: 'top' }]} placeholderTextColor={colors.textMuted} placeholder="Notes..." multiline />
            </View>

            {/* Add button */}
            <Pressable onPress={handleAddManual} style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
              backgroundColor: colors.gold, borderRadius: radius.lg, paddingVertical: 16, marginTop: 8,
            }}>
              <Plus size={18} color="#000" />
              <Text style={{ color: '#000', fontSize: 14, fontFamily: fonts.sansBold }}>Ajouter au Jour {targetDay}</Text>
            </Pressable>
          </ScrollView>
        )}
      </View>
    </BottomSheet>
  );
}

function Label({ icon: Icon, text }: { icon: typeof Clock; text: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Icon size={13} color={colors.gold} />
      <Text style={{ color: colors.textSecondary, fontSize: 11, fontFamily: fonts.sansBold, textTransform: 'uppercase', letterSpacing: 1 }}>{text}</Text>
    </View>
  );
}

const inputStyle = {
  backgroundColor: colors.surface,
  borderRadius: radius.lg,
  borderWidth: 1,
  borderColor: colors.borderSubtle,
  paddingHorizontal: 16,
  paddingVertical: 13,
  color: colors.text,
  fontSize: 15,
  fontFamily: 'Inter-Regular',
} as const;
