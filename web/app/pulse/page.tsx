import { getMovements } from "@/lib/pulse/access";
import Link from "next/link";
import { hasPulseAccess } from "@/lib/pulse/auth";
import { PulseAccessGate } from "@/app/pulse/access-gate";

const STAGE_COLORS: Record<string, string> = {
  detected: "pulse-stage-detected",
  verified: "pulse-stage-verified",
  growing: "pulse-stage-growing",
  trending: "pulse-stage-trending",
  peaked: "pulse-stage-peaked",
  declining: "pulse-stage-declining",
  dormant: "pulse-stage-dormant",
};

export default async function PulseDashboard({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string; sort?: string; q?: string }>;
}) {
  // Checked here too: the layout is not re-run on client-side navigation.
  if (!(await hasPulseAccess())) return <PulseAccessGate />;

  const params = await searchParams;

  const movements = await getMovements({
    stage: params.stage || undefined,
    search: params.q || undefined,
    sortBy: (params.sort as "momentum_score" | "last_signal_at" | "created_at") || "momentum_score",
    sortDir: "DESC",
    limit: 50,
  });

  return (
    <div className="pulse-dashboard">
      <header className="pulse-dashboard-header">
        <div>
          <h1>Pulse</h1>
          <p>Emerging movements worldwide</p>
        </div>
        <div className="pulse-dashboard-actions">
          <Link href="/pulse/scan" className="btn-primary">
            Trigger Scan
          </Link>
        </div>
      </header>

      <div className="pulse-filters">
        <div className="pulse-filter-group">
          {["all", "detected", "verified", "growing", "trending", "peaked", "declining", "dormant"].map((s) => (
            <Link
              key={s}
              href={`/pulse${s === "all" ? "" : `?stage=${s}`}${params.q ? `&q=${params.q}` : ""}`}
              className={`pulse-filter-chip ${(!params.stage && s === "all") || params.stage === s ? "active" : ""}`}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </Link>
          ))}
        </div>
      </div>

      {movements.length === 0 ? (
        <div className="pulse-empty-state">
          <h2>No movements detected yet</h2>
          <p>
            Trigger a scan to start detecting emerging movements from Reddit,
            GDELT, Bluesky, and other sources.
          </p>
          <Link href="/pulse/scan" className="btn-primary">
            Run First Scan
          </Link>
        </div>
      ) : (
        <div className="pulse-movement-grid">
          {movements.map((m) => (
            <Link
              key={m.id}
              href={`/pulse/${m.id}`}
              className="pulse-movement-card"
            >
              <div className="pulse-card-header">
                <h3 className="pulse-card-name">{m.name}</h3>
                <span className={`pulse-stage-badge ${STAGE_COLORS[m.stage] || ""}`}>
                  {m.stage}
                </span>
              </div>

              {m.geography && (
                <div className="pulse-card-geo">{m.geography}</div>
              )}

              <div className="pulse-card-momentum">
                <div className="pulse-momentum-bar">
                  <div
                    className="pulse-momentum-fill"
                    style={{ width: `${m.momentum_score}%` }}
                  />
                </div>
                <span className="pulse-momentum-score">
                  {Math.round(m.momentum_score)}
                </span>
              </div>

              {m.key_slogans && m.key_slogans.length > 0 && (
                <div className="pulse-card-slogans">
                  {m.key_slogans.slice(0, 2).map((s: string, i: number) => (
                    <span key={i} className="pulse-slogan-tag">
                      &ldquo;{s}&rdquo;
                    </span>
                  ))}
                </div>
              )}

              <div className="pulse-card-footer">
                <div className="pulse-card-categories">
                  {(m.categories || []).slice(0, 3).map((c: string) => (
                    <span key={c} className="pulse-category-tag">
                      {c}
                    </span>
                  ))}
                </div>
                <div className="pulse-card-merch" title="Merch potential">
                  {Math.round(m.merch_potential_score)}%
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
