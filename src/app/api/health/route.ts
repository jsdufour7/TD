import { jsonOk } from '@/lib/api';
import { collectPublicHealthReport } from '@/platform/health';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const report = await collectPublicHealthReport();
  return jsonOk(report, report.ok ? 200 : 503);
}
