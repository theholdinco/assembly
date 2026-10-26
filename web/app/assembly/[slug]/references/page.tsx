"use client";

import Link from "next/link";
import { renderMarkdown } from "@/lib/markdown";
import { useAssembly, useAssemblyId } from "@/lib/assembly-context";
import FollowUpModal from "@/components/FollowUpModal";
import HighlightChat from "@/components/HighlightChat";
import { buildCharacterMaps, findColor, findAvatarUrl, initials, isSocrate } from "@/lib/character-utils";

function md(text: string): string {
  return renderMarkdown(text);
}

export default function ReferencesPage() {
  const topic = useAssembly();
  const assemblyId = useAssemblyId();
  const base = `/assembly/${topic.slug}`;

  if (!topic.referenceLibrary) {
    return <p>No reference library available.</p>;
  }

  const parsed = topic.parsedReferenceLibrary;
  const { colorMap, avatarUrlMap } = buildCharacterMaps(topic.characters);

  const truncatedTitle =
    topic.title.length > 30
      ? topic.title.slice(0, 29) + "\u2026"
      : topic.title;

  if (!parsed) {
    return (
      <>
        <div className="breadcrumb">
          <Link href="/">Home</Link>
          <span className="separator">/</span>
          <Link href={base}>{truncatedTitle}</Link>
          <span className="separator">/</span>
          <span className="current">Babylon&apos;s Library</span>
        </div>

        <h1>Babylon&apos;s Library</h1>
        <p className="page-subtitle">
          Intellectual traditions and empirical evidence grounding the assembly
          debate
        </p>
        <div
          className="markdown-content"
          dangerouslySetInnerHTML={{ __html: md(topic.referenceLibrary) }}
        />

        <FollowUpModal
          assemblyId={assemblyId}
          characters={topic.characters.filter((c) => !isSocrate(c.name)).map((c) => c.name)}
          avatarUrlMap={avatarUrlMap}
          currentPage="references"
          pageType="references"
          followUps={topic.followUps}
        />
        <HighlightChat
          assemblyId={assemblyId}
          characters={topic.characters.filter((c) => !isSocrate(c.name)).map((c) => c.name)}
          avatarUrlMap={avatarUrlMap}
          currentPage="references"
          defaultMode="ask-library"
        />
      </>
    );
  }

  return (
    <>
      <div className="breadcrumb">
        <Link href="/">Home</Link>
        <span className="separator">/</span>
        <Link href={base}>{truncatedTitle}</Link>
        <span className="separator">/</span>
        <span className="current">Babylon&apos;s Library</span>
      </div>

      <h1>Babylon&apos;s Library</h1>
      <p className="page-subtitle">
        Intellectual traditions and empirical evidence grounding the assembly
        debate
      </p>

      {parsed.sections.map((section, si) => (
        <div key={si} className="ref-section">
          <h2>{section.title}</h2>
          <div className="ref-grid">
            {section.subsections.map((sub, subi) => (
              <div key={subi} className="ref-card">
                <div className="ref-card-header">
                  {sub.character && (
                    findAvatarUrl(sub.character, avatarUrlMap) ? (
                      <img
                        src={findAvatarUrl(sub.character, avatarUrlMap)}
                        alt={sub.character}
                        className="ref-char-badge"
                      />
                    ) : (
                      <span
                        className="ref-char-badge"
                        style={{
                          background: findColor(sub.character, colorMap),
                        }}
                      >
                        {initials(sub.character)}
                      </span>
                    )
                  )}
                  <div>
                    <div className="ref-card-title">{sub.title}</div>
                    {sub.character && (
                      <div className="ref-card-character">
                        {sub.character}
                        {sub.tag && (
                          <>
                            {" "}
                            <span className="badge badge-tag">{sub.tag}</span>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                {sub.entries.map((entry, ei) => {
                  const parts = [
                    entry.author
                      ? `<strong>${entry.author}</strong>`
                      : "",
                    entry.work ? `<em>${entry.work}</em>` : "",
                    entry.year ? `(${entry.year})` : "",
                  ]
                    .filter(Boolean)
                    .join(" &mdash; ");

                  return (
                    <div key={ei} className="ref-entry">
                      {parts && (
                        <div
                          className="ref-entry-title"
                          dangerouslySetInnerHTML={{ __html: parts }}
                        />
                      )}
                      {entry.description && (
                        <div className="ref-entry-desc">
                          {entry.description}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      ))}

      {parsed.crossReadings.length > 0 && (
        <div className="ref-section">
          <h2>Cross-Reading Assignments</h2>
          <div className="cross-reading-list">
            {parsed.crossReadings.map((cr, i) => (
              <div key={i} className="cross-reading">
                {findAvatarUrl(cr.character, avatarUrlMap) ? (
                  <img
                    src={findAvatarUrl(cr.character, avatarUrlMap)}
                    alt={cr.character}
                    className="trajectory-avatar-sm"
                  />
                ) : (
                  <span
                    className="trajectory-avatar-sm"
                    style={{ background: findColor(cr.character, colorMap) }}
                  >
                    {initials(cr.character)}
                  </span>
                )}
                <div>
                  <strong>{cr.character}</strong> must engage: {cr.assignment}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <FollowUpModal
        assemblyId={assemblyId}
        characters={topic.characters.filter((c) => !isSocrate(c.name)).map((c) => c.name)}
        avatarUrlMap={avatarUrlMap}
        currentPage="references"
        pageType="references"
        followUps={topic.followUps}
      />
      <HighlightChat
        assemblyId={assemblyId}
        characters={topic.characters.filter((c) => !isSocrate(c.name)).map((c) => c.name)}
        avatarUrlMap={avatarUrlMap}
        currentPage="references"
        defaultMode="ask-library"
      />
    </>
  );
}
