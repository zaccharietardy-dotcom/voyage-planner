'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { MessageCircle, Loader2 } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useAuth } from '@/components/auth';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';

interface Conversation {
  id: string;
  other_user: { id: string; display_name: string | null; avatar_url: string | null; username: string | null } | null;
  last_message: { content: string; sender_id: string; created_at: string } | null;
  unread_count: number;
  updated_at: string;
}

export default function MessagesPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { router.push('/'); return; }

    const fetchConversations = async () => {
      try {
        const res = await fetch('/api/messages/conversations');
        if (res.ok) setConversations(await res.json());
      } catch (e) {
        console.error('Error:', e);
      } finally {
        setIsLoading(false);
      }
    };

    fetchConversations();
    const interval = setInterval(fetchConversations, 10000);
    return () => clearInterval(interval);
  }, [user, authLoading]);

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto max-w-2xl px-4 py-8">
        <h1 className="text-2xl font-bold mb-6 flex items-center gap-2">
          <MessageCircle className="h-6 w-6" />
          Messages
        </h1>

        {conversations.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <MessageCircle className="h-12 w-12 mx-auto mb-4 opacity-30" />
            <p className="text-lg font-medium mb-1">Aucune conversation</p>
            <p className="text-sm">Envoyez un message depuis le profil d&apos;un voyageur</p>
          </div>
        ) : (
          <div className="divide-y rounded-xl border overflow-hidden">
            {conversations.map((conv) => (
              <button
                key={conv.id}
                onClick={() => router.push(`/messages/${conv.id}`)}
                className={cn(
                  'w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors',
                  conv.unread_count > 0 && 'bg-primary/5'
                )}
              >
                <Avatar className="h-12 w-12 shrink-0">
                  <AvatarImage src={conv.other_user?.avatar_url || undefined} />
                  <AvatarFallback>
                    {(conv.other_user?.display_name || '?')[0].toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className={cn('font-medium truncate', conv.unread_count > 0 && 'font-bold')}>
                      {conv.other_user?.display_name || conv.other_user?.username || 'Voyageur'}
                    </p>
                    {conv.last_message && (
                      <span className="text-xs text-muted-foreground shrink-0 ml-2">
                        {formatDistanceToNow(new Date(conv.last_message.created_at), { addSuffix: false, locale: fr })}
                      </span>
                    )}
                  </div>
                  {conv.last_message && (
                    <p className={cn(
                      'text-sm truncate mt-0.5',
                      conv.unread_count > 0 ? 'text-foreground font-medium' : 'text-muted-foreground'
                    )}>
                      {conv.last_message.sender_id === user?.id ? 'Vous : ' : ''}
                      {conv.last_message.content}
                    </p>
                  )}
                </div>
                {conv.unread_count > 0 && (
                  <span className="w-5 h-5 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center shrink-0">
                    {conv.unread_count}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
