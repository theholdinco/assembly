"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { renderMarkdown } from "@/lib/markdown";
import GeneratingProgress from "@/components/ic/GeneratingProgress";
import IdeaCard from "@/components/ic/IdeaCard";
import type { InvestmentIdea } from "@/lib/ic/types";
import Link from "next/link";

interface IdeaSession {
  id: string;
  focus_area: string;
  status: string;
  parsed_data: {
    ideas?: InvestmentIdea[];
    gapAnalysis?: string;
    raw?: string;
  };
  error_message?: string;
  created_at: string;
}

const IDEA_PHASES = [
  { key: "gap-analysis", label: "Gap Analysis" },
  { key: "idea-debate", label: "Idea Debate" },
  { key: "idea-synthesis", label: "Idea Synthesis" },
];

export default function IdeaSessionPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [session, setSession] = useState<IdeaSession | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSession = useCallback(() => {
    fetch(`/api/ic/ideas/${id}`)
      .then((r) => {
        if (!r.ok) throw new Error("Not found");
        return r.json();
      })
      .then((data) => {
        setSession(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    fetchSession();
  }, [fetchSession]);

  if (loading) {
    return (
      <div className="ic-dashboard">
        <p style={{ color: "var(--color-text-muted)" }}>Loading...</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="ic-dashboard">
        <div className="ic-empty-state">
          <h1>Not Found</h1>
          <p>This idea session could not be found.</p>
          <Link href="/ic/ideas" className="btn-primary">
            Back to Ideas
          </Link>
        </div>
      </div>
    );
  }

  const isGenerating = session.status === "queued" || session.status === "running";

  if (isGenerating) {
    return (
      <div className="ic-dashboard">
        <Link href="/ic/ideas" className="standalone-back">
          &larr; Back to Ideas
        </Link>
        <div className="standalone-header" style={{ textAlign: "left" }}>
          <h1>Generating Ideas</h1>
          <p>
            {session.focus_area
              ? `Focus: ${session.focus_area}`
              : "Your committee is brainstorming investment opportunities."}
          </p>
        </div>
        <GeneratingProgress
          streamUrl={`/api/ic/ideas/${id}/stream`}
          phases={IDEA_PHASES}
          onComplete={fetchSession}
          onError={fetchSession}
        />
      </div>
    );
  }

  if (session.status === "error") {
    return (
      <div className="ic-dashboard">
        <Link href="/ic/ideas" className="standalone-back">
          &larr; Back to Ideas
        </Link>
        <div className="ic-empty-state">
          <h1>Generation Error</h1>
          <p>{session.error_message || "An error occurred during idea generation."}</p>
          <Link href="/ic/ideas" className="btn-primary">
            Try Again
          </Link>
        </div>
      </div>
    );
  }

  const parsedData = session.parsed_data || {};
  const ideas = parsedData.ideas || [];
  const gapAnalysis = parsedData.gapAnalysis || "";

  return (
    <div className="ic-dashboard">
      <Link href="/ic/ideas" className="standalone-back">
        &larr; Back to Ideas
      </Link>

      <header className="ic-dashboard-header">
        <div>
          <h1>{session.focus_area || "Investment Ideas"}</h1>
          <p>
            {ideas.length} idea{ideas.length !== 1 ? "s" : ""} generated &middot;{" "}
            {new Date(session.created_at).toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </p>
        </div>
      </header>

      {gapAnalysis && (
        <section className="ic-section">
          <h2>Portfolio Gap Analysis</h2>
          <div
            className="ic-gap-analysis markdown-content"
            dangerouslySetInnerHTML={{
              __html: renderMarkdown(gapAnalysis),
            }}
          />
        </section>
      )}

      {ideas.length > 0 && (
        <section className="ic-section">
          <h2>Ideas</h2>
          <div className="ic-idea-grid">
            {ideas.map((idea, i) => (
              <IdeaCard key={i} idea={idea} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
