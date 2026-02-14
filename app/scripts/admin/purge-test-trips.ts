import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

const REQUIRED_CONFIRMATION = 'YES_DELETE_ALL_TRIPS';

dotenv.config({ path: resolve(__dirname, '../../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const tableNames = [
  'trips',
  'trip_members',
  'proposals',
  'votes',
  'trip_comments',
  'trip_photos',
  'activity_log',
  'expenses',
  'expense_splits',
  'settlements',
] as const;

type TableName = (typeof tableNames)[number];

function getConfirmValue(argv: string[]): string | null {
  const index = argv.indexOf('--confirm');
  if (index < 0 || index + 1 >= argv.length) {
    return null;
  }

  return argv[index + 1];
}

async function countRows(table: TableName): Promise<number | null> {
  const { count, error } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true });

  if (error) {
    console.warn(`[warn] Unable to count ${table}: ${error.message}`);
    return null;
  }

  return count ?? 0;
}

async function main() {
  const confirmValue = getConfirmValue(process.argv);

  if (confirmValue !== REQUIRED_CONFIRMATION) {
    console.error('Refusing to run without explicit confirmation.');
    console.error(`Usage: npx tsx scripts/admin/purge-test-trips.ts --confirm ${REQUIRED_CONFIRMATION}`);
    process.exit(1);
  }

  console.log('WARNING: purge requested, deleting ALL trips and cascade-linked records.');

  const beforeCounts = new Map<TableName, number | null>();
  for (const table of tableNames) {
    beforeCounts.set(table, await countRows(table));
  }

  const { error: deleteError } = await supabase
    .from('trips')
    .delete()
    .not('id', 'is', null);

  if (deleteError) {
    console.error(`Failed to delete trips: ${deleteError.message}`);
    process.exit(1);
  }

  const afterCounts = new Map<TableName, number | null>();
  for (const table of tableNames) {
    afterCounts.set(table, await countRows(table));
  }

  console.log('\nPurge summary by table:');
  for (const table of tableNames) {
    const before = beforeCounts.get(table);
    const after = afterCounts.get(table);

    if (before === null || after === null) {
      console.log(`- ${table}: skipped (count unavailable)`);
      continue;
    }

    const deleted = Math.max(0, before - after);
    console.log(`- ${table}: ${before} -> ${after} (deleted: ${deleted})`);
  }

  console.log('\nDone. Script remains guarded by --confirm YES_DELETE_ALL_TRIPS.');
}

main().catch((error) => {
  console.error('Unexpected error while purging trips:', error);
  process.exit(1);
});
