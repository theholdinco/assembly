"use client";

import { Suspense, useEffect, useState, useRef } from "react";
import { useRouter, useSearchParams, useParams } from "next/navigation";
import Link from "next/link";

const PHASES = [
  { key: "code-analysis", label: "Code Analysis", href: null },
  { key: "domain-analysis", label: "Domain Analysis", href: null },
  { key: "character-generation", label: "Character Generation", href: "/characters" },
  { key: "reference-library", label: "Reference Library", href: "/references" },
  { key: "reference-audit", label: "Reference Audit", href: null },
  { key: "debate", label: "Debate", href: "/iteration/1" },
  { key: "synthesis", label: "Synthesis", href: "/synthesis" },
  { key: "deliverable", label: "Deliverables", href: "/deliverables" },
  { key: "verification", label: "Verification", href: "/verification" },
] as const;

type Status = "queued" | "running" | "complete" | "error" | "cancelled";

function phaseIndex(phase: string): number {
  return PHASES.findIndex((p) => p.key === phase);
}

function getStoredProgress(routeSlug: string): { phase: string; status: Status } {
  try {
    const stored = sessionStorage.getItem(`generating-${routeSlug}`);
    if (stored) {
      const parsed = JSON.parse(stored);
      return { phase: parsed.phase || "", status: parsed.status || "queued" };
    }
  } catch {}
  return { phase: "", status: "queued" };
}

function storeProgress(routeSlug: string, phase: string, status: Status) {
  try {
    sessionStorage.setItem(`generating-${routeSlug}`, JSON.stringify({ phase, status }));
  } catch {}
}

function GeneratingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { slug: routeSlug } = useParams<{ slug: string }>();
  const assemblyId = searchParams.get("id");

  const stored = getStoredProgress(routeSlug);
  const [currentPhase, setCurrentPhase] = useState<string>(stored.phase);
  const [status, setStatus] = useState<Status>(stored.status);
  const [slug, setSlug] = useState<string>(routeSlug || "");
  const [error, setError] = useState("");
  const [resolvedId, setResolvedId] = useState<string | null>(assemblyId);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (resolvedId) return;
    fetch(`/api/assemblies/by-slug/${routeSlug}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.id) setResolvedId(data.id);
        else setError("Panel not found.");
      })
      .catch(() => setError("Failed to load panel."));
  }, [resolvedId, routeSlug]);

  useEffect(() => {
    if (!resolvedId) return;

    const es = new EventSource(`/api/assemblies/${resolvedId}/stream`);
    eventSourceRef.current = es;

    const updatePhase = (phase: string) => {
      setCurrentPhase(phase);
      storeProgress(routeSlug, phase, "running");
    };

    const updateStatus = (newStatus: Status, phase?: string) => {
      setStatus(newStatus);
      if (phase !== undefined) setCurrentPhase(phase);
      storeProgress(routeSlug, phase ?? "", newStatus);
    };

    es.onmessage = (event) => {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case "state":
          updateStatus(data.status, data.currentPhase || "");
          if (data.slug) setSlug(data.slug);
          if (data.status === "complete" && data.slug) {
            sessionStorage.removeItem(`generating-${routeSlug}`);
            sessionStorage.setItem(`assembly-complete-${routeSlug}`, "1");
            es.close();
            window.location.href = `/assembly/${data.slug}`;
          }
          break;
        case "phase":
          updatePhase(data.phase || "");
          setStatus("running");
          break;
        case "status":
          updateStatus(data.status);
          if (data.slug) setSlug(data.slug);
          if (data.status === "complete" && data.slug) {
            sessionStorage.removeItem(`generating-${routeSlug}`);
            sessionStorage.setItem(`assembly-complete-${routeSlug}`, "1");
            es.close();
            window.location.href = `/assembly/${data.slug}`;
          }
          break;
        case "error":
          sessionStorage.removeItem(`generating-${routeSlug}`);
          setError(data.content || "An error occurred.");
          es.close();
          break;
      }
    };

    let errorCount = 0;
    es.onerror = () => {
      errorCount++;
      if (errorCount > 5) {
        es.close();
        setError("Lost connection to server. Please refresh the page.");
      }
    };

    return () => {
      es.close();
    };
  }, [resolvedId, router, routeSlug]);

  const activeIndex = phaseIndex(currentPhase);

  if (error) {
    return (
      <div className="standalone-page">
        <div className="standalone-page-inner" style={{ textAlign: "center" }}>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: "1.5rem", fontWeight: 700, marginBottom: "0.75rem" }}>
            Something went wrong
          </h1>
          <p style={{ color: "var(--color-text-secondary)", marginBottom: "1.5rem" }}>{error}</p>
          <Link href="/" className="btn-primary">
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  if (status === "error" || status === "cancelled") {
    return (
      <div className="standalone-page">
        <div className="standalone-page-inner" style={{ textAlign: "center" }}>
          <h1 style={{ fontFamily: "var(--font-display)", fontSize: "1.5rem", fontWeight: 700, marginBottom: "0.75rem" }}>
            Generation {status === "error" ? "failed" : "cancelled"}
          </h1>
          <p style={{ color: "var(--color-text-secondary)", marginBottom: "1.5rem" }}>
            {status === "error"
              ? "An error occurred during generation. Please try again."
              : "This panel was cancelled."}
          </p>
          <div style={{ display: "flex", gap: "0.75rem", justifyContent: "center" }}>
            <Link href="/" className="btn-secondary">
              Dashboard
            </Link>
            <Link href="/new" className="btn-primary">
              Try again
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const basePath = slug ? `/assembly/${slug}` : "";

  return (
    <div className="standalone-page">
      <div className="standalone-page-inner">
        <div className="standalone-header">
          <h1>Assembling your panel</h1>
          <p>
            {status === "queued"
              ? "Waiting to start..."
              : "Characters are deliberating. This typically takes a few minutes."}
          </p>
        </div>

        <div className="progress-phases">
          {PHASES.map((phase, i) => {
            const isCompleted = activeIndex > i;
            const isCurrent = activeIndex === i && status === "running";
            const state = isCompleted ? "done" : isCurrent ? "active" : "upcoming";

            const content = (
              <>
                <div className={`phase-dot ${state}`}>
                  {state === "done" ? "\u2713" : "\u2022"}
                </div>
                <span className={`phase-label ${state}`}>
                  {phase.label}
                </span>
                {isCompleted && phase.href && (
                  <span className="phase-view-link">View &rarr;</span>
                )}
              </>
            );

            if (isCompleted && phase.href && basePath) {
              return (
                <a
                  key={phase.key}
                  href={`${basePath}${phase.href}`}
                  className={`phase-row ${state} clickable`}
                >
                  {content}
                </a>
              );
            }

            return (
              <div key={phase.key} className={`phase-row ${state}`}>
                {content}
              </div>
            );
          })}
        </div>

        <div style={{ textAlign: "center", marginTop: "2rem", display: "flex", flexDirection: "column", gap: "0.75rem", alignItems: "center" }}>
          <p style={{ color: "var(--color-text-muted)", fontSize: "0.8rem", margin: 0 }}>
            You can leave this page. Generation will continue in the background.
          </p>
          <div style={{ display: "flex", gap: "0.75rem" }}>
            <Link href="/" className="btn-secondary" style={{ fontSize: "0.8rem", padding: "0.5rem 1rem" }}>
              Dashboard
            </Link>
            <Link href="/new" className="btn-secondary" style={{ fontSize: "0.8rem", padding: "0.5rem 1rem" }}>
              + New Panel
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function GeneratingPage() {
  return (
    <Suspense fallback={
      <div className="standalone-page">
        <div className="standalone-page-inner">
          <div className="standalone-header">
            <h1>Assembling your panel</h1>
            <p>Loading...</p>
          </div>
        </div>
      </div>
    }>
      <GeneratingContent />
    </Suspense>
  );
}
