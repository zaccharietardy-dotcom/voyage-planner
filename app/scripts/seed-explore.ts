/**
 * seed-explore.ts
 *
 * Populates the explore page with fake profiles, public trips, likes, and follows.
 * All seed data is tagged with [SEED] in the profile bio for easy identification.
 *
 * Usage:
 *   npx tsx scripts/seed-explore.ts            # Insert seed data
 *   npx tsx scripts/seed-explore.ts --clean     # Remove all seed data
 *   npx tsx scripts/seed-explore.ts --dry-run   # Preview what would be inserted
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';
import { randomUUID } from 'crypto';

dotenv.config({ path: resolve(__dirname, '../.env.local') });

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ADMIN_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local',
  );
  process.exit(1);
}

const supabase: SupabaseClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const SEED_TAG = '[SEED]';
const args = process.argv.slice(2);
const FLAG_CLEAN = args.includes('--clean');
const FLAG_DRY_RUN = args.includes('--dry-run');

// ---------------------------------------------------------------------------
// Fake profiles
// ---------------------------------------------------------------------------

interface SeedProfile {
  email: string;
  display_name: string;
  bio: string;
  avatar_seed: string; // used as DiceBear seed
}

const PROFILES: SeedProfile[] = [
  { email: 'seed-marie@voyage.local', display_name: 'Marie Dupont', bio: `${SEED_TAG} Amoureuse de la dolce vita et des petits cafes caches. Je voyage pour la cuisine et les rencontres.`, avatar_seed: 'marie-dupont' },
  { email: 'seed-yuki@voyage.local', display_name: 'Yuki Tanaka', bio: `${SEED_TAG} Tokyo born, world explorer. I chase sunsets and street food across continents.`, avatar_seed: 'yuki-tanaka' },
  { email: 'seed-james@voyage.local', display_name: 'James Mitchell', bio: `${SEED_TAG} Backpacker at heart, luxury traveler by accident. Always looking for the next adventure.`, avatar_seed: 'james-mitchell' },
  { email: 'seed-sofia@voyage.local', display_name: 'Sofia Rossi', bio: `${SEED_TAG} Italiana con la valigia sempre pronta. Adoro i mercati locali e l'architettura medievale.`, avatar_seed: 'sofia-rossi' },
  { email: 'seed-lucas@voyage.local', display_name: 'Lucas Martin', bio: `${SEED_TAG} Photographe de voyage. Chaque destination est un nouveau chapitre de mon portfolio.`, avatar_seed: 'lucas-martin' },
  { email: 'seed-aisha@voyage.local', display_name: 'Aisha Benali', bio: `${SEED_TAG} Je planifie mes voyages autour des festivals et de la musique live. Carnet de route en main.`, avatar_seed: 'aisha-benali' },
  { email: 'seed-chen@voyage.local', display_name: 'Chen Wei', bio: `${SEED_TAG} History nerd and architecture geek. I travel to walk through time.`, avatar_seed: 'chen-wei' },
  { email: 'seed-emma@voyage.local', display_name: 'Emma Johansson', bio: `${SEED_TAG} Scandinavian minimalist who loves chaotic markets. Life is about contrasts.`, avatar_seed: 'emma-johansson' },
  { email: 'seed-diego@voyage.local', display_name: 'Diego Fernandez', bio: `${SEED_TAG} De Madrid al mundo. Viajo lento, como bien, y siempre vuelvo con historias.`, avatar_seed: 'diego-fernandez' },
  { email: 'seed-priya@voyage.local', display_name: 'Priya Sharma', bio: `${SEED_TAG} Solo traveler. Mountains over beaches, chai over coffee, experiences over things.`, avatar_seed: 'priya-sharma' },
  { email: 'seed-thomas@voyage.local', display_name: 'Thomas Berger', bio: `${SEED_TAG} Berliner Weltenbummler. Ich reise, um neue Perspektiven zu entdecken.`, avatar_seed: 'thomas-berger' },
  { email: 'seed-mia@voyage.local', display_name: 'Mia Johnson', bio: `${SEED_TAG} Travel blogger and coffee addict. If there's a rooftop bar, I'll find it.`, avatar_seed: 'mia-johnson' },
  { email: 'seed-kenji@voyage.local', display_name: 'Kenji Nakamura', bio: `${SEED_TAG} Foodie traveler from Osaka. I judge every city by its ramen and pastries.`, avatar_seed: 'kenji-nakamura' },
  { email: 'seed-camille@voyage.local', display_name: 'Camille Leroy', bio: `${SEED_TAG} Voyageuse culturelle. Musees le matin, street art l'apres-midi, jazz le soir.`, avatar_seed: 'camille-leroy' },
  { email: 'seed-omar@voyage.local', display_name: 'Omar Hassan', bio: `${SEED_TAG} From Marrakech with wanderlust. I love blending into local life wherever I go.`, avatar_seed: 'omar-hassan' },
  { email: 'seed-anna@voyage.local', display_name: 'Anna Kowalski', bio: `${SEED_TAG} Weekend city-breaker. I pack light, walk everywhere, and always get lost on purpose.`, avatar_seed: 'anna-kowalski' },
  { email: 'seed-ravi@voyage.local', display_name: 'Ravi Patel', bio: `${SEED_TAG} Engineer by day, traveler by weekend. Data-driven itineraries, spontaneous detours.`, avatar_seed: 'ravi-patel' },
  { email: 'seed-lisa@voyage.local', display_name: 'Lisa Andersen', bio: `${SEED_TAG} Sustainable traveler. Slow trains, local stays, zero regrets.`, avatar_seed: 'lisa-andersen' },
];

function avatarUrl(seed: string): string {
  return `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(seed)}`;
}

// ---------------------------------------------------------------------------
// Destinations with metadata
// ---------------------------------------------------------------------------

interface Destination {
  city: string;
  country: string;
  lat: number;
  lng: number;
  landmarks: { name: string; lat: number; lng: number }[];
}

const DESTINATIONS: Destination[] = [
  {
    city: 'Paris', country: 'France', lat: 48.8566, lng: 2.3522,
    landmarks: [
      { name: 'Tour Eiffel', lat: 48.8584, lng: 2.2945 },
      { name: 'Musee du Louvre', lat: 48.8606, lng: 2.3376 },
      { name: 'Sacre-Coeur', lat: 48.8867, lng: 2.3431 },
    ],
  },
  {
    city: 'Tokyo', country: 'Japan', lat: 35.6762, lng: 139.6503,
    landmarks: [
      { name: 'Senso-ji Temple', lat: 35.7148, lng: 139.7967 },
      { name: 'Shibuya Crossing', lat: 35.6595, lng: 139.7004 },
      { name: 'Meiji Shrine', lat: 35.6764, lng: 139.6993 },
    ],
  },
  {
    city: 'New York', country: 'USA', lat: 40.7128, lng: -74.0060,
    landmarks: [
      { name: 'Central Park', lat: 40.7829, lng: -73.9654 },
      { name: 'Statue of Liberty', lat: 40.6892, lng: -74.0445 },
      { name: 'Brooklyn Bridge', lat: 40.7061, lng: -73.9969 },
    ],
  },
  {
    city: 'London', country: 'UK', lat: 51.5074, lng: -0.1278,
    landmarks: [
      { name: 'Tower of London', lat: 51.5081, lng: -0.0759 },
      { name: 'British Museum', lat: 51.5194, lng: -0.1270 },
      { name: 'Buckingham Palace', lat: 51.5014, lng: -0.1419 },
    ],
  },
  {
    city: 'Rome', country: 'Italy', lat: 41.9028, lng: 12.4964,
    landmarks: [
      { name: 'Colosseum', lat: 41.8902, lng: 12.4922 },
      { name: 'Vatican Museums', lat: 41.9065, lng: 12.4536 },
      { name: 'Trevi Fountain', lat: 41.9009, lng: 12.4833 },
    ],
  },
  {
    city: 'Barcelona', country: 'Spain', lat: 41.3874, lng: 2.1686,
    landmarks: [
      { name: 'Sagrada Familia', lat: 41.4036, lng: 2.1744 },
      { name: 'Park Guell', lat: 41.4145, lng: 2.1527 },
      { name: 'La Rambla', lat: 41.3797, lng: 2.1746 },
    ],
  },
  {
    city: 'Amsterdam', country: 'Netherlands', lat: 52.3676, lng: 4.9041,
    landmarks: [
      { name: 'Rijksmuseum', lat: 52.3600, lng: 4.8852 },
      { name: 'Anne Frank House', lat: 52.3752, lng: 4.8840 },
      { name: 'Vondelpark', lat: 52.3579, lng: 4.8686 },
    ],
  },
  {
    city: 'Berlin', country: 'Germany', lat: 52.5200, lng: 13.4050,
    landmarks: [
      { name: 'Brandenburg Gate', lat: 52.5163, lng: 13.3777 },
      { name: 'East Side Gallery', lat: 52.5051, lng: 13.4399 },
      { name: 'Museum Island', lat: 52.5169, lng: 13.4019 },
    ],
  },
  {
    city: 'Istanbul', country: 'Turkey', lat: 41.0082, lng: 28.9784,
    landmarks: [
      { name: 'Hagia Sophia', lat: 41.0086, lng: 28.9802 },
      { name: 'Grand Bazaar', lat: 41.0107, lng: 28.9681 },
      { name: 'Blue Mosque', lat: 41.0054, lng: 28.9768 },
    ],
  },
  {
    city: 'Marrakech', country: 'Morocco', lat: 31.6295, lng: -7.9811,
    landmarks: [
      { name: 'Jemaa el-Fnaa', lat: 31.6258, lng: -7.9891 },
      { name: 'Majorelle Garden', lat: 31.6417, lng: -8.0031 },
      { name: 'Bahia Palace', lat: 31.6216, lng: -7.9830 },
    ],
  },
  {
    city: 'Lisbon', country: 'Portugal', lat: 38.7223, lng: -9.1393,
    landmarks: [
      { name: 'Belem Tower', lat: 38.6916, lng: -9.2160 },
      { name: 'Alfama District', lat: 38.7118, lng: -9.1301 },
      { name: 'Praca do Comercio', lat: 38.7075, lng: -9.1364 },
    ],
  },
  {
    city: 'Bangkok', country: 'Thailand', lat: 13.7563, lng: 100.5018,
    landmarks: [
      { name: 'Grand Palace', lat: 13.7500, lng: 100.4914 },
      { name: 'Wat Arun', lat: 13.7437, lng: 100.4888 },
      { name: 'Chatuchak Market', lat: 13.7999, lng: 100.5505 },
    ],
  },
  {
    city: 'Bali', country: 'Indonesia', lat: -8.3405, lng: 115.0920,
    landmarks: [
      { name: 'Ubud Monkey Forest', lat: -8.5182, lng: 115.2588 },
      { name: 'Tanah Lot Temple', lat: -8.6210, lng: 115.0868 },
      { name: 'Tegallalang Rice Terraces', lat: -8.4312, lng: 115.2793 },
    ],
  },
  {
    city: 'Dubai', country: 'UAE', lat: 25.2048, lng: 55.2708,
    landmarks: [
      { name: 'Burj Khalifa', lat: 25.1972, lng: 55.2744 },
      { name: 'Dubai Mall', lat: 25.1985, lng: 55.2796 },
      { name: 'Palm Jumeirah', lat: 25.1124, lng: 55.1390 },
    ],
  },
  {
    city: 'Madrid', country: 'Spain', lat: 40.4168, lng: -3.7038,
    landmarks: [
      { name: 'Prado Museum', lat: 40.4138, lng: -3.6921 },
      { name: 'Retiro Park', lat: 40.4153, lng: -3.6845 },
      { name: 'Royal Palace', lat: 40.4180, lng: -3.7142 },
    ],
  },
  {
    city: 'Seville', country: 'Spain', lat: 37.3891, lng: -5.9845,
    landmarks: [
      { name: 'Alcazar of Seville', lat: 37.3833, lng: -5.9907 },
      { name: 'Plaza de Espana', lat: 37.3772, lng: -5.9870 },
      { name: 'Seville Cathedral', lat: 37.3861, lng: -5.9930 },
    ],
  },
];

// ---------------------------------------------------------------------------
// Trip title templates
// ---------------------------------------------------------------------------

const TITLE_TEMPLATES = [
  (city: string, days: number) => `${days} jours a ${city}`,
  (city: string, days: number) => `${city} en ${days} jours`,
  (city: string, _days: number) => `Decouverte de ${city}`,
  (city: string, _days: number) => `Week-end a ${city}`,
  (city: string, _days: number) => `Explorer ${city}`,
  (city: string, days: number) => `${city} — ${days}j d'aventure`,
  (city: string, _days: number) => `Mon voyage a ${city}`,
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickN<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateShareCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/** Random date in the past N days */
function pastDate(maxDaysAgo: number): Date {
  const now = new Date();
  const daysAgo = randInt(1, maxDaysAgo);
  return new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
}

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 24 * 60 * 60 * 1000);
}

// ---------------------------------------------------------------------------
// Minimal trip data builder
// ---------------------------------------------------------------------------

function buildTripData(dest: Destination, durationDays: number, startDate: Date) {
  const days = [];

  for (let d = 0; d < durationDays; d++) {
    const dayDate = addDays(startDate, d);
    const items: any[] = [];

    // Pick 2-3 landmarks per day, cycling through available ones
    const dayLandmarks = [];
    for (let i = 0; i < randInt(2, 3); i++) {
      dayLandmarks.push(dest.landmarks[(d * 3 + i) % dest.landmarks.length]);
    }

    let orderIndex = 0;
    const startHour = 9;

    for (const lm of dayLandmarks) {
      const duration = randInt(60, 120);
      const hour = startHour + orderIndex * 2;
      items.push({
        id: randomUUID(),
        type: 'activity',
        title: lm.name,
        startTime: `${String(hour).padStart(2, '0')}:00`,
        endTime: `${String(hour + Math.floor(duration / 60)).padStart(2, '0')}:${String(duration % 60).padStart(2, '0')}`,
        latitude: lm.lat,
        longitude: lm.lng,
        orderIndex,
        duration,
      });
      orderIndex++;
    }

    days.push({
      dayNumber: d + 1,
      date: formatDate(dayDate),
      items,
      theme: d === 0 ? 'Arrivee et premiers pas' : `Jour ${d + 1}`,
    });
  }

  return {
    id: randomUUID(),
    days,
    accommodation: {
      name: `Hotel ${dest.city} Centre`,
      latitude: dest.lat + 0.002,
      longitude: dest.lng + 0.001,
      address: `1 Rue Principale, ${dest.city}`,
    },
  };
}

// ---------------------------------------------------------------------------
// Clean seed data
// ---------------------------------------------------------------------------

async function cleanSeedData() {
  console.log('Searching for seed profiles...');

  const { data: seedProfiles, error: profileErr } = await supabase
    .from('profiles')
    .select('id, display_name')
    .like('bio', `${SEED_TAG}%`);

  if (profileErr) {
    console.error('Error fetching seed profiles:', profileErr.message);
    return;
  }

  if (!seedProfiles || seedProfiles.length === 0) {
    console.log('No seed data found. Nothing to clean.');
    return;
  }

  const profileIds = seedProfiles.map((p) => p.id);
  console.log(`Found ${profileIds.length} seed profiles.`);

  // Delete in dependency order: likes, follows, trips, then profiles + auth users
  console.log('Deleting trip_likes from seed profiles...');
  const { error: likesErr } = await supabase
    .from('trip_likes')
    .delete()
    .in('user_id', profileIds);
  if (likesErr) console.error('  Error:', likesErr.message);

  // Also delete likes ON seed trips (from non-seed users)
  const { data: seedTrips } = await supabase
    .from('trips')
    .select('id')
    .in('owner_id', profileIds);
  const seedTripIds = seedTrips?.map((t) => t.id) || [];
  if (seedTripIds.length > 0) {
    const { error: likesOnTripsErr } = await supabase
      .from('trip_likes')
      .delete()
      .in('trip_id', seedTripIds);
    if (likesOnTripsErr) console.error('  Error:', likesOnTripsErr.message);
  }

  console.log('Deleting follows from seed profiles...');
  const { error: followsErr1 } = await supabase
    .from('follows')
    .delete()
    .in('follower_id', profileIds);
  if (followsErr1) console.error('  Error:', followsErr1.message);

  const { error: followsErr2 } = await supabase
    .from('follows')
    .delete()
    .in('following_id', profileIds);
  if (followsErr2) console.error('  Error:', followsErr2.message);

  console.log('Deleting trips from seed profiles...');
  const { error: tripsErr } = await supabase
    .from('trips')
    .delete()
    .in('owner_id', profileIds);
  if (tripsErr) console.error('  Error:', tripsErr.message);

  console.log('Deleting seed profiles...');
  const { error: profErr } = await supabase
    .from('profiles')
    .delete()
    .in('id', profileIds);
  if (profErr) console.error('  Error:', profErr.message);

  console.log('Deleting auth users...');
  for (const id of profileIds) {
    const { error: authErr } = await supabase.auth.admin.deleteUser(id);
    if (authErr) console.error(`  Error deleting auth user ${id}:`, authErr.message);
  }

  console.log(`Cleaned ${profileIds.length} profiles, ${seedTripIds.length} trips, and related data.`);
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

async function seedExplore() {
  // ---- Check if seed data already exists ----
  const { data: existing } = await supabase
    .from('profiles')
    .select('id')
    .like('bio', `${SEED_TAG}%`)
    .limit(1);

  if (existing && existing.length > 0) {
    console.log('Seed data already exists. Use --clean to remove it first, or --clean then re-run.');
    return;
  }

  // ---- Step 1: Create auth users + profiles ----
  console.log('\n--- Creating profiles ---');
  const profileIds: string[] = [];

  for (const p of PROFILES) {
    if (FLAG_DRY_RUN) {
      const fakeId = randomUUID();
      profileIds.push(fakeId);
      console.log(`  [DRY RUN] Would create: ${p.display_name} (${p.email})`);
      continue;
    }

    const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
      email: p.email,
      password: 'seed-password-123!',
      email_confirm: true,
      user_metadata: { display_name: p.display_name },
    });

    if (authErr) {
      console.error(`  Error creating ${p.email}:`, authErr.message);
      continue;
    }

    const userId = authData.user.id;
    profileIds.push(userId);

    const { error: profErr } = await supabase.from('profiles').upsert(
      {
        id: userId,
        email: p.email,
        display_name: p.display_name,
        bio: p.bio,
        avatar_url: avatarUrl(p.avatar_seed),
      },
      { onConflict: 'id' },
    );

    if (profErr) {
      console.error(`  Error upserting profile for ${p.email}:`, profErr.message);
    } else {
      console.log(`  Created: ${p.display_name}`);
    }
  }

  console.log(`  Total: ${profileIds.length} profiles`);

  if (profileIds.length === 0) {
    console.error('No profiles created. Aborting.');
    return;
  }

  // ---- Step 2: Create trips ----
  console.log('\n--- Creating trips ---');
  const tripRecords: Array<{
    id: string;
    owner_id: string;
    destination: string;
  }> = [];

  for (const dest of DESTINATIONS) {
    const numTrips = randInt(2, 3);

    for (let t = 0; t < numTrips; t++) {
      const duration = randInt(3, 7);
      const startDate = pastDate(90); // past 3 months
      const endDate = addDays(startDate, duration - 1);
      const ownerId = pick(profileIds);
      const titleFn = pick(TITLE_TEMPLATES);
      const title = titleFn(dest.city, duration);
      const tripId = randomUUID();
      const shareCode = generateShareCode();

      const tripData = buildTripData(dest, duration, startDate);
      tripData.id = tripId;

      const record = {
        id: tripId,
        owner_id: ownerId,
        name: title,
        title,
        destination: dest.city,
        start_date: formatDate(startDate),
        end_date: formatDate(endDate),
        duration_days: duration,
        preferences: {
          origin: dest.country,
          destination: dest.city,
          durationDays: duration,
          groupSize: randInt(1, 4),
          groupType: pick(['couple', 'friends', 'family', 'solo']),
          budgetLevel: pick(['budget', 'moderate', 'comfort', 'luxury']),
          activities: pickN(
            ['culture', 'gastronomy', 'nature', 'shopping', 'nightlife', 'sports'],
            randInt(2, 4),
          ),
        },
        data: tripData,
        share_code: shareCode,
        visibility: 'public' as const,
      };

      tripRecords.push({ id: tripId, owner_id: ownerId, destination: dest.city });

      if (FLAG_DRY_RUN) {
        console.log(`  [DRY RUN] Would create trip: "${title}" (${dest.city}, ${duration}d)`);
        continue;
      }

      const { error: tripErr } = await supabase.from('trips').insert(record);
      if (tripErr) {
        console.error(`  Error inserting trip "${title}":`, tripErr.message);
      } else {
        console.log(`  Created: "${title}" (${dest.city}, ${duration}d)`);
      }
    }
  }

  console.log(`  Total: ${tripRecords.length} trips`);

  // ---- Step 3: Create likes ----
  console.log('\n--- Creating likes ---');
  const likeSet = new Set<string>();
  const targetLikes = randInt(50, 100);
  let likesCreated = 0;

  while (likeSet.size < targetLikes && likeSet.size < profileIds.length * tripRecords.length) {
    const userId = pick(profileIds);
    const trip = pick(tripRecords);

    // Don't like your own trip
    if (trip.owner_id === userId) continue;

    const key = `${userId}:${trip.id}`;
    if (likeSet.has(key)) continue;
    likeSet.add(key);

    if (FLAG_DRY_RUN) {
      likesCreated++;
      continue;
    }

    const { error } = await supabase.from('trip_likes').insert({
      trip_id: trip.id,
      user_id: userId,
    });

    if (error) {
      // Likely duplicate or FK constraint — skip
      if (!error.message.includes('duplicate')) {
        console.error(`  Error inserting like:`, error.message);
      }
    } else {
      likesCreated++;
    }
  }

  console.log(`  Total: ${likesCreated} likes`);

  // ---- Step 4: Create follows ----
  console.log('\n--- Creating follows ---');
  const followSet = new Set<string>();
  const targetFollows = randInt(20, 30);
  let followsCreated = 0;

  while (followSet.size < targetFollows && followSet.size < profileIds.length * (profileIds.length - 1)) {
    const followerId = pick(profileIds);
    const followingId = pick(profileIds);

    if (followerId === followingId) continue;

    const key = `${followerId}:${followingId}`;
    if (followSet.has(key)) continue;
    followSet.add(key);

    if (FLAG_DRY_RUN) {
      followsCreated++;
      continue;
    }

    const { error } = await supabase.from('follows').insert({
      follower_id: followerId,
      following_id: followingId,
    });

    if (error) {
      if (!error.message.includes('duplicate')) {
        console.error(`  Error inserting follow:`, error.message);
      }
    } else {
      followsCreated++;
    }
  }

  console.log(`  Total: ${followsCreated} follows`);

  // ---- Summary ----
  console.log('\n--- Summary ---');
  console.log(`  Profiles:  ${profileIds.length}`);
  console.log(`  Trips:     ${tripRecords.length}`);
  console.log(`  Likes:     ${likesCreated}`);
  console.log(`  Follows:   ${followsCreated}`);

  if (FLAG_DRY_RUN) {
    console.log('\n  (DRY RUN — nothing was actually inserted)');
  } else {
    console.log('\n  Seed data inserted. Visit /explore to see it.');
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('=== seed-explore ===\n');

  if (FLAG_CLEAN) {
    console.log('Mode: CLEAN (removing all seed data)\n');
    if (FLAG_DRY_RUN) {
      console.log('(DRY RUN — would remove seed data but not actually doing it)\n');
      const { data: seedProfiles } = await supabase
        .from('profiles')
        .select('id, display_name')
        .like('bio', `${SEED_TAG}%`);
      if (seedProfiles && seedProfiles.length > 0) {
        console.log(`Would remove ${seedProfiles.length} profiles and all related data.`);
        for (const p of seedProfiles) {
          console.log(`  - ${p.display_name}`);
        }
      } else {
        console.log('No seed data found.');
      }
      return;
    }
    await cleanSeedData();
    return;
  }

  if (FLAG_DRY_RUN) {
    console.log('Mode: DRY RUN\n');
  }

  await seedExplore();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
