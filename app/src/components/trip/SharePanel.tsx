'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Copy, Check, Users, Link as LinkIcon, MoreVertical, Crown, Edit, Eye, Search, Loader2, UserPlus } from 'lucide-react';
import { TripMember, MemberRole } from '@/lib/types/collaboration';
import { toast } from 'sonner';

interface InviteUser {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}

interface SharePanelProps {
  tripId: string;
  shareCode: string;
  members: TripMember[];
  currentUserId?: string;
  userRole?: MemberRole;
  onMemberRoleChange?: (memberId: string, newRole: MemberRole) => void;
}

export function SharePanel({
  tripId,
  shareCode,
  members,
  currentUserId,
  userRole,
  onMemberRoleChange,
}: SharePanelProps) {
  const [copied, setCopied] = useState(false);
  const [inviteQuery, setInviteQuery] = useState('');
  const [inviteResults, setInviteResults] = useState<InviteUser[]>([]);
  const [inviteSearching, setInviteSearching] = useState(false);
  const [inviting, setInviting] = useState<string | null>(null);

  const searchForInvite = useCallback(async (query: string) => {
    if (query.length < 2) {
      setInviteResults([]);
      return;
    }

    setInviteSearching(true);
    try {
      const res = await fetch(`/api/users/search?q=${encodeURIComponent(query)}`);
      if (!res.ok) {
        return;
      }

      const results = await res.json() as InviteUser[];
      const memberIds = new Set(members.map((member) => member.userId));
      setInviteResults(results.filter((result) => !memberIds.has(result.id)));
    } catch {
      // no-op for search failures
    } finally {
      setInviteSearching(false);
    }
  }, [members]);

  const handleInvite = async (userId: string, role: 'editor' | 'viewer' = 'editor') => {
    setInviting(userId);

    try {
      const res = await fetch(`/api/trips/${tripId}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, role }),
      });

      if (!res.ok) {
        const payload = await res.json().catch(() => ({} as { error?: string }));
        toast.error(payload.error || 'Erreur lors de l\'invitation');
        return;
      }

      toast.success('Invitation envoyée');
      setInviteResults((previous) => previous.filter((result) => result.id !== userId));
      setInviteQuery('');
    } catch {
      toast.error('Erreur lors de l\'invitation');
    } finally {
      setInviting(null);
    }
  };

  const shareUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/join/${shareCode}`
    : '';

  const handleCopy = async () => {
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRoleChange = async (memberId: string, newRole: Extract<MemberRole, 'editor' | 'viewer'>) => {
    try {
      const response = await fetch(`/api/trips/${tripId}/members/${memberId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({} as { error?: string }));
        toast.error(payload.error || 'Impossible de modifier le rôle');
        return;
      }

      toast.success('Rôle mis à jour');
      onMemberRoleChange?.(memberId, newRole);
    } catch {
      toast.error('Impossible de modifier le rôle');
    }
  };

  const getRoleIcon = (role: MemberRole) => {
    switch (role) {
      case 'owner':
        return <Crown className="h-3 w-3 text-amber-500" />;
      case 'editor':
        return <Edit className="h-3 w-3 text-blue-500" />;
      case 'viewer':
        return <Eye className="h-3 w-3 text-gray-500" />;
    }
  };

  const getRoleLabel = (role: MemberRole) => {
    switch (role) {
      case 'owner':
        return 'Propriétaire';
      case 'editor':
        return 'Éditeur';
      case 'viewer':
        return 'Lecture seule';
    }
  };

  const canChangeRoles = userRole === 'owner';

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4" />
          Collaborateurs ({members.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          {members.map((member) => (
            <div
              key={member.id}
              className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors"
            >
              <Avatar className="h-8 w-8">
                <AvatarImage src={member.profile.avatarUrl || undefined} alt={member.profile.displayName} />
                <AvatarFallback className="text-sm font-medium">
                  {member.profile.displayName.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {member.profile.displayName}
                  {member.userId === currentUserId && (
                    <span className="text-muted-foreground"> (vous)</span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {member.profile.email}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="gap-1">
                  {getRoleIcon(member.role)}
                  <span className="text-xs">{getRoleLabel(member.role)}</span>
                </Badge>

                {canChangeRoles && member.role !== 'owner' && member.userId !== currentUserId && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => handleRoleChange(member.id, 'editor')}
                        disabled={member.role === 'editor'}
                      >
                        <Edit className="h-4 w-4 mr-2" />
                        Passer éditeur
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleRoleChange(member.id, 'viewer')}
                        disabled={member.role === 'viewer'}
                      >
                        <Eye className="h-4 w-4 mr-2" />
                        Passer lecture seule
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="pt-4 border-t">
          <p className="text-sm font-medium mb-2 flex items-center gap-2">
            <LinkIcon className="h-4 w-4" />
            Lien de partage permanent
          </p>
          <div className="flex gap-2">
            <Input
              value={shareUrl}
              readOnly
              className="text-sm bg-muted"
              onClick={(event) => event.currentTarget.select()}
            />
            <Button onClick={handleCopy} variant="outline" size="icon">
              {copied ? (
                <Check className="h-4 w-4 text-green-500" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Les personnes qui rejoignent via ce lien auront accès en lecture seule.
            Vous pouvez ensuite les promouvoir en éditeur.
          </p>
        </div>

        {canChangeRoles && (
          <div className="pt-4 border-t">
            <p className="text-sm font-medium mb-2 flex items-center gap-2">
              <UserPlus className="h-4 w-4" />
              Inviter un utilisateur (éditeur)
            </p>
            <div className="relative mb-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Rechercher un utilisateur..."
                value={inviteQuery}
                onChange={(event) => {
                  setInviteQuery(event.target.value);
                  searchForInvite(event.target.value);
                }}
                className="pl-9 text-sm"
              />
            </div>
            {inviteSearching && (
              <div className="flex justify-center py-2">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            )}
            {inviteResults.length > 0 && (
              <div className="space-y-1 max-h-40 overflow-y-auto">
                {inviteResults.map((inviteUser) => (
                  <div key={inviteUser.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted/50">
                    <Avatar className="h-7 w-7">
                      <AvatarImage src={inviteUser.avatar_url || undefined} />
                      <AvatarFallback className="text-xs">
                        {(inviteUser.display_name || '?')[0].toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="flex-1 text-sm truncate">{inviteUser.display_name || 'Utilisateur'}</span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1"
                      disabled={inviting === inviteUser.id}
                      onClick={() => handleInvite(inviteUser.id)}
                    >
                      {inviting === inviteUser.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <><Edit className="h-3 w-3" /> Éditeur</>
                      )}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
