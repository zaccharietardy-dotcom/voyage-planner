import { NextRequest, NextResponse } from 'next/server';
import { collectDependencyHealth } from '@/lib/integrations/collector';
import { requireAdmin } from '@/lib/server/adminAuth';

export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const mode = url.searchParams.get('test') === 'true' ? 'deep' : 'config_only';
  const report = await collectDependencyHealth({ mode });

  return NextResponse.json({
    summary: report.summary,
    integrations: report.integrations.map((integration) => ({
      ...integration,
      surface: integration.surfaces,
      auth_ok: integration.authOk,
      fallback_ok: integration.fallbackOk,
      latency_ms: integration.latencyMs,
      last_error: integration.lastError,
    })),
  }, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
