import { z } from "zod";
import { PDFDocument } from "pdf-lib";
import { callAnthropicWithTool, buildDocumentContent } from "../api";
import { zodToToolSchema } from "./schema-utils";
import type { CloDocument } from "../types";

const MAX_MAPPING_PAGES = 50;

// Section types for compliance reports (trustee reports / monthly reports)
export const COMPLIANCE_SECTION_TYPES = [
  "compliance_summary",
  "par_value_tests",
  "interest_coverage_tests",
  "asset_schedule",
  "concentration_tables",
  "waterfall",
  "trading_activity",
  "interest_accrual",
  "account_balances",
  "supplementary",
] as const;

// Section types for PPMs (Private Placement Memorandums)
export const PPM_SECTION_TYPES = [
  "transaction_overview",
  "capital_structure",
  "coverage_tests",
  "eligibility_criteria",
  "portfolio_constraints",
  "waterfall_rules",
  "fees_and_expenses",
  "key_dates",
  "key_parties",
] as const;

const sectionSchema = z.object({
  sectionType: z.string(),
  pageStart: z.number(),
  pageEnd: z.number(),
  confidence: z.enum(["high", "medium", "low"]),
  notes: z.string().optional(),
});

const documentMapSchema = z.object({
  documentType: z.enum(["compliance_report", "ppm"]),
  sections: z.array(sectionSchema),
});

export type DocumentMap = z.infer<typeof documentMapSchema>;
export type SectionEntry = z.infer<typeof sectionSchema>;

function mapperPrompt(pageOffset?: number, totalPages?: number): { system: string; user: string } {
  const pageOffsetNote = pageOffset && totalPages
    ? `\n\nIMPORTANT: You are viewing pages ${pageOffset + 1} through ${Math.min(pageOffset + MAX_MAPPING_PAGES, totalPages)} of a ${totalPages}-page document. Report page numbers relative to the ORIGINAL document (the first page you see is page ${pageOffset + 1}).`
    : "";

  const system = `You are a CLO document analyst. Your task is to identify the structure of a CLO document by finding each major section and the page range it occupies.

First, determine the document type:
- "compliance_report": A trustee report, monthly/quarterly compliance report, or payment date report. Contains test results, asset schedules, waterfall distributions, and account balances.
- "ppm": A Private Placement Memorandum or offering circular. Contains deal terms, eligibility criteria, waterfall rules, and legal provisions.

Then identify which sections are present and their page ranges.

For compliance reports, look for these section types:
${COMPLIANCE_SECTION_TYPES.map((t) => `- ${t}`).join("\n")}

For PPMs, look for these section types:
${PPM_SECTION_TYPES.map((t) => `- ${t}`).join("\n")}

Rules:
- Page numbers are 1-indexed (first page of the PDF is page 1).
- Set confidence to "high" when section boundaries are clearly marked with headers/titles.
- Set confidence to "medium" when the section is identifiable but boundaries are approximate.
- Set confidence to "low" when the content is ambiguous or spread across non-contiguous pages.
- Add notes for unusual layouts, merged sections, or anything noteworthy.
- Only include sections that are actually present in the document. Do not guess or fabricate sections.
- A section's pageEnd must be >= its pageStart.
- Sections may overlap if content spans shared pages.${pageOffsetNote}`;

  const user = `Analyze this CLO document. Identify the document type and map out all sections with their page ranges. Use the provided tool to return the structured result.`;

  return { system, user };
}

async function mapDocumentChunk(
  apiKey: string,
  chunkDoc: CloDocument,
  nonPdfDocs: CloDocument[],
  pageOffset: number,
  totalPages: number,
): Promise<DocumentMap> {
  const { system, user } = mapperPrompt(pageOffset, totalPages);
  const content = buildDocumentContent([...nonPdfDocs, chunkDoc], user);
  const inputSchema = zodToToolSchema(documentMapSchema);

  const chunkLabel = `pp${pageOffset + 1}-${Math.min(pageOffset + MAX_MAPPING_PAGES, totalPages)}`;
  const result = await callAnthropicWithTool(apiKey, system, content, 4096, {
    name: "map_document_sections",
    description: "Return the document type and a list of identified sections with their page ranges.",
    inputSchema,
  }, `mapper:${chunkLabel}`);

  if (result.error) {
    throw new Error(`Document mapping failed (${chunkLabel}): ${result.error}`);
  }

  if (!result.data) {
    throw new Error(`Document mapping returned no data (${chunkLabel})`);
  }

  return result.data as unknown as DocumentMap;
}

const VALID_SECTION_TYPES: Set<string> = new Set([
  ...COMPLIANCE_SECTION_TYPES,
  ...PPM_SECTION_TYPES,
]);

function filterToKnownSections(map: DocumentMap): DocumentMap {
  const before = map.sections.length;
  const filtered = map.sections.filter((s) => VALID_SECTION_TYPES.has(s.sectionType));
  const removed = before - filtered.length;
  if (removed > 0) {
    const dropped = map.sections.filter((s) => !VALID_SECTION_TYPES.has(s.sectionType)).map((s) => s.sectionType);
    console.log(`[document-mapper] filtered out ${removed} unknown section types: ${dropped.join(", ")}`);
  }

  // Deduplicate overlapping page ranges — higher-priority sections keep their pages
  const deduplicated = deduplicatePageRanges(filtered);

  return { ...map, sections: deduplicated };
}

// Priority order: higher-priority sections keep their full range, lower-priority
// sections get their overlapping pages trimmed away.
const SECTION_PRIORITY: Record<string, number> = {
  capital_structure: 10,
  key_dates: 9,
  coverage_tests: 8,
  portfolio_constraints: 7,
  eligibility_criteria: 6,
  fees_and_expenses: 5,
  waterfall_rules: 4,
  key_parties: 3,
  transaction_overview: 2,
};

function deduplicatePageRanges(sections: SectionEntry[]): SectionEntry[] {
  // Sort by priority descending — higher priority sections keep their pages
  const sorted = [...sections].sort(
    (a, b) => (SECTION_PRIORITY[b.sectionType] ?? 0) - (SECTION_PRIORITY[a.sectionType] ?? 0),
  );

  const claimed = new Set<number>();
  const result: SectionEntry[] = [];

  for (const section of sorted) {
    // Find unclaimed pages in this section's range
    const unclaimed: number[] = [];
    for (let p = section.pageStart; p <= section.pageEnd; p++) {
      if (!claimed.has(p)) unclaimed.push(p);
    }

    if (unclaimed.length === 0) {
      console.log(`[document-mapper] dropped ${section.sectionType}(pp${section.pageStart}-${section.pageEnd}) — all pages claimed by higher-priority sections`);
      continue;
    }

    // Use the contiguous range of unclaimed pages
    const newStart = unclaimed[0];
    const newEnd = unclaimed[unclaimed.length - 1];

    if (newStart !== section.pageStart || newEnd !== section.pageEnd) {
      console.log(`[document-mapper] trimmed ${section.sectionType}: pp${section.pageStart}-${section.pageEnd} → pp${newStart}-${newEnd}`);
    }

    for (let p = newStart; p <= newEnd; p++) claimed.add(p);
    result.push({ ...section, pageStart: newStart, pageEnd: newEnd });
  }

  return result;
}

const CONFIDENCE_RANK = { high: 3, medium: 2, low: 1 } as const;

function mergeSectionMaps(maps: DocumentMap[]): DocumentMap {
  const documentType = maps[0].documentType;
  const bestByType = new Map<string, SectionEntry>();

  for (const map of maps) {
    for (const section of map.sections) {
      const existing = bestByType.get(section.sectionType);
      if (!existing || CONFIDENCE_RANK[section.confidence] > CONFIDENCE_RANK[existing.confidence]) {
        bestByType.set(section.sectionType, section);
      }
    }
  }

  const merged = Array.from(bestByType.values());
  console.log(`[document-mapper] merged ${maps.length} chunk maps → ${merged.length} sections: ${merged.map((s) => `${s.sectionType}(pp${s.pageStart}-${s.pageEnd},${s.confidence})`).join(", ")}`);
  return filterToKnownSections({ documentType, sections: merged });
}

export async function mapDocument(
  apiKey: string,
  documents: CloDocument[],
): Promise<DocumentMap> {
  const pdfDoc = documents.find((d) => d.type === "application/pdf");
  const nonPdfDocs = documents.filter((d) => d.type !== "application/pdf");

  // Small PDF or no PDF: send directly
  if (!pdfDoc) {
    const { system, user } = mapperPrompt();
    const content = buildDocumentContent(documents, user);
    const inputSchema = zodToToolSchema(documentMapSchema);
    const result = await callAnthropicWithTool(apiKey, system, content, 4096, {
      name: "map_document_sections",
      description: "Return the document type and a list of identified sections with their page ranges.",
      inputSchema,
    });
    if (result.error) throw new Error(`Document mapping failed: ${result.error}`);
    if (!result.data) throw new Error("Document mapping returned no data");
    return filterToKnownSections(result.data as unknown as DocumentMap);
  }

  const srcDoc = await PDFDocument.load(Buffer.from(pdfDoc.base64, "base64"));
  const totalPages = srcDoc.getPageCount();

  if (totalPages <= MAX_MAPPING_PAGES) {
    const map = await mapDocumentChunk(apiKey, pdfDoc, nonPdfDocs, 0, totalPages);
    return filterToKnownSections(map);
  }

  // Large PDF: split into chunks, map in batches of 2, then merge
  console.log(`[document-mapper] PDF has ${totalPages} pages, splitting into chunks of ${MAX_MAPPING_PAGES}`);

  interface ChunkInfo { doc: CloDocument; offset: number }
  const chunks: ChunkInfo[] = [];

  for (let start = 0; start < totalPages; start += MAX_MAPPING_PAGES) {
    const end = Math.min(start + MAX_MAPPING_PAGES, totalPages);
    const chunkDoc = await PDFDocument.create();
    const pages = await chunkDoc.copyPages(srcDoc, Array.from({ length: end - start }, (_, i) => start + i));
    pages.forEach((p) => chunkDoc.addPage(p));
    const chunkBytes = await chunkDoc.save();

    chunks.push({
      doc: {
        name: `${pdfDoc.name} (pages ${start + 1}-${end})`,
        type: "application/pdf",
        size: chunkBytes.length,
        base64: Buffer.from(chunkBytes).toString("base64"),
      },
      offset: start,
    });
  }

  const maps: DocumentMap[] = [];
  const concurrency = 2;
  for (let i = 0; i < chunks.length; i += concurrency) {
    const batch = chunks.slice(i, i + concurrency);
    const batchMaps = await Promise.all(
      batch.map((c) => mapDocumentChunk(apiKey, c.doc, nonPdfDocs, c.offset, totalPages)),
    );
    maps.push(...batchMaps);
  }

  return mergeSectionMaps(maps);
}
