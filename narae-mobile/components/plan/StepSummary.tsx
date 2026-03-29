import { useState, useEffect } from 'react';
import { View, Text, Pressable, Image, ActivityIndicator } from 'react-native';
import { Pencil, Users, Wallet, Compass } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { Button } from '@/components/ui/Button';
import { colors, fonts } from '@/lib/theme';
import {
  BUDGET_LABELS, GROUP_TYPE_LABELS, ACTIVITY_LABELS,
  type TripPreferences, type ActivityType,
} from '@/lib/types/trip';

interface Props {
  prefs: Partial<TripPreferences>;
  onEdit: (step: number) => void;
  onGenerate: () => void;
  isGenerating: boolean;
}

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
  'Annecy': 'https://images.unsplash.com/photo-1558231011-3e91760cbb34?w=1200&h=600&fit=crop',
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
    if (!destination) {
      setImageLoading(false);
      return;
    }

    const fetchImage = async () => {
      setImageLoading(true);
      try {
        const lang = /paris|lyon|marseille|bordeaux|nice|strasbourg|lille|toulouse|nantes|montpellier|annecy|marrakech|tunis|bruxelles|genève|québec|montréal/i.test(destination) ? 'fr' : 'en';
        const title = encodeURIComponent(destination.replace(/ /g, '_'));
        const res = await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${title}`);
        if (!res.ok) {
          setImageLoading(false);
          return;
        }
        const json = await res.json();
        if (json.thumbnail?.source) {
          const betterUrl = json.thumbnail.source.replace(/\/\d+px-/, '/1000px-');
          setImageUrl(betterUrl);
        }
      } catch (e) {
        // Fallback already set
      } finally {
        setImageLoading(false);
      }
    };

    let hasPreset = false;
    for (const city of Object.keys(PRESET_IMAGES)) {
      if (destination.toLowerCase().includes(city.toLowerCase())) hasPreset = true;
    }

    if (!hasPreset) {
      fetchImage();
    } else {
      setImageUrl(getFallbackImage(destination));
      setImageLoading(false);
    }
  }, [destination]);

  const handleEdit = (step: number) => {
    Haptics.selectionAsync();
    onEdit(step);
  };

  const dateStr = prefs.startDate
    ? new Date(prefs.startDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
    : '';

  return (
    <View style={{ gap: 20 }}>
      <View>
        <Text style={{ color: colors.text, fontSize: 24, fontFamily: fonts.display, marginBottom: 4 }}>
          Résumé
        </Text>
        <Text style={{ color: colors.textMuted, fontSize: 14 }}>
          Vérifiez et lancez la génération
        </Text>
      </View>

      {/* Hero Destination Card */}
      <Pressable 
        onPress={() => handleEdit(0)}
        style={{
          height: 200,
          borderRadius: 24,
          overflow: 'hidden',
          backgroundColor: '#1E293B',
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.1)',
        }}
      >
        <Image
          source={{ uri: imageUrl }}
          style={{ width: '100%', height: '100%', opacity: imageLoading ? 0 : 1 }}
          onLoadEnd={() => setImageLoading(false)}
        />
        {imageLoading && (
          <View style={{ position: 'absolute', inset: 0, justifyContent: 'center', alignItems: 'center' }}>
            <ActivityIndicator color={colors.gold} />
          </View>
        )}
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.5)', 'rgba(0,0,0,0.95)']}
          style={{ position: 'absolute', inset: 0 }}
        />
        <View style={{ position: 'absolute', bottom: 16, left: 20, right: 20 }}>
          <Text style={{ color: 'white', fontSize: 28, fontFamily: fonts.display, fontWeight: 'bold' }}>
            {destination || 'Destination'}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <View style={{ backgroundColor: 'rgba(197,160,89,0.2)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(197,160,89,0.3)' }}>
              <Text style={{ color: 'white', fontSize: 13, fontWeight: 'bold' }}>
                {prefs.durationDays || 3} jours
              </Text>
            </View>
            {!!dateStr && (
              <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 13, fontWeight: '600' }}>
                · {dateStr}
              </Text>
            )}
            <View style={{ flex: 1, alignItems: 'flex-end' }}>
              <Pencil size={14} color="rgba(255,255,255,0.5)" />
            </View>
          </View>
        </View>
      </Pressable>

      {/* Visual Cards (Group & Budget) */}
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Pressable 
          onPress={() => handleEdit(2)}
          style={{
            flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12,
            backgroundColor: 'rgba(255,255,255,0.04)', padding: 14, borderRadius: 20,
            borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)'
          }}
        >
          <View style={{ backgroundColor: 'rgba(59,130,246,0.15)', padding: 10, borderRadius: 50 }}>
            <Users size={18} color="#60A5FA" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.textMuted, fontSize: 10, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 1 }}>Groupe</Text>
            <Text style={{ color: 'white', fontSize: 13, fontWeight: '600', marginTop: 2 }}>
              {GROUP_TYPE_LABELS[prefs.groupType ?? 'couple']} ({prefs.groupSize})
            </Text>
          </View>
        </Pressable>

        <Pressable 
          onPress={() => handleEdit(4)}
          style={{
            flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12,
            backgroundColor: 'rgba(255,255,255,0.04)', padding: 14, borderRadius: 20,
            borderWidth: 1, borderColor: 'rgba(255,255,255,0.05)'
          }}
        >
          <View style={{ backgroundColor: 'rgba(34,197,94,0.15)', padding: 10, borderRadius: 50 }}>
            <Wallet size={18} color="#4ADE80" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.textMuted, fontSize: 10, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 1 }}>Confort</Text>
            <Text style={{ color: 'white', fontSize: 13, fontWeight: '600', marginTop: 2 }}>
              {BUDGET_LABELS[prefs.budgetLevel ?? 'moderate']?.label}
            </Text>
          </View>
        </Pressable>
      </View>

      {/* Activities Chips */}
      <Pressable onPress={() => handleEdit(3)} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {prefs.activities?.map((act) => (
          <View key={act} style={{ 
            backgroundColor: 'rgba(197,160,89,0.1)', paddingHorizontal: 12, paddingVertical: 6, 
            borderRadius: 20, borderWidth: 1, borderColor: 'rgba(197,160,89,0.2)' 
          }}>
            <Text style={{ color: colors.gold, fontSize: 11, fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {ACTIVITY_LABELS[act as ActivityType] || act}
            </Text>
          </View>
        ))}
      </Pressable>

      <View style={{ marginTop: 10 }}>
        <Button 
          icon={isGenerating ? undefined : Compass} 
          isLoading={isGenerating} 
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onGenerate(); }}
          style={{ height: 56, borderRadius: 20 }}
        >
          {isGenerating ? 'Création de l\'itinéraire...' : 'Générer mon voyage'}
        </Button>
      </View>
    </View>
  );
}
