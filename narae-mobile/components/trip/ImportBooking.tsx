import { useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { FileText, Check, AlertTriangle } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { api } from '@/lib/api/client';
import { colors, fonts, radius } from '@/lib/theme';

interface ParsedBooking {
  type: 'flight' | 'hotel' | 'activity' | 'transport';
  name: string;
  confirmationCode?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  address?: string;
  price?: number;
  currency?: string;
  airline?: string;
  flightNumber?: string;
  hotelName?: string;
}

interface Props {
  onImport: (booking: ParsedBooking) => void;
  onClose: () => void;
}

export function ImportBooking({ onImport, onClose }: Props) {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ParsedBooking | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleAnalyze = async () => {
    if (!text.trim() || loading) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.post<ParsedBooking>('/api/import/booking', { text: text.trim() });
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Impossible d\'analyser cette réservation');
    }
    setLoading(false);
  };

  return (
    <View style={s.container}>
      <View style={s.header}>
        <FileText size={20} color={colors.gold} />
        <Text style={s.title}>Importer une réservation</Text>
      </View>

      <Text style={s.hint}>
        Collez le texte de votre email de confirmation (vol, hôtel, activité).
      </Text>

      <TextInput
        style={s.textArea}
        placeholder="Collez votre confirmation ici..."
        placeholderTextColor={colors.textMuted}
        value={text}
        onChangeText={setText}
        multiline
        numberOfLines={6}
        textAlignVertical="top"
      />

      {!result ? (
        <Pressable
          onPress={handleAnalyze}
          disabled={!text.trim() || loading}
          style={[s.btn, text.trim() ? s.btnActive : null]}
        >
          {loading ? (
            <ActivityIndicator size="small" color={colors.bg} />
          ) : (
            <Text style={s.btnText}>Analyser</Text>
          )}
        </Pressable>
      ) : null}

      {error ? (
        <View style={s.errorRow}>
          <AlertTriangle size={14} color="#f87171" />
          <Text style={s.errorText}>{error}</Text>
        </View>
      ) : null}

      {result ? (
        <View style={s.resultCard}>
          <Text style={s.resultType}>{result.type.toUpperCase()}</Text>
          <Text style={s.resultName}>{result.name}</Text>
          {result.date ? <Text style={s.resultMeta}>Date : {result.date}</Text> : null}
          {result.price ? <Text style={s.resultMeta}>Prix : {result.price} {result.currency || '€'}</Text> : null}
          {result.confirmationCode ? <Text style={s.resultMeta}>Réf : {result.confirmationCode}</Text> : null}

          <View style={s.resultActions}>
            <Pressable
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onImport(result); }}
              style={s.importBtn}
            >
              <Check size={16} color={colors.bg} />
              <Text style={s.importBtnText}>Ajouter au voyage</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  container: { gap: 14 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  title: { color: colors.text, fontSize: 17, fontFamily: fonts.display },
  hint: { color: colors.textSecondary, fontSize: 13, fontFamily: fonts.sans, lineHeight: 20 },
  textArea: {
    color: colors.text,
    fontSize: 13,
    fontFamily: fonts.sans,
    minHeight: 120,
    padding: 14,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  btn: {
    paddingVertical: 14,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
  },
  btnActive: { backgroundColor: colors.gold },
  btnText: { color: colors.bg, fontSize: 15, fontFamily: fonts.sansBold },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  errorText: { color: '#f87171', fontSize: 12, fontFamily: fonts.sans },
  resultCard: {
    padding: 16,
    borderRadius: radius.card,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(197,160,89,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(197,160,89,0.2)',
    gap: 6,
  },
  resultType: { color: colors.gold, fontSize: 10, fontFamily: fonts.sansBold, letterSpacing: 1.5 },
  resultName: { color: colors.text, fontSize: 16, fontFamily: fonts.sansBold },
  resultMeta: { color: colors.textSecondary, fontSize: 12, fontFamily: fonts.sans },
  resultActions: { marginTop: 8 },
  importBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: radius.lg,
    borderCurve: 'continuous',
    backgroundColor: colors.gold,
  },
  importBtnText: { color: colors.bg, fontSize: 14, fontFamily: fonts.sansBold },
});
