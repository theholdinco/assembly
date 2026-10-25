"use client";

import { useState } from "react";
import Link from "next/link";
import { renderMarkdown } from "@/lib/markdown";
import { useAssembly, useAssemblyId, useAssemblyAccess } from "@/lib/assembly-context";
import type { DivergencePoint, FollowUpInsight } from "@/lib/types";
import FollowUpModal from "@/components/FollowUpModal";
import HighlightChat from "@/components/HighlightChat";
import { buildCharacterMaps, findColor, findAvatarUrl, initials, isSocrate } from "@/lib/character-utils";

const INSIGHT_TYPE_LABELS: Record<FollowUpInsight["type"], string> = {
  position_shift: "Position Shift",
  new_argument: "New Argument",
  emergent_synthesis: "Emergent Synthesis",
  exposed_gap: "Exposed Gap",
  unexpected_agreement: "Unexpected Agreement",
};

const INSIGHT_TYPE_COLORS: Record<FollowUpInsight["type"], string> = {
  position_shift: "#cf222e",
  new_argument: "#0969da",
  emergent_synthesis: "#8250df",
  exposed_gap: "#e16f24",
  unexpected_agreement: "#1a7f37",
};

function md(text: string): string {
  return renderMarkdown(text);
}

interface CharacterStance {
  name: string;
  framework: string;
  position: string;
}

function extractStances(divergenceContent: string): CharacterStance[] {
  const stances: CharacterStance[] = [];
  const lines = divergenceContent.split("\n");
  const stanceRe = /^\s*-\s+\*{0,2}([^*(]+?)\*{0,2}\s*\(([^)]+)\):\s*(.+)/;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(stanceRe);
    if (match) {
      let position = match[3].trim();
      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j];
        if (
          /^\s*-\s+\S/.test(nextLine) ||
          nextLine.trim() === "" ||
          /^#{1,3}\s/.test(nextLine)
        )
          break;
        if (/^\s{4,}/.test(nextLine)) {
          position += " " + nextLine.trim();
        } else {
          break;
        }
      }
      stances.push({
        name: match[1].trim(),
        framework: match[2].trim(),
        position,
      });
    }
  }
  return stances;
}

export default function TrajectoryPage() {
  const topic = useAssembly();
  const assemblyId = useAssemblyId();
  const accessLevel = useAssemblyAccess();
  const base = `/assembly/${topic.slug}`;
  const canWrite = accessLevel === "owner" || accessLevel === "write";
  const [evolving, setEvolving] = useState(false);
  const [evolveError, setEvolveError] = useState<string | null>(null);
  const [evolveSuccess, setEvolveSuccess] = useState(false);

  const { colorMap, avatarUrlMap } = buildCharacterMaps(topic.characters);

  const insights = topic.followUps.filter((fu) => fu.insight?.hasInsight);

  async function handleEvolve() {
    setEvolving(true);
    setEvolveError(null);
    setEvolveSuccess(false);

    const res = await fetch(`/api/assemblies/${assemblyId}/deliverables`, {
      method: "POST",
    });

    if (!res.ok) {
      const data = await res.json();
      setEvolveError(data.error || "Failed to evolve deliverable");
      setEvolving(false);
      return;
    }

    setEvolveSuccess(true);
    setEvolving(false);
  }

  // Collect all divergences
  const allDivergences: DivergencePoint[] = [];
  if (topic.synthesis) allDivergences.push(...topic.synthesis.divergence);
  for (const iter of topic.iterations) {
    if (iter.synthesis) allDivergences.push(...iter.synthesis.divergence);
  }

  const seenIssues = new Set<string>();
  const uniqueDivergences: DivergencePoint[] = [];
  for (const dp of allDivergences) {
    if (!seenIssues.has(dp.issue)) {
      seenIssues.add(dp.issue);
      uniqueDivergences.push(dp);
    }
  }

  // Recurring tensions
  const clashCounts = new Map<string, number>();
  for (const fu of topic.followUps) {
    if (fu.responses.length >= 2) {
      const speakers = fu.responses.map((r) => r.speaker).sort();
      for (let i = 0; i < speakers.length; i++) {
        for (let j = i + 1; j < speakers.length; j++) {
          const key = `${speakers[i]}|${speakers[j]}`;
          clashCounts.set(key, (clashCounts.get(key) ?? 0) + 1);
        }
      }
    }
  }

  const tensions = [...clashCounts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1]);

  const truncatedTitle =
    topic.title.length > 30
      ? topic.title.slice(0, 29) + "\u2026"
      : topic.title;

  return (
    <>
      <div className="breadcrumb">
        <Link href="/">Home</Link>
        <span className="separator">/</span>
        <Link href={base}>{truncatedTitle}</Link>
        <span className="separator">/</span>
        <span className="current">Thinking Trail</span>
      </div>

      <h1>Thinking Trail</h1>
      <p className="page-subtitle">
        How the panel&apos;s positions have evolved &mdash;{" "}
        {insights.length} insight{insights.length !== 1 ? "s" : ""},{" "}
        {topic.followUps.length} follow-up
        {topic.followUps.length !== 1 ? "s" : ""}
      </p>

      {/* Intellectual Journal */}
      {insights.length > 0 && (
        <div className="trajectory-journal">
          <h2 className="trajectory-section-heading">Intellectual Journal</h2>
          <p className="trajectory-section-subtitle">
            New intellectual territory discovered through follow-up conversations
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: "1rem", marginTop: "1rem" }}>
            {insights.map((fu) => {
              const insight = fu.insight!;
              return (
                <div
                  key={fu.id || fu.timestamp}
                  style={{
                    border: "1px solid var(--color-border)",
                    borderRadius: "8px",
                    padding: "1rem 1.25rem",
                    background: "var(--color-surface)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.5rem", flexWrap: "wrap" }}>
                    <span style={{ fontSize: "0.8rem", color: "var(--color-text-muted)" }}>
                      {new Date(fu.timestamp).toLocaleDateString(undefined, {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                    <span
                      className="badge"
                      style={{
                        background: INSIGHT_TYPE_COLORS[insight.type],
                        color: "#fff",
                        fontSize: "0.7rem",
                        padding: "0.15rem 0.5rem",
                        borderRadius: "9999px",
                      }}
                    >
                      {INSIGHT_TYPE_LABELS[insight.type]}
                    </span>
                    {insight.involvedCharacters.map((name) => {
                      const url = findAvatarUrl(name, avatarUrlMap);
                      return url ? (
                        <img
                          key={name}
                          src={url}
                          alt={name}
                          title={name}
                          className="trajectory-avatar-sm"
                        />
                      ) : (
                        <span
                          key={name}
                          className="trajectory-avatar-sm"
                          style={{ background: findColor(name, colorMap) }}
                          title={name}
                        >
                          {initials(name)}
                        </span>
                      );
                    })}
                  </div>
                  <p style={{ margin: "0.5rem 0 0.25rem", fontWeight: 500 }}>
                    {insight.summary}
                  </p>
                  <p style={{ margin: 0, fontSize: "0.85rem", color: "var(--color-text-muted)" }}>
                    Sparked by: &ldquo;{fu.question.length > 120 ? fu.question.slice(0, 117) + "\u2026" : fu.question}&rdquo;
                  </p>
                </div>
              );
            })}
          </div>

          {canWrite && (
            <div style={{ marginTop: "1.5rem" }}>
              {evolveSuccess ? (
                <p style={{ color: "var(--color-success, #1a7f37)" }}>
                  Deliverable evolved successfully.{" "}
                  <Link href={`${base}/deliverables`}>View deliverables</Link>
                </p>
              ) : (
                <button
                  onClick={handleEvolve}
                  disabled={evolving}
                  style={{
                    padding: "0.6rem 1.25rem",
                    background: "var(--color-accent)",
                    color: "#fff",
                    border: "none",
                    borderRadius: "6px",
                    cursor: evolving ? "wait" : "pointer",
                    opacity: evolving ? 0.7 : 1,
                    fontSize: "0.9rem",
                  }}
                >
                  {evolving ? "Evolving deliverable\u2026" : "Evolve Deliverable"}
                </button>
              )}
              {evolveError && (
                <p style={{ color: "var(--color-error, #cf222e)", marginTop: "0.5rem" }}>
                  {evolveError}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {topic.followUps.length === 0 && insights.length === 0 && (
        <div style={{ padding: "2rem 0", color: "var(--color-text-muted)" }}>
          <p>No follow-up conversations yet. Ask the panel questions to start building your thinking trail.</p>
        </div>
      )}

      {uniqueDivergences.length > 0 && (
        <div className="trajectory-divergence-map">
          <h2 className="trajectory-section-heading">Divergence Map</h2>
          <p className="trajectory-section-subtitle">
            Key issues where the panel remains divided
          </p>

          {uniqueDivergences.map((dp, di) => {
            const stances = extractStances(dp.content);

            if (stances.length === 0) {
              return (
                <div key={di} className="divergence-issue">
                  <h3 className="divergence-issue-title">{dp.issue}</h3>
                  <div
                    className="divergence-prose"
                    dangerouslySetInnerHTML={{ __html: md(dp.content) }}
                  />
                </div>
              );
            }

            return (
              <div key={di} className="divergence-issue">
                <h3 className="divergence-issue-title">{dp.issue}</h3>
                <div className="divergence-stances">
                  {stances.map((s, si) => (
                    <div key={si} className="divergence-stance">
                      <div className="divergence-stance-speaker">
                        {findAvatarUrl(s.name, avatarUrlMap) ? (
                          <img
                            src={findAvatarUrl(s.name, avatarUrlMap)}
                            alt={s.name}
                            className="trajectory-avatar-sm"
                          />
                        ) : (
                          <span
                            className="trajectory-avatar-sm"
                            style={{ background: findColor(s.name, colorMap) }}
                          >
                            {initials(s.name)}
                          </span>
                        )}
                        <span className="divergence-stance-name">
                          {s.name}
                        </span>
                        <span className="badge badge-tag">{s.framework}</span>
                      </div>
                      <div className="divergence-stance-position">
                        {s.position}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tensions.length > 0 && (
        <div className="trajectory-tensions">
          <h3>Recurring Tensions</h3>
          {tensions.map(([pair, count]) => {
            const [a, b] = pair.split("|");
            return (
              <div key={pair} className="tension-pair">
                {avatarUrlMap[a] ? (
                  <img src={avatarUrlMap[a]} alt={a} className="trajectory-avatar-sm" />
                ) : (
                  <span
                    className="trajectory-avatar-sm"
                    style={{ background: colorMap[a] ?? "var(--color-accent)" }}
                  >
                    {initials(a)}
                  </span>
                )}
                <span className="tension-vs">vs</span>
                {avatarUrlMap[b] ? (
                  <img src={avatarUrlMap[b]} alt={b} className="trajectory-avatar-sm" />
                ) : (
                  <span
                    className="trajectory-avatar-sm"
                    style={{ background: colorMap[b] ?? "var(--color-accent)" }}
                  >
                    {initials(b)}
                  </span>
                )}
                <span className="tension-names">
                  {a} &amp; {b}
                </span>
                <span className="badge badge-tag">{count} exchanges</span>
              </div>
            );
          })}
        </div>
      )}

      <FollowUpModal
        assemblyId={assemblyId}
        characters={topic.characters.filter((c) => !isSocrate(c.name)).map((c) => c.name)}
        avatarUrlMap={avatarUrlMap}
        currentPage="trajectory"
        pageType="trajectory"
      />
      <HighlightChat
        assemblyId={assemblyId}
        characters={topic.characters.filter((c) => !isSocrate(c.name)).map((c) => c.name)}
        avatarUrlMap={avatarUrlMap}
        currentPage="trajectory"
        defaultMode="ask-assembly"
      />
    </>
  );
}
