'use client';

import { useState, useEffect } from 'react';
import { Trip } from '@/lib/types';
import { useAuth } from '@/components/auth';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Copy,
  Check,
  Share2,
  QrCode,
  Loader2,
  MessageCircle,
  Mail,
  Link as LinkIcon,
  Users,
  LogIn,
  Calendar,
  Download,
  UserPlus,
} from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import Link from 'next/link';
import { TripVisibilitySelector } from '@/components/trip/TripVisibilitySelector';

interface ShareTripDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trip: Trip;
  tripId: string;
  isOwner?: boolean;
  currentVisibility?: 'public' | 'friends' | 'private';
  onTripSaved?: (savedTripId: string, shareCode: string) => void;
}

export function ShareTripDialog({
  open,
  onOpenChange,
  trip,
  tripId,
  isOwner = false,
  currentVisibility = 'private',
  onTripSaved,
}: ShareTripDialogProps) {
  const { user, isLoading: authLoading } = useAuth();
  const [shareCode, setShareCode] = useState<string | null>(null);
  const [savedTripId, setSavedTripId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<'viewer' | 'editor' | false>(false);
  const [showQR, setShowQR] = useState(false);
  const [friends, setFriends] = useState<any[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [sentTo, setSentTo] = useState<Set<string>>(new Set());
  const [sendingTo, setSendingTo] = useState<string | null>(null);

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const shareUrl = shareCode ? `${baseUrl}/join/${shareCode}` : '';
  const editorShareUrl = shareCode ? `${baseUrl}/join/${shareCode}?role=editor` : '';

  // Vérifier si le voyage est déjà sauvegardé quand le dialog s'ouvre
  useEffect(() => {
    if (!open || !user || shareCode) return;

    const checkExisting = async () => {
      try {
        const response = await fetch('/api/trips');
        if (!response.ok) return;
        const trips = await response.json();
        // Chercher par tripId (UUID Supabase) ou par destination + date
        const startStr = new Date(trip.preferences.startDate).toISOString().split('T')[0];
        const existing = trips.find((t: any) =>
          t.id === tripId ||
          (t.destination === trip.preferences.destination && t.start_date === startStr)
        );
        if (existing) {
          setShareCode(existing.share_code);
          setSavedTripId(existing.id);
        }
      } catch { /* ignore */ }
    };
    checkExisting();
  }, [open, user]);

  // Charger abonnés + abonnements quand le dialog s'ouvre et qu'on a un shareCode
  useEffect(() => {
    if (!open || !user || !shareCode) return;
    const fetchFriends = async () => {
      setFriendsLoading(true);
      try {
        const [followingRes, followersRes] = await Promise.all([
          fetch(`/api/follows?type=following`),
          fetch(`/api/follows?type=followers`),
        ]);
        const followingData = followingRes.ok ? await followingRes.json() : [];
        const followersData = followersRes.ok ? await followersRes.json() : [];

        // Fusionner et dédupliquer
        const map = new Map<string, any>();
        for (const f of followingData) {
          const u = f.following;
          if (u && u.id !== user.id) map.set(u.id, u);
        }
        for (const f of followersData) {
          const u = f.follower;
          if (u && u.id !== user.id && !map.has(u.id)) map.set(u.id, u);
        }
        setFriends(Array.from(map.values()));
      } catch { /* ignore */ }
      setFriendsLoading(false);
    };
    fetchFriends();
  }, [open, user, shareCode]);

  // Inviter un ami au voyage
  const inviteFriend = async (friendId: string) => {
    if (!savedTripId || sendingTo) return;
    setSendingTo(friendId);
    try {
      const res = await fetch(`/api/trips/${savedTripId}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: friendId, role: 'viewer' }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Erreur invitation');
      }
      setSentTo(prev => new Set(prev).add(friendId));
    } catch (e) {
      console.error('Invite friend error:', e);
    } finally {
      setSendingTo(null);
    }
  };

  // Sauvegarder le voyage en Supabase pour obtenir un code de partage
  const saveTrip = async () => {
    if (!user) {
      setError('Vous devez être connecté pour partager ce voyage');
      return;
    }

    // Déjà sauvegardé
    if (shareCode) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/trips', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...trip,
          title: `Voyage à ${trip.preferences.destination}`,
          destination: trip.preferences.destination,
          startDate: trip.preferences.startDate,
          durationDays: trip.preferences.durationDays,
          preferences: trip.preferences,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Erreur lors de la sauvegarde');
      }

      const savedTrip = await response.json();
      setShareCode(savedTrip.share_code);
      setSavedTripId(savedTrip.id);

      // Mettre à jour localStorage avec le vrai ID
      localStorage.setItem('currentTrip', JSON.stringify({ ...trip, id: savedTrip.id }));

      // Notifier le parent
      onTripSaved?.(savedTrip.id, savedTrip.share_code);
    } catch (err) {
      console.error('Error saving trip:', err);
      setError(err instanceof Error ? err.message : 'Erreur inconnue');
    } finally {
      setIsLoading(false);
    }
  };

  // Copier le lien
  const handleCopy = async (type: 'viewer' | 'editor') => {
    const url = type === 'editor' ? editorShareUrl : shareUrl;
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(type);
    setTimeout(() => setCopied(false), 2000);
  };

  // Partage natif (Web Share API)
  const handleNativeShare = async () => {
    if (!shareUrl || !navigator.share) return;

    try {
      await navigator.share({
        title: `Voyage à ${trip.preferences.destination}`,
        text: `Rejoins mon voyage à ${trip.preferences.destination} !`,
        url: shareUrl,
      });
    } catch (err) {
      // L'utilisateur a annulé ou erreur
      console.log('Share cancelled or failed:', err);
    }
  };

  // Partage WhatsApp
  const handleWhatsAppShare = () => {
    const text = encodeURIComponent(
      `Hey ! Rejoins mon voyage à ${trip.preferences.destination} 🌍✈️\n${shareUrl}`
    );
    window.open(`https://wa.me/?text=${text}`, '_blank');
  };

  // Partage Email
  const handleEmailShare = () => {
    const subject = encodeURIComponent(`Invitation: Voyage à ${trip.preferences.destination}`);
    const body = encodeURIComponent(
      `Salut !\n\nJe t'invite à rejoindre mon voyage à ${trip.preferences.destination}.\n\nClique sur ce lien pour voir l'itinéraire et collaborer :\n${shareUrl}\n\nÀ bientôt !`
    );
    window.open(`mailto:?subject=${subject}&body=${body}`, '_blank');
  };

  // Non connecté
  if (!authLoading && !user) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Share2 className="h-5 w-5" />
              Partager le voyage
            </DialogTitle>
            <DialogDescription>
              Connectez-vous pour partager ce voyage avec vos amis
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col items-center py-6 gap-4">
            <div className="p-4 rounded-full bg-primary/10">
              <LogIn className="h-8 w-8 text-primary" />
            </div>
            <p className="text-center text-muted-foreground">
              Pour partager ce voyage et collaborer avec vos amis, vous devez être connecté.
            </p>
            <Button asChild className="w-full">
              <Link href={`/login?redirect=/trip/${tripId}`}>
                Se connecter
              </Link>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  // Chargement auth
  if (authLoading) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-5 w-5" />
            Partager le voyage
          </DialogTitle>
          <DialogDescription>
            Invitez vos amis à voir et modifier ce voyage ensemble
          </DialogDescription>
        </DialogHeader>

        {/* Pas encore de code de partage - sauvegarder d'abord */}
        {!shareCode && (
          <div className="space-y-4 py-4">
            <div className="flex flex-col items-center gap-4 p-6 bg-muted/50 rounded-lg">
              <Users className="h-12 w-12 text-primary" />
              <div className="text-center">
                <h3 className="font-medium">Voyagez ensemble</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Partagez ce voyage pour que vos amis puissent le voir et proposer des modifications
                </p>
              </div>
            </div>

            {error && (
              <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm">
                {error}
              </div>
            )}

            <Button
              onClick={saveTrip}
              disabled={isLoading}
              className="w-full"
              size="lg"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Préparation du partage...
                </>
              ) : (
                <>
                  <Share2 className="mr-2 h-4 w-4" />
                  Créer le lien de partage
                </>
              )}
            </Button>
          </div>
        )}

        {/* Code de partage disponible */}
        {shareCode && (
          <div className="space-y-4 py-4">
            {/* Visibilité */}
            {isOwner && savedTripId && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Visibilité du voyage</label>
                <TripVisibilitySelector
                  tripId={savedTripId}
                  currentVisibility={currentVisibility}
                />
              </div>
            )}

            {/* Lien lecture seule */}
            <div className="space-y-2">
              <label className="text-sm font-medium flex items-center gap-2">
                <LinkIcon className="h-4 w-4" />
                Lien lecture seule
              </label>
              <div className="flex gap-2">
                <Input
                  value={shareUrl}
                  readOnly
                  className="text-sm bg-muted"
                  onClick={(e) => e.currentTarget.select()}
                />
                <Button onClick={() => handleCopy('viewer')} variant="outline" size="icon">
                  {copied === 'viewer' ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Les personnes qui rejoignent via ce lien pourront voir le voyage.
              </p>
            </div>

            {/* Lien éditeur */}
            {isOwner && (
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Lien éditeur
                </label>
                <div className="flex gap-2">
                  <Input
                    value={editorShareUrl}
                    readOnly
                    className="text-sm bg-muted"
                    onClick={(e) => e.currentTarget.select()}
                  />
                  <Button onClick={() => handleCopy('editor')} variant="outline" size="icon">
                    {copied === 'editor' ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Les personnes qui rejoignent via ce lien pourront modifier le voyage.
                </p>
              </div>
            )}

            {/* QR Code */}
            <div className="space-y-2">
              <Button
                variant="outline"
                className="w-full gap-2"
                onClick={() => setShowQR(!showQR)}
              >
                <QrCode className="h-4 w-4" />
                {showQR ? 'Masquer' : 'Afficher'} le QR Code
              </Button>

              {showQR && (
                <div className="flex justify-center p-4 bg-white rounded-lg">
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(shareUrl)}`}
                    alt="QR Code"
                    className="w-48 h-48"
                  />
                </div>
              )}
            </div>

            {/* Boutons de partage */}
            <div className="grid grid-cols-3 gap-2">
              {/* Partage natif (si disponible sur mobile) */}
              {typeof navigator !== 'undefined' && typeof navigator.share === 'function' && (
                <Button
                  variant="outline"
                  className="flex flex-col items-center gap-1 h-auto py-3"
                  onClick={handleNativeShare}
                >
                  <Share2 className="h-5 w-5" />
                  <span className="text-xs">Partager</span>
                </Button>
              )}

              {/* WhatsApp */}
              <Button
                variant="outline"
                className="flex flex-col items-center gap-1 h-auto py-3"
                onClick={handleWhatsAppShare}
              >
                <MessageCircle className="h-5 w-5 text-green-500" />
                <span className="text-xs">WhatsApp</span>
              </Button>

              {/* Email */}
              <Button
                variant="outline"
                className="flex flex-col items-center gap-1 h-auto py-3"
                onClick={handleEmailShare}
              >
                <Mail className="h-5 w-5 text-blue-500" />
                <span className="text-xs">Email</span>
              </Button>
            </div>

            {/* Partager avec des amis */}
            {friends.length > 0 && (
              <div className="space-y-2 pt-2 border-t">
                <label className="text-sm font-medium flex items-center gap-2">
                  <UserPlus className="h-4 w-4" />
                  Inviter un ami
                </label>
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {friends.map((friend: any) => (
                    <div
                      key={friend.id}
                      className="flex items-center gap-2 p-2 rounded-lg hover:bg-muted/50"
                    >
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={friend.avatar_url || undefined} />
                        <AvatarFallback className="text-xs">
                          {(friend.display_name || friend.username || '?')[0].toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span className="flex-1 text-sm font-medium truncate">
                        {friend.display_name || friend.username || 'Voyageur'}
                      </span>
                      <Button
                        size="sm"
                        variant={sentTo.has(friend.id) ? 'ghost' : 'outline'}
                        disabled={sentTo.has(friend.id) || sendingTo === friend.id}
                        onClick={() => inviteFriend(friend.id)}
                        className="shrink-0 h-8 gap-1"
                      >
                        {sentTo.has(friend.id) ? (
                          <>
                            <Check className="h-3 w-3 text-green-500" />
                            <span className="text-xs">Invité</span>
                          </>
                        ) : sendingTo === friend.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <>
                            <UserPlus className="h-3 w-3" />
                            <span className="text-xs">Inviter</span>
                          </>
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {friendsLoading && (
              <div className="flex justify-center py-2">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            )}

            {/* Calendar export section */}
            {savedTripId && (
              <div className="space-y-2 pt-2 border-t">
                <label className="text-sm font-medium flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  Calendrier
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    className="flex flex-col items-center gap-1 h-auto py-3"
                    onClick={() => {
                      const tokenParam = shareCode ? `?token=${shareCode}` : '';
                      const url = `webcal://${window.location.host}/api/trips/${savedTripId}/calendar.ics${tokenParam}`;
                      window.location.href = url;
                    }}
                  >
                    <Calendar className="h-5 w-5 text-gray-700" />
                    <span className="text-xs">Apple Calendar</span>
                  </Button>
                  <Button
                    variant="outline"
                    className="flex flex-col items-center gap-1 h-auto py-3"
                    onClick={() => {
                      const tokenParam = shareCode ? `?token=${shareCode}` : '';
                      const icsUrl = `${baseUrl}/api/trips/${savedTripId}/calendar.ics${tokenParam}`;
                      const gcalUrl = `https://calendar.google.com/calendar/r/settings/addbyurl?url=${encodeURIComponent(icsUrl)}`;
                      window.open(gcalUrl, '_blank');
                    }}
                  >
                    <Calendar className="h-5 w-5 text-blue-500" />
                    <span className="text-xs">Google Calendar</span>
                  </Button>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-2"
                  onClick={() => {
                    const url = `${baseUrl}/api/trips/${savedTripId}/calendar.ics?download=1${shareCode ? `&token=${shareCode}` : ''}`;
                    window.open(url);
                  }}
                >
                  <Download className="h-4 w-4" />
                  Télécharger .ics
                </Button>
              </div>
            )}

          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
