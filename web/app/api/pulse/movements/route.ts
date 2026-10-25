import { NextRequest, NextResponse } from "next/server";
import { getMovements, type MovementFilters } from "@/lib/pulse/access";
import { pulseUnauthorized } from "@/lib/pulse/auth";

export async function GET(request: NextRequest) {
  const unauthorized = await pulseUnauthorized();
  if (unauthorized) return unauthorized;

  const { searchParams } = new URL(request.url);

  const filters: MovementFilters = {};
  if (searchParams.get("stage")) filters.stage = searchParams.get("stage")!;
  if (searchParams.get("minMomentum")) filters.minMomentum = Number(searchParams.get("minMomentum"));
  if (searchParams.get("search")) filters.search = searchParams.get("search")!;
  if (searchParams.get("limit")) filters.limit = Number(searchParams.get("limit"));
  if (searchParams.get("offset")) filters.offset = Number(searchParams.get("offset"));
  if (searchParams.get("sortBy")) filters.sortBy = searchParams.get("sortBy") as MovementFilters["sortBy"];
  if (searchParams.get("sortDir")) filters.sortDir = searchParams.get("sortDir") as MovementFilters["sortDir"];

  const movements = await getMovements(filters);
  return NextResponse.json(movements);
}
