"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { renderMarkdown } from "@/lib/markdown";
import { useAssembly, useAssemblyId } from "@/lib/assembly-context";
import FollowUpModal from "@/components/FollowUpModal";
import HighlightChat from "@/components/HighlightChat";
import { buildCharacterMaps, findColor, findAvatarUrl, initials, isSocrate } from "@/lib/character-utils";
import type { DebateExchange } from "@/lib/types";

const STRUCTURE_DISPLAY_NAMES: Record<string, string> = {
  "grande-table": "Town Hall",
  "rapid-fire": "Crossfire",
  "deep-dive": "Deep Dive",
};

function formatStructure(s: string): string {
  return (
    STRUCTURE_DISPLAY_NAMES[s] ??
    s
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  );
}

function md(text: string): string {
  return renderMarkdown(text);
}

function Exchange({
  ex,
  isSocrateExchange,
  isReaction,
  colorMap,
  avatarUrlMap,
}: {
  ex: DebateExchange;
  isSocrateExchange: boolean;
  isReaction: boolean;
  colorMap: Record<string, string>;
  avatarUrlMap: Record<string, string>;
}) {
  const cls = isSocrateExchange
    ? "debate-exchange debate-socrate"
    : isReaction
      ? "debate-exchange debate-reaction"
      : "debate-exchange";

  const avatarUrl = findAvatarUrl(ex.speaker, avatarUrlMap);
  const color = isSocrateExchange ? "var(--color-socrate)" : findColor(ex.speaker, colorMap);

  return (
    <div className={cls}>
      <div className="debate-speaker">
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={ex.speaker}
            style={{ width: 20, height: 20, borderRadius: "50%", objectFit: "cover" }}
          />
        ) : (
          <span
            className="debate-speaker-dot"
            style={{ background: color }}
          />
        )}
        {ex.speaker}
      </div>
      <div
        className="debate-content"
        dangerouslySetInnerHTML={{ __html: md(ex.content) }}
      />
    </div>
  );
}

export default function IterationPage() {
  const topic = useAssembly();
  const assemblyId = useAssemblyId();
  const params = useParams<{ slug: string; num: string }>();
  const num = Number(params.num);
  const base = `/assembly/${topic.slug}`;

  const { colorMap, avatarUrlMap } = buildCharacterMaps(topic.characters);
  const nonSocrateNames = topic.characters.filter((c) => !isSocrate(c.name)).map((c) => c.name);

  const iteration = topic.iterations.find((i) => i.number === num);
  if (!iteration) {
    return <p>Iteration not found.</p>;
  }

  const iterIndex = topic.iterations.findIndex((i) => i.number === num);
  const prev = topic.iterations[iterIndex - 1] ?? null;
  const next = topic.iterations[iterIndex + 1] ?? null;

  const showTranscript =
    iteration.rounds.length > 0 &&
    iteration.transcriptRaw !== iteration.synthesis?.raw;

  return (
    <>
      <div className="breadcrumb">
        <Link href="/">Home</Link>
        <span className="separator">/</span>
        <Link href={base}>
          {topic.title.length > 30
            ? topic.title.slice(0, 29) + "\u2026"
            : topic.title}
        </Link>
        <span className="separator">/</span>
        <span className="current">
          Iteration {iteration.number}: {formatStructure(iteration.structure)}
        </span>
      </div>

      <h1>{formatStructure(iteration.structure)}</h1>
      <p className="page-subtitle">Debate round {iteration.number}</p>

      {iteration.synthesis && (
        <div
          className="markdown-content"
          dangerouslySetInnerHTML={{ __html: md(iteration.synthesis.raw) }}
        />
      )}

      {showTranscript && (
        <>
          <div className="section-header">
            <h2>Debate Transcript</h2>
            <span className="section-count">
              {iteration.rounds.length} rounds
            </span>
          </div>

          {iteration.rounds.map((round, ri) => (
            <details key={ri}>
              <summary>{round.title}</summary>
              <div className="details-content">
                {round.exchanges.map((ex, ei) => (
                  <Exchange
                    key={`ex-${ei}`}
                    ex={ex}
                    isSocrateExchange={false}
                    isReaction={false}
                    colorMap={colorMap}
                    avatarUrlMap={avatarUrlMap}
                  />
                ))}
                {round.socrate.length > 0 && (
                  <>
                    <h3>Socrate Intervenes</h3>
                    {round.socrate.map((ex, si) => (
                      <Exchange
                        key={`soc-${si}`}
                        ex={ex}
                        isSocrateExchange={true}
                        isReaction={false}
                        colorMap={colorMap}
                        avatarUrlMap={avatarUrlMap}
                      />
                    ))}
                  </>
                )}
                {round.assemblyReactions.length > 0 && (
                  <>
                    <h3>Assembly Reactions</h3>
                    {round.assemblyReactions.map((ex, ai) => (
                      <Exchange
                        key={`react-${ai}`}
                        ex={ex}
                        isSocrateExchange={false}
                        isReaction={true}
                        colorMap={colorMap}
                        avatarUrlMap={avatarUrlMap}
                      />
                    ))}
                  </>
                )}
              </div>
            </details>
          ))}
        </>
      )}

      <FollowUpModal
        assemblyId={assemblyId}
        characters={nonSocrateNames}
        avatarUrlMap={avatarUrlMap}
        currentPage={`iteration-${num}`}
        pageType="iteration"
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
          <Link href={`${base}/iteration/${prev.number}`}>
            &larr; Iteration {prev.number}: {formatStructure(prev.structure)}
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link href={`${base}/iteration/${next.number}`}>
            Iteration {next.number}: {formatStructure(next.structure)} &rarr;
          </Link>
        ) : (
          <span />
        )}
      </div>

      <HighlightChat
        assemblyId={assemblyId}
        characters={nonSocrateNames}
        avatarUrlMap={avatarUrlMap}
        currentPage={`iteration-${num}`}
        defaultMode="debate"
      />
    </>
  );
}
