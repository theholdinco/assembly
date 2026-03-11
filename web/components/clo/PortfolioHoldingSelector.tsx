"use client";

import { useState, useEffect } from "react";
import type { CloHolding } from "@/lib/clo/types";

interface PortfolioHoldingSelectorProps {
  onSelect: (holding: CloHolding) => void;
}

export default function PortfolioHoldingSelector({ onSelect }: PortfolioHoldingSelectorProps) {
  const [holdings, setHoldings] = useState<CloHolding[]>([]);
  const [search, setSearch] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/clo/holdings")
      .then((res) => (res.ok ? res.json() : { holdings: [] }))
      .then((data) => {
        setHoldings(data.holdings || []);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  if (!loaded || holdings.length === 0) return null;

  const query = search.toLowerCase();
  const filtered = holdings.filter(
    (h) =>
      (h.obligorName?.toLowerCase().includes(query) ?? false) ||
      (h.moodysIndustry?.toLowerCase().includes(query) ?? false) ||
      (h.industryDescription?.toLowerCase().includes(query) ?? false)
  );

  function formatRating(h: CloHolding): string {
    return [h.moodysRating, h.spRating].filter(Boolean).join("/") || "-";
  }

  function formatPar(h: CloHolding): string {
    if (h.parBalance == null) return "-";
    if (h.parBalance >= 1_000_000) return `$${(h.parBalance / 1_000_000).toFixed(1)}M`;
    return `$${(h.parBalance / 1_000).toFixed(0)}K`;
  }

  return (
    <div
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: "0.5rem",
        padding: "0.75rem",
        marginBottom: "1rem",
        background: "var(--color-bg-secondary, var(--color-bg-card, transparent))",
      }}
    >
      <label
        style={{
          display: "block",
          fontSize: "0.85rem",
          fontWeight: 600,
          color: "var(--color-text-secondary)",
          marginBottom: "0.5rem",
        }}
      >
        Select from Portfolio
      </label>
      <input
        type="text"
        className="ic-input"
        placeholder="Search by name or industry..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ marginBottom: "0.5rem" }}
      />
      <div style={{ maxHeight: "200px", overflowY: "auto" }}>
        {filtered.length === 0 && (
          <div style={{ padding: "0.5rem", color: "var(--color-text-secondary)", fontSize: "0.85rem" }}>
            No matching holdings
          </div>
        )}
        {filtered.map((h) => (
          <button
            key={h.id}
            type="button"
            onClick={() => onSelect(h)}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              padding: "0.5rem",
              border: "none",
              borderBottom: "1px solid var(--color-border)",
              background: "transparent",
              cursor: "pointer",
              fontSize: "0.85rem",
              color: "var(--color-text)",
              borderRadius: 0,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-bg-hover, rgba(128,128,128,0.1))")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <div style={{ fontWeight: 600 }}>{h.obligorName || "Unknown"}</div>
            <div style={{ color: "var(--color-text-secondary)", marginTop: "0.15rem" }}>
              {[
                h.moodysIndustry || h.industryDescription,
                formatRating(h),
                h.spreadBps != null ? `${h.spreadBps}bps` : null,
                formatPar(h),
              ]
                .filter(Boolean)
                .join(" \u00B7 ")}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
