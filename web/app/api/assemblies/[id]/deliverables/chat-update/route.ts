import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-helpers";
import { query } from "@/lib/db";
import { decryptApiKey } from "@/lib/crypto";
import { deliverableChatUpdatePrompt } from "@/worker/prompts";
import type { Topic, Deliverable } from "@/lib/types";
import { getAssemblyAccess } from "@/lib/assembly-access";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: assemblyId } = await params;

  const access = await getAssemblyAccess(assemblyId, user.id);
  if (!access || access === "read") {
    return NextResponse.json(
      { error: access ? "Read-only access" : "Not found" },
      { status: access ? 403 : 404 }
    );
  }

  const body = await request.json();
  const { conversationHistory } = body as {
    conversationHistory: { role: string; content: string }[];
  };

  if (!conversationHistory?.length) {
    return NextResponse.json(
      { error: "No conversation history provided" },
      { status: 400 }
    );
  }

  const assemblies = await query<{
    raw_files: Record<string, string>;
    parsed_data: Topic;
    topic_input: string;
  }>(
    "SELECT raw_files, parsed_data, topic_input FROM assemblies WHERE id = $1",
    [assemblyId]
  );

  if (!assemblies.length) {
    return NextResponse.json({ error: "Assembly not found" }, { status: 404 });
  }

  const { raw_files, parsed_data, topic_input } = assemblies[0];
  const currentDeliverables = parsed_data.deliverables || [];

  if (currentDeliverables.length === 0) {
    return NextResponse.json(
      { error: "No existing deliverable to update" },
      { status: 400 }
    );
  }

  const latestDeliverable = currentDeliverables[currentDeliverables.length - 1];
  const synthesis = raw_files["synthesis.md"] || "";

  const prompt = deliverableChatUpdatePrompt(
    topic_input,
    latestDeliverable.content,
    conversationHistory,
    synthesis
  );

  const userRows = await query<{
    encrypted_api_key: Buffer;
    api_key_iv: Buffer;
  }>(
    "SELECT encrypted_api_key, api_key_iv FROM users WHERE id = $1",
    [user.id]
  );

  if (!userRows.length || !userRows[0].encrypted_api_key) {
    return NextResponse.json(
      { error: "No API key configured" },
      { status: 400 }
    );
  }

  const apiKey = decryptApiKey(
    userRows[0].encrypted_api_key,
    userRows[0].api_key_iv
  );

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 8192,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    return NextResponse.json(
      { error: "Anthropic API error", details: errorText },
      { status: response.status }
    );
  }

  const data = await response.json();
  const updatedContent = data.content?.[0]?.text;
  if (!updatedContent) {
    return NextResponse.json(
      { error: "Empty response from API" },
      { status: 500 }
    );
  }

  // Versioning: keep original v1 + latest chat-updated version
  // If there are already 2+ versions, replace the last one (the chat-updated one)
  // If there's only the original, add a new one
  const originalDeliverable = { ...currentDeliverables[0], version: 1 };
  const chatUpdatedDeliverable: Deliverable = {
    slug: "deliverable-chat-updated",
    title: `${originalDeliverable.title} (Updated)`,
    content: updatedContent,
    version: 2,
    createdAt: new Date().toISOString(),
  };

  const updatedDeliverables = [originalDeliverable, chatUpdatedDeliverable];
  const updatedRawFiles = {
    ...raw_files,
    "deliverable-chat-updated.md": updatedContent,
  };
  const updatedParsedData = {
    ...parsed_data,
    deliverables: updatedDeliverables,
  };

  await query(
    "UPDATE assemblies SET raw_files = $1, parsed_data = $2 WHERE id = $3",
    [
      JSON.stringify(updatedRawFiles),
      JSON.stringify(updatedParsedData),
      assemblyId,
    ]
  );

  return NextResponse.json({
    deliverable: chatUpdatedDeliverable,
    version: 2,
  });
}
