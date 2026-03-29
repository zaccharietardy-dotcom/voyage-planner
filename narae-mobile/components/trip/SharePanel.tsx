import { View, Text, Pressable, Share, Alert } from 'react-native';
import { Link2, Globe, Lock, Users, Copy, Share2 } from 'lucide-react-native';
import * as Clipboard from 'expo-linking';
import { colors, fonts, radius } from '@/lib/theme';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  tripId: string;
  destination: string;
  visibility: 'public' | 'friends' | 'private';
  onVisibilityChange?: (v: 'public' | 'friends' | 'private') => void;
}

const VISIBILITY_OPTIONS = [
  { value: 'private' as const, label: 'Privé', desc: 'Visible uniquement par vous', icon: Lock },
  { value: 'friends' as const, label: 'Amis', desc: 'Visible par vos abonnés', icon: Users },
  { value: 'public' as const, label: 'Public', desc: 'Visible par tous sur Explorer', icon: Globe },
];

export function SharePanel({ isOpen, onClose, tripId, destination, visibility, onVisibilityChange }: Props) {
  const shareUrl = `https://naraevoyage.com/trip/${tripId}`;

  const handleCopyLink = () => {
    // Copy to clipboard via Share API
    Share.share({ message: shareUrl });
  };

  const handleNativeShare = async () => {
    try {
      await Share.share({
        message: `Découvre mon voyage à ${destination} sur Narae Voyage !\n${shareUrl}`,
      });
    } catch {}
  };

  return (
    <BottomSheet isOpen={isOpen} onClose={onClose} height={0.55}>
      <View style={{ padding: 20, gap: 20 }}>
        <Text style={{ color: colors.text, fontSize: 18, fontFamily: fonts.display }}>
          Partager
        </Text>

        {/* Visibility selector */}
        <View style={{ gap: 8 }}>
          <Text style={{ color: colors.textMuted, fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1 }}>
            Visibilité
          </Text>
          {VISIBILITY_OPTIONS.map((opt) => {
            const selected = visibility === opt.value;
            return (
              <Pressable
                key={opt.value}
                onPress={() => onVisibilityChange?.(opt.value)}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 12,
                  backgroundColor: selected ? colors.goldBg : colors.surface,
                  borderRadius: radius.lg, padding: 14,
                  borderWidth: 1, borderColor: selected ? colors.goldBorder : colors.borderSubtle,
                }}
              >
                <opt.icon size={18} color={selected ? colors.gold : colors.textMuted} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: selected ? colors.gold : colors.text, fontSize: 14, fontWeight: '600' }}>
                    {opt.label}
                  </Text>
                  <Text style={{ color: colors.textMuted, fontSize: 11 }}>{opt.desc}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        {/* Share actions */}
        <View style={{ gap: 10 }}>
          <Button icon={Link2} variant="outline" onPress={handleCopyLink}>
            Copier le lien
          </Button>
          <Button icon={Share2} onPress={handleNativeShare}>
            Partager
          </Button>
        </View>
      </View>
    </BottomSheet>
  );
}
