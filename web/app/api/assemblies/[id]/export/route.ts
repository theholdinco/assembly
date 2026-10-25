import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-helpers";
import { query } from "@/lib/db";
import { renderMarkdown } from "@/lib/markdown";
import { readFileSync } from "fs";
import { join } from "path";
import type { Topic } from "@/lib/types";
import { getAssemblyAccess } from "@/lib/assembly-access";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const access = await getAssemblyAccess(id, user.id);
  if (!access) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const rows = await query<{
    parsed_data: Topic;
    topic_input: string;
    raw_files: Record<string, string>;
  }>(
    "SELECT parsed_data, topic_input, raw_files FROM assemblies WHERE id = $1",
    [id]
  );

  if (!rows.length || !rows[0].parsed_data) {
    return NextResponse.json(
      { error: "Assembly not found or not complete" },
      { status: 404 }
    );
  }

  const topic = rows[0].parsed_data;
  const rawFiles = rows[0].raw_files || {};
  const title = rows[0].topic_input;

  let css = "";
  try {
    css = readFileSync(join(process.cwd(), "public/styles.css"), "utf-8");
  } catch {
    // CSS may not be available in all environments
  }

  const md = (text: string) => renderMarkdown(text);

  const sections: string[] = [];

  sections.push(`<h1>${escapeHtml(title)}</h1>`);

  const toc = [
    topic.characters.length > 0 && '<a href="#characters">Characters</a>',
    topic.iterations.length > 0 && '<a href="#debate">Debate</a>',
    topic.synthesis && '<a href="#synthesis">Synthesis</a>',
    topic.deliverables.length > 0 && '<a href="#deliverables">Deliverables</a>',
    topic.verification.length > 0 && '<a href="#verification">Verification</a>',
    topic.parsedReferenceLibrary && '<a href="#references">Reference Library</a>',
  ].filter(Boolean);

  sections.push(
    `<nav class="toc"><h2>Contents</h2><ul>${toc.map((l) => `<li>${l}</li>`).join("")}</ul></nav>`
  );

  if (topic.characters.length > 0) {
    sections.push('<section id="characters"><h2>Characters</h2>');
    for (const char of topic.characters) {
      sections.push(`<div class="character-profile">`);
      sections.push(
        `<h3>${escapeHtml(char.name)} ${char.tag ? `<span class="tag">[${escapeHtml(char.tag)}]</span>` : ""}</h3>`
      );
      if (char.biography) sections.push(`<h4>Biography</h4>${md(char.biography)}`);
      if (char.framework) sections.push(`<h4>Ideological Framework</h4>${md(char.framework)}`);
      if (char.specificPositions.length)
        sections.push(
          `<h4>Specific Positions</h4><ol>${char.specificPositions.map((p) => `<li>${md(p)}</li>`).join("")}</ol>`
        );
      if (char.blindSpot) sections.push(`<h4>Blind Spot</h4>${md(char.blindSpot)}`);
      if (char.heroes.length)
        sections.push(`<h4>Intellectual Heroes</h4><ul>${char.heroes.map((h) => `<li>${escapeHtml(h)}</li>`).join("")}</ul>`);
      sections.push(`</div><hr/>`);
    }
    sections.push("</section>");
  }

  if (topic.iterations.length > 0) {
    sections.push('<section id="debate"><h2>Debate</h2>');
    for (const iter of topic.iterations) {
      sections.push(
        `<h3>Iteration ${iter.number}: ${escapeHtml(iter.structure)}</h3>`
      );
      if (iter.transcriptRaw) {
        sections.push(md(iter.transcriptRaw));
      } else if (iter.rounds.length > 0) {
        for (const round of iter.rounds) {
          sections.push(`<h4>${escapeHtml(round.title)}</h4>`);
          for (const ex of round.exchanges) {
            sections.push(
              `<p><strong>${escapeHtml(ex.speaker)}:</strong> ${md(ex.content)}</p>`
            );
          }
        }
      }
    }
    sections.push("</section>");
  }

  if (rawFiles["synthesis.md"]) {
    sections.push(
      `<section id="synthesis"><h2>Synthesis</h2>${md(rawFiles["synthesis.md"])}</section>`
    );
  } else if (topic.synthesis?.raw) {
    sections.push(
      `<section id="synthesis"><h2>Synthesis</h2>${md(topic.synthesis.raw)}</section>`
    );
  }

  if (topic.deliverables.length > 0) {
    sections.push('<section id="deliverables"><h2>Deliverables</h2>');
    for (const d of topic.deliverables) {
      sections.push(`<h3>${escapeHtml(d.title)}</h3>${md(d.content)}`);
    }
    sections.push("</section>");
  }

  if (topic.verification.length > 0) {
    sections.push('<section id="verification"><h2>Verification</h2>');
    for (const v of topic.verification) {
      sections.push(`<h3>${escapeHtml(v.title)}</h3>${md(v.content)}`);
    }
    sections.push("</section>");
  }

  if (rawFiles["reference-library.md"]) {
    sections.push(
      `<section id="references"><h2>Reference Library</h2>${md(rawFiles["reference-library.md"])}</section>`
    );
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)} — Intellectual Assembly</title>
<style>${css}
body { max-width: 860px; margin: 0 auto; padding: 2rem; display: block; }
.toc { margin: 2rem 0; padding: 1.5rem; background: var(--color-surface); border-radius: var(--radius); border: 1px solid var(--color-border-light); }
.toc h2 { margin-top: 0; }
.toc ul { list-style: none; padding: 0; display: flex; flex-wrap: wrap; gap: 0.5rem 1.5rem; }
.toc a { color: var(--color-accent); text-decoration: none; }
.character-profile { margin: 1.5rem 0; }
.tag { font-size: 0.8em; color: var(--color-text-muted); }
section { margin: 3rem 0; }
hr { border: none; border-top: 1px solid var(--color-border-light); margin: 2rem 0; }
</style>
</head>
<body class="markdown-content">
${sections.join("\n")}
<footer style="margin-top: 4rem; padding: 1.5rem 0; border-top: 1px solid var(--color-border-light); text-align: center; color: var(--color-text-muted); font-size: 0.8rem;">
Generated by Intellectual Assembly
</footer>
</body>
</html>`;

  const slug = topic.slug || "assembly";

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}-export.html"`,
    },
  });
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
