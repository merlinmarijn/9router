import { NextResponse } from "next/server";
import { getUsageLog } from "@/lib/usageDb";

export const dynamic = "force-dynamic";

/**
 * GET /api/usage/request-log
 * Paginated request log backed by usage history (recorded for every request,
 * independent of the opt-in observability setting).
 * Query parameters: page, pageSize (1-100), provider, connectionId, status (success|error), startDate
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page")) || 1;
    const pageSize = parseInt(searchParams.get("pageSize")) || 25;
    if (page < 1 || pageSize < 1 || pageSize > 100) {
      return NextResponse.json({ error: "Invalid page or pageSize" }, { status: 400 });
    }

    const result = await getUsageLog({
      page,
      pageSize,
      provider: searchParams.get("provider") || undefined,
      connectionId: searchParams.get("connectionId") || undefined,
      status: searchParams.get("status") || undefined,
      startDate: searchParams.get("startDate") || undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[API] Failed to get request log:", error);
    return NextResponse.json({ error: "Failed to fetch request log" }, { status: 500 });
  }
}
