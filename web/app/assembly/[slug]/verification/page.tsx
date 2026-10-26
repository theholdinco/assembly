"use client";

import Link from "next/link";
import { renderMarkdown } from "@/lib/markdown";
import { useAssembly, useAssemblyId } from "@/lib/assembly-context";
import FollowUpModal from "@/components/FollowUpModal";
import HighlightChat from "@/components/HighlightChat";

function md(text: string): string {
  return renderMarkdown(text);
}

function extractCorrectionCount(content: string): number | null {
  const match = content.match(/Number of corrections applied:\s*(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
}

export default function VerificationPage() {
  const topic = useAssembly();
  const assemblyId = useAssemblyId();
  const base = `/assembly/${topic.slug}`;

  if (topic.verification.length === 0) {
    return <p>No verification reports available.</p>;
  }

  const isNotesFormat = topic.verification.some((v) => v.type === "notes");
  const correctionCount = isNotesFormat
    ? extractCorrectionCount(topic.verification[0].content)
    : null;

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
        <span className="current">Verification</span>
      </div>

      <h1>Verification</h1>
      {isNotesFormat && correctionCount !== null ? (
        <p className="page-subtitle">
          Verification complete — {correctionCount} correction{correctionCount !== 1 ? "s" : ""} applied to deliverable
        </p>
      ) : (
        <p className="page-subtitle">
          {topic.verification.length} verification report
          {topic.verification.length > 1 ? "s" : ""}
        </p>
      )}

      {topic.verification.map((v) => (
        <div key={v.type} id={v.type}>
          <div
            className="markdown-content"
            dangerouslySetInnerHTML={{ __html: md(v.content) }}
          />
          <hr />
        </div>
      ))}

      <FollowUpModal
        assemblyId={assemblyId}
        characters={topic.characters.map((c) => c.name)}
        currentPage="verification"
      />
      <HighlightChat
        assemblyId={assemblyId}
        characters={topic.characters.map((c) => c.name)}
        currentPage="verification"
        defaultMode="ask-assembly"
      />
    </>
  );
}
