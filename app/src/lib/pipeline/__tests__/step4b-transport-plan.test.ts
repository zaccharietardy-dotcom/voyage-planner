/**
 * Step 4b — transport plan tests.
 * Exercises both the deterministic fallback chain and the LLM path (mocked).
 */

jest.mock('@/lib/services/geminiClient', () => ({
  callGemini: jest.fn(),
}));

jest.mock('@/lib/services/airportFinder', () => ({
  findNearestAirport: jest.fn(async () => null),
}));

import { buildTransportPlan } from '../step4b-transport-plan';
import { callGemini } from '@/lib/services/geminiClient';
import { findNearestAirport } from '@/lib/services/airportFinder';

const mockedCallGemini = callGemini as jest.MockedFunction<typeof callGemini>;
const mockedFindNearestAirport = findNearestAirport as jest.MockedFunction<typeof findNearestAirport>;

function makeLlmResponse(json: unknown): Response {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(json) }] } }],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function makeLlmError(status = 500): Response {
  return new Response(JSON.stringify({ error: { message: 'boom' } }), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('buildTransportPlan — deterministic fallback', () => {
  it('Paris → Rome picks plane and builds 3 legs with hubs', async () => {
    mockedCallGemini.mockResolvedValueOnce(makeLlmError());

    const plan = await buildTransportPlan({
      origin: 'Paris',
      destination: 'Rome',
      startDate: new Date('2026-05-01'),
      endDate: new Date('2026-05-04'),
      groupSize: 2,
    });

    expect(plan.mode).toBe('plane');
    expect(plan.outboundLegs.length).toBe(3);
    expect(plan.returnLegs.length).toBe(3);
    expect(plan.source).toMatch(/fallback_/);
    expect(plan.outboundLegs[1].mode).toBe('plane');
    expect(plan.outboundLegs[1].from.hub?.code).toBe('CDG');
    expect(plan.outboundLegs[1].to.hub?.code).toBe('FCO');
    expect(plan.totalOutboundMin).toBeGreaterThan(plan.outboundLegs[1].durationMin); // includes transfers
  });

  it('Paris → Lyon picks train (<650 km) with 3 legs routed via main stations', async () => {
    mockedCallGemini.mockResolvedValueOnce(makeLlmError());

    const plan = await buildTransportPlan({
      origin: 'Paris',
      destination: 'Lyon',
      startDate: new Date('2026-05-01'),
      endDate: new Date('2026-05-03'),
      groupSize: 1,
    });

    expect(plan.mode).toBe('train');
    expect(plan.outboundLegs[1].mode === 'train' || plan.outboundLegs[1].mode === 'high_speed_train').toBe(true);
    expect(plan.outboundLegs[1].from.hub?.kind).toBe('station');
    expect(plan.outboundLegs[1].to.hub?.kind).toBe('station');
  });

  it('respects explicit user preference (transport: train) even for long distance', async () => {
    mockedCallGemini.mockResolvedValueOnce(makeLlmError());

    const plan = await buildTransportPlan({
      origin: 'Paris',
      destination: 'Berlin',
      startDate: new Date('2026-06-10'),
      endDate: new Date('2026-06-14'),
      groupSize: 1,
      transportPref: 'train',
    });

    expect(plan.mode).toBe('train');
  });

  it('falls back to single generic leg when neither city is in the europe table and Places returns nothing', async () => {
    mockedCallGemini.mockResolvedValueOnce(makeLlmError());
    mockedFindNearestAirport.mockResolvedValue(null);

    const plan = await buildTransportPlan({
      origin: 'Timbuktu',
      destination: 'Kathmandu',
      startDate: new Date('2026-07-01'),
      endDate: new Date('2026-07-05'),
      groupSize: 1,
    });

    // No hubs resolved → should still produce a plan (single heuristic leg or empty-ish)
    expect(plan).toBeTruthy();
    expect(plan.outboundLegs.length).toBeGreaterThanOrEqual(1);
    expect(plan.returnLegs.length).toBeGreaterThanOrEqual(1);
    expect(plan.source).toBe('fallback_heuristic');
  });

  it('caches the plan and returns it on the second call', async () => {
    mockedCallGemini.mockResolvedValue(makeLlmError());

    const input = {
      origin: 'Paris',
      destination: 'Rome',
      startDate: new Date('2026-05-01'),
      endDate: new Date('2026-05-04'),
      groupSize: 2,
    } as const;

    const first = await buildTransportPlan({ ...input });
    const second = await buildTransportPlan({ ...input });
    expect(second.source).toBe('cache');
    expect(second.totalCostEur).toBe(first.totalCostEur);
  });
});

describe('buildTransportPlan — LLM path', () => {
  it('uses LLM output when it matches the schema', async () => {
    mockedCallGemini.mockResolvedValueOnce(
      makeLlmResponse({
        mode: 'plane',
        reasoning: 'Optimal flight',
        outboundLegs: [
          {
            index: 0,
            mode: 'rer',
            from: { name: 'Igny', lat: 48.75, lng: 2.22 },
            to: { name: 'CDG', lat: 49.00, lng: 2.55, hub: { name: 'CDG', code: 'CDG', kind: 'airport', lat: 49.00, lng: 2.55 } },
            durationMin: 85,
            costEur: 12,
            provider: 'RER B',
          },
          {
            index: 1,
            mode: 'plane',
            from: { name: 'CDG', lat: 49.00, lng: 2.55, hub: { name: 'CDG', code: 'CDG', kind: 'airport', lat: 49.00, lng: 2.55 } },
            to: { name: 'FCO', lat: 41.80, lng: 12.24, hub: { name: 'FCO', code: 'FCO', kind: 'airport', lat: 41.80, lng: 12.24 } },
            durationMin: 145,
            costEur: 75,
            provider: 'Air France',
          },
          {
            index: 2,
            mode: 'train',
            from: { name: 'FCO', lat: 41.80, lng: 12.24, hub: { name: 'FCO', code: 'FCO', kind: 'airport', lat: 41.80, lng: 12.24 } },
            to: { name: 'Leonardo Hotel', lat: 41.90, lng: 12.49 },
            durationMin: 40,
            costEur: 14,
            provider: 'Leonardo Express',
          },
        ],
        returnLegs: [
          {
            index: 0,
            mode: 'train',
            from: { name: 'Leonardo Hotel', lat: 41.90, lng: 12.49 },
            to: { name: 'FCO', lat: 41.80, lng: 12.24, hub: { name: 'FCO', code: 'FCO', kind: 'airport', lat: 41.80, lng: 12.24 } },
            durationMin: 40,
            costEur: 14,
          },
          {
            index: 1,
            mode: 'plane',
            from: { name: 'FCO', lat: 41.80, lng: 12.24, hub: { name: 'FCO', code: 'FCO', kind: 'airport', lat: 41.80, lng: 12.24 } },
            to: { name: 'CDG', lat: 49.00, lng: 2.55, hub: { name: 'CDG', code: 'CDG', kind: 'airport', lat: 49.00, lng: 2.55 } },
            durationMin: 140,
            costEur: 85,
          },
          {
            index: 2,
            mode: 'rer',
            from: { name: 'CDG', lat: 49.00, lng: 2.55, hub: { name: 'CDG', code: 'CDG', kind: 'airport', lat: 49.00, lng: 2.55 } },
            to: { name: 'Igny', lat: 48.75, lng: 2.22 },
            durationMin: 85,
            costEur: 12,
          },
        ],
        totalOutboundMin: 270,
        totalReturnMin: 265,
        totalCostEur: 212,
      }),
    );

    const plan = await buildTransportPlan({
      origin: 'Igny-sur-seine',
      destination: 'Rome-city',
      startDate: new Date('2026-05-01'),
      endDate: new Date('2026-05-04'),
      groupSize: 1,
    });

    expect(plan.source).toBe('llm');
    expect(plan.mode).toBe('plane');
    expect(plan.outboundLegs.length).toBe(3);
    expect(plan.outboundLegs[0].provider).toBe('RER B');
    expect(plan.outboundLegs[1].to.hub?.code).toBe('FCO');
  });

  it('falls back when LLM returns malformed JSON', async () => {
    const badResponse = new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'this is not JSON at all' }] } }],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
    mockedCallGemini.mockResolvedValueOnce(badResponse);

    const plan = await buildTransportPlan({
      origin: 'Paris-unique1',
      destination: 'Rome-unique1',
      startDate: new Date('2026-08-01'),
      endDate: new Date('2026-08-04'),
      groupSize: 1,
    });

    expect(plan.source).toMatch(/fallback_/);
    expect(plan.outboundLegs.length).toBeGreaterThan(0);
  });

  it('falls back when LLM payload fails validation (missing legs)', async () => {
    mockedCallGemini.mockResolvedValueOnce(
      makeLlmResponse({ mode: 'plane', reasoning: 'ok', outboundLegs: [], returnLegs: [], totalOutboundMin: 0, totalReturnMin: 0, totalCostEur: 0 }),
    );

    const plan = await buildTransportPlan({
      origin: 'Paris-unique2',
      destination: 'Rome-unique2',
      startDate: new Date('2026-09-01'),
      endDate: new Date('2026-09-04'),
      groupSize: 1,
    });

    expect(plan.source).toMatch(/fallback_/);
  });
});
