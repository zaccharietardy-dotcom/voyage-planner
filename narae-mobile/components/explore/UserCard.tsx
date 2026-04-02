import { Text, Pressable } from 'react-native';
import { Avatar } from '@/components/ui/Avatar';
import { colors, radius } from '@/lib/theme';

interface Props {
  user: {
    id: string;
    display_name: string;
    avatar_url: string | null;
    trip_count?: number;
  };
  onPress: () => void;
  onFollow?: () => void;
  isFollowing?: boolean;
}

export function UserCard({ user, onPress, onFollow, isFollowing }: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        width: 140, alignItems: 'center', gap: 10,
        backgroundColor: colors.card, borderRadius: radius['3xl'],
        padding: 16, borderWidth: 1, borderColor: colors.borderSubtle,
      }}
    >
      <Avatar url={user.avatar_url} name={user.display_name} size="md" />
      <Text style={{ color: colors.text, fontSize: 13, fontWeight: '600', textAlign: 'center' }} numberOfLines={1}>
        {user.display_name}
      </Text>
      {user.trip_count !== undefined && (
        <Text style={{ color: colors.textMuted, fontSize: 11 }}>
          {user.trip_count} voyage{user.trip_count !== 1 ? 's' : ''}
        </Text>
      )}
      {onFollow && (
        <Pressable
          onPress={(e) => { e.stopPropagation?.(); onFollow(); }}
          style={{
            paddingHorizontal: 16, paddingVertical: 6, borderRadius: 10,
            backgroundColor: isFollowing ? colors.surface : colors.goldBg,
            borderWidth: 1, borderColor: isFollowing ? colors.border : colors.goldBorder,
          }}
        >
          <Text style={{ color: isFollowing ? colors.textSecondary : colors.gold, fontSize: 11, fontWeight: '700' }}>
            {isFollowing ? 'Suivi' : 'Suivre'}
          </Text>
        </Pressable>
      )}
    </Pressable>
  );
}
