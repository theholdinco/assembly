"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AttachmentWidget, { type AttachedFile } from "@/components/AttachmentWidget";

const TYPEWRITER_PROMPTS = [
  "Design a microservices architecture for a fintech platform...",
  "I had a fight with my best friend and I need perspective...",
  "Should I raise venture capital or bootstrap my startup?",
  "Help me create a 12-week marathon training program...",
  "What's the most effective way to learn Mandarin as an adult?",
  "Evaluate the pros and cons of remote vs hybrid work...",
  "I need to negotiate my salary — coach me through it...",
  "How should I restructure my team after a round of layoffs?",
  "Compare React, Vue, and Svelte for my next project...",
  "Help me plan a gap year that actually advances my career...",
];

function useTypewriter(prompts: string[], active: boolean) {
  const [display, setDisplay] = useState("");
  const indexRef = useRef(0);
  const charRef = useRef(0);
  const phaseRef = useRef<"typing" | "pausing" | "deleting">("typing");
  const frameRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const tick = useCallback(() => {
    const prompt = prompts[indexRef.current];
    const phase = phaseRef.current;

    if (phase === "typing") {
      charRef.current++;
      setDisplay(prompt.slice(0, charRef.current));
      if (charRef.current >= prompt.length) {
        phaseRef.current = "pausing";
        frameRef.current = setTimeout(tick, 2000);
      } else {
        frameRef.current = setTimeout(tick, 35 + Math.random() * 40);
      }
    } else if (phase === "pausing") {
      phaseRef.current = "deleting";
      frameRef.current = setTimeout(tick, 30);
    } else {
      charRef.current--;
      setDisplay(prompt.slice(0, charRef.current));
      if (charRef.current <= 0) {
        indexRef.current = (indexRef.current + 1) % prompts.length;
        phaseRef.current = "typing";
        frameRef.current = setTimeout(tick, 400);
      } else {
        frameRef.current = setTimeout(tick, 18);
      }
    }
  }, [prompts]);

  useEffect(() => {
    if (!active) return;
    frameRef.current = setTimeout(tick, 600);
    return () => { if (frameRef.current) clearTimeout(frameRef.current); };
  }, [active, tick]);

  return display;
}

interface GitHubRepo {
  fullName: string;
  name: string;
  owner: string;
  defaultBranch: string;
  description: string | null;
  private: boolean;
}

interface GitHubStatus {
  connected: boolean;
  username?: string;
}

export default function NewAssemblyPage() {
  const [topic, setTopic] = useState("");
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  const typewriterText = useTypewriter(TYPEWRITER_PROMPTS, topic.length === 0 && !submitting);

  const [savedCharsExpanded, setSavedCharsExpanded] = useState(false);
  const [savedChars, setSavedChars] = useState<Array<{ id: string; name: string; tag: string; avatar_url: string | null }>>([]);
  const [selectedSavedIds, setSelectedSavedIds] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/saved-characters")
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setSavedChars(data); })
      .catch(() => {});
  }, []);

  function toggleSavedChar(id: string) {
    setSelectedSavedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  const [githubStatus, setGithubStatus] = useState<GitHubStatus | null>(null);
  const [repoExpanded, setRepoExpanded] = useState(false);
  const [repoSearch, setRepoSearch] = useState("");
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null);
  const [branch, setBranch] = useState("main");
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    fetch("/api/github/status")
      .then((r) => r.json())
      .then(setGithubStatus)
      .catch(() => setGithubStatus({ connected: false }));
  }, []);

  useEffect(() => {
    if (!githubStatus?.connected || !repoExpanded) return;
    fetchRepos("");
  }, [githubStatus?.connected, repoExpanded]);

  function fetchRepos(q: string) {
    setLoadingRepos(true);
    const url = q ? `/api/github/repos?q=${encodeURIComponent(q)}` : "/api/github/repos";
    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setRepos(data);
      })
      .finally(() => setLoadingRepos(false));
  }

  function handleRepoSearch(value: string) {
    setRepoSearch(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => fetchRepos(value), 300);
  }

  function selectRepo(repo: GitHubRepo) {
    setSelectedRepo(repo);
    setBranch(repo.defaultBranch);
    setRepoSearch("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!topic.trim() || submitting) return;

    setError("");
    setSubmitting(true);

    const payload: Record<string, string | boolean | string[]> = { topicInput: topic.trim() };
    if (selectedRepo) {
      payload.githubRepoOwner = selectedRepo.owner;
      payload.githubRepoName = selectedRepo.name;
      payload.githubRepoBranch = branch;
    }
    if (files.length > 0) {
      payload.hasFiles = true;
    }
    if (selectedSavedIds.length > 0) {
      payload.savedCharacterIds = selectedSavedIds;
    }

    const res = await fetch("/api/assemblies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const data = await res.json();
      setError(data.error || "Failed to create assembly.");
      setSubmitting(false);
      return;
    }

    const { id, slug } = await res.json();

    if (files.length > 0) {
      try {
        for (const f of files) {
          const form = new FormData();
          form.append("file", f.file);
          const uploadRes = await fetch(`/api/assemblies/${id}/upload`, { method: "POST", body: form });
          if (!uploadRes.ok) {
            const errBody = await uploadRes.json().catch(() => ({}));
            throw new Error(errBody.error || `Upload failed (${uploadRes.status})`);
          }
        }
        await fetch(`/api/assemblies/${id}/upload`, { method: "PATCH" });
      } catch (err) {
        await fetch(`/api/assemblies/${id}/upload`, { method: "DELETE" });
        setError(err instanceof Error ? err.message : "File upload failed. Please try again.");
        setSubmitting(false);
        return;
      }
    }

    router.push(`/assembly/${slug}/generating?id=${id}`);
  }

  return (
    <div className="standalone-page">
      <div className="standalone-page-inner" style={{ maxWidth: "640px" }}>
        <Link href="/" className="standalone-back">
          &larr; Back to dashboard
        </Link>

        <div className="standalone-header" style={{ textAlign: "left" }}>
          <h1>Launch New Panel</h1>
          <p style={{ margin: 0 }}>
            Describe a topic or question. A fresh panel of AI characters will debate it from radically
            different perspectives.
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="topic-input-card">
            <div style={{ position: "relative" }}>
              <textarea
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder=""
                rows={5}
                disabled={submitting}
              />
              {topic.length === 0 && !submitting && (
                <div className="typewriter-overlay" aria-hidden="true">
                  <span className="typewriter-text">{typewriterText}</span>
                  <span className="typewriter-cursor" />
                </div>
              )}
            </div>

            <AttachmentWidget files={files} onChange={setFiles} disabled={submitting} />

            {savedChars.length > 0 && (
              <div className="repo-section">
                <button
                  type="button"
                  className="repo-toggle"
                  onClick={() => setSavedCharsExpanded(!savedCharsExpanded)}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ opacity: 0.6 }}>
                    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                  </svg>
                  Reuse saved characters ({selectedSavedIds.length}/{savedChars.length} selected)
                  <span style={{ marginLeft: "auto", fontSize: "0.75rem" }}>
                    {savedCharsExpanded ? "\u25B2" : "\u25BC"}
                  </span>
                </button>

                {savedCharsExpanded && (
                  <div className="repo-picker" style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", padding: "0.75rem" }}>
                    {savedChars.map((sc) => (
                      <button
                        key={sc.id}
                        type="button"
                        onClick={() => toggleSavedChar(sc.id)}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.4rem",
                          padding: "0.35rem 0.7rem",
                          borderRadius: "999px",
                          border: selectedSavedIds.includes(sc.id)
                            ? "1.5px solid var(--color-accent)"
                            : "1px solid var(--color-border)",
                          background: selectedSavedIds.includes(sc.id)
                            ? "var(--color-accent-bg, rgba(99,102,241,0.08))"
                            : "transparent",
                          cursor: "pointer",
                          fontSize: "0.82rem",
                          color: "var(--color-text)",
                        }}
                      >
                        {sc.avatar_url && (
                          <img src={sc.avatar_url} alt="" style={{ width: 18, height: 18, borderRadius: "50%" }} />
                        )}
                        {sc.name}
                        <span style={{ opacity: 0.5, fontSize: "0.75rem" }}>{sc.tag}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {githubStatus?.connected && (
              <div className="repo-section">
                <button
                  type="button"
                  className="repo-toggle"
                  onClick={() => setRepoExpanded(!repoExpanded)}
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{ opacity: 0.6 }}>
                    <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
                  </svg>
                  Link a repository (optional)
                  <span style={{ marginLeft: "auto", fontSize: "0.75rem" }}>
                    {repoExpanded ? "\u25B2" : "\u25BC"}
                  </span>
                </button>

                {repoExpanded && (
                  <div className="repo-picker">
                    {selectedRepo ? (
                      <div className="repo-selected">
                        <span className="repo-chip">
                          {selectedRepo.fullName}
                          <button
                            type="button"
                            onClick={() => setSelectedRepo(null)}
                            className="repo-chip-remove"
                          >
                            &times;
                          </button>
                        </span>
                        <div className="repo-branch-input">
                          <label>Branch:</label>
                          <input
                            type="text"
                            value={branch}
                            onChange={(e) => setBranch(e.target.value)}
                            placeholder="main"
                          />
                        </div>
                      </div>
                    ) : (
                      <>
                        <input
                          type="text"
                          value={repoSearch}
                          onChange={(e) => handleRepoSearch(e.target.value)}
                          placeholder="Search your repositories..."
                          className="repo-search-input"
                        />
                        <div className="repo-list">
                          {loadingRepos ? (
                            <div className="repo-list-empty">Loading...</div>
                          ) : repos.length === 0 ? (
                            <div className="repo-list-empty">No repositories found</div>
                          ) : (
                            repos.map((r) => (
                              <button
                                key={r.fullName}
                                type="button"
                                className="repo-list-item"
                                onClick={() => selectRepo(r)}
                              >
                                <span className="repo-list-name">{r.fullName}</span>
                                {r.private && <span className="repo-list-badge">private</span>}
                                {r.description && (
                                  <span className="repo-list-desc">{r.description}</span>
                                )}
                              </button>
                            ))
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {error && (
              <p style={{ color: "var(--color-low)", fontSize: "0.85rem", marginTop: "0.75rem" }}>
                {error}
              </p>
            )}

            <div style={{ marginTop: "1.25rem", display: "flex", justifyContent: "flex-end" }}>
              <button
                type="submit"
                disabled={submitting || !topic.trim()}
                className={`btn-primary ${submitting || !topic.trim() ? "disabled" : ""}`}
              >
                {submitting ? "Launching..." : "Launch Panel"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
