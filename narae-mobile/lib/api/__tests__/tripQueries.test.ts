jest.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getUser: jest.fn(),
      getSession: jest.fn(),
      refreshSession: jest.fn(),
    },
    from: jest.fn(),
  },
}));

jest.mock('@/lib/api/client', () => ({
  api: {
    post: jest.fn(),
  },
  fetchWithAuth: jest.fn(),
  getValidSession: jest.fn(),
  getAuthHeaders: jest.fn(),
}));

import { supabase } from '@/lib/supabase/client';
import { deleteTrip, fetchMyTrips, fetchTrip } from '@/lib/api/trips';

const mockSupabase = supabase as unknown as {
  auth: {
    getUser: jest.Mock;
    getSession: jest.Mock;
    refreshSession: jest.Mock;
  };
  from: jest.Mock;
};

describe('trip query wrappers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns an empty list when there is no authenticated user', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } });

    await expect(fetchMyTrips()).resolves.toEqual([]);
  });

  it('fetches a trip detail row by id', async () => {
    const single = jest.fn().mockResolvedValue({
      data: { id: 'trip-1', destination: 'Rome' },
      error: null,
    });
    const eq = jest.fn(() => ({ single }));
    const select = jest.fn(() => ({ eq }));
    mockSupabase.from.mockReturnValue({ select });

    await expect(fetchTrip('trip-1')).resolves.toEqual({ id: 'trip-1', destination: 'Rome' });

    expect(mockSupabase.from).toHaveBeenCalledWith('trips');
    expect(select).toHaveBeenCalledWith('*');
    expect(eq).toHaveBeenCalledWith('id', 'trip-1');
  });

  it('deletes a trip row by id', async () => {
    const eq = jest.fn().mockResolvedValue({ error: null });
    const del = jest.fn(() => ({ eq }));
    mockSupabase.from.mockReturnValue({ delete: del });

    await deleteTrip('trip-1');

    expect(mockSupabase.from).toHaveBeenCalledWith('trips');
    expect(del).toHaveBeenCalled();
    expect(eq).toHaveBeenCalledWith('id', 'trip-1');
  });
});
