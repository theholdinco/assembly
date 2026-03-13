import Anthropic from "@anthropic-ai/sdk";
import {
  parseCharacterFiles,
  parseSynthesis,
  parseTranscript,
  parseReferenceLibrary,
} from "../lib/parsers/index.js";
import type { Topic } from "../lib/types.js";
import {
  domainAnalysisPrompt,
  characterGenerationPrompt,
  avatarMappingPrompt,
  referenceLibraryPrompt,
  referenceAuditPrompt,
  debatePrompt,
  synthesisPrompt,
  deliverablePrompt,
  verificationPrompt,
  maverickRoundPrompt,
} from "./prompts.js";

export interface Attachment {
  name: string;
  type: string;
  size: number;
  base64: string;
  textContent?: string;
}

export interface PipelineConfig {
  assemblyId: string;
  topic: string;
  slug: string;
  apiKey: string;
  codeContext?: string;
  attachments?: Attachment[];
  savedCharacters?: Array<{
    name: string; tag: string; biography: string; framework: string;
    frameworkName: string; blindSpot: string; heroes: string[];
    rhetoricalTendencies: string; debateStyle: string; avatarUrl?: string;
  }>;
  initialRawFiles?: Record<string, string>;
  updatePhase: (phase: string) => Promise<void>;
  updateRawFiles: (files: Record<string, string>) => Promise<void>;
  updateParsedData: (data: unknown) => Promise<void>;
}

interface DomainAnalysisMetadata {
  mode: string;
  characterCount: number;
  debateStructure: string;
  outputType: string;
}

function parseDomainAnalysisMetadata(domainAnalysis: string): DomainAnalysisMetadata {
  const modeMatch = domainAnalysis.match(/Recommended mode:\s*(Light|Standard|Deep)/i);
  const countMatch = domainAnalysis.match(/Recommended character count:\s*(\d+)/i);
  const structureMatch = domainAnalysis.match(/Recommended debate structure:\s*(Duels|Grande Table|Tribunal|Socratique)/i);
  // Primary: match "Recommended output type: **Type**"
  const recommendedMatch = domainAnalysis.match(/Recommended output type:\s*\*\*([^*]+)\*\*/i);
  let outputType = recommendedMatch?.[1]?.trim() || "";

  // Fallback: scan the Output Type section for the first bold type that matches a known type
  if (!outputType) {
    const outputSection = domainAnalysis.match(/Output Type Determination[\s\S]*?(?=##|$)/i);
    if (outputSection) {
      const typePatterns = ["Code", "Architecture/Design", "Essay/Writing", "Decision Brief", "Analysis", "Plan"];
      for (const pattern of typePatterns) {
        if (outputSection[0].includes(`**${pattern}**`)) {
          outputType = pattern;
          break;
        }
      }
    }
  }

  if (!outputType) outputType = "Analysis";

  return {
    mode: modeMatch?.[1] || "Standard",
    characterCount: countMatch ? parseInt(countMatch[1], 10) : 6,
    debateStructure: structureMatch?.[1] || "Grande Table",
    outputType,
  };
}

function buildAttachmentContent(
  attachments: Attachment[],
  userMessage: string
): Anthropic.MessageCreateParams["messages"][0]["content"] {
  const textFiles = attachments.filter((a) => a.textContent);
  const pdfFiles = attachments.filter((a) => a.type === "application/pdf" && a.base64);
  const imageFiles = attachments.filter(
    (a) => a.type.startsWith("image/") && a.base64
  );

  const blocks: Anthropic.MessageCreateParams["messages"][0]["content"] = [];

  for (const doc of pdfFiles) {
    blocks.push({
      type: "document" as const,
      source: {
        type: "base64" as const,
        media_type: "application/pdf" as const,
        data: doc.base64,
      },
    });
  }

  for (const img of imageFiles) {
    blocks.push({
      type: "image" as const,
      source: {
        type: "base64" as const,
        media_type: img.type as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
        data: img.base64,
      },
    });
  }

  let textMessage = userMessage;
  if (textFiles.length > 0) {
    const textContext = textFiles
      .map((f) => `## Attached: ${f.name}\n\`\`\`\n${f.textContent}\n\`\`\``)
      .join("\n\n");
    textMessage = `${userMessage}\n\n${textContext}`;
  }

  blocks.push({ type: "text" as const, text: textMessage });
  return blocks;
}

async function callClaude(
  client: Anthropic,
  systemPrompt: string,
  userMessage: string,
  maxTokens: number,
  model: string = "claude-sonnet-4-20250514",
  attachments?: Attachment[]
): Promise<string> {
  try {
    const content: Anthropic.MessageCreateParams["messages"][0]["content"] =
      attachments && attachments.length > 0
        ? buildAttachmentContent(attachments, userMessage)
        : userMessage;

    const response = await client.messages.create({
      model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content }],
      system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
    });

    return response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n");
  } catch (err: unknown) {
    if (err && typeof err === "object" && "status" in err) {
      const apiErr = err as { status: number; message?: string };
      if (apiErr.status === 401) {
        throw new Error("Invalid API key. Please update your key in Settings.");
      }
      if (apiErr.status === 429) {
        throw new Error("Rate limited by Anthropic. Please wait and try again, or check your API plan limits.");
      }
      if (apiErr.status === 529) {
        throw new Error("Anthropic API is temporarily overloaded. Your assembly will be retried.");
      }
    }
    throw err;
  }
}

function attachAvatars(characters: Topic["characters"], rawAvatarJson: string) {
  try {
    const avatarMapping = JSON.parse(rawAvatarJson) as Array<{
      name: string;
      skinColor: string;
      hair: string;
      hairColor: string;
      eyes: string;
      eyebrows: string;
      mouth: string;
      glasses: string;
      features: string;
    }>;
    for (const char of characters) {
      const mapping = avatarMapping.find(
        (m) => m.name.toLowerCase() === char.name.toLowerCase()
      );
      if (mapping) {
        const params = new URLSearchParams({
          seed: mapping.name,
          skinColor: mapping.skinColor,
          hair: mapping.hair,
          hairColor: mapping.hairColor,
          eyes: mapping.eyes,
          eyebrows: mapping.eyebrows,
          mouth: mapping.mouth,
        });
        if (mapping.glasses !== "none") {
          params.set("glasses", mapping.glasses);
          params.set("glassesProbability", "100");
        } else {
          params.set("glassesProbability", "0");
        }
        if (mapping.features !== "none") {
          params.set("features", mapping.features);
          params.set("featuresProbability", "100");
        } else {
          params.set("featuresProbability", "0");
        }
        char.avatarUrl = `https://api.dicebear.com/9.x/adventurer/svg?${params.toString()}`;
      }
    }
  } catch {
    console.warn("[pipeline] Failed to parse avatar-mapping.json, skipping avatars");
  }
}

function buildParsedTopic(
  rawFiles: Record<string, string>,
  slug: string,
  topic: string,
  savedCharacters?: Array<{ name: string; avatarUrl?: string }>
): Topic {
  const characters = rawFiles["characters.md"]
    ? parseCharacterFiles([rawFiles["characters.md"]])
    : [];

  if (rawFiles["avatar-mapping.json"]) {
    attachAvatars(characters, rawFiles["avatar-mapping.json"]);
  }

  if (savedCharacters) {
    const savedAvatarMap = new Map(
      savedCharacters.filter((sc) => sc.avatarUrl).map((sc) => [sc.name.toLowerCase(), sc.avatarUrl!])
    );
    for (const char of characters) {
      const savedUrl = savedAvatarMap.get(char.name.toLowerCase());
      if (savedUrl) char.avatarUrl = savedUrl;
    }
  }

  const synthesisData = rawFiles["synthesis.md"]
    ? parseSynthesis(rawFiles["synthesis.md"])
    : null;

  const rounds = rawFiles["debate-transcript.md"]
    ? parseTranscript(rawFiles["debate-transcript.md"])
    : [];

  const parsedRefLib = rawFiles["reference-library.md"]
    ? parseReferenceLibrary(rawFiles["reference-library.md"])
    : null;

  // Detect debate structure from domain analysis
  const debateStructure = rawFiles["domain-analysis.md"]
    ? parseDomainAnalysisMetadata(rawFiles["domain-analysis.md"]).debateStructure
    : "Grande Table";

  return {
    slug,
    title: topic,
    characters,
    iterations: rawFiles["debate-transcript.md"]
      ? [{
          number: 1,
          structure: debateStructure,
          synthesis: synthesisData,
          transcriptRaw: rawFiles["debate-transcript.md"],
          rounds,
        }]
      : [],
    synthesis: synthesisData,
    deliverables: rawFiles["deliverable.md"]
      ? [{ slug: "main", title: "Deliverable", content: rawFiles["deliverable.md"] }]
      : [],
    verification: rawFiles["verification-notes.md"]
      ? [{ type: "notes", title: "Verification Notes", content: rawFiles["verification-notes.md"] }]
      : rawFiles["verification.md"]
        ? [{ type: "full", title: "Verification Report", content: rawFiles["verification.md"] }]
        : [],
    referenceLibrary: rawFiles["reference-library.md"] || null,
    parsedReferenceLibrary: parsedRefLib,
    researchFiles: [],
    followUps: [],
  };
}

export async function runPipeline(config: PipelineConfig): Promise<void> {
  const { topic, slug, apiKey, codeContext, attachments, savedCharacters, initialRawFiles, updatePhase, updateRawFiles, updateParsedData } =
    config;

  const client = new Anthropic({ apiKey });

  // Track raw files — pre-populated from DB for resume support
  const rawFiles: Record<string, string> = { ...initialRawFiles };

  // Phase 1: Domain Analysis
  if (!rawFiles["domain-analysis.md"]) {
    await updatePhase("domain-analysis");
    const result = await callClaude(
      client,
      domainAnalysisPrompt(topic, codeContext),
      `Analyze this topic: ${topic}`,
      8192,
      undefined,
      attachments
    );
    rawFiles["domain-analysis.md"] = result;
    await updateRawFiles(rawFiles);
  }

  // Parse metadata from domain analysis for downstream phases
  const metadata = parseDomainAnalysisMetadata(rawFiles["domain-analysis.md"]);

  // Phase 2: Character Generation
  if (!rawFiles["characters.md"]) {
    await updatePhase("character-generation");
    const savedCount = savedCharacters?.length ?? 0;
    const newCount = Math.max(0, metadata.characterCount - savedCount);
    const result = await callClaude(
      client,
      characterGenerationPrompt(topic, rawFiles["domain-analysis.md"], newCount, codeContext, savedCharacters),
      `Generate characters for the assembly on: ${topic}`,
      8192
    );
    rawFiles["characters.md"] = result;
    await updateRawFiles(rawFiles);
    await updateParsedData(buildParsedTopic(rawFiles, slug, topic, savedCharacters));
  }

  // Phase 2.5: Avatar Mapping
  if (!rawFiles["avatar-mapping.json"]) {
    await updatePhase("avatar-mapping");
    const result = await callClaude(
      client,
      avatarMappingPrompt(rawFiles["characters.md"]),
      "Map each character to DiceBear Adventurer avatar options based on their biographies.",
      2048,
      "claude-haiku-4-5-20251001"
    );
    const cleaned = result.replace(/```(?:json)?\s*/g, "").replace(/```/g, "").trim();
    rawFiles["avatar-mapping.json"] = cleaned;
    await updateRawFiles(rawFiles);
    await updateParsedData(buildParsedTopic(rawFiles, slug, topic, savedCharacters));
  }

  // Phase 3: Reference Library
  if (!rawFiles["reference-library.md"]) {
    await updatePhase("reference-library");
    const result = await callClaude(
      client,
      referenceLibraryPrompt(topic, rawFiles["characters.md"]),
      `Build the reference library for the assembly on: ${topic}`,
      8192
    );
    rawFiles["reference-library.md"] = result;
    await updateRawFiles(rawFiles);
    await updateParsedData(buildParsedTopic(rawFiles, slug, topic, savedCharacters));
  }

  // Phase 3.5: Reference Audit
  if (!rawFiles["reference-audit.md"]) {
    await updatePhase("reference-audit");
    const auditResult = await callClaude(
      client,
      referenceAuditPrompt(rawFiles["reference-library.md"]),
      "Audit this reference library for fabricated or uncertain citations.",
      8192
    );
    rawFiles["reference-audit.md"] = auditResult;

    // Replace the reference library with the audited version (which has confidence tags)
    rawFiles["reference-library.md"] = auditResult;
    await updateRawFiles(rawFiles);
    await updateParsedData(buildParsedTopic(rawFiles, slug, topic, savedCharacters));
  }

  // Phase 4: Debate
  if (!rawFiles["debate-transcript.md"]) {
    await updatePhase("debate");
    const result = await callClaude(
      client,
      debatePrompt(
        topic,
        rawFiles["characters.md"],
        rawFiles["reference-library.md"],
        metadata.debateStructure
      ),
      `Run the ${metadata.debateStructure} debate on: ${topic}`,
      16384,
      undefined,
      attachments
    );
    rawFiles["debate-transcript.md"] = result;
    await updateRawFiles(rawFiles);
    await updateParsedData(buildParsedTopic(rawFiles, slug, topic, savedCharacters));
  }

  // Phase 4.5: Maverick Round
  if (!rawFiles["maverick-round.md"]) {
    await updatePhase("maverick-round");
    const result = await callClaude(
      client,
      maverickRoundPrompt(topic, rawFiles["characters.md"], rawFiles["debate-transcript.md"]),
      `Run the Maverick Round for: ${topic}`,
      8192
    );
    rawFiles["maverick-round.md"] = result;
    await updateRawFiles(rawFiles);
  }

  // Phase 5: Synthesis
  if (!rawFiles["synthesis.md"]) {
    await updatePhase("synthesis");
    const result = await callClaude(
      client,
      synthesisPrompt(topic, rawFiles["debate-transcript.md"], rawFiles["maverick-round.md"]),
      `Synthesize the debate on: ${topic}`,
      8192
    );
    rawFiles["synthesis.md"] = result;
    await updateRawFiles(rawFiles);
    await updateParsedData(buildParsedTopic(rawFiles, slug, topic, savedCharacters));
  }

  // Phase 6: Deliverable
  if (!rawFiles["deliverable.md"]) {
    await updatePhase("deliverable");
    const result = await callClaude(
      client,
      deliverablePrompt(topic, rawFiles["synthesis.md"], metadata.outputType),
      `Produce the deliverable for: ${topic}`,
      8192
    );
    rawFiles["deliverable.md"] = result;
    await updateRawFiles(rawFiles);
    await updateParsedData(buildParsedTopic(rawFiles, slug, topic, savedCharacters));
  }

  // Phase 7: Verification (inline fixing — returns corrected deliverable)
  if (!rawFiles["verification-notes.md"]) {
    await updatePhase("verification");
    const result = await callClaude(
      client,
      verificationPrompt(
        topic,
        rawFiles["deliverable.md"],
        rawFiles["synthesis.md"]
      ),
      `Verify and fix the deliverable for: ${topic}`,
      8192
    );

    // Store original deliverable for reference
    rawFiles["deliverable-pre-verification.md"] = rawFiles["deliverable.md"];

    // Parse: everything before "## Verification Notes" is the corrected deliverable
    const notesMarker = result.indexOf("## Verification Notes");
    if (notesMarker !== -1) {
      rawFiles["deliverable.md"] = result.slice(0, notesMarker).trim();
      rawFiles["verification-notes.md"] = result.slice(notesMarker).trim();
    } else {
      // Fallback: treat entire result as corrected deliverable
      rawFiles["deliverable.md"] = result;
      rawFiles["verification-notes.md"] = "## Verification Notes\n\nNo explicit notes section returned by verifier.";
    }

    await updateRawFiles(rawFiles);
  }

  // Build final parsed data and save
  await updateParsedData(buildParsedTopic(rawFiles, slug, topic, savedCharacters));
}
