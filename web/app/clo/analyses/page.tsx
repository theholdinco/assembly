import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { getPanelForUser } from "@/lib/clo/access";
import Link from "next/link";

interface AnalysisRow {
  id: string;
  title: string;
  borrower_name: string;
  analysis_type: string;
  status: string;
  created_at: string;
  completed_at: string | null;
}

export default async function AnalysesPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/");
  }

  const panel = await getPanelForUser(session.user.id);

  if (!panel || panel.status !== "active") {
    return (
      <div className="ic-dashboard">
        <div className="ic-empty-state">
          <h1>Loan Analyses</h1>
          <p>
            You need an active panel before running analyses. Complete
            onboarding to get started.
          </p>
          <Link href="/clo" className="btn-primary">
            Go to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  const analyses = await query<AnalysisRow>(
    `SELECT id, title, borrower_name, analysis_type, status, created_at, completed_at
     FROM clo_analyses
     WHERE panel_id = $1
     ORDER BY created_at DESC`,
    [panel.id]
  );

  return (
    <div className="ic-dashboard">
      <header className="ic-dashboard-header">
        <div>
          <h1>Loan Analyses</h1>
          <p>Evaluate credit opportunities with your panel</p>
        </div>
        <div className="ic-dashboard-actions">
          <Link href="/clo/analyze/new" className="btn-primary">
            New Analysis
          </Link>
        </div>
      </header>

      {analyses.length > 0 ? (
        <section className="ic-section">
          <h2>All Analyses</h2>
          <div className="ic-eval-list">
            {analyses.map((a) => (
              <Link
                key={a.id}
                href={`/clo/analyze/${a.id}`}
                className="ic-eval-card"
              >
                <div className="ic-eval-title">
                  {a.title || a.borrower_name}
                </div>
                <div className="ic-eval-meta">
                  <span className={`ic-eval-status ic-eval-status-${a.status}`}>
                    {a.status}
                  </span>
                  <span className="ic-eval-type-tag">{a.analysis_type}</span>
                  <span>
                    {new Date(a.created_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      ) : (
        <section className="ic-section">
          <p style={{ fontSize: "0.85rem", color: "var(--color-text-muted)" }}>
            No analyses yet. Use &ldquo;New Analysis&rdquo; to evaluate a credit opportunity.
          </p>
        </section>
      )}
    </div>
  );
}
