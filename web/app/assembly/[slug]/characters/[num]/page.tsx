"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { marked } from "marked";
import { useAssembly, useAssemblyId } from "@/lib/assembly-context";
import FollowUpModal from "@/components/FollowUpModal";
import HighlightChat from "@/components/HighlightChat";
import { buildCharacterMaps, initials, isSocrate } from "@/lib/character-utils";

function md(text: string): string {
  return marked.parse(text, { async: false }) as string;
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "\u2026";
}

function formatStructure(s: string): string {
  const names: Record<string, string> = {
    "grande-table": "Town Hall",
    "rapid-fire": "Crossfire",
    "deep-dive": "Deep Dive",
  };
  return (
    names[s] ??
    s
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  );
}

export default function CharacterProfilePage() {
  const topic = useAssembly();
  const assemblyId = useAssemblyId();
  const base = `/assembly/${topic.slug}`;
  const params = useParams<{ num: string }>();
  const num = Number(params.num);

  const { colorMap, avatarUrlMap } = buildCharacterMaps(topic.characters);
  const nonSocrateChars = topic.characters.filter((c) => !isSocrate(c.name));
  const charIndex = nonSocrateChars.findIndex((c) => c.number === num);
  const character = nonSocrateChars[charIndex];

  const [savedId, setSavedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/saved-characters`)
      .then((r) => r.json())
      .then((chars: Array<{ id: string; source_assembly_id: string; name: string }>) => {
        const match = chars.find(
          (c) => c.source_assembly_id === assemblyId && c.name === character?.name
        );
        if (match) setSavedId(match.id);
      })
      .catch(() => {});
  }, [assemblyId, character?.name]);

  async function toggleSave() {
    if (!character || saving) return;
    setSaving(true);
    if (savedId) {
      await fetch(`/api/saved-characters/${savedId}`, { method: "DELETE" });
      setSavedId(null);
    } else {
      const res = await fetch("/api/saved-characters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assemblyId, characterNumber: character.number }),
      });
      const data = await res.json();
      setSavedId(data.id);
    }
    setSaving(false);
  }

  if (!character) return <p>Character not found.</p>;

  const color = colorMap[character.name] ?? "var(--color-accent)";

  const debateHistory: Array<{
    type: string;
    label: string;
    excerpt: string;
    link: string;
  }> = [];

  for (const iter of topic.iterations) {
    for (const round of iter.rounds) {
      for (const ex of [
        ...round.exchanges,
        ...round.assemblyReactions,
        ...round.socrate,
      ]) {
        if (ex.speaker === character.name) {
          debateHistory.push({
            type: "iteration",
            label: `Iteration ${iter.number}: ${formatStructure(iter.structure)} \u2014 ${round.title}`,
            excerpt: truncate(ex.content, 150),
            link: `${base}/iteration/${iter.number}`,
          });
        }
      }
    }
  }

  for (const fu of topic.followUps) {
    for (const r of fu.responses) {
      if (r.speaker === character.name) {
        debateHistory.push({
          type: "follow-up",
          label: truncate(fu.question, 80),
          excerpt: truncate(r.content, 150),
          link: `${base}/trajectory`,
        });
      }
    }
  }

  const prev = nonSocrateChars[charIndex - 1] ?? null;
  const next = nonSocrateChars[charIndex + 1] ?? null;

  return (
    <>
      <div className="breadcrumb">
        <Link href="/">Home</Link>
        <span className="separator">/</span>
        <Link href={base}>
          {topic.title.length > 30 ? topic.title.slice(0, 30) + "\u2026" : topic.title}
        </Link>
        <span className="separator">/</span>
        <Link href={`${base}/characters`}>The Panel</Link>
        <span className="separator">/</span>
        <span className="current">{character.name}</span>
      </div>

      <div className="profile-header">
        {character.avatarUrl ? (
          <img
            src={character.avatarUrl}
            alt={character.name}
            className="profile-avatar"
          />
        ) : (
          <div className="profile-avatar" style={{ background: color }}>
            {initials(character.name)}
          </div>
        )}
        <div>
          <h1 style={{ marginBottom: "0.15rem" }}>{character.name}</h1>
          <div className="profile-meta">
            {character.tag && (
              <span className="badge badge-tag">{character.tag}</span>
            )}
            {character.frameworkName && (
              <span
                style={{
                  color: "var(--color-text-secondary)",
                  fontSize: "0.88rem",
                }}
              >
                {character.frameworkName}
              </span>
            )}
          </div>
          <button
            onClick={toggleSave}
            disabled={saving}
            title={savedId ? "Remove from saved characters" : "Save character for reuse"}
            style={{
              background: "none",
              border: "1px solid var(--color-border)",
              borderRadius: "6px",
              padding: "0.35rem 0.65rem",
              cursor: "pointer",
              fontSize: "0.82rem",
              color: savedId ? "var(--color-accent)" : "var(--color-text-secondary)",
              marginTop: "0.5rem",
              display: "inline-flex",
              alignItems: "center",
              gap: "0.35rem",
            }}
          >
            {savedId ? "\u2605" : "\u2606"} {savedId ? "Saved" : "Save"}
          </button>
        </div>
      </div>

      {character.biography && (
        <>
          <h2>Biography</h2>
          <div
            className="markdown-content"
            dangerouslySetInnerHTML={{ __html: md(character.biography) }}
          />
        </>
      )}

      {character.framework && (
        <>
          <h2>Ideological Framework</h2>
          <div
            className="markdown-content"
            dangerouslySetInnerHTML={{ __html: md(character.framework) }}
          />
        </>
      )}

      {character.specificPositions.length > 0 && (
        <>
          <h2>Specific Positions</h2>
          <ol>
            {character.specificPositions.map((p, i) => (
              <li
                key={i}
                dangerouslySetInnerHTML={{ __html: md(p) }}
              />
            ))}
          </ol>
        </>
      )}

      {character.blindSpot && (
        <>
          <h2>Blind Spot</h2>
          <div
            className="markdown-content"
            dangerouslySetInnerHTML={{ __html: md(character.blindSpot) }}
          />
        </>
      )}

      {character.heroes.length > 0 && (
        <>
          <h2>Intellectual Heroes</h2>
          <ul>
            {character.heroes.map((h, i) => (
              <li key={i} dangerouslySetInnerHTML={{ __html: md(h) }} />
            ))}
          </ul>
        </>
      )}

      {character.debateStyle && (
        <>
          <h2>Debate Style</h2>
          <div
            className="markdown-content"
            dangerouslySetInnerHTML={{
              __html: md(character.debateStyle),
            }}
          />
        </>
      )}

      {character.rhetoricalTendencies && !character.debateStyle && (
        <>
          <h2>Rhetorical Tendencies</h2>
          <div
            className="markdown-content"
            dangerouslySetInnerHTML={{
              __html: md(character.rhetoricalTendencies),
            }}
          />
        </>
      )}

      {character.relationships && character.relationships.length > 0 && (
        <>
          <h2>Relationships</h2>
          <ul>
            {character.relationships.map((r, i) => (
              <li key={i} dangerouslySetInnerHTML={{ __html: md(r) }} />
            ))}
          </ul>
        </>
      )}

      {debateHistory.length > 0 && (
        <>
          <h2>Debate History</h2>
          <p
            style={{
              color: "var(--color-text-secondary)",
              fontSize: "0.85rem",
              marginBottom: "1rem",
            }}
          >
            {debateHistory.length} contributions across debates and follow-ups
          </p>
          {debateHistory.map((entry, i) => (
            <details key={i}>
              <summary>
                {entry.label}{" "}
                {entry.type === "follow-up" && (
                  <span className="badge badge-tag">follow-up</span>
                )}
              </summary>
              <div className="details-content">
                <p>{entry.excerpt}</p>
                <Link
                  href={entry.link}
                  style={{ fontSize: "0.82rem" }}
                >
                  View in context &rarr;
                </Link>
              </div>
            </details>
          ))}
        </>
      )}

      <FollowUpModal
        assemblyId={assemblyId}
        characters={nonSocrateChars.map((c) => c.name)}
        avatarUrlMap={avatarUrlMap}
        currentPage={`character-${character.name}`}
        defaultCharacter={character.name}
        pageType="character"
        followUps={topic.followUps}
      />

      <hr />
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          fontSize: "0.85rem",
        }}
      >
        {prev ? (
          <Link href={`${base}/characters/${prev.number}`}>
            &larr; {prev.name}
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link href={`${base}/characters/${next.number}`}>
            {next.name} &rarr;
          </Link>
        ) : (
          <span />
        )}
      </div>

      <HighlightChat
        assemblyId={assemblyId}
        characters={nonSocrateChars.map((c) => c.name)}
        avatarUrlMap={avatarUrlMap}
        currentPage={`character-${character.name}`}
        defaultCharacter={character.name}
        defaultMode="ask-character"
      />
    </>
  );
}
