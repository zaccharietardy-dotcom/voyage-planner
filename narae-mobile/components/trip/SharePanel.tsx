import { useMemo, useState } from 'react';
import { View, Text, Pressable, Share, Alert, StyleSheet } from 'react-native';
import { Link2, Globe, Lock, Users, Share2, ChevronDown, UserPlus } from 'lucide-react-native';
import { colors, fonts, radius } from '@/lib/theme';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { SelectionSheet, type SelectionSheetOption } from '@/components/ui/SelectionSheet';
import { UserSearch } from '@/components/social/UserSearch';
import { useTranslation } from '@/lib/i18n';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  tripId: string;
  destination: string;
  visibility: 'public' | 'friends' | 'private';
  onVisibilityChange?: (v: 'public' | 'friends' | 'private') => void;
}

export function SharePanel({ isOpen, onClose, tripId, destination, visibility, onVisibilityChange }: Props) {
  const [visibilityOpen, setVisibilityOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const { t } = useTranslation();

  const VISIBILITY_OPTIONS = [
    { value: 'private' as const, label: t('share.visibility.private'), desc: t('share.visibility.private.desc'), icon: Lock },
    { value: 'friends' as const, label: t('share.visibility.friends'), desc: t('share.visibility.friends.desc'), icon: Users },
    { value: 'public' as const, label: t('share.visibility.public'), desc: t('share.visibility.public.desc'), icon: Globe },
  ];
  const shareUrl = `https://naraevoyage.com/trip/${tripId}`;
  const selectedVisibility = useMemo(
    () => VISIBILITY_OPTIONS.find((option) => option.value === visibility) || VISIBILITY_OPTIONS[0],
    [visibility],
  );
  const sheetOptions: SelectionSheetOption[] = VISIBILITY_OPTIONS.map((option) => ({
    value: option.value,
    label: option.label,
    description: option.desc,
    searchText: `${option.label} ${option.desc}`,
  }));

  const handleCopyLink = async () => {
    try {
      await Share.share({ message: shareUrl });
      Alert.alert(t('share.copyLink.success'), shareUrl);
    } catch {}
  };

  const handleNativeShare = async () => {
    try {
      await Share.share({
        message: `${t('share.message', { destination })}\n${shareUrl}`,
      });
    } catch {}
  };

  return (
    <>
      <BottomSheet isOpen={isOpen} onClose={onClose} height={0.62}>
        <View style={styles.content}>
          <Text style={styles.title}>{t('share.title')}</Text>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{t('share.visibility.label')}</Text>
            <Pressable onPress={() => setVisibilityOpen(true)} style={styles.visibilityCard}>
              <View style={styles.visibilityIcon}>
                <selectedVisibility.icon size={18} color={colors.gold} />
              </View>
              <View style={styles.visibilityCopy}>
                <Text style={styles.visibilityTitle}>{selectedVisibility.label}</Text>
                <Text style={styles.visibilityDescription}>{selectedVisibility.desc}</Text>
              </View>
              <ChevronDown size={16} color={colors.textMuted} />
            </Pressable>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>{t('share.collaborators')}</Text>
            <Button icon={UserPlus} variant="outline" onPress={() => setInviteOpen(true)}>
              {t('share.invite')}
            </Button>
          </View>

          <View style={styles.actions}>
            <Button icon={Link2} variant="outline" onPress={handleCopyLink}>
              {t('share.copyLink')}
            </Button>
            <Button icon={Share2} onPress={handleNativeShare}>
              {t('share.share')}
            </Button>
          </View>
        </View>
      </BottomSheet>

      <BottomSheet isOpen={inviteOpen} onClose={() => setInviteOpen(false)} height={0.7}>
        <UserSearch onClose={() => setInviteOpen(false)} />
      </BottomSheet>

      <SelectionSheet
        isOpen={visibilityOpen}
        onClose={() => setVisibilityOpen(false)}
        title={t('share.visibility.title')}
        subtitle={t('share.visibility.subtitle')}
        options={sheetOptions}
        selectedValue={visibility}
        onSelect={(value) => onVisibilityChange?.(value as 'public' | 'friends' | 'private')}
        renderOption={(option, { selected }) => {
          const current = VISIBILITY_OPTIONS.find((entry) => entry.value === option.value) || VISIBILITY_OPTIONS[0];
          return (
            <View style={styles.optionRow}>
              <current.icon size={18} color={selected ? colors.gold : colors.textMuted} />
              <View style={styles.optionCopy}>
                <Text style={[styles.optionTitle, selected ? styles.optionTitleSelected : null]}>
                  {current.label}
                </Text>
                <Text style={styles.optionDescription}>{current.desc}</Text>
              </View>
            </View>
          );
        }}
      />
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: 20,
    gap: 20,
  },
  title: {
    color: colors.text,
    fontSize: 22,
    fontFamily: fonts.display,
  },
  section: {
    gap: 8,
  },
  sectionLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontFamily: fonts.sansBold,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
  },
  visibilityCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(10,17,40,0.92)',
    borderRadius: radius.card,
    borderCurve: 'continuous',
    padding: 16,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  visibilityIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    borderCurve: 'continuous',
    backgroundColor: colors.goldBg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  visibilityCopy: {
    flex: 1,
    gap: 2,
  },
  visibilityTitle: {
    color: colors.text,
    fontSize: 14,
    fontFamily: fonts.sansSemiBold,
  },
  visibilityDescription: {
    color: colors.textMuted,
    fontSize: 11,
    fontFamily: fonts.sans,
  },
  actions: {
    gap: 10,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  optionCopy: {
    flex: 1,
    gap: 2,
  },
  optionTitle: {
    color: colors.text,
    fontSize: 14,
    fontFamily: fonts.sansSemiBold,
  },
  optionTitleSelected: {
    color: colors.gold,
  },
  optionDescription: {
    color: colors.textMuted,
    fontSize: 11,
    fontFamily: fonts.sans,
  },
});
