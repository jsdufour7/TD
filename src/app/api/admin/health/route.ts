import { requireAdmin } from '@/auth/guards';
import { jsonError, jsonOk } from '@/lib/api';
import { collectDetailedHealthReport } from '@/platform/health';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    await requireAdmin();
    const report = await collectDetailedHealthReport();
    return jsonOk(report, report.ok ? 200 : 503);
  } catch (error) {
    return jsonError(error);
  }
}
