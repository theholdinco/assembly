import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-helpers";
import { query } from "@/lib/db";

const ALLOWED_EXTENSIONS = new Set([
  "txt", "md", "csv", "json", "xml", "html", "css", "js", "ts", "tsx", "jsx",
  "py", "rb", "go", "rs", "java", "c", "cpp", "h", "hpp", "sh", "yaml", "yml",
  "toml", "sql", "svg", "pdf", "png", "jpg", "jpeg", "gif", "webp",
]);

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "csv", "json", "xml", "html", "css", "svg",
  "js", "ts", "tsx", "jsx", "py", "rb", "go", "rs",
  "java", "c", "cpp", "h", "hpp", "sh", "yaml", "yml",
  "toml", "sql",
]);

const MIME_BY_EXT: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const MAX_TOTAL_SIZE = 50 * 1024 * 1024; // 50MB total per assembly

async function verifyOwnership(assemblyId: string, userId: string) {
  const rows = await query(
    `SELECT id FROM assemblies WHERE id = $1 AND user_id = $2`,
    [assemblyId, userId]
  );
  return rows.length > 0;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: assemblyId } = await params;

  if (!(await verifyOwnership(assemblyId, user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Failed to parse upload — file may be too large" }, { status: 400 });
  }
  const file = formData.get("file") as File | null;

  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "File exceeds 20MB limit" }, { status: 400 });
  }

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return NextResponse.json({ error: "Unsupported file type" }, { status: 400 });
  }

  const [{ total_size }] = await query<{ total_size: number }>(
    `SELECT COALESCE(SUM((a->>'size')::int), 0) AS total_size
     FROM assemblies, jsonb_array_elements(attachments) AS a
     WHERE id = $1`,
    [assemblyId]
  );
  if (total_size + file.size > MAX_TOTAL_SIZE) {
    return NextResponse.json({ error: "Total attachments exceed 50MB limit" }, { status: 400 });
  }

  const isText = TEXT_EXTENSIONS.has(ext);
  const resolvedType = MIME_BY_EXT[ext] ?? file.type;

  const attachment: Record<string, unknown> = {
    name: file.name,
    type: resolvedType,
    size: file.size,
  };

  if (isText) {
    attachment.textContent = await file.text();
  } else {
    const buffer = Buffer.from(await file.arrayBuffer());
    attachment.base64 = buffer.toString("base64");
  }

  await query(
    `UPDATE assemblies
     SET attachments = COALESCE(attachments, '[]'::jsonb) || $1::jsonb
     WHERE id = $2 AND user_id = $3`,
    [JSON.stringify(attachment), assemblyId, user.id]
  );

  return NextResponse.json({
    name: file.name,
    type: resolvedType,
    size: file.size,
  });
}

// Flip status from 'uploading' to 'queued' after all uploads succeed
export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: assemblyId } = await params;

  if (!(await verifyOwnership(assemblyId, user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await query(
    `UPDATE assemblies SET status = 'queued' WHERE id = $1 AND status = 'uploading'`,
    [assemblyId]
  );

  return NextResponse.json({ ok: true });
}

// Abort: mark as error so worker won't pick it up with partial attachments
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: assemblyId } = await params;

  if (!(await verifyOwnership(assemblyId, user.id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await query(
    `UPDATE assemblies SET status = 'error', error_message = 'File upload failed'
     WHERE id = $1 AND status = 'uploading'`,
    [assemblyId]
  );

  return NextResponse.json({ ok: true });
}
