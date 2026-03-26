"use client";

import { useState, useMemo } from "react";
import type { PortfolioHolding, CloHolding } from "@/lib/clo/types";

type SortDir = "asc" | "desc";

interface ExpandedColumn {
  key: keyof CloHolding;
  label: string;
  align?: "left" | "right";
  format?: (v: unknown) => string;
}

const ALL_EXPANDED_COLUMNS: ExpandedColumn[] = [
  { key: "obligorName", label: "Obligor" },
  { key: "parBalance", label: "Par Balance", align: "right", format: (v) => v != null ? Number(v).toLocaleString() : "" },
  { key: "moodysRating", label: "Moody's" },
  { key: "spRating", label: "S&P" },
  { key: "compositeRating", label: "Composite" },
  { key: "spreadBps", label: "Spread (bps)", align: "right", format: (v) => v != null ? String(v) : "" },
  { key: "industryDescription", label: "Industry" },
  { key: "maturityDate", label: "Maturity" },
  { key: "assetType", label: "Asset Type" },
  { key: "country", label: "Country" },
  { key: "currency", label: "Currency" },
  { key: "principalBalance", label: "Principal", align: "right", format: (v) => v != null ? Number(v).toLocaleString() : "" },
  { key: "marketValue", label: "Market Value", align: "right", format: (v) => v != null ? Number(v).toLocaleString() : "" },
  { key: "currentPrice", label: "Price", align: "right", format: (v) => v != null ? Number(v).toFixed(2) : "" },
  { key: "allInRate", label: "All-In Rate", align: "right", format: (v) => v != null ? `${Number(v).toFixed(2)}%` : "" },
  { key: "referenceRate", label: "Ref Rate" },
  { key: "facilityName", label: "Facility" },
  { key: "isin", label: "ISIN" },
  { key: "remainingLifeYears", label: "Rem. Life (y)", align: "right", format: (v) => v != null ? Number(v).toFixed(1) : "" },
  { key: "ratingFactor", label: "Rating Factor", align: "right", format: (v) => v != null ? String(v) : "" },
];

const DEFAULT_VISIBLE_KEYS: (keyof CloHolding)[] = [
  "obligorName", "parBalance", "moodysRating", "spreadBps", "industryDescription", "maturityDate", "assetType",
];

type LegacySortKey = keyof PortfolioHolding;

function LegacyTable({ holdings }: { holdings: PortfolioHolding[] }) {
  const [sortKey, setSortKey] = useState<LegacySortKey>("notional");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [filterText, setFilterText] = useState("");
  const [sectorFilter, setSectorFilter] = useState("");

  const sectors = useMemo(
    () => [...new Set(holdings.map((h) => h.sector).filter(Boolean))].sort(),
    [holdings]
  );

  const filtered = useMemo(() => {
    let result = holdings;
    if (filterText) {
      const lower = filterText.toLowerCase();
      result = result.filter((h) => h.issuer.toLowerCase().includes(lower));
    }
    if (sectorFilter) {
      result = result.filter((h) => h.sector === sectorFilter);
    }
    return [...result].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      return sortDir === "asc" ? String(av ?? "").localeCompare(String(bv ?? "")) : String(bv ?? "").localeCompare(String(av ?? ""));
    });
  }, [holdings, filterText, sectorFilter, sortKey, sortDir]);

  function handleSort(key: LegacySortKey) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "issuer" || key === "sector" ? "asc" : "desc");
    }
  }

  function sortIndicator(key: LegacySortKey) {
    if (sortKey !== key) return "";
    return sortDir === "asc" ? " \u25B2" : " \u25BC";
  }

  return (
    <div>
      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap" }}>
        <input
          type="text"
          placeholder="Filter by issuer..."
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          className="ic-textarea"
          style={{ padding: "0.4rem 0.6rem", fontSize: "0.85rem", maxWidth: "250px" }}
        />
        <select
          value={sectorFilter}
          onChange={(e) => setSectorFilter(e.target.value)}
          className="ic-textarea"
          style={{ padding: "0.4rem 0.6rem", fontSize: "0.85rem", maxWidth: "200px" }}
        >
          <option value="">All Sectors</option>
          {sectors.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <span style={{ fontSize: "0.8rem", color: "var(--color-text-muted)", alignSelf: "center" }}>
          {filtered.length} of {holdings.length} holdings
        </span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={thStyle} onClick={() => handleSort("issuer")}>Issuer{sortIndicator("issuer")}</th>
              <th style={{ ...thStyle, textAlign: "right" }} onClick={() => handleSort("notional")}>Notional (K){sortIndicator("notional")}</th>
              <th style={thStyle} onClick={() => handleSort("rating")}>Rating{sortIndicator("rating")}</th>
              <th style={{ ...thStyle, textAlign: "right" }} onClick={() => handleSort("spread")}>Spread{sortIndicator("spread")}</th>
              <th style={thStyle} onClick={() => handleSort("sector")}>Sector{sortIndicator("sector")}</th>
              <th style={thStyle} onClick={() => handleSort("maturity")}>Maturity{sortIndicator("maturity")}</th>
              <th style={thStyle} onClick={() => handleSort("loanType")}>Type{sortIndicator("loanType")}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((h, i) => (
              <tr key={i}>
                <td style={tdStyle}>{h.issuer}</td>
                <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{h.notional.toLocaleString()}</td>
                <td style={tdStyle}>{h.rating}</td>
                <td style={{ ...tdStyle, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{h.spread}</td>
                <td style={tdStyle}>{h.sector}</td>
                <td style={tdStyle}>{h.maturity}</td>
                <td style={tdStyle}>{h.loanType}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ExpandedTable({ holdings }: { holdings: CloHolding[] }) {
  const [sortKey, setSortKey] = useState<keyof CloHolding>("parBalance");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [filterText, setFilterText] = useState("");
  const [ratingFilter, setRatingFilter] = useState("");
  const [industryFilter, setIndustryFilter] = useState("");
  const [visibleKeys, setVisibleKeys] = useState<Set<keyof CloHolding>>(new Set(DEFAULT_VISIBLE_KEYS));
  const [showColumnPicker, setShowColumnPicker] = useState(false);

  const ratings = useMemo(
    () => [...new Set(holdings.map((h) => h.moodysRating).filter(Boolean) as string[])].sort(),
    [holdings]
  );

  const industries = useMemo(
    () => [...new Set(holdings.map((h) => h.industryDescription).filter(Boolean) as string[])].sort(),
    [holdings]
  );

  const visibleColumns = useMemo(
    () => ALL_EXPANDED_COLUMNS.filter((c) => visibleKeys.has(c.key)),
    [visibleKeys]
  );

  const filtered = useMemo(() => {
    let result = holdings;
    if (filterText) {
      const lower = filterText.toLowerCase();
      result = result.filter((h) => (h.obligorName ?? "").toLowerCase().includes(lower) || (h.facilityName ?? "").toLowerCase().includes(lower));
    }
    if (ratingFilter) {
      result = result.filter((h) => h.moodysRating === ratingFilter);
    }
    if (industryFilter) {
      result = result.filter((h) => h.industryDescription === industryFilter);
    }
    return [...result].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return sortDir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
    });
  }, [holdings, filterText, ratingFilter, industryFilter, sortKey, sortDir]);

  function handleSort(key: keyof CloHolding) {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir(key === "obligorName" ? "asc" : "desc");
    }
  }

  function sortIndicator(key: keyof CloHolding) {
    if (sortKey !== key) return "";
    return sortDir === "asc" ? " \u25B2" : " \u25BC";
  }

  function toggleColumn(key: keyof CloHolding) {
    setVisibleKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div>
      <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap", alignItems: "center" }}>
        <input
          type="text"
          placeholder="Filter by obligor..."
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          className="ic-textarea"
          style={{ padding: "0.4rem 0.6rem", fontSize: "0.85rem", maxWidth: "250px" }}
        />
        <select
          value={ratingFilter}
          onChange={(e) => setRatingFilter(e.target.value)}
          className="ic-textarea"
          style={{ padding: "0.4rem 0.6rem", fontSize: "0.85rem", maxWidth: "150px" }}
        >
          <option value="">All Ratings</option>
          {ratings.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <select
          value={industryFilter}
          onChange={(e) => setIndustryFilter(e.target.value)}
          className="ic-textarea"
          style={{ padding: "0.4rem 0.6rem", fontSize: "0.85rem", maxWidth: "200px" }}
        >
          <option value="">All Industries</option>
          {industries.map((ind) => (
            <option key={ind} value={ind}>{ind}</option>
          ))}
        </select>
        <div style={{ position: "relative" }}>
          <button
            className="btn-secondary"
            onClick={() => setShowColumnPicker(!showColumnPicker)}
            style={{ fontSize: "0.8rem", padding: "0.4rem 0.6rem" }}
          >
            Columns ({visibleKeys.size})
          </button>
          {showColumnPicker && (
            <div style={{
              position: "absolute", top: "100%", left: 0, zIndex: 10, marginTop: "0.25rem",
              background: "var(--color-bg)", border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-sm)", padding: "0.5rem", minWidth: "180px",
              maxHeight: "300px", overflowY: "auto", boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
            }}>
              {ALL_EXPANDED_COLUMNS.map((col) => (
                <label key={col.key} style={{ display: "flex", gap: "0.4rem", fontSize: "0.8rem", padding: "0.2rem 0", cursor: "pointer" }}>
                  <input type="checkbox" checked={visibleKeys.has(col.key)} onChange={() => toggleColumn(col.key)} />
                  {col.label}
                </label>
              ))}
            </div>
          )}
        </div>
        <span style={{ fontSize: "0.8rem", color: "var(--color-text-muted)", alignSelf: "center" }}>
          {filtered.length} of {holdings.length} holdings
        </span>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {visibleColumns.map((col) => (
                <th
                  key={col.key}
                  style={{ ...thStyle, textAlign: col.align ?? "left" }}
                  onClick={() => handleSort(col.key)}
                >
                  {col.label}{sortIndicator(col.key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((h, i) => (
              <tr key={i}>
                {visibleColumns.map((col) => {
                  const val = h[col.key];
                  const display = col.format ? col.format(val) : (val != null ? String(val) : "");
                  return (
                    <td key={col.key} style={{ ...tdStyle, textAlign: col.align ?? "left", fontVariantNumeric: col.align === "right" ? "tabular-nums" : undefined }}>
                      {display}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  padding: "0.5rem 0.6rem",
  fontWeight: 600,
  color: "var(--color-text-muted)",
  cursor: "pointer",
  userSelect: "none",
  whiteSpace: "nowrap",
  fontSize: "0.8rem",
  borderBottom: "2px solid var(--color-border)",
};

const tdStyle: React.CSSProperties = {
  padding: "0.4rem 0.6rem",
  borderBottom: "1px solid var(--color-border)",
  fontSize: "0.8rem",
};

export default function HoldingsTable({
  holdings,
  expandedHoldings,
  mode = "legacy",
}: {
  holdings?: PortfolioHolding[];
  expandedHoldings?: CloHolding[];
  mode?: "legacy" | "expanded";
}) {
  if (mode === "expanded" && expandedHoldings && expandedHoldings.length > 0) {
    return <ExpandedTable holdings={expandedHoldings} />;
  }
  if (holdings && holdings.length > 0) {
    return <LegacyTable holdings={holdings} />;
  }
  return <p style={{ color: "var(--color-text-muted)", fontSize: "0.85rem" }}>No holdings data available.</p>;
}
