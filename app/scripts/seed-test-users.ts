import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(__dirname, '../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TEST_USERS = [
  { email: 'test1@voyage-dev.local', password: 'testpass123', displayName: 'Alice Test' },
  { email: 'test2@voyage-dev.local', password: 'testpass123', displayName: 'Bob Test' },
  { email: 'test3@voyage-dev.local', password: 'testpass123', displayName: 'Charlie Test' },
];

async function seedTestUsers() {
  console.log('🌱 Création des comptes de test...\n');

  for (const user of TEST_USERS) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: user.email,
      password: user.password,
      email_confirm: true,
      user_metadata: { display_name: user.displayName },
    });

    if (error) {
      if (error.message?.includes('already been registered')) {
        console.log(`  ✓ ${user.email} existe déjà`);
      } else {
        console.error(`  ✗ Erreur pour ${user.email}: ${error.message}`);
      }
      continue;
    }

    // Create profile
    await supabase.from('profiles').upsert({
      id: data.user.id,
      email: user.email,
      display_name: user.displayName,
    }, { onConflict: 'id' });

    console.log(`  ✓ ${user.email} créé (id: ${data.user.id})`);
  }

  console.log('\n📋 Comptes de test:');
  console.log('┌─────────────────────────────┬──────────────┐');
  console.log('│ Email                       │ Mot de passe │');
  console.log('├─────────────────────────────┼──────────────┤');
  for (const user of TEST_USERS) {
    console.log(`│ ${user.email.padEnd(27)} │ ${user.password.padEnd(12)} │`);
  }
  console.log('└─────────────────────────────┴──────────────┘');
  console.log('\nConnecte-toi sur /login avec ces identifiants.');
}

seedTestUsers().catch(console.error);
