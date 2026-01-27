'use client';

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ProposalCard } from './ProposalCard';
import { Proposal, ProposalStatus } from '@/lib/types/collaboration';
import { GitPullRequest, Clock, CheckCircle, XCircle, Inbox } from 'lucide-react';

interface ProposalsListProps {
  proposals: Proposal[];
  onVote: (proposalId: string, vote: boolean) => Promise<void>;
  currentUserId?: string;
  onCreateProposal?: () => void;
}

export function ProposalsList({
  proposals,
  onVote,
  currentUserId,
  onCreateProposal,
}: ProposalsListProps) {
  const [activeTab, setActiveTab] = useState<'pending' | 'resolved'>('pending');

  const pendingProposals = proposals.filter((p) => p.status === 'pending');
  const resolvedProposals = proposals.filter((p) => p.status !== 'pending');

  const getStatusIcon = (status: ProposalStatus) => {
    switch (status) {
      case 'merged':
        return <CheckCircle className="h-3 w-3 text-green-500" />;
      case 'rejected':
        return <XCircle className="h-3 w-3 text-red-500" />;
      default:
        return <Clock className="h-3 w-3" />;
    }
  };

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
          onValueChange={(v) => setActiveTab(v as 'pending' | 'resolved')}
          className="h-full flex flex-col"
        >
          <TabsList className="mx-4 grid w-auto grid-cols-2">
            <TabsTrigger value="pending" className="gap-1">
              <Clock className="h-3 w-3" />
              En attente ({pendingProposals.length})
            </TabsTrigger>
            <TabsTrigger value="resolved" className="gap-1">
              <CheckCircle className="h-3 w-3" />
              Résolues ({resolvedProposals.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pending" className="flex-1 mt-0">
            <ScrollArea className="h-full max-h-[400px]">
              <div className="p-4 space-y-3">
                {pendingProposals.length === 0 ? (
                  <div className="text-center py-8">
                    <Inbox className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">
                      Aucune proposition en attente
                    </p>
                  </div>
                ) : (
                  pendingProposals.map((proposal) => (
                    <ProposalCard
                      key={proposal.id}
                      proposal={proposal}
                      onVote={onVote}
                      currentUserId={currentUserId}
                    />
                  ))
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="resolved" className="flex-1 mt-0">
            <ScrollArea className="h-full max-h-[400px]">
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
                      currentUserId={currentUserId}
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
