// Lineage Explorer data types

export interface LineageNode {
  id: string;
  name: string;
  type: 'tribe' | 'family';
  nodeType: 'lineage_root' | 'confederation' | 'tribe' | 'section' | 'family' | 'origin_group';
  lineage: 'adnani' | 'qahtani' | 'unknown' | null;
  isRuling?: boolean;
  rulesOver?: string | null;
  familyType?: string | null;
  size: number;
  metadata?: {
    formationTheories?: FormationTheory[];
    note?: string;
  };
}

export interface FormationTheory {
  theory: string;
  confidence: ConfidenceLevel;
  note: string;
}

export type ConfidenceLevel = 'confirmed' | 'oral_tradition' | 'claimed' | 'legendary';

export type EdgeType =
  | 'descent'         // blood lineage
  | 'confederation'   // political membership
  | 'branch'          // split off from
  | 'ruling_house'    // ruling family of
  | 'family_of'       // family belongs to tribe
  | 'claimed_descent' // genealogical claim
  | 'pre_confederation_origin' // where section came from before joining
  | 'lineage'         // links to adnani/qahtani root
  | 'origin_group'    // non-tribal origin (Persian, Hadrami, etc.)
  | 'alliance'
  | 'rivalry'
  | 'intermarriage'
  | 'trade_partnership'
  | 'shared_migration'
  | 'vassalage';

export interface LineageEdge {
  source: string;
  target: string;
  edgeType: EdgeType;
  confidence: ConfidenceLevel;
  label?: string;
}

export interface ConfederationCluster {
  sections: string[];
  formationTheories?: FormationTheory[];
}

export interface LineageData {
  nodes: LineageNode[];
  edges: LineageEdge[];
  ancestryChains: Record<string, string[]>;
  clusters: {
    confederations: Record<string, ConfederationCluster>;
    originGroups: Record<string, string[]>;
  };
}
