import { NextRequest, NextResponse } from 'next/server';
import { generateDurationSuggestion, generateDestinationSuggestions } from '@/lib/services/suggestions';
import type { ActivityType, BudgetLevel, GroupType } from '@/lib/types';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { deriveBillingState, fetchEntitlementsForUser } from '@/lib/server/billingEntitlements';
import { checkAndIncrementRateLimit } from '@/lib/server/dbRateLimit';

export const maxDuration = 30; // 30 seconds max

const FREE_HOURLY_LIMIT = 30;
const PRO_HOURLY_LIMIT = 120;
const STRING_MAX_LENGTH = 120;
const ACTIVITY_TYPES = new Set<ActivityType>([
  'beach',
  'nature',
  'culture',
  'gastronomy',
  'nightlife',
  'shopping',
  'adventure',
  'wellness',
]);
const BUDGET_LEVELS = new Set<BudgetLevel>(['economic', 'moderate', 'comfort', 'luxury']);
const GROUP_TYPES = new Set<GroupType>(['solo', 'couple', 'friends', 'family_with_kids', 'family_without_kids']);

interface DurationSuggestBody {
  type: 'duration';
  destination: string;
  activities?: ActivityType[];
  budgetLevel?: BudgetLevel;
  groupType?: GroupType;
}

interface DestinationSuggestBody {
  type: 'destination';
  query: string;
  origin?: string;
  activities?: ActivityType[];
  vibes?: ActivityType[];
  budgetLevel?: BudgetLevel;
  groupType?: GroupType;
  durationDays?: number;
}

type SuggestBody = DurationSuggestBody | DestinationSuggestBody;

function getClientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
}

function asTrimmedString(value: unknown, field: string, required: boolean): string | undefined {
  if (value === undefined || value === null) {
    if (required) throw new Error(`${field} requis`);
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new Error(`${field} doit être une chaîne`);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    if (required) throw new Error(`${field} requis`);
    return undefined;
  }

  if (trimmed.length > STRING_MAX_LENGTH) {
    throw new Error(`${field} trop long (max ${STRING_MAX_LENGTH})`);
  }

  return trimmed;
}

function asActivityTypes(value: unknown): ActivityType[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new Error('activities doit être un tableau');
  }

  const normalized = value.map((item) => {
    if (typeof item !== 'string') {
      throw new Error('activities contient une valeur invalide');
    }
    return item.trim() as ActivityType;
  });

  for (const item of normalized) {
    if (!ACTIVITY_TYPES.has(item)) {
      throw new Error(`activity invalide: ${item}`);
    }
  }
  return normalized;
}

function asBudgetLevel(value: unknown): BudgetLevel | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error('budgetLevel doit être une chaîne');
  const normalized = value.trim() as BudgetLevel;
  if (!BUDGET_LEVELS.has(normalized)) throw new Error('budgetLevel invalide');
  return normalized;
}

function asGroupType(value: unknown): GroupType | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new Error('groupType doit être une chaîne');
  const normalized = value.trim() as GroupType;
  if (!GROUP_TYPES.has(normalized)) throw new Error('groupType invalide');
  return normalized;
}

function asDurationDays(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error('durationDays doit être un entier');
  }
  if (value < 1 || value > 30) {
    throw new Error('durationDays doit être compris entre 1 et 30');
  }
  return value;
}

function parseSuggestBody(payload: unknown): SuggestBody {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Payload invalide');
  }

  const body = payload as Record<string, unknown>;
  const type = body.type;
  if (type !== 'duration' && type !== 'destination') {
    throw new Error('Type de suggestion invalide. Utilisez "duration" ou "destination".');
  }

  if (type === 'duration') {
    const destination = asTrimmedString(body.destination, 'destination', true);
    return {
      type: 'duration',
      destination: destination || '',
      activities: asActivityTypes(body.activities),
      budgetLevel: asBudgetLevel(body.budgetLevel),
      groupType: asGroupType(body.groupType),
    };
  }

  const query = asTrimmedString(body.query, 'query', true);
  return {
    type: 'destination',
    query: query || '',
    origin: asTrimmedString(body.origin, 'origin', false),
    activities: asActivityTypes(body.activities),
    vibes: asActivityTypes(body.vibes),
    budgetLevel: asBudgetLevel(body.budgetLevel),
    groupType: asGroupType(body.groupType),
    durationDays: asDurationDays(body.durationDays),
  };
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createRouteHandlerClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 });
    }

    const body = parseSuggestBody(await request.json().catch(() => null));

    const { data: profile } = await supabase
      .from('profiles')
      .select('subscription_status, subscription_ends_at')
      .eq('id', user.id)
      .single();

    const entitlements = await fetchEntitlementsForUser(supabase, user.id);
    const billingState = deriveBillingState(profile, entitlements);
    const hourlyLimit = billingState.status === 'pro' ? PRO_HOURLY_LIMIT : FREE_HOURLY_LIMIT;
    const ip = getClientIp(request);

    const rateLimit = await checkAndIncrementRateLimit(
      supabase as any,
      `suggest:${user.id}:${ip}`,
      hourlyLimit,
      3600
    );

    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Trop de requêtes de suggestion. Réessayez plus tard.', code: 'RATE_LIMIT_EXCEEDED' },
        {
          status: 429,
          headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) },
        }
      );
    }

    if (body.type === 'duration') {
      const suggestion = await generateDurationSuggestion(body.destination, {
        activities: body.activities,
        budgetLevel: body.budgetLevel,
        groupType: body.groupType,
      });
      return NextResponse.json({ type: 'duration', duration: suggestion });
    }

    const mergedActivities = Array.from(new Set([
      ...(body.activities || []),
      ...(body.vibes || []),
    ]));
    const suggestions = await generateDestinationSuggestions(body.query, {
      origin: body.origin,
      activities: mergedActivities.length > 0 ? mergedActivities : undefined,
      budgetLevel: body.budgetLevel,
      groupType: body.groupType,
      durationDays: body.durationDays,
    });

    return NextResponse.json({ type: 'destination', destinations: suggestions });
  } catch (error) {
    if (error instanceof Error) {
      const validationError = [
        'Payload invalide',
        'Type de suggestion invalide. Utilisez "duration" ou "destination".',
        'destination requis',
        'destination doit être une chaîne',
        `destination trop long (max ${STRING_MAX_LENGTH})`,
        'query requis',
        'query doit être une chaîne',
        `query trop long (max ${STRING_MAX_LENGTH})`,
        'origin doit être une chaîne',
        `origin trop long (max ${STRING_MAX_LENGTH})`,
        'activities doit être un tableau',
        'activities contient une valeur invalide',
        'budgetLevel doit être une chaîne',
        'budgetLevel invalide',
        'groupType doit être une chaîne',
        'groupType invalide',
        'durationDays doit être un entier',
        'durationDays doit être compris entre 1 et 30',
      ].includes(error.message) || error.message.startsWith('activity invalide:');

      if (validationError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
    }

    console.error('[Suggest API] Error:', error);
    return NextResponse.json(
      { error: 'Erreur lors de la génération des suggestions' },
      { status: 500 }
    );
  }
}
