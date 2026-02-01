'use client';

import { useState, useEffect } from 'react';
import { MessageCircle, Send, Reply, Loader2 } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/components/auth';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { toast } from 'sonner';

interface Comment {
  id: string;
  trip_id: string;
  user_id: string;
  content: string;
  parent_id: string | null;
  created_at: string;
  author: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
    username: string | null;
  };
}

export function CommentsSection({ tripId }: { tripId: string }) {
  const { user } = useAuth();
  const [comments, setComments] = useState<Comment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [content, setContent] = useState('');
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const [sending, setSending] = useState(false);

  const fetchComments = async () => {
    try {
      const res = await fetch(`/api/trips/${tripId}/comments`);
      if (res.ok) {
        const data = await res.json();
        setComments(data);
      }
    } catch (e) {
      console.error('Error fetching comments:', e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchComments();
  }, [tripId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim() || !user) return;

    setSending(true);
    try {
      const res = await fetch(`/api/trips/${tripId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: content.trim(),
          parent_id: replyTo?.id || null,
        }),
      });

      if (res.ok) {
        const newComment = await res.json();
        setComments(prev => [...prev, newComment]);
        setContent('');
        setReplyTo(null);
        toast.success('Commentaire ajouté');
      } else {
        toast.error('Erreur lors de l\'ajout du commentaire');
      }
    } catch {
      toast.error('Erreur réseau');
    } finally {
      setSending(false);
    }
  };

  // Organize comments into tree
  const rootComments = comments.filter(c => !c.parent_id);
  const replies = (parentId: string) => comments.filter(c => c.parent_id === parentId);

  const renderComment = (comment: Comment, isReply = false) => (
    <div key={comment.id} className={cn('flex gap-3', isReply && 'ml-10 mt-2')}>
      <Avatar className="h-8 w-8 shrink-0">
        <AvatarImage src={comment.author.avatar_url || undefined} />
        <AvatarFallback className="text-xs">
          {(comment.author.display_name || '?')[0].toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <div className="bg-muted/50 rounded-xl px-3 py-2">
          <p className="text-sm font-medium">
            {comment.author.display_name || comment.author.username || 'Voyageur'}
          </p>
          <p className="text-sm text-foreground mt-0.5 whitespace-pre-wrap break-words">
            {comment.content}
          </p>
        </div>
        <div className="flex items-center gap-3 mt-1 px-1">
          <span className="text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true, locale: fr })}
          </span>
          {user && (
            <button
              onClick={() => setReplyTo(comment)}
              className="text-xs text-muted-foreground hover:text-primary transition-colors"
            >
              Répondre
            </button>
          )}
        </div>
        {/* Replies */}
        {replies(comment.id).map(reply => renderComment(reply, true))}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <h3 className="font-semibold flex items-center gap-2">
        <MessageCircle className="h-5 w-5" />
        Commentaires ({comments.length})
      </h3>

      {isLoading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : comments.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">
          Aucun commentaire. Soyez le premier !
        </p>
      ) : (
        <div className="space-y-4">
          {rootComments.map(c => renderComment(c))}
        </div>
      )}

      {/* Comment input */}
      {user ? (
        <form onSubmit={handleSubmit} className="space-y-2">
          {replyTo && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 px-3 py-2 rounded-lg">
              <Reply className="h-3 w-3" />
              <span>Réponse à {replyTo.author.display_name || 'Voyageur'}</span>
              <button
                type="button"
                onClick={() => setReplyTo(null)}
                className="ml-auto text-muted-foreground hover:text-foreground"
              >
                ✕
              </button>
            </div>
          )}
          <div className="flex gap-2">
            <input
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Ajouter un commentaire..."
              className="flex-1 bg-muted/50 border rounded-full px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              disabled={sending}
            />
            <Button
              type="submit"
              size="icon"
              disabled={!content.trim() || sending}
              className="rounded-full shrink-0"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </form>
      ) : (
        <p className="text-sm text-muted-foreground text-center">
          Connectez-vous pour commenter
        </p>
      )}
    </div>
  );
}
