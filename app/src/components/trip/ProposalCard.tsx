'use client';

import { useState } from 'react';
import { Card, CardHeader, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  ThumbsUp,
  ThumbsDown,
  Clock,
  Plus,
  Minus,
  ArrowRight,
  Edit,
  CheckCircle,
  XCircle,
  GitMerge,
} from 'lucide-react';
import { Proposal, ChangeType } from '@/lib/types/collaboration';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';

interface ProposalCardProps {
  proposal: Proposal;
  onVote: (proposalId: string, vote: boolean) => Promise<void>;
  currentUserId?: string;
}

export function ProposalCard({ proposal, onVote, currentUserId }: ProposalCardProps) {
  const [isVoting, setIsVoting] = useState(false);

  const handleVote = async (vote: boolean) => {
    setIsVoting(true);
    try {
      await onVote(proposal.id, vote);
    } finally {
      setIsVoting(false);
    }
  };

  const getStatusBadge = () => {
    switch (proposal.status) {
      case 'pending':
        return (
          <Badge variant="outline" className="gap-1">
            <Clock className="h-3 w-3" />
            En attente
          </Badge>
        );
      case 'approved':
        return (
          <Badge className="gap-1 bg-green-500">
            <CheckCircle className="h-3 w-3" />
            Approuvée
          </Badge>
        );
      case 'rejected':
        return (
          <Badge variant="destructive" className="gap-1">
            <XCircle className="h-3 w-3" />
            Rejetée
          </Badge>
        );
      case 'merged':
        return (
          <Badge className="gap-1 bg-blue-500">
            <GitMerge className="h-3 w-3" />
            Appliquée
          </Badge>
        );
    }
  };

  const getChangeIcon = (type: ChangeType) => {
    switch (type) {
      case 'add_activity':
        return <Plus className="h-3 w-3 text-green-500" />;
      case 'remove_activity':
        return <Minus className="h-3 w-3 text-red-500" />;
      case 'move_activity':
        return <ArrowRight className="h-3 w-3 text-blue-500" />;
      case 'modify_activity':
      case 'change_restaurant':
      case 'change_hotel':
      case 'change_time':
        return <Edit className="h-3 w-3 text-orange-500" />;
    }
  };

  const isAuthor = proposal.authorId === currentUserId;
  const canVote = !isAuthor && proposal.status === 'pending';

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            {proposal.author.avatarUrl ? (
              <img
                src={proposal.author.avatarUrl}
                alt={proposal.author.displayName}
                className="w-8 h-8 rounded-full object-cover"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                <span className="text-xs font-medium text-primary">
                  {proposal.author.displayName.charAt(0).toUpperCase()}
                </span>
              </div>
            )}
            <div>
              <p className="text-sm font-medium">{proposal.author.displayName}</p>
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {formatDistanceToNow(new Date(proposal.createdAt), {
                  addSuffix: true,
                  locale: fr,
                })}
              </p>
            </div>
          </div>
          {getStatusBadge()}
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <div>
          <h4 className="font-semibold text-sm">{proposal.title}</h4>
          {proposal.description && (
            <p className="text-sm text-muted-foreground mt-1">
              {proposal.description}
            </p>
          )}
        </div>

        {/* Liste des changements */}
        <div className="space-y-1">
          {proposal.changes.map((change, i) => (
            <div
              key={i}
              className="flex items-center gap-2 text-xs px-2 py-1.5 bg-muted rounded"
            >
              {getChangeIcon(change.type)}
              <span>{change.description}</span>
            </div>
          ))}
        </div>
      </CardContent>

      {/* Footer avec votes */}
      <CardFooter className="border-t pt-3">
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-4 text-sm">
            <span className="flex items-center gap-1 text-green-600">
              <ThumbsUp className="h-4 w-4" />
              {proposal.votesFor}
            </span>
            <span className="flex items-center gap-1 text-red-600">
              <ThumbsDown className="h-4 w-4" />
              {proposal.votesAgainst}
            </span>
          </div>

          {canVote && (
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={proposal.userVote === true ? 'default' : 'outline'}
                onClick={() => handleVote(true)}
                disabled={isVoting}
                className="gap-1"
              >
                <ThumbsUp className="h-4 w-4" />
                Pour
              </Button>
              <Button
                size="sm"
                variant={proposal.userVote === false ? 'destructive' : 'outline'}
                onClick={() => handleVote(false)}
                disabled={isVoting}
                className="gap-1"
              >
                <ThumbsDown className="h-4 w-4" />
                Contre
              </Button>
            </div>
          )}

          {isAuthor && proposal.status === 'pending' && (
            <p className="text-xs text-muted-foreground">
              En attente des votes...
            </p>
          )}
        </div>
      </CardFooter>
    </Card>
  );
}
