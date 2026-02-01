'use client';

import { useEffect, useState, useCallback } from 'react';
import { Users, UserPlus, Bell, Loader2, Check, X, Search, Link2, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { UserProfileCard } from '@/components/social/UserProfileCard';
import { FollowButton } from '@/components/social/FollowButton';
import { useAuth } from '@/components/auth';
import { toast } from 'sonner';

interface SearchResult {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  username: string | null;
  bio: string | null;
}

export default function CommunityPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('search');
  const [closeFriends, setCloseFriends] = useState<any[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [following, setFollowing] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Search
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (user) loadData();
  }, [user]);

  // Debounced search
  useEffect(() => {
    if (searchQuery.length < 2) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(() => {
      searchUsers(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

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

  const searchUsers = async (query: string) => {
    setSearching(true);
    try {
      const res = await fetch(`/api/users/search?q=${encodeURIComponent(query)}`);
      if (res.ok) {
        setSearchResults(await res.json());
      }
    } catch (e) {
      console.error('Search error:', e);
    } finally {
      setSearching(false);
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

  const copyInviteLink = () => {
    if (!user) return;
    const link = `${window.location.origin}/invite/${user.id}`;
    navigator.clipboard.writeText(link);
    toast.success('Lien d\'invitation copié !');
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
            <p className="text-muted-foreground text-sm">Trouve et suis des voyageurs</p>
          </div>
          <div className="flex items-center gap-2">
            {requests.length > 0 && (
              <Badge variant="destructive" className="gap-1">
                <Bell className="w-3 h-3" />
                {requests.length}
              </Badge>
            )}
            <Button variant="outline" size="sm" onClick={copyInviteLink} className="gap-1.5">
              <Link2 className="w-4 h-4" />
              Inviter
            </Button>
          </div>
        </div>

        {/* Search bar - always visible */}
        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Rechercher un voyageur..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Search results */}
        {searchQuery.length >= 2 && (
          <div className="mb-6">
            {searching ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 text-primary animate-spin" />
              </div>
            ) : searchResults.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-muted-foreground text-sm">Aucun résultat pour &ldquo;{searchQuery}&rdquo;</p>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground font-medium mb-2">
                  {searchResults.length} résultat{searchResults.length > 1 ? 's' : ''}
                </p>
                {searchResults.map((result) => (
                  <Card key={result.id}>
                    <CardContent className="p-3">
                      <div className="flex items-center gap-3">
                        <Avatar className="h-10 w-10">
                          <AvatarImage src={result.avatar_url || undefined} />
                          <AvatarFallback>
                            {(result.display_name || '?')[0].toUpperCase()}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">
                            {result.display_name || 'Utilisateur'}
                          </p>
                          {result.username && (
                            <p className="text-muted-foreground text-xs">@{result.username}</p>
                          )}
                          {result.bio && (
                            <p className="text-muted-foreground text-xs truncate mt-0.5">{result.bio}</p>
                          )}
                        </div>
                        <FollowButton
                          userId={result.id}
                          initialIsFollowing={false}
                          initialIsCloseFriend={false}
                          size="sm"
                        />
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tabs */}
        {searchQuery.length < 2 && (
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="w-full">
              <TabsTrigger value="search" className="flex-1">Abonnements</TabsTrigger>
              <TabsTrigger value="friends" className="flex-1">Amis proches</TabsTrigger>
              <TabsTrigger value="requests" className="flex-1 relative">
                Demandes
                {requests.length > 0 && (
                  <span className="ml-1.5 w-5 h-5 rounded-full bg-destructive text-destructive-foreground text-xs flex items-center justify-center">
                    {requests.length}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>

            {loading ? (
              <div className="flex items-center justify-center py-20">
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
              </div>
            ) : (
              <>
                <TabsContent value="search" className="mt-4">
                  {following.length === 0 ? (
                    <div className="text-center py-16">
                      <UserPlus className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                      <p className="text-muted-foreground font-medium">Tu ne suis personne</p>
                      <p className="text-muted-foreground text-sm mt-1">
                        Recherche un voyageur ci-dessus ou partage ton lien d&apos;invitation
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
              </>
            )}
          </Tabs>
        )}
      </div>
    </div>
  );
}
