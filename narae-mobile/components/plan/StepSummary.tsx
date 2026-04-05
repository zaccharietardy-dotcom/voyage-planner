import { useState, useEffect } from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Pencil, Users, Wallet, Compass } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { colors, fonts, goldGradient } from '@/lib/theme';
import {
  BUDGET_LABELS, GROUP_TYPE_LABELS,
  type TripPreferences, type ActivityType,
} from '@/lib/types/trip';

interface Props {
  prefs: Partial<TripPreferences>;
  onEdit: (step: number) => void;
  onGenerate: () => void;
  isGenerating: boolean;
}

// Activity display labels matching web (short uppercase)
const ACTIVITY_DISPLAY: Record<string, string> = {
  culture: 'Culture',
  nature: 'Nature',
  gastronomy: 'Foodie',
  adventure: 'Aventure',
  beach: 'Plage',
  shopping: 'Shopping',
  nightlife: 'Nightlife',
  wellness: 'Wellness',
};

const PRESET_IMAGES: Record<string, string> = {
  'Paris': 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=1200&h=600&fit=crop',
  'New York': 'https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?w=1200&h=600&fit=crop',
  'Barcelona': 'https://images.unsplash.com/photo-1583422409516-2895a77efded?w=1200&h=600&fit=crop',
  'Tokyo': 'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=1200&h=600&fit=crop',
  'Rome': 'https://images.unsplash.com/photo-1552832230-c0197dd311b5?w=1200&h=600&fit=crop',
  'Amsterdam': 'https://images.unsplash.com/photo-1534351590666-13e3e96b5017?w=1200&h=600&fit=crop',
  'Lisbonne': 'https://images.unsplash.com/photo-1585208798174-6cedd86e019a?w=1200&h=600&fit=crop',
  'Marrakech': 'https://images.unsplash.com/photo-1597212618440-806262de4f6b?w=1200&h=600&fit=crop',
  'London': 'https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=1200&h=600&fit=crop',
  'Nice': 'https://images.unsplash.com/photo-1491166617655-0723a0999cfc?w=1200&h=600&fit=crop',
};

function getFallbackImage(destination?: string): string {
  if (!destination) return 'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=1200&h=600&fit=crop';
  for (const [city, url] of Object.entries(PRESET_IMAGES)) {
    if (destination.toLowerCase().includes(city.toLowerCase())) return url;
  }
  return 'https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?w=1200&h=600&fit=crop';
}

export function StepSummary({ prefs, onEdit, onGenerate, isGenerating }: Props) {
  const destination = prefs.destination || '';
  const [imageUrl, setImageUrl] = useState<string>(getFallbackImage(destination));
  const [imageLoading, setImageLoading] = useState(true);

  useEffect(() => {
    if (!destination) { setImageLoading(false); return; }

    const fetchImage = async () => {
      setImageLoading(true);
      try {
        const lang = /paris|lyon|marseille|bordeaux|nice|strasbourg|lille|toulouse|nantes|montpellier|annecy|marrakech|tunis|bruxelles|genève|québec|montréal/i.test(destination) ? 'fr' : 'en';
        const title = encodeURIComponent(destination.replace(/ /g, '_'));
        const res = await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${title}`);
        if (!res.ok) { setImageLoading(false); return; }
        const json = await res.json();
        if (json.thumbnail?.source) {
          setImageUrl(json.thumbnail.source.replace(/\/\d+px-/, '/1000px-'));
        }
      } catch { /* fallback */ } finally { setImageLoading(false); }
    };

    let hasPreset = false;
    for (const city of Object.keys(PRESET_IMAGES)) {
      if (destination.toLowerCase().includes(city.toLowerCase())) hasPreset = true;
    }
    if (!hasPreset) { fetchImage(); } else { setImageUrl(getFallbackImage(destination)); setImageLoading(false); }
  }, [destination]);

  const handleEdit = (step: number) => { Haptics.selectionAsync(); onEdit(step); };

  const dateStr = prefs.startDate
    ? new Date(prefs.startDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
    : '';

  return (
    <View style={{ gap: 20 }}>
      {/* Hero Card — matches web rounded-[2rem] aspect-[2/1] */}
      <Pressable onPress={() => handleEdit(0)} style={s.heroCard}>
        <Image
          source={{ uri: imageUrl }}
          style={[StyleSheet.absoluteFillObject, { opacity: imageLoading ? 0 : 1 }]}
          contentFit="cover"
          transition={300}
          onLoadEnd={() => setImageLoading(false)}
        />
        {imageLoading && (
          <View style={{ ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center' }}>
            <ActivityIndicator color={colors.gold} />
          </View>
        )}
        <LinearGradient
          colors={['transparent', 'rgba(2,6,23,0.5)', '#020617']}
          style={StyleSheet.absoluteFillObject}
        />
        <View style={s.heroContent}>
          <Text style={s.heroTitle}>{destination || 'Destination'}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
            <View style={s.durationBadge}>
              <Text style={s.durationBadgeText}>{prefs.durationDays || 3} jours</Text>
            </View>
            {!!dateStr && (
              <Text style={s.heroDate}>· {dateStr}</Text>
            )}
            <View style={{ flex: 1, alignItems: 'flex-end' }}>
              <Pencil size={14} color="rgba(255,255,255,0.5)" />
            </View>
          </View>
        </View>
      </Pressable>

      {/* Summary cards — matches web grid-cols-2 gap-4 */}
      <View style={{ flexDirection: 'row', gap: 16 }}>
        <Pressable onPress={() => handleEdit(3)} style={s.summaryCard}>
          <View style={[s.summaryIcon, { backgroundColor: 'rgba(59,130,246,0.1)' }]}>
            <Users size={18} color="#60A5FA" />
          </View>
          <Text style={s.summaryLabel}>GROUPE</Text>
          <Text style={s.summaryValue}>
            {GROUP_TYPE_LABELS[prefs.groupType ?? 'couple'].replace(/\s*[\p{Emoji_Presentation}\p{Extended_Pictographic}]+$/u, '')} ({prefs.groupSize})
          </Text>
        </Pressable>

        <Pressable onPress={() => handleEdit(5)} style={s.summaryCard}>
          <View style={[s.summaryIcon, { backgroundColor: 'rgba(34,197,94,0.1)' }]}>
            <Wallet size={18} color="#4ADE80" />
          </View>
          <Text style={s.summaryLabel}>CONFORT</Text>
          <Text style={s.summaryValue}>
            {BUDGET_LABELS[prefs.budgetLevel ?? 'moderate']?.label}
          </Text>
        </Pressable>
      </View>

      {/* Activity tags — matches web rounded-full bg-gold/10 text-gold border-gold/20 */}
      <Pressable onPress={() => handleEdit(4)} style={s.tagRow}>
        {prefs.activities?.map((act) => (
          <View key={act} style={s.tag}>
            <Text style={s.tagText}>
              {ACTIVITY_DISPLAY[act] || act}
            </Text>
          </View>
        ))}
      </Pressable>

      {/* Generate button — matches web h-16 rounded-[2rem] bg-gold-gradient */}
      <Pressable
        onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onGenerate(); }}
        disabled={isGenerating}
        style={{ marginTop: 8 }}
      >
        <LinearGradient colors={[...goldGradient]} style={s.generateButton}>
          {isGenerating ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Compass size={22} color="#000" />
          )}
          <Text style={s.generateText}>
            {isGenerating ? 'Création de l\'itinéraire...' : 'Générer mon voyage'}
          </Text>
        </LinearGradient>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  // Hero — matches web rounded-[2rem] aspect-[2/1] with gradient
  heroCard: {
    height: 200,
    borderRadius: 32,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.5,
    shadowRadius: 50,
  },
  heroContent: {
    position: 'absolute',
    bottom: 20,
    left: 24,
    right: 24,
  },
  heroTitle: {
    color: colors.text,
    fontSize: 32,
    fontFamily: fonts.display,
    letterSpacing: -0.5,
    textShadowColor: 'rgba(0,0,0,0.8)',
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 20,
  },
  durationBadge: {
    backgroundColor: 'rgba(197,160,89,0.2)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 8,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: 'rgba(197,160,89,0.3)',
  },
  durationBadgeText: {
    color: colors.gold,
    fontSize: 12,
    fontFamily: fonts.sansBold,
  },
  heroDate: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 14,
    fontFamily: fonts.sansSemiBold,
  },
  // Summary cards — matches web p-5 rounded-[1.5rem] bg-white/[0.03]
  summaryCard: {
    flex: 1,
    padding: 20,
    borderRadius: 24,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    gap: 8,
  },
  summaryIcon: {
    width: 40,
    height: 40,
    borderRadius: 16,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryLabel: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 10,
    fontFamily: fonts.sansBold,
    letterSpacing: 2,
  },
  summaryValue: {
    color: colors.text,
    fontSize: 15,
    fontFamily: fonts.sansBold,
  },
  // Tags — matches web rounded-full text-[11px] bg-gold/10 text-gold border-gold/20
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  tag: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(197,160,89,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(197,160,89,0.2)',
  },
  tagText: {
    color: colors.gold,
    fontSize: 11,
    fontFamily: fonts.sansBold,
    textTransform: 'uppercase',
    letterSpacing: 2,
  },
  // Generate button — matches web h-16 rounded-[2rem] bg-gold-gradient
  generateButton: {
    height: 64,
    borderRadius: 32,
    borderCurve: 'continuous',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    shadowColor: '#c5a059',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 30,
  },
  generateText: {
    color: '#000',
    fontSize: 18,
    fontFamily: fonts.sansBold,
  },
});
