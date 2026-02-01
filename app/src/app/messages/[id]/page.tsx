'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Send, Loader2 } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/components/auth';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  created_at: string;
  sender: { id: string; display_name: string | null; avatar_url: string | null };
  is_mine: boolean;
}

export default function ChatPage() {
  const params = useParams();
  const router = useRouter();
  const convId = params.id as string;
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const fetchMessages = async () => {
    try {
      const res = await fetch(`/api/messages/conversations/${convId}`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data);
      }
    } catch (e) {
      console.error('Error:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchMessages();
    const interval = setInterval(fetchMessages, 3000); // Poll every 3s for near-realtime
    return () => clearInterval(interval);
  }, [convId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() || sending) return;

    setSending(true);
    try {
      const res = await fetch('/api/messages/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conversation_id: convId, content: content.trim() }),
      });

      if (res.ok) {
        const newMsg = await res.json();
        setMessages(prev => [...prev, {
          ...newMsg,
          sender: { id: user?.id || '', display_name: null, avatar_url: null },
          is_mine: true,
        }]);
        setContent('');
        inputRef.current?.focus();
      }
    } catch (e) {
      console.error('Send error:', e);
    } finally {
      setSending(false);
    }
  };

  // Get other user from messages
  const otherUser = messages.find(m => !m.is_mine)?.sender;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="sticky top-16 z-40 bg-background/95 backdrop-blur border-b px-4 py-3">
        <div className="container mx-auto max-w-2xl flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.push('/messages')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          {otherUser && (
            <button
              onClick={() => router.push(`/user/${otherUser.id}`)}
              className="flex items-center gap-2"
            >
              <Avatar className="h-9 w-9">
                <AvatarImage src={otherUser.avatar_url || undefined} />
                <AvatarFallback>
                  {(otherUser.display_name || '?')[0].toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="font-semibold">
                {otherUser.display_name || 'Voyageur'}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        <div className="container mx-auto max-w-2xl px-4 py-4 space-y-3">
          {isLoading ? (
            <div className="flex justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : messages.length === 0 ? (
            <p className="text-center text-muted-foreground py-20">
              Commencez la conversation !
            </p>
          ) : (
            messages.map((msg, i) => {
              const showDate = i === 0 ||
                new Date(msg.created_at).toDateString() !== new Date(messages[i-1].created_at).toDateString();

              return (
                <div key={msg.id}>
                  {showDate && (
                    <p className="text-center text-xs text-muted-foreground my-4">
                      {format(new Date(msg.created_at), 'd MMMM yyyy', { locale: fr })}
                    </p>
                  )}
                  <div className={cn('flex gap-2', msg.is_mine ? 'justify-end' : 'justify-start')}>
                    {!msg.is_mine && (
                      <Avatar className="h-7 w-7 shrink-0 mt-1">
                        <AvatarImage src={msg.sender.avatar_url || undefined} />
                        <AvatarFallback className="text-xs">
                          {(msg.sender.display_name || '?')[0].toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                    )}
                    <div className={cn(
                      'max-w-[75%] px-4 py-2 rounded-2xl text-sm',
                      msg.is_mine
                        ? 'bg-primary text-primary-foreground rounded-br-md'
                        : 'bg-muted rounded-bl-md'
                    )}>
                      <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                      <p className={cn(
                        'text-[10px] mt-1',
                        msg.is_mine ? 'text-primary-foreground/60' : 'text-muted-foreground'
                      )}>
                        {format(new Date(msg.created_at), 'HH:mm')}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="sticky bottom-0 bg-background border-t px-4 py-3">
        <form onSubmit={handleSend} className="container mx-auto max-w-2xl flex gap-2">
          <input
            ref={inputRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Écrire un message..."
            className="flex-1 bg-muted border rounded-full px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            disabled={sending}
            autoFocus
          />
          <Button
            type="submit"
            size="icon"
            disabled={!content.trim() || sending}
            className="rounded-full shrink-0 h-10 w-10"
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </form>
      </div>
    </div>
  );
}
