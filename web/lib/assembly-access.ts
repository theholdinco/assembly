import { query } from "@/lib/db";

export type AccessLevel = "owner" | "write" | "read" | null;

export async function getAssemblyAccess(
  assemblyId: string,
  userId: string
): Promise<AccessLevel> {
  const ownerRows = await query(
    "SELECT id FROM assemblies WHERE id = $1 AND user_id = $2",
    [assemblyId, userId]
  );
  if (ownerRows.length > 0) return "owner";

  const shareRows = await query<{ role: string }>(
    "SELECT role FROM assembly_shares WHERE assembly_id = $1 AND user_id = $2",
    [assemblyId, userId]
  );
  if (shareRows.length > 0) return shareRows[0].role as "read" | "write";

  return null;
}

/**
 * Resolve a slug to an assembly the caller can access.
 *
 * Slugs are only unique per owner (`UNIQUE (user_id, slug)`), so the same slug
 * can belong to several users. Only assemblies the caller owns or has been
 * shared are considered, the caller's own assembly wins, and the result is
 * ordered so it is deterministic. Callers must load the assembly and its
 * children by the returned `assemblyId`, never by slug again.
 */
export async function getAssemblyAccessBySlug(
  slug: string,
  userId: string
): Promise<{ access: AccessLevel; assemblyId: string | null }> {
  const rows = await query<{ id: string; is_owner: boolean; role: string | null }>(
    `SELECT a.id, a.user_id = $2 AS is_owner, s.role
     FROM assemblies a
     LEFT JOIN assembly_shares s ON s.assembly_id = a.id AND s.user_id = $2
     WHERE a.slug = $1 AND (a.user_id = $2 OR s.user_id IS NOT NULL)
     ORDER BY (a.user_id = $2) DESC, a.created_at DESC, a.id
     LIMIT 1`,
    [slug, userId]
  );
  if (rows.length === 0) return { access: null, assemblyId: null };

  const assembly = rows[0];
  if (assembly.is_owner) return { access: "owner", assemblyId: assembly.id };
  return { access: assembly.role as "read" | "write", assemblyId: assembly.id };
}
