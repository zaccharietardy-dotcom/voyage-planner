import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api/client';

export interface ItemVote {
  itemId: string;
  wantCount: number;
  skipCount: number;
  userVote: 'want' | 'skip' | null;
}

export function useActivityVotes(tripId: string | undefined) {
  const [votes, setVotes] = useState<Map<string, ItemVote>>(new Map());

  const fetchVotes = useCallback(async () => {
    if (!tripId) return;
    try {
      const res = await api.get<{ votes: ItemVote[] }>(`/api/trips/${tripId}/votes`);
      const map = new Map<string, ItemVote>();
      (res.votes ?? []).forEach((v) => map.set(v.itemId, v));
      setVotes(map);
    } catch {}
  }, [tripId]);

  useEffect(() => {
    fetchVotes();
  }, [fetchVotes]);

  const castVote = useCallback(async (itemId: string, vote: 'want' | 'skip' | null) => {
    if (!tripId) return;
    // Optimistic
    setVotes((prev) => {
      const next = new Map(prev);
      const current = next.get(itemId) ?? { itemId, wantCount: 0, skipCount: 0, userVote: null };
      // Undo previous vote
      if (current.userVote === 'want') current.wantCount--;
      if (current.userVote === 'skip') current.skipCount--;
      // Apply new vote
      if (vote === 'want') current.wantCount++;
      if (vote === 'skip') current.skipCount++;
      current.userVote = vote;
      next.set(itemId, { ...current });
      return next;
    });
    try {
      await api.post(`/api/trips/${tripId}/votes`, { itemId, vote });
    } catch {
      fetchVotes(); // Revert on error
    }
  }, [tripId, fetchVotes]);

  const getVote = useCallback((itemId: string): ItemVote => {
    return votes.get(itemId) ?? { itemId, wantCount: 0, skipCount: 0, userVote: null };
  }, [votes]);

  return { votes, getVote, castVote, refetch: fetchVotes };
}
