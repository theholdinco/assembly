import { notFound } from "next/navigation";
import Link from "next/link";
import {
  getBuyerBySiret,
  getBuyerContracts,
  getBuyerTopVendors,
  getBuyerProcedureBreakdown,
  getBuyerFlags,
} from "@/lib/france/queries";
import { BuyerFlags } from "@/lib/france/types";
import {
  TopEntitiesChart,
  ProcedureBreakdownChart,
} from "@/components/france/Charts";
import { formatEuro } from "@/lib/france/format";

export default async function BuyerPage({
  params,
}: {
  params: Promise<{ siret: string }>;
}) {
  const { siret } = await params;
  const buyer = await getBuyerBySiret(siret);
  if (!buyer) notFound();

  const [contracts, topVendors, procedureBreakdown, flags] = await Promise.all([
    getBuyerContracts(siret),
    getBuyerTopVendors(siret),
    getBuyerProcedureBreakdown(siret),
    getBuyerFlags(siret),
  ]);

  const cards = [
    { label: "Contracts", value: buyer.contract_count.toLocaleString() },
    { label: "Total Spend", value: formatEuro(buyer.total_amount_ht) },
    {
      label: "First Seen",
      value: new Date(buyer.first_seen).getFullYear().toString(),
    },
    {
      label: "Last Seen",
      value: new Date(buyer.last_seen).getFullYear().toString(),
    },
  ];

  return (
    <div className="fr-page">
      <header className="fr-page-header">
        <h1>{buyer.name}</h1>
        <p>SIRET: {buyer.siret}</p>
      </header>

      <div className="fr-stats-grid">
        {cards.map((card) => (
          <div key={card.label} className="fr-stat-card">
            <div className="fr-stat-label">{card.label}</div>
            <div className="fr-stat-value">{card.value}</div>
          </div>
        ))}
      </div>

      {((flags.singleBidPct !== null && flags.singleBidPct > 50) || flags.noCompetitionCount > 0 || flags.inflatedContractCount > 0) && (
        <div className="fr-flag-section">
          {flags.singleBidPct !== null && flags.singleBidPct > 50 && (
            <div className={`fr-flag-card ${flags.singleBidPct > 80 ? 'fr-flag-card--danger' : 'fr-flag-card--warning'}`}>
              <div className="fr-flag-value">{flags.singleBidPct}%</div>
              <div className="fr-flag-label">single-bid rate</div>
              <div className="fr-flag-desc">of contracts with bid data had only one bidder</div>
            </div>
          )}
          {flags.noCompetitionCount > 0 && (
            <div className="fr-flag-card fr-flag-card--warning">
              <div className="fr-flag-value">{flags.noCompetitionCount}</div>
              <div className="fr-flag-label">no-competition contracts</div>
              <div className="fr-flag-desc">{formatEuro(flags.noCompetitionSpend)} awarded without competition</div>
            </div>
          )}
          {flags.inflatedContractCount > 0 && (
            <div className="fr-flag-card fr-flag-card--danger">
              <div className="fr-flag-value">{flags.inflatedContractCount}</div>
              <div className="fr-flag-label">contracts doubled post-award</div>
              <div className="fr-flag-desc">amendment increased amount by more than 100%</div>
            </div>
          )}
        </div>
      )}

      <section className="fr-section">
        <h2 className="fr-section-title">Procedure Types</h2>
        <ProcedureBreakdownChart data={procedureBreakdown} />
      </section>

      <section className="fr-section">
        <h2 className="fr-section-title">Top Vendors</h2>
        <TopEntitiesChart data={topVendors} linkPrefix="/france/vendors" />
      </section>

      <section className="fr-section">
        <h2 className="fr-section-title">Contracts</h2>
        <table className="fr-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Object</th>
              <th>Procedure</th>
              <th className="fr-table-right">Amount</th>
              <th className="fr-table-right">Bids</th>
            </tr>
          </thead>
          <tbody>
            {contracts.map((c) => (
              <tr key={c.uid}>
                <td className="fr-table-nowrap">
                  {c.notification_date
                    ? new Date(c.notification_date).toLocaleDateString("fr-FR")
                    : "\u2014"}
                </td>
                <td>
                  <Link href={`/france/contracts/${encodeURIComponent(c.uid)}`}>
                    {c.object || "\u2014"}
                  </Link>
                </td>
                <td>{c.procedure || "\u2014"}</td>
                <td className="fr-table-right fr-table-num">
                  {c.amount_ht != null ? formatEuro(c.amount_ht) : "\u2014"}
                </td>
                <td className="fr-table-right">
                  {c.bids_received ?? "\u2014"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
