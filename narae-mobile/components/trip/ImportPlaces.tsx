import { useState } from 'react';
import { View, Text, TextInput, Pressable, FlatList, ActivityIndicator, StyleSheet } from 'react-native';
import { MapPin, Plus, Check, Globe } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { api } from '@/lib/api/client';
import { colors, fonts, radius } from '@/lib/theme';

interface ImportedPlace {
  name: string;
  city?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  category?: string;
}

interface Props {
  onImport: (places: ImportedPlace[]) => void;
  onClose: () => void;
}

type Source = 'url' | 'text';

export function ImportPlaces({ onImport, onClose }: Props) {
  const [source, setSource] = useState<Source>('url');
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [places, setPlaces] = useState<(ImportedPlace & { selected: boolean })[]>([]);
  const [error, setError] = useState<string | null>(null);

  const handleAnalyze = async () => {
    if (!input.trim() || loading) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setLoading(true);
    setError(null);
    try {
      const body = source === 'url' ? { url: input.trim() } : { text: input.trim() };
      const res = await api.post<{ places: ImportedPlace[] }>('/api/import/social', body);
      setPlaces((res.places ?? []).map((p) => ({ ...p, selected: true })));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur d\'import');
    }
    setLoading(false);
  };

  const togglePlace = (index: number) => {
    setPlaces((prev) => prev.map((p, i) => (i === index ? { ...p, selected: !p.selected } : p)));
  };

  const handleImport = () => {
    const selected = places.filter((p) => p.selected);
    if (selected.length === 0) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onImport(selected);
  };

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Globe size={20} color={colors.gold} />
        <Text style={s.title}>Importer des lieux</Text>
      </View>

      <View style={s.sourceTabs}>
        <Pressable
          onPress={() => setSource('url')}
          style={[s.sourceTab, source === 'url' && s.sourceTabActive]}
        >
          <Text style={[s.sourceTabText, source === 'url' && s.sourceTabTextActive]}>URL</Text>
        </Pressable>
        <Pressable
          onPress={() => setSource('text')}
          style={[s.sourceTab, source === 'text' && s.sourceTabActive]}
        >
          <Text style={[s.sourceTabText, source === 'text' && s.sourceTabTextActive]}>Texte</Text>
        </Pressable>
      </View>

      <TextInput
        style={source === 'text' ? s.textArea : s.input}
        placeholder={source === 'url'
          ? 'Lien Instagram, TikTok, Google Maps...'
          : 'Collez une liste de lieux, un article de blog...'}
        placeholderTextColor={colors.textMuted}
        value={input}
        onChangeText={setInput}
        multiline={source === 'text'}
        numberOfLines={source === 'text' ? 4 : 1}
        textAlignVertical={source === 'text' ? 'top' : 'center'}
        autoCapitalize="none"
      />

      {places.length === 0 ? (
        <Pressable
          onPress={handleAnalyze}
          disabled={!input.trim() || loading}
          style={[s.btn, input.trim() ? s.btnActive : null]}
        >
          {loading ? (
            <ActivityIndicator size="small" color={colors.bg} />
          ) : (
            <Text style={s.btnText}>Analyser</Text>
          )}
        </Pressable>
      ) : null}

      {error ? <Text style={s.error}>{error}</Text> : null}

      {places.length > 0 ? (
        <>
          <Text style={s.resultsTitle}>{places.filter((p) => p.selected).length} lieux sélectionnés</Text>
          <FlatList
            data={places}
            keyExtractor={(_, i) => String(i)}
            style={{ maxHeight: 200 }}
            renderItem={({ item, index }) => (
              <Pressable onPress={() => togglePlace(index)} style={s.placeRow}>
                <View style={[s.checkbox, item.selected && s.checkboxActive]}>
                  {item.selected ? <Check size={12} color={colors.bg} /> : null}
                </View>
                <MapPin size={14} color={colors.textMuted} />
                <View style={{ flex: 1 }}>
                  <Text style={s.placeName}>{item.name}</Text>
                  {item.city ? <Text style={s.placeMeta}>{item.city}{item.country ? `, ${item.country}` : ''}</Text> : null}
                </View>
              </Pressable>
            )}
          />
          <Pressable onPress={handleImport} style={[s.btn, s.btnActive]}>
            <Plus size={16} color={colors.bg} />
            <Text style={s.btnText}>Ajouter au pool</Text>
          </Pressable>
        </>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  container: { gap: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { color: colors.text, fontSize: 17, fontFamily: fonts.display },
  sourceTabs: { flexDirection: 'row', gap: 8 },
  sourceTab: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  sourceTabActive: { backgroundColor: colors.goldBg, borderColor: 'rgba(197,160,89,0.2)' },
  sourceTabText: { color: colors.textMuted, fontSize: 13, fontFamily: fonts.sansBold },
  sourceTabTextActive: { color: colors.gold },
  input: {
    color: colors.text,
    fontSize: 14,
    fontFamily: fonts.sans,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  textArea: {
    color: colors.text,
    fontSize: 13,
    fontFamily: fonts.sans,
    minHeight: 80,
    padding: 14,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  btnActive: { backgroundColor: colors.gold },
  btnText: { color: colors.bg, fontSize: 15, fontFamily: fonts.sansBold },
  error: { color: '#f87171', fontSize: 12, fontFamily: fonts.sans },
  resultsTitle: { color: colors.textSecondary, fontSize: 13, fontFamily: fonts.sansSemiBold },
  placeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.04)',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxActive: { backgroundColor: colors.gold, borderColor: colors.gold },
  placeName: { color: colors.text, fontSize: 13, fontFamily: fonts.sansSemiBold },
  placeMeta: { color: colors.textMuted, fontSize: 11, fontFamily: fonts.sans },
});
