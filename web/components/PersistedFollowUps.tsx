"use client";

import { renderMarkdown } from "@/lib/markdown";
import type { FollowUp, Character } from "@/lib/types";

const AVATAR_COLORS = [
  "#0969da", "#8250df", "#bf3989", "#0e8a16", "#e16f24",
  "#cf222e", "#1a7f37", "#6639ba", "#953800", "#0550ae",
  "#7c3aed", "#d1242f",
];

const MODE_LABELS: Record<string, string> = {
  "ask-assembly": "Panel",
  "ask-character": "Character",
  "ask-library": "Library",
  debate: "Debate",
};

function md(text: string): string {
  return renderMarkdown(text);
}

function initials(name: string): string {
  const parts = name.replace(/^(Dr\.|Colonel|Col\.)?\s*/i, "").split(/\s+/);
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface PersistedFollowUpsProps {
  followUps: FollowUp[];
  context: string;
  characters: Character[];
}

export default function PersistedFollowUps({ followUps, context, characters }: PersistedFollowUpsProps) {
  const filtered = followUps.filter((fu) => {
    if (typeof fu.context === "string") return fu.context === context;
    if (fu.context && typeof fu.context === "object" && "page" in fu.context)
      return (fu.context as { page: string }).page === context;
    return false;
  });

  if (filtered.length === 0) return null;

  const colorMap: Record<string, string> = {};
  const avatarUrlMap: Record<string, string> = {};
  characters.forEach((char, i) => {
    colorMap[char.name] = AVATAR_COLORS[i % AVATAR_COLORS.length];
    if (char.avatarUrl) avatarUrlMap[char.name] = char.avatarUrl;
  });

  function findColor(name: string): string {
    if (colorMap[name]) return colorMap[name];
    const lower = name.toLowerCase();
    for (const fullName of Object.keys(colorMap)) {
      const firstName = fullName.split(/\s+/)[0].toLowerCase();
      if (firstName === lower || fullName.toLowerCase().includes(lower))
        return colorMap[fullName];
    }
    return "var(--color-accent)";
  }

  return (
    <div style={{ marginTop: "2rem" }}>
      <h2 style={{ fontFamily: "var(--font-display)", fontSize: "1.1rem", marginBottom: "1rem" }}>
        Previous Follow-ups
      </h2>
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {filtered.map((fu) => (
          <div
            key={fu.id || fu.timestamp}
            style={{
              border: "1px solid var(--color-border-light)",
              borderRadius: "8px",
              padding: "1rem 1.25rem",
              background: "var(--color-surface)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.5rem", flexWrap: "wrap" }}>
              <span style={{ fontSize: "0.78rem", color: "var(--color-text-muted)" }}>
                {new Date(fu.timestamp).toLocaleDateString(undefined, {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
              <span className="badge badge-tag" style={{ fontSize: "0.7rem" }}>
                {MODE_LABELS[fu.mode] ?? fu.mode}
              </span>
            </div>
            <p style={{ fontWeight: 500, margin: "0.25rem 0 0.75rem" }}>
              {fu.question}
            </p>
            {fu.responses.map((r, ri) => (
              <div key={ri} className="debate-exchange" style={{ marginBottom: "0.5rem" }}>
                <div className="debate-speaker">
                  {avatarUrlMap[r.speaker] ? (
                    <img
                      src={avatarUrlMap[r.speaker]}
                      alt={r.speaker}
                      style={{ width: 20, height: 20, borderRadius: "50%", objectFit: "cover" }}
                    />
                  ) : (
                    <span
                      className="debate-speaker-dot"
                      style={{ background: findColor(r.speaker) }}
                    />
                  )}
                  {r.speaker}
                </div>
                <div
                  className="debate-content"
                  dangerouslySetInnerHTML={{ __html: md(r.content) }}
                />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
