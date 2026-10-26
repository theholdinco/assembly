"use client";

import { renderMarkdown } from "@/lib/markdown";
import type { InvestmentMemo } from "@/lib/ic/types";

interface MemoViewerProps {
  memo: InvestmentMemo;
}

function isCaveatSection(heading: string): boolean {
  const lower = heading.toLowerCase();
  return lower.includes("what we don't know") || lower.includes("information gaps") || lower.includes("what we don\u2019t know");
}

export default function MemoViewer({ memo }: MemoViewerProps) {
  if (memo.sections?.length > 0) {
    return (
      <div className="ic-memo">
        <h1 className="ic-memo-title">{memo.title}</h1>
        {memo.sections.map((section, i) => (
          <div
            key={i}
            className={`ic-memo-section ${isCaveatSection(section.heading) ? "ic-memo-section-caveat" : ""}`}
          >
            <h2>{section.heading}</h2>
            <div
              className="markdown-content"
              dangerouslySetInnerHTML={{
                __html: renderMarkdown(section.content),
              }}
            />
          </div>
        ))}
      </div>
    );
  }

  if (memo.raw) {
    return (
      <div className="ic-memo">
        <div
          className="markdown-content"
          dangerouslySetInnerHTML={{
            __html: renderMarkdown(memo.raw),
          }}
        />
      </div>
    );
  }

  return <p style={{ color: "var(--color-text-muted)" }}>No memo available.</p>;
}
