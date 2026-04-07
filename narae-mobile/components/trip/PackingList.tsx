import { useState, useEffect, useCallback } from 'react';
import { View, Text, Pressable, TextInput, SectionList, StyleSheet } from 'react-native';
import { Check, Plus, Luggage } from 'lucide-react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import { colors, fonts, radius } from '@/lib/theme';
import { useTranslation } from '@/lib/i18n';

interface PackingItem {
  id: string;
  label: string;
  checked: boolean;
}

interface PackingCategory {
  title: string;
  emoji: string;
  data: PackingItem[];
}

interface Props {
  tripId: string;
  packingItems?: string[]; // from trip.travelTips.packing
}

export function PackingList({ tripId, packingItems }: Props) {
  const { t } = useTranslation();

  const DEFAULT_CATEGORIES: { title: string; emoji: string; items: string[] }[] = [
    { title: t('packing.category.essentials'), emoji: '🎒', items: [t('packing.item.passport'), t('packing.item.tickets'), t('packing.item.card'), t('packing.item.phone'), t('packing.item.insurance')] },
    { title: t('packing.category.clothes'), emoji: '👕', items: [t('packing.item.tshirts'), t('packing.item.pants'), t('packing.item.underwear'), t('packing.item.shoes'), t('packing.item.jacket')] },
    { title: t('packing.category.hygiene'), emoji: '🧴', items: [t('packing.item.toothbrush'), t('packing.item.shampoo'), t('packing.item.sunscreen'), t('packing.item.deodorant')] },
    { title: t('packing.category.electronics'), emoji: '📱', items: [t('packing.item.adapter'), t('packing.item.powerbank'), t('packing.item.headphones'), t('packing.item.camera')] },
    { title: t('packing.category.health'), emoji: '💊', items: [t('packing.item.medications'), t('packing.item.firstaid'), t('packing.item.masks')] },
  ];

  function buildCategories(items?: string[]): PackingCategory[] {
    if (items && items.length > 0) {
      return [{
        title: t('packing.category.tripItems'),
        emoji: '🎒',
        data: items.map((item, i) => ({ id: `trip-${i}`, label: item, checked: false })),
      }];
    }
    return DEFAULT_CATEGORIES.map((cat) => ({
      title: cat.title,
      emoji: cat.emoji,
      data: cat.items.map((item, i) => ({ id: `${cat.title}-${i}`, label: item, checked: false })),
    }));
  }
  const storageKey = `@narae/packing/${tripId}`;
  const [categories, setCategories] = useState<PackingCategory[]>(() => buildCategories(packingItems));
  const [newItem, setNewItem] = useState('');

  // Load saved state
  useEffect(() => {
    AsyncStorage.getItem(storageKey).then((saved) => {
      if (!saved) return;
      const checkedIds: string[] = JSON.parse(saved);
      setCategories((prev) =>
        prev.map((cat) => ({
          ...cat,
          data: cat.data.map((item) => ({ ...item, checked: checkedIds.includes(item.id) })),
        })),
      );
    }).catch(() => {});
  }, [storageKey]);

  const saveState = useCallback((cats: PackingCategory[]) => {
    const checkedIds = cats.flatMap((c) => c.data.filter((i) => i.checked).map((i) => i.id));
    AsyncStorage.setItem(storageKey, JSON.stringify(checkedIds)).catch(() => {});
  }, [storageKey]);

  const toggleItem = (categoryIndex: number, itemId: string) => {
    Haptics.selectionAsync();
    setCategories((prev) => {
      const next = prev.map((cat, ci) => {
        if (ci !== categoryIndex) return cat;
        return {
          ...cat,
          data: cat.data.map((item) =>
            item.id === itemId ? { ...item, checked: !item.checked } : item,
          ),
        };
      });
      saveState(next);
      return next;
    });
  };

  const addItem = () => {
    if (!newItem.trim()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCategories((prev) => {
      const next = [...prev];
      const lastCat = next[next.length - 1];
      lastCat.data = [...lastCat.data, { id: `custom-${Date.now()}`, label: newItem.trim(), checked: false }];
      return next;
    });
    setNewItem('');
  };

  const totalItems = categories.reduce((s, c) => s + c.data.length, 0);
  const checkedItems = categories.reduce((s, c) => s + c.data.filter((i) => i.checked).length, 0);
  const progress = totalItems > 0 ? checkedItems / totalItems : 0;

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Luggage size={18} color={colors.gold} />
        <Text style={s.title}>{t('packing.title')}</Text>
        <Text style={s.count}>{checkedItems}/{totalItems}</Text>
      </View>

      {/* Progress bar */}
      <View style={s.progressTrack}>
        <View style={[s.progressFill, { width: `${progress * 100}%` }]} />
      </View>

      <SectionList
        sections={categories}
        keyExtractor={(item) => item.id}
        scrollEnabled={false}
        renderSectionHeader={({ section }) => (
          <View style={s.sectionHeader}>
            <Text style={s.sectionEmoji}>{section.emoji}</Text>
            <Text style={s.sectionTitle}>{section.title}</Text>
          </View>
        )}
        renderItem={({ item, section }) => {
          const catIndex = categories.indexOf(section);
          return (
            <Pressable onPress={() => toggleItem(catIndex, item.id)} style={s.itemRow}>
              <View style={[s.checkbox, item.checked && s.checkboxChecked]}>
                {item.checked ? <Check size={12} color={colors.bg} /> : null}
              </View>
              <Text style={[s.itemText, item.checked && s.itemTextChecked]}>{item.label}</Text>
            </Pressable>
          );
        }}
      />

      {/* Add custom item */}
      <View style={s.addRow}>
        <TextInput
          style={s.addInput}
          placeholder={t('packing.addItem')}
          placeholderTextColor={colors.textMuted}
          value={newItem}
          onChangeText={setNewItem}
          onSubmitEditing={addItem}
        />
        <Pressable onPress={addItem} style={s.addBtn}>
          <Plus size={16} color={colors.gold} />
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { color: colors.text, fontSize: 16, fontFamily: fonts.sansBold, flex: 1 },
  count: { color: colors.gold, fontSize: 13, fontFamily: fonts.sansBold },
  progressTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: colors.gold,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingTop: 12,
    paddingBottom: 6,
  },
  sectionEmoji: { fontSize: 14 },
  sectionTitle: { color: colors.textSecondary, fontSize: 12, fontFamily: fonts.sansBold, textTransform: 'uppercase', letterSpacing: 1 },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: colors.gold,
    borderColor: colors.gold,
  },
  itemText: {
    color: colors.text,
    fontSize: 14,
    fontFamily: fonts.sans,
    flex: 1,
  },
  itemTextChecked: {
    color: colors.textMuted,
    textDecorationLine: 'line-through',
  },
  addRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  addInput: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    fontFamily: fonts.sans,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
