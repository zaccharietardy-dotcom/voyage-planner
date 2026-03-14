'use client';

import { useState, useEffect, useCallback } from 'react';

interface VoteData {
  itemId: string;
  wantCount: number;
  skipCount: number;
  userVote: 'want' | 'skip' | null;
}

export function useActivityVotes(tripId: string) {
  const [votes, setVotes] = useState<Map<string, VoteData>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tripId) return;

    fetch(`/api/trips/${tripId}/votes`)
      .then(res => res.json())
      .then(data => {
        if (data.votes) {
          const voteMap = new Map<string, VoteData>();
          // Group by itemId
          const grouped = new Map<string, typeof data.votes>();
          for (const v of data.votes) {
            if (!grouped.has(v.item_id)) grouped.set(v.item_id, []);
            grouped.get(v.item_id)!.push(v);
          }
          for (const [itemId, itemVotes] of grouped) {
            voteMap.set(itemId, {
              itemId,
              wantCount: itemVotes.filter((v: { vote: string }) => v.vote === 'want').length,
              skipCount: itemVotes.filter((v: { vote: string }) => v.vote === 'skip').length,
              userVote: null, // Will be set from user-specific data
            });
          }
          setVotes(voteMap);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [tripId]);

  const castVote = useCallback(async (itemId: string, vote: 'want' | 'skip' | null) => {
    // Optimistic update
    setVotes(prev => {
      const newMap = new Map(prev);
      const existing = newMap.get(itemId) || { itemId, wantCount: 0, skipCount: 0, userVote: null };

      // Remove previous vote
      if (existing.userVote === 'want') existing.wantCount--;
      if (existing.userVote === 'skip') existing.skipCount--;

      // Add new vote
      if (vote === 'want') existing.wantCount++;
      if (vote === 'skip') existing.skipCount++;
      existing.userVote = vote;

      newMap.set(itemId, { ...existing });
      return newMap;
    });

    try {
      const res = await fetch(`/api/trips/${tripId}/votes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, vote }),
      });
      const data = await res.json();
      if (data.itemId) {
        setVotes(prev => {
          const newMap = new Map(prev);
          newMap.set(data.itemId, data);
          return newMap;
        });
      }
    } catch (error) {
      console.error('Vote error:', error);
    }
  }, [tripId]);

  const getVoteData = useCallback((itemId: string): VoteData => {
    return votes.get(itemId) || { itemId, wantCount: 0, skipCount: 0, userVote: null };
  }, [votes]);

  return { votes, loading, castVote, getVoteData };
}
