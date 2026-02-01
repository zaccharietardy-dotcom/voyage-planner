'use client';

import { useEffect, useState } from 'react';
import { Users, UserPlus, Bell, Loader2, Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { UserProfileCard } from '@/components/social/UserProfileCard';
import { useAuth } from '@/components/auth';

export default function CommunityPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('friends');
  const [closeFriends, setCloseFriends] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [following, setFollowing] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) loadData();
  }, [user]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [cfRes, reqRes, followRes] = await Promise.all([
        fetch('/api/close-friends?type=accepted').then(r => r.ok ? r.json() : []),
        fetch('/api/close-friends?type=received').then(r => r.ok ? r.json() : []),
        fetch('/api/follows?type=following').then(r => r.ok ? r.json() : []),
      ]);
      setCloseFriends(cfRes);
      setRequests(reqRes);
      setFollowing(followRes);
    } catch (e) {
      console.error('Error loading community data:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleRequestResponse = async (requestId: string, status: 'accepted' | 'rejected') => {
    try {
      await fetch(`/api/close-friends/${requestId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      setRequests(prev => prev.filter(r => r.id !== requestId));
      if (status === 'accepted') loadData();
    } catch (e) {
      console.error('Error responding:', e);
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <p className="text-muted-foreground">Connecte-toi pour voir ta communauté</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
      <div className="container max-w-2xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Communauté</h1>
            <p className="text-muted-foreground text-sm">Tes amis et connexions</p>
          </div>
          {requests.length > 0 && (
            <Badge variant="destructive" className="gap-1">
              <Bell className="w-3 h-3" />
              {requests.length}
            </Badge>
          )}
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full">
            <TabsTrigger value="friends" className="flex-1">Amis proches</TabsTrigger>
            <TabsTrigger value="requests" className="flex-1 relative">
              Demandes
              {requests.length > 0 && (
                <span className="ml-1.5 w-5 h-5 rounded-full bg-destructive text-destructive-foreground text-xs flex items-center justify-center">
                  {requests.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="following" className="flex-1">Abonnements</TabsTrigger>
          </TabsList>

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 text-primary animate-spin" />
            </div>
          ) : (
            <>
              <TabsContent value="friends" className="mt-4">
                {closeFriends.length === 0 ? (
                  <div className="text-center py-16">
                    <Users className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                    <p className="text-muted-foreground font-medium">Pas encore d&apos;amis proches</p>
                    <p className="text-muted-foreground text-sm mt-1">
                      Envoie des demandes d&apos;ami proche depuis le profil d&apos;un voyageur
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {closeFriends.map((cf: any) => {
                      const friend = cf.requester?.id === user.id ? cf.target : cf.requester;
                      return friend ? (
                        <UserProfileCard key={cf.id} user={friend} subtitle="Ami proche" />
                      ) : null;
                    })}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="requests" className="mt-4">
                {requests.length === 0 ? (
                  <div className="text-center py-16">
                    <Bell className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                    <p className="text-muted-foreground">Aucune demande en attente</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {requests.map((req: any) => (
                      <Card key={req.id}>
                        <CardContent className="p-4">
                          <div className="flex items-center gap-3">
                            <Avatar className="h-10 w-10">
                              <AvatarImage src={req.requester?.avatar_url || undefined} />
                              <AvatarFallback>
                                {(req.requester?.display_name || '?')[0].toUpperCase()}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex-1">
                              <p className="font-medium text-sm">{req.requester?.display_name}</p>
                              <p className="text-muted-foreground text-xs">Veut devenir ami proche</p>
                            </div>
                            <div className="flex gap-2">
                              <Button
                                size="icon"
                                variant="outline"
                                className="h-8 w-8 text-green-600 hover:bg-green-50"
                                onClick={() => handleRequestResponse(req.id, 'accepted')}
                              >
                                <Check className="w-4 h-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="outline"
                                className="h-8 w-8 text-destructive hover:bg-destructive/10"
                                onClick={() => handleRequestResponse(req.id, 'rejected')}
                              >
                                <X className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="following" className="mt-4">
                {following.length === 0 ? (
                  <div className="text-center py-16">
                    <UserPlus className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                    <p className="text-muted-foreground">Tu ne suis personne</p>
                    <p className="text-muted-foreground text-sm mt-1">
                      Découvre des voyageurs dans l&apos;onglet Explorer
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {following.map((f: any) => (
                      <UserProfileCard
                        key={f.id}
                        user={f.following || { id: '', display_name: 'Utilisateur', avatar_url: null }}
                      />
                    ))}
                  </div>
                )}
              </TabsContent>
            </>
          )}
        </Tabs>
      </div>
    </div>
  );
}
