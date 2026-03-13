import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-helpers";
import { query } from "@/lib/db";

export async function GET() {
  const user = await getCurrentUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await query(
    `SELECT id, name, tag, biography, framework, framework_name, blind_spot,
            heroes, rhetorical_tendencies, debate_style, avatar_url,
            source_assembly_id, created_at
     FROM saved_characters WHERE user_id = $1 ORDER BY created_at DESC`,
    [user.id]
  );

  return NextResponse.json(rows);
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { assemblyId, characterNumber } = await request.json();
  if (!assemblyId || characterNumber == null) {
    return NextResponse.json({ error: "assemblyId and characterNumber are required" }, { status: 400 });
  }

  const assemblies = await query<{
    parsed_data: {
      characters: Array<{
        number: number;
        name: string;
        tag: string;
        biography: string;
        framework: string;
        frameworkName: string;
        blindSpot: string;
        heroes: string[];
        rhetoricalTendencies: string;
        debateStyle: string;
        avatarUrl?: string;
      }>;
    };
  }>(
    `SELECT parsed_data FROM assemblies WHERE id = $1 AND user_id = $2`,
    [assemblyId, user.id]
  );

  if (!assemblies.length) {
    return NextResponse.json({ error: "Assembly not found" }, { status: 404 });
  }

  const characters = assemblies[0].parsed_data?.characters;
  const character = characters?.find((c) => c.number === characterNumber);

  if (!character) {
    return NextResponse.json({ error: "Character not found" }, { status: 404 });
  }

  const rows = await query(
    `INSERT INTO saved_characters (user_id, source_assembly_id, name, tag, biography, framework, framework_name, blind_spot, heroes, rhetorical_tendencies, debate_style, avatar_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (user_id, source_assembly_id, name) DO NOTHING
     RETURNING *`,
    [
      user.id,
      assemblyId,
      character.name,
      character.tag,
      character.biography,
      character.framework,
      character.frameworkName || "",
      character.blindSpot,
      JSON.stringify(character.heroes || []),
      character.rhetoricalTendencies || character.debateStyle || "",
      character.debateStyle || "",
      character.avatarUrl || null,
    ]
  );

  if (!rows.length) {
    const existing = await query(
      `SELECT * FROM saved_characters WHERE user_id = $1 AND source_assembly_id = $2 AND name = $3`,
      [user.id, assemblyId, character.name]
    );
    return NextResponse.json(existing[0]);
  }

  return NextResponse.json(rows[0], { status: 201 });
}
