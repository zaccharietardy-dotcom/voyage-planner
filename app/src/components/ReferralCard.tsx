'use client';

import { useEffect, useState } from 'react';
import { Gift, Copy, Check, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/components/auth';
import { toast } from 'sonner';

export function ReferralCard() {
  const { user } = useAuth();
  const [data, setData] = useState<{ code: string | null; referralCount: number; extraTrips: number } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!user) return;
    fetch('/api/referral')
      .then((r) => r.ok ? r.json() : null)
      .then(setData)
      .catch(() => {});
  }, [user]);

  if (!user || !data?.code) return null;

  const shareUrl = `https://naraevoyage.com/register?ref=${data.code}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast.success('Lien copié !');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Impossible de copier');
    }
  };

  const handleShare = async () => {
    if (navigator.share) {
      await navigator.share({
        title: 'Narae Voyage',
        text: `Rejoins Narae et obtiens un voyage gratuit avec mon code : ${data.code}`,
        url: shareUrl,
      }).catch(() => {});
    } else {
      handleCopy();
    }
  };

  return (
    <div className="rounded-2xl border border-gold/20 bg-gold/5 p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="h-10 w-10 rounded-xl bg-gold/10 flex items-center justify-center">
          <Gift className="h-5 w-5 text-gold" />
        </div>
        <div>
          <h3 className="font-bold text-sm">Parrainage</h3>
          <p className="text-xs text-muted-foreground">Invitez un ami, gagnez tous les deux un voyage gratuit</p>
        </div>
      </div>

      {/* Code display */}
      <div className="flex items-center gap-2 mb-4">
        <div className="flex-1 rounded-xl bg-background border px-4 py-3 font-mono text-lg font-bold tracking-widest text-center">
          {data.code}
        </div>
        <Button
          variant="outline"
          size="icon"
          className="h-12 w-12 rounded-xl shrink-0"
          onClick={handleCopy}
        >
          {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>

      <Button
        onClick={handleShare}
        className="w-full rounded-xl bg-gold-gradient text-[#020617] font-bold"
      >
        Partager mon lien
      </Button>

      {/* Stats */}
      {data.referralCount > 0 && (
        <div className="flex items-center gap-2 mt-4 pt-4 border-t border-gold/10 text-xs text-muted-foreground">
          <Users className="h-3.5 w-3.5" />
          <span>{data.referralCount} ami{data.referralCount > 1 ? 's' : ''} parrainé{data.referralCount > 1 ? 's' : ''}</span>
          <span className="text-gold font-bold ml-auto">+{data.referralCount} voyage{data.referralCount > 1 ? 's' : ''} offert{data.referralCount > 1 ? 's' : ''}</span>
        </div>
      )}
    </div>
  );
}
