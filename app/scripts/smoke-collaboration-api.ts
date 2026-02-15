import { createClient } from '@supabase/supabase-js';
import { createBrowserClient } from '@supabase/ssr';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(__dirname, '../.env.local') });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const BASE_URL = process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3100';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase env vars in app/.env.local');
}

const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

type TestUser = {
  email: string;
  password: string;
  displayName: string;
  id: string;
};

type CookieItem = { name: string; value: string };

class CookieJar {
  private jar = new Map<string, string>();

  getAll(): CookieItem[] {
    return Array.from(this.jar.entries()).map(([name, value]) => ({ name, value }));
  }

  setAll(items: Array<{ name: string; value: string }>) {
    for (const item of items) {
      this.jar.set(item.name, item.value);
    }
  }

  header(): string {
    return Array.from(this.jar.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join('; ');
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function ensureUser(email: string, password: string, displayName: string): Promise<TestUser> {
  const { data: existingProfile } = await service
    .from('profiles')
    .select('id, email, display_name')
    .eq('email', email)
    .maybeSingle();

  if (existingProfile?.id) {
    return {
      email,
      password,
      displayName,
      id: existingProfile.id,
    };
  }

  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { display_name: displayName },
  });

  if (error && !error.message?.includes('already been registered')) {
    throw new Error(`Failed creating ${email}: ${error.message}`);
  }

  let userId = data?.user?.id || '';
  if (!userId) {
    const { data: usersData, error: listError } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listError) throw new Error(`listUsers failed: ${listError.message}`);
    const found = usersData.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    assert(found?.id, `Cannot find user id for ${email}`);
    userId = found.id;
  }

  const { error: profileError } = await service.from('profiles').upsert({
    id: userId,
    email,
    display_name: displayName,
  }, { onConflict: 'id' });

  if (profileError) throw new Error(`profile upsert failed for ${email}: ${profileError.message}`);

  return { email, password, displayName, id: userId };
}

async function createAuthedApiClient(user: TestUser) {
  const jar = new CookieJar();
  const browser = createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (cookies) => jar.setAll(cookies),
    },
  });

  const { data, error } = await browser.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });

  if (error || !data.user) {
    throw new Error(`signIn failed for ${user.email}: ${error?.message || 'unknown error'}`);
  }

  async function api(path: string, init?: RequestInit) {
    const headers = new Headers(init?.headers || {});
    headers.set('cookie', jar.header());
    if (init?.body && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }

    const response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers,
    });

    const text = await response.text();
    let json: any = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = { raw: text };
      }
    }

    return { response, json };
  }

  return { user: data.user, api, jar };
}

async function deleteTripsByPrefix(ownerId: string, prefix: string) {
  const { data: trips, error } = await service
    .from('trips')
    .select('id, title, owner_id')
    .eq('owner_id', ownerId)
    .ilike('title', `${prefix}%`);

  if (error) throw new Error(`cleanup query failed: ${error.message}`);
  for (const trip of trips || []) {
    const { error: delError } = await service.from('trips').delete().eq('id', trip.id);
    if (delError) throw new Error(`cleanup delete failed for ${trip.id}: ${delError.message}`);
  }
}

async function main() {
  const now = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const prefix = `[SMOKE-COLLAB-${now}]`;

  console.log(`Smoke base URL: ${BASE_URL}`);

  const owner = await ensureUser('test1@voyage-dev.local', 'testpass123', 'Alice Test');
  const invited = await ensureUser('test2@voyage-dev.local', 'testpass123', 'Bob Test');
  const joiner = await ensureUser('test3@voyage-dev.local', 'testpass123', 'Charlie Test');

  await deleteTripsByPrefix(owner.id, '[SMOKE-COLLAB-');

  const ownerClient = await createAuthedApiClient(owner);
  const invitedClient = await createAuthedApiClient(invited);
  const joinerClient = await createAuthedApiClient(joiner);

  const createPayload = {
    title: `${prefix} Rome`,
    destination: 'Rome',
    startDate: '2026-04-10',
    durationDays: 4,
    preferences: {
      destination: 'Rome',
      startDate: '2026-04-10',
      durationDays: 4,
      budgetLevel: 'moderate',
      groupSize: 2,
      groupType: 'couple',
      activities: ['culture'],
    },
    data: {},
  };

  const created = await ownerClient.api('/api/trips', {
    method: 'POST',
    body: JSON.stringify(createPayload),
  });
  assert(created.response.status === 200, `owner create trip failed: ${created.response.status} ${JSON.stringify(created.json)}`);
  const tripId = created.json?.id as string;
  const shareCode = created.json?.share_code as string;
  assert(tripId, 'missing trip id from create response');
  assert(shareCode, 'missing share_code from create response');
  console.log(`✓ Owner created trip: ${tripId} (share=${shareCode})`);

  const ownerList = await ownerClient.api('/api/trips');
  assert(ownerList.response.status === 200, `owner list failed: ${ownerList.response.status}`);
  const ownerTrip = (ownerList.json as any[]).find((t) => t.id === tripId);
  assert(ownerTrip, 'owner list missing created trip');
  assert(ownerTrip.userRole === 'owner', `owner role mismatch: ${ownerTrip.userRole}`);
  console.log('✓ Owner list contains trip with owner role');

  const invitedListBefore = await invitedClient.api('/api/trips');
  assert(invitedListBefore.response.status === 200, `invited list before failed: ${invitedListBefore.response.status}`);
  const invitedBeforeTrip = (invitedListBefore.json as any[]).find((t) => t.id === tripId);
  assert(!invitedBeforeTrip, 'invited user should not see trip before invite');
  console.log('✓ Invited user does not see trip before invitation');

  const inviteRes = await ownerClient.api(`/api/trips/${tripId}/invite`, {
    method: 'POST',
    body: JSON.stringify({ user_id: invited.id, role: 'editor' }),
  });
  assert(inviteRes.response.status === 200, `invite failed: ${inviteRes.response.status} ${JSON.stringify(inviteRes.json)}`);
  console.log('✓ Owner invited second user as editor');

  const invitedListAfter = await invitedClient.api('/api/trips');
  assert(invitedListAfter.response.status === 200, `invited list after failed: ${invitedListAfter.response.status}`);
  const invitedTrip = (invitedListAfter.json as any[]).find((t) => t.id === tripId);
  assert(invitedTrip, 'invited user does not see trip after invite');
  assert(invitedTrip.userRole === 'editor', `invited role mismatch: ${invitedTrip.userRole}`);
  assert(invitedTrip.isInvited === true, `invited flag mismatch: ${invitedTrip.isInvited}`);
  console.log('✓ Invited user sees trip in /api/trips with editor role + isInvited');

  const invitedGetTrip = await invitedClient.api(`/api/trips/${tripId}`);
  assert(invitedGetTrip.response.status === 200, `invited get trip failed: ${invitedGetTrip.response.status} ${JSON.stringify(invitedGetTrip.json)}`);
  assert(invitedGetTrip.json?.userRole === 'editor', `invited get trip role mismatch: ${invitedGetTrip.json?.userRole}`);
  console.log('✓ Invited user can open /api/trips/[id]');

  const invitedPatch = await invitedClient.api(`/api/trips/${tripId}`, {
    method: 'PATCH',
    body: JSON.stringify({ title: `${prefix} edited-by-invited` }),
  });
  assert(invitedPatch.response.status === 403, `invited PATCH should be forbidden, got ${invitedPatch.response.status}`);
  console.log('✓ Invited user cannot PATCH owner-only trip fields');

  const ownerPatch = await ownerClient.api(`/api/trips/${tripId}`, {
    method: 'PATCH',
    body: JSON.stringify({ title: `${prefix} owner-updated` }),
  });
  assert(ownerPatch.response.status === 200, `owner PATCH failed: ${ownerPatch.response.status} ${JSON.stringify(ownerPatch.json)}`);
  console.log('✓ Owner can PATCH trip');

  const joinByCode = await joinerClient.api('/api/trips/join', {
    method: 'POST',
    body: JSON.stringify({ code: shareCode }),
  });
  assert(joinByCode.response.status === 200, `join by code failed: ${joinByCode.response.status} ${JSON.stringify(joinByCode.json)}`);
  assert(['joined', 'already_member'].includes(joinByCode.json?.status), `unexpected join status: ${joinByCode.json?.status}`);
  console.log(`✓ Third user joined with share code (${joinByCode.json?.status})`);

  const joinerList = await joinerClient.api('/api/trips');
  assert(joinerList.response.status === 200, `joiner list failed: ${joinerList.response.status}`);
  const joinerTrip = (joinerList.json as any[]).find((t) => t.id === tripId);
  assert(joinerTrip, 'joiner does not see joined trip in /api/trips');
  assert(joinerTrip.userRole === 'viewer', `joiner role mismatch: ${joinerTrip.userRole}`);
  console.log('✓ Joiner sees trip in /api/trips with viewer role');

  const joinerGetTrip = await joinerClient.api(`/api/trips/${tripId}`);
  assert(joinerGetTrip.response.status === 200, `joiner get trip failed: ${joinerGetTrip.response.status}`);
  assert(joinerGetTrip.json?.userRole === 'viewer', `joiner userRole mismatch: ${joinerGetTrip.json?.userRole}`);
  console.log('✓ Joiner can open trip detail');

  const ownerDelete = await ownerClient.api(`/api/trips/${tripId}`, { method: 'DELETE' });
  assert(ownerDelete.response.status === 200, `owner delete failed: ${ownerDelete.response.status}`);
  console.log('✓ Owner deleted smoke trip');

  console.log('\n✅ Collaboration smoke test passed end-to-end.');
}

main().catch((error) => {
  console.error('\n❌ Collaboration smoke test failed:', error);
  process.exit(1);
});

