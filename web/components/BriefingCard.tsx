"use client";

import { useState, useEffect, useCallback } from "react";
import { marked } from "marked";

interface BriefingCardProps {
  product: "ic" | "clo";
}

export default function BriefingCard({ product }: BriefingCardProps) {
  const [digest, setDigest] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);

  const loadBriefing = useCallback(() => {
    setLoading(true);
    setError(false);
    fetch(`/api/${product}/briefing`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        if (data?.relevant && data.digest_md) {
          setDigest(data.digest_md);
        } else {
          setDigest(null);
        }
        setLoading(false);
      })
      .catch((err) => {
        console.error("[BriefingCard] Failed to load briefing:", err);
        setError(true);
        setLoading(false);
      });
  }, [product]);

  useEffect(() => {
    loadBriefing();
  }, [loadBriefing]);

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const res = await fetch(`/api/${product}/briefing`, { method: "POST" });
      const result = await res.json();
      if (result.error) {
        console.error("[BriefingCard] Refresh failed:", result.error);
      }
    } catch (err) {
      console.error("[BriefingCard] Refresh failed:", err);
    }
    setRefreshing(false);
    loadBriefing();
  }

  const sectionStyle = {
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-sm)",
    padding: "1rem 1.25rem",
    background: "var(--color-surface)",
  };

  const refreshButton = (
    <button
      onClick={handleRefresh}
      disabled={refreshing}
      style={{
        background: "none",
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-sm)",
        padding: "0.25rem 0.6rem",
        fontSize: "0.75rem",
        color: "var(--color-text-muted)",
        cursor: refreshing ? "wait" : "pointer",
        opacity: refreshing ? 0.6 : 1,
      }}
    >
      {refreshing ? "Fetching..." : "Refresh"}
    </button>
  );

  if (loading && !digest) {
    return (
      <section className="ic-section" style={sectionStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600 }}>
            Market Briefing
          </h2>
          {refreshButton}
        </div>
        <p style={{ margin: "0.75rem 0 0", fontSize: "0.85rem", color: "var(--color-text-muted)" }}>
          Loading briefing...
        </p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="ic-section" style={sectionStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600 }}>
            Market Briefing
          </h2>
          {refreshButton}
        </div>
        <p style={{ margin: "0.75rem 0 0", fontSize: "0.85rem", color: "var(--color-text-muted)" }}>
          Unable to load briefing. Try refreshing or check that your API key is valid.
        </p>
      </section>
    );
  }

  if (!digest) {
    return (
      <section className="ic-section" style={sectionStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600 }}>
            Market Briefing
          </h2>
          {refreshButton}
        </div>
        <p style={{ margin: "0.75rem 0 0", fontSize: "0.85rem", color: "var(--color-text-muted)" }}>
          No briefing available yet. Click refresh to fetch the latest market data.
        </p>
      </section>
    );
  }

  return (
    <section className="ic-section" style={sectionStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <button
          onClick={() => setCollapsed(!collapsed)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 0,
            color: "inherit",
            font: "inherit",
          }}
        >
          <h2 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600 }}>
            Market Briefing
          </h2>
          <span
            style={{
              fontSize: "0.75rem",
              color: "var(--color-text-muted)",
              transition: "transform 0.2s",
              transform: collapsed ? "rotate(-90deg)" : "rotate(0deg)",
            }}
          >
            ▼
          </span>
        </button>
        {refreshButton}
      </div>
      {!collapsed && (
        <div
          className="markdown-content"
          style={{
            marginTop: "0.75rem",
            fontSize: "0.85rem",
            lineHeight: 1.6,
            color: "var(--color-text-secondary, var(--color-text))",
          }}
          dangerouslySetInnerHTML={{
            __html: marked.parse(digest, { async: false }) as string,
          }}
        />
      )}
    </section>
  );
}
