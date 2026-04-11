import { NextResponse } from 'next/server';
import { getLastProfiling } from '@/lib/services/profilingStore';

export async function GET() {
  const profiling = getLastProfiling();
  if (!profiling) {
    return NextResponse.json({ error: 'No profiling data yet. Run a generation first.' }, { status: 404 });
  }
  return NextResponse.json(profiling);
}
