'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Copy, Check, Users, Link as LinkIcon, MoreVertical, Crown, Edit, Eye } from 'lucide-react';
import { TripMember, MemberRole } from '@/lib/types/collaboration';
import { getSupabaseClient } from '@/lib/supabase';
import type { Json } from '@/lib/supabase/types';

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
            Les personnes qui rejoignent via ce lien auront accès en lecture seule.
            Vous pouvez ensuite les promouvoir éditeur.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
