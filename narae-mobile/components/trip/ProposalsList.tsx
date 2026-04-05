import { View, Text, StyleSheet } from 'react-native';
import { Vote } from 'lucide-react-native';
import { ProposalCard } from './ProposalCard';
import { colors, fonts } from '@/lib/theme';
import type { Proposal } from '@/hooks/useProposals';

interface Props {
  proposals: Proposal[];
  isOwner: boolean;
  onVote: (proposalId: string, voteYes: boolean) => void;
  onDecide: (proposalId: string, decision: 'merge' | 'reject') => void;
}

export function ProposalsList({ proposals, isOwner, onVote, onDecide }: Props) {
  if (proposals.length === 0) {
    return (
      <View style={s.empty}>
        <Vote size={24} color={colors.textMuted} />
        <Text style={s.emptyText}>Aucune proposition en cours.</Text>
      </View>
    );
  }

  return (
    <View style={s.container}>
      <Text style={s.title}>Propositions ({proposals.length})</Text>
      {proposals.map((p) => (
        <ProposalCard
          key={p.id}
          proposal={p}
          isOwner={isOwner}
          onVote={onVote}
          onDecide={onDecide}
        />
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  container: { gap: 10 },
  title: { color: colors.text, fontSize: 15, fontFamily: fonts.sansBold },
  empty: { alignItems: 'center', gap: 8, paddingVertical: 24 },
  emptyText: { color: colors.textMuted, fontSize: 13, fontFamily: fonts.sans },
});
