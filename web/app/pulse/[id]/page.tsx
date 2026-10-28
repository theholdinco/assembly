import { getMovementById, getSignalsForMovement } from "@/lib/pulse/access";
import { notFound } from "next/navigation";
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

const SOURCE_LABELS: Record<string, string> = {
  reddit: "Reddit",
  gdelt: "GDELT",
  bluesky: "Bluesky",
  wikipedia: "Wikipedia",
  news: "News",
  mastodon: "Mastodon",
};

export default async function MovementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Checked here too: the layout is not re-run on client-side navigation.
  if (!(await hasPulseAccess())) return <PulseAccessGate />;

  const { id } = await params;
  const movement = await getMovementById(id);

  if (!movement) notFound();

  const signals = await getSignalsForMovement(id);

  const signalsBySource = signals.reduce<Record<string, typeof signals>>((acc, s) => {
    const key = s.source;
    if (!acc[key]) acc[key] = [];
    acc[key].push(s);
    return acc;
  }, {});

  return (
    <div className="pulse-detail">
      <Link href="/pulse" className="pulse-back-link">
        &larr; Back to Dashboard
      </Link>

      <header className="pulse-detail-header">
        <div>
          <h1>{movement.name}</h1>
          <div className="pulse-detail-meta">
            <span className={`pulse-stage-badge ${STAGE_COLORS[movement.stage] || ""}`}>
              {movement.stage}
            </span>
            {movement.geography && (
              <span className="pulse-detail-geo">{movement.geography}</span>
            )}
            <span className="pulse-detail-date">
              Detected{" "}
              {new Date(movement.first_detected_at).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
          </div>
        </div>

        <div className="pulse-detail-scores">
          <div className="pulse-score-box">
            <span className="pulse-score-value">{Math.round(movement.momentum_score)}</span>
            <span className="pulse-score-label">Momentum</span>
          </div>
          <div className="pulse-score-box">
            <span className="pulse-score-value">{Math.round(movement.merch_potential_score)}</span>
            <span className="pulse-score-label">Merch Potential</span>
          </div>
        </div>
      </header>

      <div className="pulse-detail-actions">
        <Link href={`/pulse/${movement.id}/merch`} className="pulse-merch-link">
          View Merch Preview &rarr;
        </Link>
      </div>

      {movement.description && (
        <section className="pulse-detail-section">
          <p className="pulse-detail-description">{movement.description}</p>
        </section>
      )}

      {movement.analysis_summary && (
        <section className="pulse-detail-section">
          <h2>Analysis</h2>
          <p>{movement.analysis_summary}</p>
        </section>
      )}

      {movement.key_slogans && movement.key_slogans.length > 0 && (
        <section className="pulse-detail-section">
          <h2>Key Slogans</h2>
          <div className="pulse-slogans-list">
            {movement.key_slogans.map((s: string, i: number) => (
              <div key={i} className="pulse-slogan-item">
                &ldquo;{s}&rdquo;
              </div>
            ))}
          </div>
        </section>
      )}

      {movement.categories && movement.categories.length > 0 && (
        <section className="pulse-detail-section">
          <h2>Categories</h2>
          <div className="pulse-detail-tags">
            {movement.categories.map((c: string) => (
              <span key={c} className="pulse-category-tag">
                {c}
              </span>
            ))}
          </div>
        </section>
      )}

      {movement.key_phrases && movement.key_phrases.length > 0 && (
        <section className="pulse-detail-section">
          <h2>Key Phrases</h2>
          <div className="pulse-detail-tags">
            {movement.key_phrases.map((p: string) => (
              <span key={p} className="pulse-phrase-tag">
                {p}
              </span>
            ))}
          </div>
        </section>
      )}

      {signals.length > 0 && (
        <section className="pulse-detail-section">
          <h2>Signals ({signals.length})</h2>
          {Object.entries(signalsBySource).map(([source, sourceSignals]) => (
            <div key={source} className="pulse-signal-group">
              <h3 className="pulse-signal-source">
                {SOURCE_LABELS[source] || source}
                <span className="pulse-signal-count">({sourceSignals.length})</span>
              </h3>
              <div className="pulse-signal-list">
                {sourceSignals.slice(0, 10).map((s) => (
                  <div key={s.id} className="pulse-signal-item">
                    <div className="pulse-signal-title">
                      {s.url ? (
                        <a
                          href={s.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="pulse-signal-link"
                        >
                          {s.title || "Untitled"}
                        </a>
                      ) : (
                        s.title || "Untitled"
                      )}
                    </div>
                    {s.content && (
                      <p className="pulse-signal-content">
                        {s.content.slice(0, 200)}
                        {s.content.length > 200 ? "..." : ""}
                      </p>
                    )}
                    <span className="pulse-signal-date">
                      {new Date(s.created_at).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
