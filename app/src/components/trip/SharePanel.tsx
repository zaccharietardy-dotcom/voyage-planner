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
import { getSupabaseClient } from '@/lib/supabase';
import type { Json } from '@/lib/supabase/types';
import { toast } from 'sonner';

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
  const [inviteResults, setInviteResults] = useState<any[]>([]);
  const [inviteSearching, setInviteSearching] = useState(false);
  const [inviting, setInviting] = useState<string | null>(null);

  const searchForInvite = useCallback(async (query: string) => {
    if (query.length < 2) { setInviteResults([]); return; }
    setInviteSearching(true);
    try {
      const res = await fetch(`/api/users/search?q=${encodeURIComponent(query)}`);
      if (res.ok) {
        const results = await res.json();
        // Filter out existing members
        const memberIds = new Set(members.map(m => m.userId));
        setInviteResults(results.filter((r: any) => !memberIds.has(r.id)));
      }
    } catch { /* ignore */ }
    finally { setInviteSearching(false); }
  }, [members]);

  const handleInvite = async (userId: string, role: 'editor' | 'viewer' = 'editor') => {
    setInviting(userId);
    try {
      const res = await fetch(`/api/trips/${tripId}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, role }),
      });
      if (res.ok) {
        toast.success('Invitation envoy\u00e9e');
        setInviteResults(prev => prev.filter(r => r.id !== userId));
        setInviteQuery('');
      } else {
        toast.error('Erreur lors de l\'invitation');
      }
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

  const handleRoleChange = async (memberId: string, userId: string, newRole: MemberRole) => {
    const supabase = getSupabaseClient();

    const { error } = await supabase
      .from('trip_members')
      .update({ role: newRole })
      .eq('id', memberId);

    if (!error && currentUserId) {
      // Log d'activité
      await supabase.from('activity_log').insert({
        trip_id: tripId,
        user_id: currentUserId,
        action: 'member_role_changed',
        details: { targetUserId: userId, newRole } as unknown as Json,
      });

      onMemberRoleChange?.(memberId, newRole);
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
        return 'Lecteur';
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
        {/* Liste des membres */}
        <div className="space-y-2">
          {members.map((member) => (
            <div
              key={member.id}
              className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 transition-colors"
            >
              {member.profile.avatarUrl ? (
                <img
                  src={member.profile.avatarUrl}
                  alt={member.profile.displayName}
                  className="w-8 h-8 rounded-full object-cover"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                  <span className="text-sm font-medium text-primary">
                    {member.profile.displayName.charAt(0).toUpperCase()}
                  </span>
                </div>
              )}

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
                        onClick={() => handleRoleChange(member.id, member.userId, 'editor')}
                        disabled={member.role === 'editor'}
                      >
                        <Edit className="h-4 w-4 mr-2" />
                        Promouvoir éditeur
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleRoleChange(member.id, member.userId, 'viewer')}
                        disabled={member.role === 'viewer'}
                      >
                        <Eye className="h-4 w-4 mr-2" />
                        Rétrograder lecteur
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Lien de partage */}
        <div className="pt-4 border-t">
          <p className="text-sm font-medium mb-2 flex items-center gap-2">
            <LinkIcon className="h-4 w-4" />
            Inviter des amis
          </p>
          <div className="flex gap-2">
            <Input
              value={shareUrl}
              readOnly
              className="text-sm bg-muted"
              onClick={(e) => e.currentTarget.select()}
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
            Les personnes qui rejoignent via ce lien auront acc&egrave;s en lecture seule.
            Vous pouvez ensuite les promouvoir &eacute;diteur.
          </p>
        </div>

        {/* Inviter un ami */}
        {canChangeRoles && (
          <div className="pt-4 border-t">
            <p className="text-sm font-medium mb-2 flex items-center gap-2">
              <UserPlus className="h-4 w-4" />
              Inviter un ami en &eacute;diteur
            </p>
            <div className="relative mb-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Rechercher un utilisateur..."
                value={inviteQuery}
                onChange={(e) => {
                  setInviteQuery(e.target.value);
                  searchForInvite(e.target.value);
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
                {inviteResults.map((user: any) => (
                  <div key={user.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted/50">
                    <Avatar className="h-7 w-7">
                      <AvatarImage src={user.avatar_url || undefined} />
                      <AvatarFallback className="text-xs">
                        {(user.display_name || '?')[0].toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="flex-1 text-sm truncate">{user.display_name || 'Utilisateur'}</span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs gap-1"
                      disabled={inviting === user.id}
                      onClick={() => handleInvite(user.id)}
                    >
                      {inviting === user.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <><Edit className="h-3 w-3" /> &Eacute;diteur</>
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
