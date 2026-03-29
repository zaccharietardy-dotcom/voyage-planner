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
import { trackEvent } from '@/lib/analytics';
import { useTranslation } from '@/lib/i18n';
import { toast } from 'sonner';

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
  const { t } = useTranslation();
  const { user, isLoading: authLoading } = useAuth();
  const [shareCode, setShareCode] = useState<string | null>(null);
  const [savedTripId, setSavedTripId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [friends, setFriends] = useState<any[]>([]);
  const [friendsLoading, setFriendsLoading] = useState(false);
  const [sentTo, setSentTo] = useState<Set<string>>(new Set());
  const [sendingTo, setSendingTo] = useState<string | null>(null);

  const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const shareUrl = shareCode ? `${baseUrl}/join/${shareCode}` : '';

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
      setError(t('share.loginToShare'));
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
      setError(err instanceof Error ? err.message : t('common.error'));
    } finally {
      setIsLoading(false);
    }
  };

  // Copier le lien
  const handleCopy = async () => {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    trackEvent('trip_shared', { method: 'copy_link' });
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
      trackEvent('trip_shared', { method: 'native' });
    } catch (err) {
      // L'utilisateur a annulé ou erreur
      // Share cancelled or failed
    }
  };

  // Partage WhatsApp
  const handleWhatsAppShare = () => {
    const text = encodeURIComponent(
      `Hey ! Rejoins mon voyage à ${trip.preferences.destination} 🌍✈️\n${shareUrl}`
    );
    window.open(`https://wa.me/?text=${text}`, '_blank');
    trackEvent('trip_shared', { method: 'whatsapp' });
  };

  // Partage Email
  const handleEmailShare = () => {
    const subject = encodeURIComponent(`Invitation: Voyage à ${trip.preferences.destination}`);
    const body = encodeURIComponent(
      `Salut !\n\nJe t'invite à rejoindre mon voyage à ${trip.preferences.destination}.\n\nClique sur ce lien pour voir l'itinéraire et collaborer :\n${shareUrl}\n\nÀ bientôt !`
    );
    window.open(`mailto:?subject=${subject}&body=${body}`, '_blank');
    trackEvent('trip_shared', { method: 'email' });
  };

  // Partage Twitter/X
  const handleTwitterShare = () => {
    const text = encodeURIComponent(
      `Je viens de planifier mon voyage à ${trip.preferences.destination} ! 🌍✈️`
    );
    const url = encodeURIComponent(shareUrl);
    window.open(`https://twitter.com/intent/tweet?text=${text}&url=${url}`, '_blank', 'width=550,height=420');
  };

  // Partage Facebook
  const handleFacebookShare = () => {
    const url = encodeURIComponent(shareUrl);
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${url}`, '_blank', 'width=550,height=420');
  };

  // Non connecté
  if (!authLoading && !user) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Share2 className="h-5 w-5" />
              {t('share.title')}
            </DialogTitle>
            <DialogDescription>
              {t('share.loginRequired')}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col items-center py-6 gap-4">
            <div className="p-4 rounded-full bg-primary/10">
              <LogIn className="h-8 w-8 text-primary" />
            </div>
            <p className="text-center text-muted-foreground">
              {t('share.loginToShare')}
            </p>
            <Button asChild className="w-full">
              <Link href={`/login?redirect=/trip/${tripId}`}>
                {t('share.signIn')}
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
            {t('share.title')}
          </DialogTitle>
          <DialogDescription>
            {t('share.subtitle')}
          </DialogDescription>
        </DialogHeader>

        {/* Pas encore de code de partage - sauvegarder d'abord */}
        {!shareCode && (
          <div className="space-y-4 py-4">
            <div className="flex flex-col items-center gap-4 p-6 bg-muted/50 rounded-lg">
              <Users className="h-12 w-12 text-primary" />
              <div className="text-center">
                <h3 className="font-medium">{t('share.travelTogether')}</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {t('share.travelTogetherDesc')}
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
                  {t('share.preparing')}
                </>
              ) : (
                <>
                  <Share2 className="mr-2 h-4 w-4" />
                  {t('share.createLink')}
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
                <label className="text-sm font-medium">{t('share.tripVisibility')}</label>
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
                {t('share.readOnlyLink')}
              </label>
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
              <p className="text-xs text-muted-foreground">
                {t('share.readOnlyDesc')}
              </p>
            </div>

            {/* QR Code */}
            <div className="space-y-2">
              <Button
                variant="outline"
                className="w-full gap-2"
                onClick={() => setShowQR(!showQR)}
              >
                <QrCode className="h-4 w-4" />
                {showQR ? t('share.hideQR') : t('share.showQR')}
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
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {/* Partage natif (si disponible sur mobile) */}
              {typeof navigator !== 'undefined' && typeof navigator.share === 'function' && (
                <Button
                  variant="outline"
                  className="flex flex-col items-center gap-1 h-auto py-3"
                  onClick={handleNativeShare}
                >
                  <Share2 className="h-5 w-5" />
                  <span className="text-xs">{t('share.native')}</span>
                </Button>
              )}

              {/* WhatsApp */}
              <Button
                variant="outline"
                className="flex flex-col items-center gap-1 h-auto py-3"
                onClick={handleWhatsAppShare}
              >
                <MessageCircle className="h-5 w-5 text-green-500" />
                <span className="text-xs">{t('share.whatsapp')}</span>
              </Button>

              {/* Email */}
              <Button
                variant="outline"
                className="flex flex-col items-center gap-1 h-auto py-3"
                onClick={handleEmailShare}
              >
                <Mail className="h-5 w-5 text-blue-500" />
                <span className="text-xs">{t('share.email')}</span>
              </Button>

              {/* Twitter/X */}
              <Button
                variant="outline"
                className="flex flex-col items-center gap-1 h-auto py-3"
                onClick={handleTwitterShare}
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                </svg>
                <span className="text-xs">{t('share.twitter')}</span>
              </Button>

              {/* Facebook */}
              <Button
                variant="outline"
                className="flex flex-col items-center gap-1 h-auto py-3"
                onClick={handleFacebookShare}
              >
                <svg className="h-5 w-5 text-[#1877F2]" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                </svg>
                <span className="text-xs">{t('share.facebook')}</span>
              </Button>
            </div>

            {/* Partager avec des amis */}
            {friends.length > 0 && (
              <div className="space-y-2 pt-2 border-t">
                <label className="text-sm font-medium flex items-center gap-2">
                  <UserPlus className="h-4 w-4" />
                  {t('share.inviteFriend')}
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
                            <span className="text-xs">{t('share.invited')}</span>
                          </>
                        ) : sendingTo === friend.id ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <>
                            <UserPlus className="h-3 w-3" />
                            <span className="text-xs">{t('share.invite')}</span>
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
            {savedTripId && (() => {
              const isPublicUrl = !baseUrl.includes('localhost') && !baseUrl.includes('127.0.0.1');
              const tokenParam = shareCode ? `?token=${shareCode}` : '';
              const icsDownloadUrl = `${baseUrl}/api/trips/${savedTripId}/calendar.ics?download=1${shareCode ? `&token=${shareCode}` : ''}`;

              return (
                <div className="space-y-2 pt-2 border-t">
                  <label className="text-sm font-medium flex items-center gap-2">
                    <Calendar className="h-4 w-4" />
                    {t('share.calendar')}
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      variant="outline"
                      className="flex flex-col items-center gap-1 h-auto py-3"
                      onClick={() => {
                        if (isPublicUrl) {
                          const url = `webcal://${window.location.host}/api/trips/${savedTripId}/calendar.ics${tokenParam}`;
                          window.location.href = url;
                        } else {
                          // In localhost, download the .ics file directly — macOS opens it in Calendar
                          window.open(icsDownloadUrl);
                        }
                      }}
                    >
                      <Calendar className="h-5 w-5 text-gray-700" />
                      <span className="text-xs">Apple Calendar</span>
                    </Button>
                    <Button
                      variant="outline"
                      className="flex flex-col items-center gap-1 h-auto py-3"
                      onClick={() => {
                        if (isPublicUrl) {
                          // On deployed URL, use subscription approach
                          const icsUrl = `${baseUrl}/api/trips/${savedTripId}/calendar.ics${tokenParam}`;
                          const gcalUrl = `https://calendar.google.com/calendar/r/settings/addbyurl?url=${encodeURIComponent(icsUrl)}`;
                          window.open(gcalUrl, '_blank');
                        } else {
                          // On localhost, download .ics and show import instructions
                          window.open(icsDownloadUrl);
                          // Small delay to show instructions after download starts
                          setTimeout(() => {
                            toast.info('Fichier .ics téléchargé ! Ouvrez calendar.google.com > Paramètres > Importation et exportation > Sélectionnez le fichier .ics');
                          }, 500);
                        }
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
                      window.open(icsDownloadUrl);
                    }}
                  >
                    <Download className="h-4 w-4" />
                    {t('share.downloadIcs')}
                  </Button>
                </div>
              );
            })()}

          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
