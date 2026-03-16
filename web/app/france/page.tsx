import Link from "next/link";
import {
  getFlagStats,
  getLowestCompetitionBuyers,
  getTopNoCompetitionSpenders,
  getWorstAmendmentInflations,
} from "@/lib/france/queries";
import { formatEuro } from "@/lib/france/format";

export default async function FranceFlagsPage() {
  const [stats, lowestCompetition, topNoComp, worstInflations] =
    await Promise.all([
      getFlagStats(),
      getLowestCompetitionBuyers(10),
      getTopNoCompetitionSpenders(10),
      getWorstAmendmentInflations(10),
    ]);

  return (
    <div className="fr-page">
      <header className="fr-page-header">
        <h1>Procurement Red Flags</h1>
        <p>Anomaly detection across French public procurement data (DECP)</p>
      </header>

      <div className="fr-stats-grid">
        <div className="fr-stat-card">
          <div className="fr-stat-label">Single-Bid Rate</div>
          <div className="fr-stat-value">{stats.singleBidRate.toFixed(1)}%</div>
          <div className="fr-stat-sub">from {stats.singleBidRate2019.toFixed(1)}% in 2019</div>
        </div>
        <div className="fr-stat-card">
          <div className="fr-stat-label">No-Competition</div>
          <div className="fr-stat-value">{formatEuro(stats.noCompetitionSpend)}</div>
          <div className="fr-stat-sub">{stats.noCompetitionContracts.toLocaleString()} contracts</div>
        </div>
        <div className="fr-stat-card">
          <div className="fr-stat-label">Doubled Contracts</div>
          <div className="fr-stat-value">{stats.doubledContracts.toLocaleString()}</div>
          <div className="fr-stat-sub">post-award value &gt;2x</div>
        </div>
        <div className="fr-stat-card">
          <div className="fr-stat-label">Missing Bid Data</div>
          <div className="fr-stat-value">{stats.missingBidDataPct.toFixed(1)}%</div>
          <div className="fr-stat-sub">of all contracts</div>
        </div>
      </div>

      <section className="fr-section">
        <h2 className="fr-section-title">Lowest Competition Buyers</h2>
        <div className="fr-table-wrap">
          <table className="fr-table">
            <thead>
              <tr>
                <th>Buyer</th>
                <th className="fr-table-right">Contracts w/ Bids</th>
                <th className="fr-table-right">Single Bid %</th>
                <th className="fr-table-right">Total Spend</th>
              </tr>
            </thead>
            <tbody>
              {lowestCompetition.map((row) => (
                <tr key={row.siret}>
                  <td>
                    <Link href={`/france/buyers/${row.siret}`}>{row.name}</Link>
                  </td>
                  <td className="fr-table-right fr-table-num">
                    {row.contractsWithBids.toLocaleString()}
                  </td>
                  <td className="fr-table-right fr-table-num">
                    {row.singleBidPct.toFixed(1)}%
                  </td>
                  <td className="fr-table-right fr-table-num">
                    {formatEuro(row.totalSpend)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="fr-section">
        <h2 className="fr-section-title">Top No-Competition Spenders</h2>
        <div className="fr-table-wrap">
          <table className="fr-table">
            <thead>
              <tr>
                <th>Buyer</th>
                <th className="fr-table-right">No-Comp Contracts</th>
                <th className="fr-table-right">Total No-Comp Spend</th>
              </tr>
            </thead>
            <tbody>
              {topNoComp.map((row) => (
                <tr key={row.siret}>
                  <td>
                    <Link href={`/france/buyers/${row.siret}`}>{row.name}</Link>
                  </td>
                  <td className="fr-table-right fr-table-num">
                    {row.noCompContracts.toLocaleString()}
                  </td>
                  <td className="fr-table-right fr-table-num">
                    {formatEuro(row.noCompSpend)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="fr-section">
        <h2 className="fr-section-title">Worst Amendment Inflations</h2>
        <div className="fr-table-wrap">
          <table className="fr-table">
            <thead>
              <tr>
                <th>Contract</th>
                <th>Buyer</th>
                <th className="fr-table-right">Original</th>
                <th className="fr-table-right">Final</th>
                <th className="fr-table-right">Increase %</th>
              </tr>
            </thead>
            <tbody>
              {worstInflations.map((row) => (
                <tr key={row.uid}>
                  <td className="fr-table-truncate">
                    <Link href={`/france/contracts/${row.uid}`}>{row.object}</Link>
                  </td>
                  <td>{row.buyerName}</td>
                  <td className="fr-table-right fr-table-num">
                    {formatEuro(row.originalAmount)}
                  </td>
                  <td className="fr-table-right fr-table-num">
                    {formatEuro(row.finalAmount)}
                  </td>
                  <td className="fr-table-right fr-table-danger">
                    +{row.pctIncrease.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
