import {
  buildProposalVoteSnapshot,
  computePendingProposalStatus,
  getEligibleVoterCount,
  getRequiredVotes,
} from '@/lib/server/collaboration';
import { mergeProposalChangesIntoTripData } from '@/lib/server/proposalMerge';
import type { ProposedChange } from '@/lib/types/collaboration';

describe('Collaboration workflow helpers', () => {
  describe('vote majority logic', () => {
    it('computes required votes as floor(eligible/2)+1', () => {
      expect(getRequiredVotes(0)).toBe(0);
      expect(getRequiredVotes(1)).toBe(1);
      expect(getRequiredVotes(2)).toBe(2);
      expect(getRequiredVotes(3)).toBe(2);
      expect(getRequiredVotes(4)).toBe(3);
    });

    it('computes eligible voters from editors excluding author', () => {
      const editors = ['author', 'editor-1', 'editor-2', 'editor-3'];
      expect(getEligibleVoterCount(editors, 'author')).toBe(3);
      expect(getEligibleVoterCount(editors, 'editor-2')).toBe(3);
    });

    it('marks proposal approved directly when no eligible editors exist', () => {
      expect(computePendingProposalStatus(0, 0, 0)).toBe('approved');

      const snapshot = buildProposalVoteSnapshot(0, 0, 0);
      expect(snapshot.status).toBe('approved');
      expect(snapshot.ownerDecisionRequired).toBe(true);
      expect(snapshot.requiredVotes).toBe(0);
    });

    it('transitions pending -> approved only on strict majority for', () => {
      expect(computePendingProposalStatus(4, 2, 1)).toBe('pending');
      expect(computePendingProposalStatus(4, 3, 1)).toBe('approved');
    });

    it('transitions pending -> rejected on strict majority against', () => {
      expect(computePendingProposalStatus(5, 2, 2)).toBe('pending');
      expect(computePendingProposalStatus(5, 1, 3)).toBe('rejected');
    });
  });

  describe('proposal merge helper', () => {
    it('applies add, modify, remove and change_time changes', () => {
      const originalTripData = {
        days: [
          {
            dayNumber: 1,
            items: [
              {
                id: 'activity-1',
                dayNumber: 1,
                startTime: '10:00',
                endTime: '11:00',
                title: 'Museum',
              },
            ],
          },
        ],
      };

      const changes: ProposedChange[] = [
        {
          id: 'change-1',
          type: 'add_activity',
          dayNumber: 1,
          data: {
            activity: {
              title: 'Beach',
              startTime: '12:00',
              endTime: '13:00',
              type: 'activity',
            },
          },
          description: 'Add Beach',
        },
        {
          id: 'change-2',
          type: 'modify_activity',
          dayNumber: 1,
          targetId: 'activity-1',
          data: {
            activity: {
              title: 'Modern Art Museum',
            },
          },
          description: 'Rename activity',
        },
        {
          id: 'change-3',
          type: 'change_time',
          dayNumber: 1,
          targetId: 'activity-1',
          data: {
            newStartTime: '09:30',
            newEndTime: '10:45',
          },
          description: 'Adjust time',
        },
        {
          id: 'change-4',
          type: 'remove_activity',
          dayNumber: 1,
          targetId: 'activity-1',
          data: {},
          description: 'Remove original activity',
        },
      ];

      const merged = mergeProposalChangesIntoTripData(originalTripData, changes);
      const dayOne = Array.isArray(merged.days) ? merged.days[0] : undefined;
      const items = Array.isArray(dayOne?.items) ? dayOne.items : [];

      expect(items).toHaveLength(1);
      expect(items[0].title).toBe('Beach');
      expect(items[0].startTime).toBe('12:00');
    });
  });
});
