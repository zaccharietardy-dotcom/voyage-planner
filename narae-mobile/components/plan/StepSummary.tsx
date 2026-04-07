import { useState, useEffect } from 'react';
import { View, Text, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Pencil, Users, Wallet, Compass } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { colors, fonts, goldGradient } from '@/lib/theme';
import { useTranslation } from '@/lib/i18n';
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

const CACHE_KEY_PREFIX = 'dest_img_';
const BAD_IMAGE_KEYWORDS = ['flag', 'drapeau', 'blason', 'coat_of_arms', 'armoiries', 'logo', 'emblem', 'banner', 'gwenn', 'seal_of', 'escudo', 'wappen', 'bandiera', 'carte_', 'map_of', 'location_'];

interface WikiSummaryPayload {
  originalimage?: { source?: string };
  thumbnail?: { source?: string };
}

interface NominatimRegionResult {
  boundingbox?: string[];
  name?: string;
  display_name?: string;
}

async function getCachedImage(destination: string): Promise<string | null> {
  try {
    const key = CACHE_KEY_PREFIX + destination.toLowerCase();
    const cached = await AsyncStorage.getItem(key);
    // Invalidate old bad caches (desert photo, flags, etc.)
    if (cached && (cached.includes('unsplash.com') || BAD_IMAGE_KEYWORDS.some(kw => cached.toLowerCase().includes(kw)))) {
      await AsyncStorage.removeItem(key);
      return null;
    }
    return cached;
  } catch { return null; }
}

async function setCachedImage(destination: string, url: string): Promise<void> {
  try {
    await AsyncStorage.setItem(CACHE_KEY_PREFIX + destination.toLowerCase(), url);
  } catch { /* ignore */ }
}

async function clearCachedImage(destination: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(CACHE_KEY_PREFIX + destination.toLowerCase());
  } catch { /* ignore */ }
}

function isGoodImage(url: string): boolean {
  const lower = url.toLowerCase();
  return !BAD_IMAGE_KEYWORDS.some(kw => lower.includes(kw));
}

function extractWikiImage(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null;
  const payload = json as WikiSummaryPayload;
  const imgUrl = payload.originalimage?.source || payload.thumbnail?.source;
  if (!imgUrl || !isGoodImage(imgUrl)) return null;
  return imgUrl.includes('/thumb/') ? imgUrl.replace(/\/\d+px-/, '/1200px-') : imgUrl;
}

/**
 * Multi-strategy image fetch. Tries in order:
 * 1. Wikipedia fr/en for exact destination name
 * 2. Wikipedia "Tourisme_en_{destination}"
 * 3. Nominatim → find the biggest city in the region → Wikipedia for that city
 * 4. null (caller shows gradient placeholder, NOT a random photo)
 */
async function fetchDestinationImage(destination: string): Promise<string | null> {
  const encodedTitle = encodeURIComponent(destination.replace(/ /g, '_'));

  // Strategy 1: Direct Wikipedia fr + en
  for (const lang of ['fr', 'en']) {
    try {
      const res = await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodedTitle}`);
      if (!res.ok) continue;
      const img = extractWikiImage(await res.json());
      if (img) return img;
    } catch { continue; }
  }

  // Strategy 2: "Tourisme en {destination}" (fr Wikipedia)
  try {
    const res = await fetch(`https://fr.wikipedia.org/api/rest_v1/page/summary/Tourisme_en_${encodedTitle}`);
    if (res.ok) {
      const img = extractWikiImage(await res.json());
      if (img) return img;
    }
  } catch { /* ignore */ }

  // Strategy 3: Find the main city in the region via Nominatim, then get its Wikipedia image
  try {
    const nRes = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(destination)}&format=json&limit=1`,
      { headers: { 'User-Agent': 'NaraeVoyage/1.0' } },
    );
    if (nRes.ok) {
      const rawResults: unknown = await nRes.json();
      const results = Array.isArray(rawResults) ? (rawResults as NominatimRegionResult[]) : [];
      if (results.length > 0 && Array.isArray(results[0].boundingbox)) {
        const [south, north, west, east] = results[0].boundingbox || [];
        if (!south || !north || !west || !east) return null;
        // Search for cities in the bounding box
        const cityRes = await fetch(
          `https://nominatim.openstreetmap.org/search?q=city&format=json&limit=3&bounded=1&viewbox=${west},${north},${east},${south}&featuretype=city`,
          { headers: { 'User-Agent': 'NaraeVoyage/1.0' } },
        );
        if (cityRes.ok) {
          const rawCities: unknown = await cityRes.json();
          const cities = Array.isArray(rawCities) ? (rawCities as NominatimRegionResult[]) : [];
          // Try Wikipedia for each city until we get a good image
          for (const city of cities) {
            const cityName = city.name || city.display_name?.split(',')[0];
            if (!cityName) continue;
            try {
              const wRes = await fetch(`https://fr.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(cityName)}`);
              if (!wRes.ok) continue;
              const img = extractWikiImage(await wRes.json());
              if (img) return img;
            } catch { continue; }
          }
        }
      }
    }
  } catch { /* ignore */ }

  return null; // No fallback photo — caller shows gradient
}

export function StepSummary({ prefs, onEdit, onGenerate, isGenerating }: Props) {
  const { t } = useTranslation();
  const destination = prefs.destination || '';
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageLoading, setImageLoading] = useState(true);

  useEffect(() => {
    if (!destination) { setImageLoading(false); return; }
    let cancelled = false;

    (async () => {
      setImageLoading(true);

      // 1. Check AsyncStorage cache
      const cached = await getCachedImage(destination);
      if (cached && !cancelled) {
        setImageUrl(cached);
        setImageLoading(false);
        return;
      }

      // 2. Multi-strategy fetch (Wikipedia → Nominatim city → null)
      const url = await fetchDestinationImage(destination);
      if (!cancelled) {
        setImageUrl(url); // null = gradient placeholder
        if (url) await setCachedImage(destination, url);
        setImageLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [destination]);

  const handleEdit = (step: number) => { Haptics.selectionAsync(); onEdit(step); };

  const dateStr = prefs.startDate
    ? new Date(prefs.startDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
    : '';

  return (
    <View style={{ gap: 20 }}>
      {/* Hero Card — matches web rounded-[2rem] aspect-[2/1] */}
      <Pressable onPress={() => handleEdit(0)} style={s.heroCard}>
        {imageUrl ? (
          <Image
            source={{ uri: imageUrl }}
            style={[StyleSheet.absoluteFillObject, { opacity: imageLoading ? 0 : 1 }]}
            contentFit="cover"
            transition={300}
            onLoadEnd={() => setImageLoading(false)}
            onError={() => {
              void clearCachedImage(destination);
              setImageUrl(null);
              setImageLoading(false);
            }}
          />
        ) : (
          <LinearGradient
            colors={['#1a2744', '#0d1b2a', '#020617']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFillObject}
          />
        )}
        {imageLoading && imageUrl && (
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
              <Text style={s.durationBadgeText}>{prefs.durationDays || 3} {t('plan.summary.days')}</Text>
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
          <Text style={s.summaryLabel}>{t('plan.summary.group')}</Text>
          <Text style={s.summaryValue}>
            {GROUP_TYPE_LABELS[prefs.groupType ?? 'couple'].replace(/\s*[\p{Emoji_Presentation}\p{Extended_Pictographic}]+$/u, '')} ({prefs.groupSize})
          </Text>
        </Pressable>

        <Pressable onPress={() => handleEdit(5)} style={s.summaryCard}>
          <View style={[s.summaryIcon, { backgroundColor: 'rgba(34,197,94,0.1)' }]}>
            <Wallet size={18} color="#4ADE80" />
          </View>
          <Text style={s.summaryLabel}>{t('plan.summary.budget')}</Text>
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
            {isGenerating ? t('plan.summary.generating') : t('plan.summary.generate')}
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
