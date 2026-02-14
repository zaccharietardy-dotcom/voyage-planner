'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ProposalCard } from './ProposalCard';
import { Proposal } from '@/lib/types/collaboration';
import { GitPullRequest, Clock, CheckCircle, Inbox, Crown } from 'lucide-react';

interface ProposalsListProps {
  proposals: Proposal[];
  onVote: (proposalId: string, vote: boolean) => Promise<void>;
  onDecision?: (proposalId: string, decision: 'merge' | 'reject') => Promise<void>;
  currentUserId?: string;
  canVote?: boolean;
  canOwnerDecide?: boolean;
  onCreateProposal?: () => void;
}

export function ProposalsList({
  proposals,
  onVote,
  onDecision,
  currentUserId,
  canVote = false,
  canOwnerDecide = false,
  onCreateProposal,
}: ProposalsListProps) {
  const [activeTab, setActiveTab] = useState<'pending' | 'resolved'>('pending');

  const votingProposals = proposals.filter((proposal) => proposal.status === 'pending');
  const ownerDecisionProposals = proposals.filter((proposal) => proposal.status === 'approved');
  const resolvedProposals = proposals.filter(
    (proposal) => proposal.status === 'merged' || proposal.status === 'rejected'
  );

  return (
    <Card className="h-full flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <GitPullRequest className="h-4 w-4" />
            Propositions
          </CardTitle>
          {onCreateProposal && (
            <Button size="sm" variant="outline" onClick={onCreateProposal}>
              Proposer
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex-1 p-0">
        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as 'pending' | 'resolved')}
          className="h-full flex flex-col"
        >
          <TabsList className="mx-4 grid w-auto grid-cols-2">
            <TabsTrigger value="pending" className="gap-1">
              <Clock className="h-3 w-3" />
              En cours ({votingProposals.length + ownerDecisionProposals.length})
            </TabsTrigger>
            <TabsTrigger value="resolved" className="gap-1">
              <CheckCircle className="h-3 w-3" />
              Résolues ({resolvedProposals.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pending" className="flex-1 mt-0">
            <ScrollArea className="h-full max-h-[420px]">
              <div className="p-4 space-y-4">
                {votingProposals.length === 0 && ownerDecisionProposals.length === 0 ? (
                  <div className="text-center py-8">
                    <Inbox className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">
                      Aucune proposition en attente
                    </p>
                  </div>
                ) : (
                  <>
                    {votingProposals.map((proposal) => (
                      <ProposalCard
                        key={proposal.id}
                        proposal={proposal}
                        onVote={onVote}
                        onDecision={onDecision}
                        currentUserId={currentUserId}
                        canVote={canVote}
                        canOwnerDecide={canOwnerDecide}
                      />
                    ))}

                    {ownerDecisionProposals.length > 0 && (
                      <div className="space-y-3 pt-1">
                        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 flex items-center gap-2">
                          <Crown className="h-3.5 w-3.5" />
                          Propositions approuvées: décision propriétaire requise
                        </div>
                        {ownerDecisionProposals.map((proposal) => (
                          <ProposalCard
                            key={proposal.id}
                            proposal={proposal}
                            onVote={onVote}
                            onDecision={onDecision}
                            currentUserId={currentUserId}
                            canVote={false}
                            canOwnerDecide={canOwnerDecide}
                          />
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="resolved" className="flex-1 mt-0">
            <ScrollArea className="h-full max-h-[420px]">
              <div className="p-4 space-y-3">
                {resolvedProposals.length === 0 ? (
                  <div className="text-center py-8">
                    <Inbox className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">
                      Aucune proposition résolue
                    </p>
                  </div>
                ) : (
                  resolvedProposals.map((proposal) => (
                    <ProposalCard
                      key={proposal.id}
                      proposal={proposal}
                      onVote={onVote}
                      onDecision={onDecision}
                      currentUserId={currentUserId}
                      canVote={false}
                      canOwnerDecide={false}
                    />
                  ))
                )}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
