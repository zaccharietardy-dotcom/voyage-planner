jest.mock('@/lib/api/client', () => ({
  api: {
    post: jest.fn(),
  },
  getAuthHeaders: jest.fn().mockResolvedValue({
    Authorization: 'Bearer test-token',
  }),
}));

jest.mock('@/lib/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: jest.fn().mockResolvedValue({
        data: { session: null },
      }),
    },
  },
}));

import { buildProgressFromEvent, processSSEBuffer } from '@/lib/api/trips';

describe('mobile generate SSE parsing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    }) as jest.Mock;
  });

  it('maps progress events from the web pipeline format', () => {
    expect(
      buildProgressFromEvent({
        type: 'step_start',
        step: 2,
        stepName: 'Restaurants',
      }),
    ).toEqual({
      step: 2,
      total: 8,
      label: '2/8 — Restaurants',
      detail: undefined,
    });
  });

  it('parses progress and done statuses from an SSE buffer', async () => {
    const onProgress = jest.fn();

    const result = await processSSEBuffer(
      'data: {"status":"progress","event":{"type":"step_start","step":2,"stepName":"Restaurants"}}\n\n'
      + 'data: {"status":"done","trip":{"id":"trip-1","days":[]}}\n\n',
      { onProgress },
      null,
    );

    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({
        step: 2,
        label: '2/8 — Restaurants',
      }),
    );
    expect(result.trip).toMatchObject({ id: 'trip-1' });
    expect(result.remaining).toBe('');
  });

  it('parses snapshot statuses from the stream format', async () => {
    const onSnapshot = jest.fn();

    await processSSEBuffer(
      'data: {"status":"snapshot","snapshot":{"stage":"fetched","center":{"latitude":41.9,"longitude":12.49},"markers":[{"id":"destination","title":"Rome","kind":"destination","latitude":41.9,"longitude":12.49}]}}\n\n',
      { onSnapshot },
      null,
    );

    expect(onSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'fetched',
        markers: [
          expect.objectContaining({
            kind: 'destination',
            title: 'Rome',
          }),
        ],
      }),
    );
  });

  it('returns error statuses from the web stream format', async () => {
    const result = await processSSEBuffer(
      'data: {"status":"error","error":"Session expirée"}\n\n',
      {},
      null,
    );

    expect(result.error).toBe('Session expirée');
  });

  it('keeps truncated events in the remaining buffer until the payload is complete', async () => {
    const first = await processSSEBuffer(
      'data: {"status":"done","trip":{"id":"trip-1"',
      {},
      null,
    );

    expect(first.trip).toBeUndefined();
    expect(first.remaining).toContain('"trip-1"');

    const second = await processSSEBuffer(
      `${first.remaining}}}\n\n`,
      {},
      null,
    );

    expect(second.trip).toMatchObject({ id: 'trip-1' });
  });

  it('handles question statuses and posts the selected answer back to the API', async () => {
    const onQuestion = jest.fn().mockResolvedValue('opt-b');

    await processSSEBuffer(
      'data: {"status":"question","question":{"questionId":"question-1","sessionId":"session-1","type":"day_trip","title":"Choix","prompt":"Question ?","timeoutMs":10000,"options":[{"id":"opt-a","label":"A","isDefault":true},{"id":"opt-b","label":"B","isDefault":false}]}}\n\n',
      { onQuestion },
      'session-1',
    );

    expect(onQuestion).toHaveBeenCalledWith(
      expect.objectContaining({
        questionId: 'question-1',
      }),
    );
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/generate/answer'),
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });
});
