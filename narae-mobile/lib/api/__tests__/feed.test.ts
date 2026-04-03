jest.mock('@/lib/api/client', () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
    del: jest.fn(),
  },
}));

import { api } from '@/lib/api/client';
import { cloneTrip, fetchFeed, likeTrip, unlikeTrip } from '@/lib/api/feed';

const mockApi = api as jest.Mocked<typeof api>;

describe('feed mobile API wrappers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fetches the feed with tab, page and sort params', async () => {
    mockApi.get.mockResolvedValue({ trips: [], hasMore: false });

    await fetchFeed('following', 3, 'trending');

    expect(mockApi.get).toHaveBeenCalledWith('/api/feed?tab=following&page=3&limit=10&sort=trending');
  });

  it('likes a trip through the like endpoint', async () => {
    mockApi.post.mockResolvedValue(undefined);

    await likeTrip('trip-1');

    expect(mockApi.post).toHaveBeenCalledWith('/api/trips/trip-1/like');
  });

  it('unlikes a trip through the like endpoint', async () => {
    mockApi.del.mockResolvedValue(undefined);

    await unlikeTrip('trip-1');

    expect(mockApi.del).toHaveBeenCalledWith('/api/trips/trip-1/like');
  });

  it('clones a trip through the clone endpoint', async () => {
    mockApi.post.mockResolvedValue({ id: 'clone-1' });

    await expect(cloneTrip('trip-1')).resolves.toEqual({ id: 'clone-1' });
    expect(mockApi.post).toHaveBeenCalledWith('/api/trips/trip-1/clone');
  });
});
