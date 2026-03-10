import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import type { Entity } from '../../types';

const BADGE_CONFIG: Record<string, { label: string; className: string }> = {
  tribe: { label: 'Tribe', className: 'badge-tribe' },
  family: { label: 'Family', className: 'badge-family' },
  figure: { label: 'Figure', className: 'badge-figure' },
  ethnic: { label: 'Ethnic Group', className: 'badge-ethnic' },
  event: { label: 'Event', className: 'badge-event' },
  region: { label: 'Region', className: 'badge-region' },
};

function getName(entity: Entity): string {
  if (entity.type === 'event') {
    return entity.data.title;
  }
  return entity.data.name;
}

function getDescription(entity: Entity): string | null {
  const d = entity.data;
  if ('description' in d && d.description) return d.description;
  if ('significance' in d && d.significance) return d.significance as string;
  if ('originNarrative' in d && d.originNarrative) return d.originNarrative as string;
  return null;
}

function getQuickFacts(entity: Entity): Array<{ label: string; value: string }> {
  const facts: Array<{ label: string; value: string }> = [];

  switch (entity.type) {
    case 'tribe': {
      const d = entity.data;
      if (d.lineageRoot) facts.push({ label: 'Lineage', value: d.lineageRoot });
      if (d.formationType) facts.push({ label: 'Formation', value: d.formationType });
      if (d.foundingEra) facts.push({ label: 'Founded', value: d.foundingEra });
      if (d.status) facts.push({ label: 'Status', value: d.status });
      if (d.peakPowerEra) facts.push({ label: 'Peak Power', value: d.peakPowerEra });
      if (d.traditionalEconomy) facts.push({ label: 'Economy', value: d.traditionalEconomy });
      if (d.alignment) facts.push({ label: 'Alignment', value: d.alignment });
      break;
    }
    case 'family': {
      const d = entity.data;
      if (d.familyType) facts.push({ label: 'Type', value: d.familyType });
      if (d.isRuling) facts.push({ label: 'Ruling', value: 'Yes' });
      if (d.rulesOver) facts.push({ label: 'Rules Over', value: d.rulesOver });
      if (d.foundedYear) facts.push({ label: 'Founded', value: String(d.foundedYear) });
      if (d.legitimacyBasis) facts.push({ label: 'Legitimacy', value: d.legitimacyBasis });
      break;
    }
    case 'figure': {
      const d = entity.data;
      if (d.title) facts.push({ label: 'Title', value: d.title });
      if (d.roleDescription) facts.push({ label: 'Role', value: d.roleDescription });
      if (d.bornYear) facts.push({ label: 'Born', value: String(d.bornYear) });
      if (d.diedYear) facts.push({ label: 'Died', value: String(d.diedYear) });
      if (d.era) facts.push({ label: 'Era', value: d.era });
      break;
    }
    case 'ethnic': {
      const d = entity.data;
      if (d.ethnicity) facts.push({ label: 'Ethnicity', value: d.ethnicity });
      if (d.religion) facts.push({ label: 'Religion', value: d.religion });
      if (d.identityType) facts.push({ label: 'Identity', value: d.identityType });
      if (d.populationEstimate) facts.push({ label: 'Population', value: d.populationEstimate });
      break;
    }
    case 'event': {
      const d = entity.data;
      if (d.eventType) facts.push({ label: 'Type', value: d.eventType });
      if (d.year) facts.push({ label: 'Year', value: String(d.year) });
      if (d.outcome) facts.push({ label: 'Outcome', value: d.outcome });
      break;
    }
    case 'region': {
      const d = entity.data;
      if (d.type) facts.push({ label: 'Type', value: d.type });
      if (d.country) facts.push({ label: 'Country', value: d.country });
      if (d.rulingFamily) facts.push({ label: 'Ruling Family', value: d.rulingFamily });
      break;
    }
  }

  return facts.filter(f => !f.value.includes('UNKNOWN'));
}

function getInsight(entity: Entity): string | null {
  let insight: string | null = null;
  switch (entity.type) {
    case 'tribe': insight = entity.data.ancestorStory || entity.data.legitimacyNotes || null; break;
    case 'family': insight = entity.data.originStory || null; break;
    case 'ethnic': insight = entity.data.keyTension || null; break;
    case 'event': insight = entity.data.surpriseFactor || null; break;
    case 'region': insight = entity.data.strategicImportance || null; break;
    default: return null;
  }
  if (insight?.includes('UNKNOWN')) return null;
  return insight;
}

interface DetailPanelProps {
  entity: Entity | null;
  onClose: () => void;
  onNavigate?: (path: string) => void;
}

export default function DetailPanel({ entity, onClose, onNavigate }: DetailPanelProps) {
  const routerNavigate = useNavigate();
  const navigate = onNavigate ?? routerNavigate;

  return (
    <AnimatePresence>
      {entity && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 bg-black/20 z-40"
            onClick={onClose}
          />

          {/* Panel */}
          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="fixed top-0 right-0 bottom-0 w-full max-w-full sm:max-w-lg z-50 bg-bg border-l border-border shadow-2xl overflow-y-auto"
          >
            <div className="p-4 sm:p-6 pt-20">
              {/* Close button */}
              <button
                onClick={onClose}
                className="absolute top-20 right-4 p-2 text-text-tertiary hover:text-text transition-colors"
                aria-label="Close"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>

              {/* Header */}
              <div className="mb-6">
                <span className={`${BADGE_CONFIG[entity.type].className} text-xs px-2 py-0.5 rounded-full font-medium`}>
                  {BADGE_CONFIG[entity.type].label}
                </span>
                {entity.type === 'family' && (entity.data as any).entityClassification === 'tribe+family' && (
                  <span className="badge-tribe text-xs px-2 py-0.5 rounded-full font-medium ml-1">Tribe</span>
                )}
                <h2 className="font-display text-2xl sm:text-3xl font-bold text-text mt-2">
                  {getName(entity)}
                </h2>
              </div>

              <div className="h-px bg-border mb-6" />

              {/* Quick facts */}
              {(() => {
                const facts = getQuickFacts(entity);
                if (facts.length === 0) return null;
                return (
                  <div className="grid grid-cols-2 gap-3 mb-6">
                    {facts.map((fact) => (
                      <div key={fact.label} className="bg-bg-subtle rounded-lg p-3">
                        <div className="text-xs text-text-tertiary uppercase tracking-wider">{fact.label}</div>
                        <div className="text-sm font-medium text-text mt-0.5 capitalize">{fact.value}</div>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* Key insight */}
              {(() => {
                const insight = getInsight(entity);
                if (!insight) return null;
                return (
                  <div className="mb-6 border-l-2 border-accent bg-accent-soft rounded-lg p-4">
                    <div className="text-xs font-medium text-accent-hover uppercase tracking-wider mb-1">
                      Key Insight
                    </div>
                    <p className="text-sm text-text-secondary leading-relaxed">{insight}</p>
                  </div>
                );
              })()}

              {/* Description */}
              {(() => {
                const desc = getDescription(entity);
                if (!desc) return null;
                return (
                  <div className="mb-6">
                    <h3 className="font-display text-lg font-semibold text-text mb-2">Overview</h3>
                    <p className="text-sm text-text-secondary leading-relaxed">{desc}</p>
                  </div>
                );
              })()}

              {/* History */}
              {('history' in entity.data) && (entity.data as any).history && (
                <div className="mb-6">
                  <h3 className="font-display text-lg font-semibold text-text mb-2">History</h3>
                  <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-line">
                    {(entity.data as any).history}
                  </p>
                </div>
              )}

              {/* Tribal Origin */}
              {entity.type === 'family' && entity.data.tribalOrigin && (
                <div className="mb-6">
                  <div className="bg-bg-subtle rounded-lg p-3">
                    <div className="text-xs text-text-tertiary uppercase tracking-wider">Tribal Origin</div>
                    <div className="text-sm font-medium text-text mt-0.5">{entity.data.tribalOrigin}</div>
                  </div>
                </div>
              )}

              {/* Modern Status */}
              {entity.type === 'family' && entity.data.modernStatus && (
                <div className="mb-6">
                  <h3 className="font-display text-lg font-semibold text-text mb-2">Modern Status</h3>
                  <p className="text-sm text-text-secondary leading-relaxed">{entity.data.modernStatus}</p>
                </div>
              )}

              {/* Timeline Events */}
              {('timelineEvents' in entity.data) && (entity.data as any).timelineEvents?.length > 0 && (
                <div className="mb-6">
                  <h3 className="font-display text-lg font-semibold text-text mb-2">
                    Timeline
                    <span className="text-sm font-normal text-text-tertiary ml-2">
                      ({(entity.data as any).timelineEvents.length})
                    </span>
                  </h3>
                  <div className="max-h-64 overflow-y-auto space-y-3 pr-1">
                    {(entity.data as any).timelineEvents
                      .sort((a: any, b: any) => (a.year || 0) - (b.year || 0))
                      .map((evt: any, i: number) => (
                        <div key={i} className="border-l-2 border-accent/30 pl-3">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold text-accent">{evt.year}</span>
                            <span className="text-xs text-text-tertiary capitalize">{evt.eventType}</span>
                          </div>
                          <div className="text-sm font-medium text-text">{evt.title}</div>
                          {evt.description && (
                            <p className="text-xs text-text-secondary mt-0.5 line-clamp-2">{evt.description}</p>
                          )}
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Migration Path */}
              {('migrationPath' in entity.data) && (entity.data as any).migrationPath?.length > 0 && (
                <div className="mb-6">
                  <h3 className="font-display text-lg font-semibold text-text mb-2">Migration Path</h3>
                  <div className="space-y-2">
                    {(entity.data as any).migrationPath.map((step: any, i: number) => (
                      <div key={i} className="flex items-start gap-2 text-sm">
                        <span className="text-accent font-mono text-xs mt-0.5 shrink-0">
                          {step.endYear ? `${step.year}–${step.endYear}` : step.year || '?'}
                        </span>
                        <span className="text-text-secondary">
                          {step.from} → {step.to}
                          {step.description && <span className="text-text-tertiary"> — {step.description}</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Name Etymology */}
              {('nameEtymology' in entity.data) && (entity.data as any).nameEtymology && (
                <div className="mb-6 bg-bg-subtle rounded-lg p-4">
                  <div className="text-xs font-medium text-accent uppercase tracking-wider mb-1">Name Origin</div>
                  <p className="text-sm text-text-secondary leading-relaxed">{(entity.data as any).nameEtymology}</p>
                </div>
              )}

              {/* Folk Legends */}
              {('folkLegends' in entity.data) && (entity.data as any).folkLegends?.length > 0 && (
                <div className="mb-6">
                  <h3 className="font-display text-lg font-semibold text-text mb-2">
                    Folk Legends & Oral Traditions
                  </h3>
                  <div className="space-y-3">
                    {(entity.data as any).folkLegends.map((legend: any, i: number) => (
                      <div key={i} className="border-l-2 border-plum/40 pl-3">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-medium text-text">{legend.title}</span>
                          {legend.plausibility && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-bg-subtle text-text-tertiary capitalize">
                              {legend.plausibility}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-text-secondary leading-relaxed">{legend.story}</p>
                        {legend.source && (
                          <p className="text-xs text-text-tertiary mt-1 italic">Source: {legend.source}</p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Related entities */}
              {entity.type === 'tribe' && entity.data.relations.length > 0 && (
                <div className="mb-6">
                  <h3 className="font-display text-lg font-semibold text-text mb-2">Relations</h3>
                  <div className="space-y-2">
                    {entity.data.relations.slice(0, 8).map((rel, i) => (
                      <button
                        key={i}
                        onClick={() => { onClose(); navigate(`/tribe/${rel.tribeId}`); }}
                        className="flex items-center gap-2 text-sm text-text hover:text-accent-hover transition-colors"
                      >
                        <span className="w-2 h-2 rounded-full bg-accent" />
                        <span>{rel.tribeId.replace(/_/g, ' ')}</span>
                        {rel.type && <span className="text-xs text-text-tertiary">({rel.type})</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {entity.type === 'family' && entity.data.notableFigures.length > 0 && (
                <div className="mb-6">
                  <h3 className="font-display text-lg font-semibold text-text mb-2">
                    Notable Figures
                    <span className="text-sm font-normal text-text-tertiary ml-2">
                      ({entity.data.notableFigures.length})
                    </span>
                  </h3>
                  <div className="max-h-80 overflow-y-auto space-y-1 pr-1">
                    {entity.data.notableFigures.map((fig, idx) => (
                      <button
                        key={`${fig.id}-${idx}`}
                        onClick={() => { onClose(); navigate(`/figure/${fig.id}`); }}
                        className="w-full text-left p-2 rounded-lg hover:bg-bg-subtle transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-plum flex-shrink-0" />
                          <span className="text-sm font-medium text-text">{fig.name}</span>
                        </div>
                        {fig.title && (
                          <p className="text-xs text-text-tertiary ml-4 mt-0.5">{fig.title}</p>
                        )}
                        {'biography' in fig && fig.biography && (
                          <p className="text-xs text-text-secondary ml-4 mt-1 line-clamp-2">{fig.biography}</p>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {entity.type === 'family' && (entity.data as any).relations?.length > 0 && (
                <div className="mb-6">
                  <h3 className="font-display text-lg font-semibold text-text mb-2">Relations</h3>
                  <div className="space-y-2">
                    {(entity.data as any).relations.slice(0, 12).map((rel: any, i: number) => (
                      <div key={i} className="flex items-center gap-2 text-sm text-text">
                        <span className="w-2 h-2 rounded-full bg-accent" />
                        <span>{rel.tribeId?.replace(/_/g, ' ')}</span>
                        {rel.type && <span className="text-xs text-text-tertiary">({rel.type})</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="h-px bg-border mb-6" />

              {/* Navigation buttons */}
              <div className="flex gap-2 flex-wrap">
                {(entity.type === 'tribe' || entity.type === 'family' || entity.type === 'region' || entity.type === 'ethnic') && (
                  <button
                    onClick={() => {
                      onClose();
                      navigate(`/map?entity=${entity.type}:${entity.data.id}`);
                    }}
                    className="px-4 py-2.5 text-sm font-medium bg-bg-subtle text-text border border-border rounded-lg hover:border-border-strong transition-colors"
                  >
                    Show in Map
                  </button>
                )}
                {(entity.type === 'tribe' || entity.type === 'family') && (
                  <button
                    onClick={() => { onClose(); navigate('/lineage'); }}
                    className="px-4 py-2.5 text-sm font-medium bg-bg-subtle text-text border border-border rounded-lg hover:border-border-strong transition-colors"
                  >
                    Show in Lineage
                  </button>
                )}
                {entity.type === 'event' && (
                  <button
                    onClick={() => { onClose(); navigate('/timeline'); }}
                    className="px-4 py-2.5 text-sm font-medium bg-bg-subtle text-text border border-border rounded-lg hover:border-border-strong transition-colors"
                  >
                    Show in Timeline
                  </button>
                )}
              </div>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
