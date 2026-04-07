import { View, Text, Pressable, StyleSheet } from 'react-native';
import { ThumbsUp, ThumbsDown, Check, X } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { Avatar } from '@/components/ui/Avatar';
import { colors, fonts, radius } from '@/lib/theme';
import type { Proposal, ProposalStatus } from '@/hooks/useProposals';
import { useTranslation } from '@/lib/i18n';

interface Props {
  proposal: Proposal;
  isOwner: boolean;
  onVote: (proposalId: string, voteYes: boolean) => void;
  onDecide: (proposalId: string, decision: 'merge' | 'reject') => void;
}

const STATUS_COLORS: Record<ProposalStatus, string> = {
  pending: colors.gold,
  approved: '#4ade80',
  rejected: '#f87171',
  merged: '#60a5fa',
};

const STATUS_KEYS: Record<ProposalStatus, string> = {
  pending: 'proposal.pending',
  approved: 'proposal.approved',
  rejected: 'proposal.rejected',
  merged: 'proposal.merged',
};

export function ProposalCard({ proposal, isOwner, onVote, onDecide }: Props) {
  const { t } = useTranslation();
  const isPending = proposal.status === 'pending';
  const isApproved = proposal.status === 'approved';

  return (
    <View style={s.card}>
      <View style={s.header}>
        <Avatar
          url={proposal.author?.avatar_url}
          name={proposal.author?.display_name || '?'}
          size="sm"
        />
        <View style={s.headerInfo}>
          <Text style={s.author}>{proposal.author?.display_name || t('proposal.author.anon')}</Text>
          <View style={[s.statusBadge, { backgroundColor: `${STATUS_COLORS[proposal.status]}20` }]}>
            <Text style={[s.statusText, { color: STATUS_COLORS[proposal.status] }]}>
              {t(STATUS_KEYS[proposal.status] as any)}
            </Text>
          </View>
        </View>
      </View>

      <Text style={s.title}>{proposal.title}</Text>
      {proposal.description ? (
        <Text style={s.description}>{proposal.description}</Text>
      ) : null}

      {/* Vote counts */}
      <View style={s.votesRow}>
        <View style={s.voteItem}>
          <ThumbsUp size={14} color="#4ade80" />
          <Text style={s.voteCount}>{proposal.votes_for}</Text>
        </View>
        <View style={s.voteItem}>
          <ThumbsDown size={14} color="#f87171" />
          <Text style={s.voteCount}>{proposal.votes_against}</Text>
        </View>
      </View>

      {/* Vote buttons (pending only) */}
      {isPending ? (
        <View style={s.actionRow}>
          <Pressable
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onVote(proposal.id, true); }}
            style={[s.actionBtn, s.actionBtnYes]}
          >
            <ThumbsUp size={14} color="#4ade80" />
            <Text style={[s.actionBtnText, { color: '#4ade80' }]}>{t('proposal.vote.for')}</Text>
          </Pressable>
          <Pressable
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onVote(proposal.id, false); }}
            style={[s.actionBtn, s.actionBtnNo]}
          >
            <ThumbsDown size={14} color="#f87171" />
            <Text style={[s.actionBtnText, { color: '#f87171' }]}>{t('proposal.vote.against')}</Text>
          </Pressable>
        </View>
      ) : null}

      {/* Owner decision (approved proposals) */}
      {isApproved && isOwner ? (
        <View style={s.actionRow}>
          <Pressable
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onDecide(proposal.id, 'merge'); }}
            style={[s.actionBtn, s.actionBtnMerge]}
          >
            <Check size={14} color={colors.bg} />
            <Text style={[s.actionBtnText, { color: colors.bg }]}>{t('proposal.merge')}</Text>
          </Pressable>
          <Pressable
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onDecide(proposal.id, 'reject'); }}
            style={[s.actionBtn, s.actionBtnNo]}
          >
            <X size={14} color="#f87171" />
            <Text style={[s.actionBtnText, { color: '#f87171' }]}>{t('proposal.reject')}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    padding: 16,
    borderRadius: radius.card,
    borderCurve: 'continuous',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    gap: 10,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerInfo: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  author: { color: colors.text, fontSize: 13, fontFamily: fonts.sansSemiBold },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusText: { fontSize: 10, fontFamily: fonts.sansBold, textTransform: 'uppercase', letterSpacing: 1 },
  title: { color: colors.text, fontSize: 15, fontFamily: fonts.sansBold },
  description: { color: colors.textSecondary, fontSize: 13, fontFamily: fonts.sans, lineHeight: 19 },
  votesRow: { flexDirection: 'row', gap: 16 },
  voteItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  voteCount: { color: colors.textSecondary, fontSize: 13, fontFamily: fonts.sansBold },
  actionRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    borderCurve: 'continuous',
    borderWidth: 1,
  },
  actionBtnYes: { backgroundColor: 'rgba(74,222,128,0.08)', borderColor: 'rgba(74,222,128,0.2)' },
  actionBtnNo: { backgroundColor: 'rgba(248,113,113,0.08)', borderColor: 'rgba(248,113,113,0.2)' },
  actionBtnMerge: { backgroundColor: colors.gold, borderColor: colors.gold },
  actionBtnText: { fontSize: 13, fontFamily: fonts.sansBold },
});
