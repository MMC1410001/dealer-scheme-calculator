/**
 * GET /admin/choices/history?upload=<id> or ?source=<API|ADMIN|...>&day=YYYY-MM-DD[&actor=<sender>]:
 * the reward choice changes of one history entry as CSV (src/server/reward-choice-history.ts).
 * Admin session required (roles ADMIN and CHOICES; the proxy also checks the path).
 */
import { getDb } from "@/db/client";
import { getAdminSession } from "@/lib/auth/admin-server";
import { canAccessAdminPath } from "@/lib/auth/admin-users";
import { choiceHistoryRows, historyCsv, historyFileName, parseHistorySelector } from "@/server/reward-choice-history";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const session = await getAdminSession();
  const url = new URL(request.url);
  if (!session || !canAccessAdminPath(session.role, url.pathname)) {
    return new Response("Log in again.", { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const selector = parseHistorySelector(url.searchParams);
  if (!selector) return new Response("The link is not valid.", { status: 400, headers: { "Cache-Control": "no-store" } });
  const rows = await choiceHistoryRows(getDb(), selector);
  return new Response(historyCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${historyFileName(selector)}"`,
      "Cache-Control": "no-store",
    },
  });
}
