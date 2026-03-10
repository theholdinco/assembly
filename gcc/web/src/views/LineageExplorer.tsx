import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import * as d3 from 'd3';
import rawLineageData from '../data/lineage.json';
import type { LineageData, LineageNode, LineageEdge, EdgeType, ConfidenceLevel } from '../types/lineage';

interface Props {
  onSelectEntity?: (type: string, id: string) => void;
}

interface SimNode extends LineageNode, d3.SimulationNodeDatum {}
interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  edgeType: EdgeType;
  confidence: ConfidenceLevel;
  label?: string;
}

const lineageData: LineageData = rawLineageData as LineageData;

const INITIAL_NODE_LIMIT = 150;

type LayoutMode = 'force' | 'hierarchical';

const NODE_TYPE_DEPTH: Record<string, number> = {
  lineage_root: 0,
  confederation: 1,
  tribe: 2,
  section: 3,
  family: 4,
  origin_group: 1,
};

const LINEAGE_COLORS: Record<string, string> = {
  adnani: '#C4643A',
  qahtani: '#1ABC9C',
  unknown: '#888',
};

const LINEAGE_COLORS_MUTED: Record<string, string> = {
  adnani: '#A0503A',
  qahtani: '#158A6E',
  unknown: '#666',
};

const ORIGIN_COLORS: Record<string, string> = {
  persian: '#8E7CC3',
  hadrami: '#D4A574',
  indian: '#6BA3A0',
};

const LINK_DISTANCES: Record<string, number> = {
  descent: 50,
  family_of: 50,
  confederation: 40,
  lineage: 120,
  alliance: 100,
  rivalry: 100,
  branch: 80,
  ruling_house: 80,
  claimed_descent: 80,
  pre_confederation_origin: 80,
  origin_group: 80,
  intermarriage: 90,
  trade_partnership: 100,
  shared_migration: 100,
  vassalage: 60,
};

function getNodeFill(node: LineageNode): string {
  if (node.nodeType === 'lineage_root') {
    return LINEAGE_COLORS[node.lineage ?? 'unknown'] ?? '#888';
  }
  if (node.nodeType === 'origin_group') {
    const key = node.name.toLowerCase();
    for (const [k, v] of Object.entries(ORIGIN_COLORS)) {
      if (key.includes(k)) return v;
    }
    return '#888';
  }
  if (node.nodeType === 'family') {
    return LINEAGE_COLORS_MUTED[node.lineage ?? 'unknown'] ?? '#555';
  }
  if (node.nodeType === 'section') {
    const base = LINEAGE_COLORS[node.lineage ?? 'unknown'] ?? '#888';
    return d3.color(base)?.darker(0.3)?.formatHex() ?? base;
  }
  return LINEAGE_COLORS[node.lineage ?? 'unknown'] ?? '#888';
}

function getNodeStroke(node: LineageNode): string {
  const fill = getNodeFill(node);
  return d3.color(fill)?.darker(0.6)?.formatHex() ?? '#333';
}

function getNodeRadius(node: LineageNode): number {
  switch (node.nodeType) {
    case 'lineage_root': return 20;
    case 'confederation': return Math.max(14, Math.min(24, 14 + node.size * 0.5));
    case 'tribe': return Math.max(8, Math.min(14, 8 + Math.sqrt(node.size) * 1.5));
    case 'section': return Math.max(6, Math.min(10, 6 + Math.sqrt(node.size)));
    case 'family': return Math.max(6, Math.min(10, 6 + Math.sqrt(node.size)));
    case 'origin_group': return 12;
    default: return 8;
  }
}

function getChargeStrength(node: LineageNode): number {
  return node.nodeType === 'confederation' ? -80 : -40;
}

function getEdgeStroke(edge: LineageEdge): string {
  switch (edge.edgeType) {
    case 'rivalry': return '#E74C3C';
    case 'alliance': return '#2ECC71';
    case 'intermarriage': return '#8E44AD';
    case 'descent':
    case 'branch':
    case 'ruling_house':
    case 'family_of':
      return LINEAGE_COLORS.adnani;
    default: return '#666';
  }
}

function getEdgeDash(edgeType: EdgeType): string {
  switch (edgeType) {
    case 'confederation': return '3,3';
    case 'pre_confederation_origin': return '6,4';
    case 'claimed_descent': return '2,3';
    case 'rivalry': return '6,4';
    default: return '';
  }
}

function getEdgeWidth(edgeType: EdgeType): number {
  switch (edgeType) {
    case 'descent': return 2;
    case 'ruling_house': return 2;
    case 'confederation': return 1.5;
    case 'branch': return 1.5;
    case 'lineage': return 0.5;
    case 'family_of': return 1;
    case 'alliance': return 1;
    case 'intermarriage': return 1.5;
    case 'pre_confederation_origin': return 1;
    case 'claimed_descent': return 1;
    default: return 1;
  }
}

function getEdgeOpacity(edgeType: EdgeType): number {
  switch (edgeType) {
    case 'claimed_descent': return 0.5;
    case 'lineage': return 0.3;
    case 'pre_confederation_origin': return 0.4;
    default: return 0.6;
  }
}

const OVERLAY_EDGE_TYPES = new Set<EdgeType>(['alliance', 'rivalry', 'intermarriage']);

function drawNodeShape(
  selection: d3.Selection<SVGGElement, SimNode, SVGGElement, unknown>,
) {
  selection.each(function (d) {
    const g = d3.select(this);
    const r = getNodeRadius(d);
    const fill = getNodeFill(d);
    const stroke = getNodeStroke(d);

    g.selectAll('.node-shape').remove();
    g.selectAll('.crown-icon').remove();

    switch (d.nodeType) {
      case 'lineage_root': {
        g.insert('circle', ':first-child')
          .attr('class', 'node-shape')
          .attr('r', r)
          .attr('fill', fill)
          .attr('stroke', stroke)
          .attr('stroke-width', 1);
        break;
      }
      case 'confederation': {
        const w = r * 2.2;
        const h = r * 1.6;
        g.insert('rect', ':first-child')
          .attr('class', 'node-shape')
          .attr('x', -w / 2)
          .attr('y', -h / 2)
          .attr('width', w)
          .attr('height', h)
          .attr('rx', 8)
          .attr('ry', 8)
          .attr('fill', d3.color(fill)?.copy({ opacity: 0.25 })?.formatRgb() ?? fill)
          .attr('stroke', fill)
          .attr('stroke-width', 1.5);
        break;
      }
      case 'family': {
        // Diamond (rotated square)
        const s = r * 1.2;
        g.insert('rect', ':first-child')
          .attr('class', 'node-shape')
          .attr('x', -s / 2)
          .attr('y', -s / 2)
          .attr('width', s)
          .attr('height', s)
          .attr('fill', fill)
          .attr('stroke', stroke)
          .attr('stroke-width', 1)
          .attr('transform', 'rotate(45)');
        if (d.isRuling) {
          g.append('text')
            .attr('class', 'crown-icon')
            .attr('x', 0)
            .attr('y', -r - 4)
            .attr('text-anchor', 'middle')
            .attr('font-size', '10px')
            .text('\u265A');
        }
        break;
      }
      case 'origin_group': {
        // Hexagon
        const hex = d3.range(6).map(i => {
          const angle = (Math.PI / 3) * i - Math.PI / 6;
          return `${r * Math.cos(angle)},${r * Math.sin(angle)}`;
        }).join(' ');
        g.insert('polygon', ':first-child')
          .attr('class', 'node-shape')
          .attr('points', hex)
          .attr('fill', fill)
          .attr('stroke', stroke)
          .attr('stroke-width', 1);
        break;
      }
      default: {
        // tribe, section: circle
        g.insert('circle', ':first-child')
          .attr('class', 'node-shape')
          .attr('r', r)
          .attr('fill', fill)
          .attr('stroke', stroke)
          .attr('stroke-width', 1);
        break;
      }
    }
  });
}

export default function LineageExplorer({ onSelectEntity }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const simulationRef = useRef<d3.Simulation<SimNode, SimLink> | null>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  const [layoutMode, setLayoutMode] = useState<LayoutMode>('force');
  const [showAll, setShowAll] = useState(false);
  const [filterTypes, setFilterTypes] = useState({
    confederation: true,
    tribe: true,
    section: true,
    family: true,
  });
  const [filterLineage, setFilterLineage] = useState<'all' | 'adnani' | 'qahtani'>('all');
  const [showAlliances, setShowAlliances] = useState(false);
  const [showRivalries, setShowRivalries] = useState(false);
  const [showIntermarriage, setShowIntermarriage] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; node: SimNode } | null>(null);

  const overlayVisibility = useMemo(() => ({
    alliance: showAlliances,
    rivalry: showRivalries,
    intermarriage: showIntermarriage,
  }), [showAlliances, showRivalries, showIntermarriage]);

  const { nodes, links } = useMemo(() => {
    const rawNodes = lineageData.nodes
      .filter(n => {
        if (n.nodeType === 'lineage_root') return true;
        if (n.nodeType === 'origin_group') return true;
        if (n.nodeType === 'confederation' && !filterTypes.confederation) return false;
        if (n.nodeType === 'tribe' && !filterTypes.tribe) return false;
        if (n.nodeType === 'section' && !filterTypes.section) return false;
        if (n.nodeType === 'family' && !filterTypes.family) return false;
        if (filterLineage === 'adnani' && n.lineage !== 'adnani' && n.lineage !== null) return false;
        if (filterLineage === 'qahtani' && n.lineage !== 'qahtani' && n.lineage !== null) return false;
        return true;
      })
      .sort((a, b) => b.size - a.size);

    const limited = showAll ? rawNodes : rawNodes.slice(0, INITIAL_NODE_LIMIT);
    const nodeIds = new Set(limited.map(n => n.id));

    const filteredLinks = lineageData.edges.filter(e => {
      if (!nodeIds.has(e.source) || !nodeIds.has(e.target)) return false;
      if (OVERLAY_EDGE_TYPES.has(e.edgeType)) {
        const vis = overlayVisibility[e.edgeType as keyof typeof overlayVisibility];
        if (!vis) return false;
      }
      return true;
    });

    return {
      nodes: limited.map(n => ({ ...n })) as SimNode[],
      links: filteredLinks.map(e => ({
        source: e.source,
        target: e.target,
        edgeType: e.edgeType,
        confidence: e.confidence,
        label: e.label,
      })) as SimLink[],
    };
  }, [showAll, filterTypes, filterLineage, overlayVisibility]);

  const ancestryChain = useMemo(() => {
    if (!selectedNodeId) return null;
    const chain = lineageData.ancestryChains[selectedNodeId];
    if (!chain || chain.length === 0) return null;
    return chain;
  }, [selectedNodeId]);

  const ancestryNodeIds = useMemo(() => {
    if (!ancestryChain) return null;
    return new Set(ancestryChain);
  }, [ancestryChain]);

  const ancestryEdgeKey = useCallback((src: string, tgt: string) => `${src}|${tgt}`, []);

  const ancestryEdgeIds = useMemo(() => {
    if (!ancestryChain || ancestryChain.length < 2) return null;
    const edgeSet = new Set<string>();
    for (let i = 0; i < ancestryChain.length - 1; i++) {
      edgeSet.add(ancestryEdgeKey(ancestryChain[i], ancestryChain[i + 1]));
      edgeSet.add(ancestryEdgeKey(ancestryChain[i + 1], ancestryChain[i]));
    }
    return edgeSet;
  }, [ancestryChain, ancestryEdgeKey]);

  // Sibling node IDs: other nodes sharing same parent in the chain
  const siblingIds = useMemo(() => {
    if (!ancestryChain || ancestryChain.length < 2) return new Set<string>();
    const parentIds = new Set(ancestryChain.slice(1)); // all except the first (selected node)
    const siblings = new Set<string>();
    for (const edge of lineageData.edges) {
      if (parentIds.has(edge.source) && !ancestryNodeIds?.has(edge.target)) {
        siblings.add(edge.target);
      }
    }
    return siblings;
  }, [ancestryChain, ancestryNodeIds]);

  const ancestryChainNames = useMemo(() => {
    if (!ancestryChain) return [];
    const nodeMap = new Map(lineageData.nodes.map(n => [n.id, n]));
    return ancestryChain.map(id => ({
      id,
      name: nodeMap.get(id)?.name ?? id,
      confidence: nodeMap.get(id)?.metadata?.formationTheories?.[0]?.confidence ?? 'confirmed' as ConfidenceLevel,
    }));
  }, [ancestryChain]);

  // Search across ALL lineage nodes, not just currently visible ones
  const searchResults = useMemo(() => {
    if (!searchQuery.trim() || searchQuery.length < 2) return [];
    const q = searchQuery.toLowerCase();
    return lineageData.nodes
      .filter(n => n.name.toLowerCase().includes(q))
      .sort((a, b) => (b.size ?? 0) - (a.size ?? 0))
      .slice(0, 8);
  }, [searchQuery]);

  const searchMatchId = useMemo(() => {
    return searchResults.length > 0 ? searchResults[0].id : null;
  }, [searchResults]);

  // D3 rendering
  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return;
    if (nodes.length === 0) return;

    const svg = d3.select(svgRef.current);
    const { width, height } = containerRef.current.getBoundingClientRect();

    svg.selectAll('*').remove();
    svg.attr('width', width).attr('height', height);

    // Defs
    const defs = svg.append('defs');

    // Glow filter
    const glowFilter = defs.append('filter').attr('id', 'lineage-glow');
    glowFilter.append('feDropShadow')
      .attr('dx', 0).attr('dy', 0)
      .attr('stdDeviation', 5)
      .attr('flood-color', '#C4643A')
      .attr('flood-opacity', 0.7);

    // Arrow marker for branch edges
    defs.append('marker')
      .attr('id', 'arrow-branch')
      .attr('viewBox', '0 0 10 10')
      .attr('refX', 20)
      .attr('refY', 5)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,0 L10,5 L0,10 Z')
      .attr('fill', '#666');

    const g = svg.append('g').attr('class', 'lineage-root');

    // Zoom
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 6])
      .on('zoom', (event) => g.attr('transform', event.transform));
    zoomRef.current = zoom;
    svg.call(zoom);

    // Simulation
    const simulation = d3.forceSimulation<SimNode>(nodes)
      .force('link', d3.forceLink<SimNode, SimLink>(links)
        .id(d => d.id)
        .distance(d => LINK_DISTANCES[d.edgeType] ?? 80))
      .force('charge', d3.forceManyBody<SimNode>().strength(d => getChargeStrength(d)))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collide', d3.forceCollide<SimNode>().radius(d => getNodeRadius(d) + 6));

    // Hierarchical layout: position nodes by depth level with Y-force
    if (layoutMode === 'hierarchical') {
      const layerHeight = height / 6;
      const yCenter = height / 2;

      // Assign initial positions by depth
      nodes.forEach(n => {
        const depth = NODE_TYPE_DEPTH[n.nodeType] ?? 2;
        n.y = yCenter - (height * 0.35) + depth * layerHeight;
        if (n.x == null) n.x = width / 2 + (Math.random() - 0.5) * width * 0.6;
      });

      // Strong Y-force to keep nodes at their depth level
      simulation
        .force('y', d3.forceY<SimNode>(d => {
          const depth = NODE_TYPE_DEPTH[d.nodeType] ?? 2;
          return yCenter - (height * 0.35) + depth * layerHeight;
        }).strength(0.8))
        .force('x', d3.forceX<SimNode>(width / 2).strength(0.02))
        .force('charge', d3.forceManyBody<SimNode>().strength(d => getChargeStrength(d) * 1.5));
    }

    simulationRef.current = simulation;

    // Hierarchical depth labels
    if (layoutMode === 'hierarchical') {
      const layerHeight = height / 6;
      const yCenter = height / 2;
      const depthLabels = [
        { label: 'Lineage Roots', depth: 0 },
        { label: 'Confederations & Origins', depth: 1 },
        { label: 'Tribes', depth: 2 },
        { label: 'Sections', depth: 3 },
        { label: 'Families', depth: 4 },
      ];
      const labelGroup = g.append('g').attr('class', 'depth-labels');
      depthLabels.forEach(({ label, depth }) => {
        const y = yCenter - (height * 0.35) + depth * layerHeight;
        labelGroup.append('line')
          .attr('x1', -5000).attr('x2', 10000)
          .attr('y1', y).attr('y2', y)
          .attr('stroke', '#C4643A')
          .attr('stroke-opacity', 0.08)
          .attr('stroke-width', 1);
        labelGroup.append('text')
          .attr('x', 30)
          .attr('y', y - 8)
          .attr('font-family', "'DM Sans', sans-serif")
          .attr('font-size', '10px')
          .attr('fill', '#C4643A')
          .attr('opacity', 0.4)
          .attr('font-weight', 600)
          .text(label.toUpperCase());
      });
    }

    // Edge group
    const edgeGroup = g.append('g').attr('class', 'edges');

    // Edge lines
    const edgeElements = edgeGroup.selectAll<SVGLineElement, SimLink>('line')
      .data(links)
      .join('line')
      .attr('stroke', d => getEdgeStroke(d as unknown as LineageEdge))
      .attr('stroke-width', d => getEdgeWidth(d.edgeType))
      .attr('stroke-opacity', d => getEdgeOpacity(d.edgeType))
      .attr('stroke-dasharray', d => getEdgeDash(d.edgeType))
      .attr('marker-end', d => d.edgeType === 'branch' ? 'url(#arrow-branch)' : null);

    // Edge labels for special types
    const edgeLabelGroup = g.append('g').attr('class', 'edge-labels');
    const claimedDescentEdges = links.filter(l => l.edgeType === 'claimed_descent');
    const claimedLabels = edgeLabelGroup.selectAll<SVGTextElement, SimLink>('text.claimed')
      .data(claimedDescentEdges)
      .join('text')
      .attr('class', 'claimed')
      .attr('font-family', "'DM Sans', sans-serif")
      .attr('font-size', '10px')
      .attr('fill', '#1A1A1A')
      .attr('text-anchor', 'middle')
      .attr('opacity', 0.6)
      .text('?');

    // Crown markers for ruling_house edges
    const rulingEdges = links.filter(l => l.edgeType === 'ruling_house');
    const rulingLabels = edgeLabelGroup.selectAll<SVGTextElement, SimLink>('text.ruling')
      .data(rulingEdges)
      .join('text')
      .attr('class', 'ruling')
      .attr('font-size', '9px')
      .attr('text-anchor', 'middle')
      .text('\u265A');

    // Node group
    const nodeGroup = g.append('g').attr('class', 'nodes');
    const nodeElements = nodeGroup.selectAll<SVGGElement, SimNode>('g.node')
      .data(nodes, d => d.id)
      .join('g')
      .attr('class', 'node')
      .style('cursor', 'pointer');

    drawNodeShape(nodeElements);

    // Labels
    const labelGroup = g.append('g').attr('class', 'labels');
    const labelElements = labelGroup.selectAll<SVGTextElement, SimNode>('text')
      .data(nodes.filter(n => n.size > 2 || n.nodeType === 'lineage_root' || n.nodeType === 'confederation'), d => d.id)
      .join('text')
      .text(d => d.name)
      .attr('font-size', d => d.nodeType === 'lineage_root' ? 13 : d.nodeType === 'confederation' ? 11 : 9)
      .attr('font-family', "'DM Sans', sans-serif")
      .attr('font-weight', d => d.nodeType === 'lineage_root' ? 700 : 500)
      .attr('fill', '#1A1A1A')
      .attr('text-anchor', 'middle')
      .attr('dy', d => -getNodeRadius(d) - 6)
      .attr('pointer-events', 'none')
      .attr('opacity', 0.85);

    // Drag
    let dragMoved = false;
    const drag = d3.drag<SVGGElement, SimNode>()
      .on('start', (event, d) => {
        dragMoved = false;
        if (!event.active) simulation.alphaTarget(0.1).restart();
        d.fx = d.x;
        d.fy = d.y;
      })
      .on('drag', (event, d) => {
        dragMoved = true;
        d.fx = event.x;
        d.fy = event.y;
      })
      .on('end', (event, d) => {
        if (!event.active) simulation.alphaTarget(0);
        // Keep node pinned where user dropped it
      });

    nodeElements.call(drag);

    // Hover + click (only if not dragging)
    nodeElements
      .on('mouseenter', (event, d) => {
        const [mx, my] = d3.pointer(event, containerRef.current!);
        setTooltip({ x: mx, y: my, node: d });
      })
      .on('mouseleave', () => {
        setTooltip(null);
      })
      .on('click', (_event, d) => {
        if (dragMoved) return; // Don't trigger click after drag
        setSelectedNodeId(prev => prev === d.id ? null : d.id);
        onSelectEntity?.(d.type, d.id);
      });

    // Tick
    simulation.on('tick', () => {
      edgeElements
        .attr('x1', d => (d.source as SimNode).x!)
        .attr('y1', d => (d.source as SimNode).y!)
        .attr('x2', d => (d.target as SimNode).x!)
        .attr('y2', d => (d.target as SimNode).y!);

      claimedLabels
        .attr('x', d => ((d.source as SimNode).x! + (d.target as SimNode).x!) / 2)
        .attr('y', d => ((d.source as SimNode).y! + (d.target as SimNode).y!) / 2);

      rulingLabels
        .attr('x', d => ((d.source as SimNode).x! + (d.target as SimNode).x!) / 2)
        .attr('y', d => ((d.source as SimNode).y! + (d.target as SimNode).y!) / 2);

      nodeElements.attr('transform', d => `translate(${d.x},${d.y})`);

      labelElements
        .attr('x', d => d.x!)
        .attr('y', d => d.y!);
    });

    // Fade-in edges
    edgeElements
      .attr('stroke-opacity', 0)
      .transition()
      .duration(800)
      .delay((_d, i) => i * 2)
      .attr('stroke-opacity', d => getEdgeOpacity(d.edgeType));

    return () => {
      simulation.stop();
    };
  }, [nodes, links, onSelectEntity, layoutMode]);

  // Highlight effect for ancestry trace + search
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    const hasAncestry = ancestryNodeIds !== null;

    svg.selectAll<SVGGElement, SimNode>('g.node')
      .each(function (d) {
        const g = d3.select(this);
        const shape = g.select('.node-shape');

        let opacity = 1;
        let filterVal = 'none';

        if (searchMatchId && d.id === searchMatchId) {
          opacity = 1;
          filterVal = 'url(#lineage-glow)';
        } else if (hasAncestry) {
          if (ancestryNodeIds.has(d.id)) {
            opacity = 1;
            filterVal = 'url(#lineage-glow)';
          } else if (siblingIds.has(d.id)) {
            opacity = 0.5;
          } else {
            opacity = 0.15;
          }
        }

        shape.transition().duration(300)
          .attr('opacity', opacity)
          .attr('filter', filterVal);

        g.transition().duration(300).attr('opacity', opacity);
      });

    svg.selectAll<SVGLineElement, SimLink>('.edges line')
      .transition().duration(300)
      .attr('stroke-opacity', d => {
        if (!hasAncestry) return getEdgeOpacity(d.edgeType);
        const src = typeof d.source === 'object' ? (d.source as SimNode).id : String(d.source);
        const tgt = typeof d.target === 'object' ? (d.target as SimNode).id : String(d.target);
        if (ancestryEdgeIds?.has(ancestryEdgeKey(src, tgt))) return 0.9;
        return 0.05;
      });

    svg.selectAll<SVGTextElement, SimNode>('.labels text')
      .transition().duration(300)
      .attr('opacity', d => {
        if (!hasAncestry) return 0.85;
        if (ancestryNodeIds?.has(d.id)) return 1;
        if (siblingIds.has(d.id)) return 0.4;
        return 0.08;
      });

    // Pan to search match
    if (searchMatchId && containerRef.current && zoomRef.current) {
      const matchNode = nodes.find(n => n.id === searchMatchId);
      if (matchNode && matchNode.x != null && matchNode.y != null) {
        const { width, height } = containerRef.current.getBoundingClientRect();
        const transform = d3.zoomIdentity
          .translate(width / 2, height / 2)
          .scale(1.5)
          .translate(-matchNode.x, -matchNode.y);
        svg.transition().duration(600).call(
          zoomRef.current.transform as any,
          transform,
        );
      }
    }
  }, [ancestryNodeIds, ancestryEdgeIds, ancestryEdgeKey, siblingIds, searchMatchId, nodes]);

  const resetView = useCallback(() => {
    setFilterTypes({ confederation: true, tribe: true, section: true, family: true });
    setFilterLineage('all');
    setShowAlliances(false);
    setShowRivalries(false);
    setShowIntermarriage(false);
    setSearchQuery('');
    setSelectedNodeId(null);
    setShowAll(false);
    setLayoutMode('force');
    if (svgRef.current && zoomRef.current) {
      d3.select(svgRef.current).transition().duration(400).call(
        zoomRef.current.transform as any,
        d3.zoomIdentity,
      );
    }
  }, []);

  const sectionCount = useCallback((node: SimNode): number => {
    if (node.nodeType !== 'confederation') return 0;
    const cluster = lineageData.clusters.confederations[node.id];
    return cluster?.sections?.length ?? cluster?.members?.length ?? 0;
  }, []);

  const isEmpty = lineageData.nodes.length === 0;

  return (
    <div
      ref={containerRef}
      className="relative w-full overflow-hidden bg-bg"
      style={{ height: 'calc(100vh - 4rem)' }}
    >
      <svg ref={svgRef} className="absolute inset-0 w-full h-full" />

      {isEmpty && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center text-text">
            <div className="text-2xl font-display font-semibold mb-2">Lineage Explorer</div>
            <div className="text-sm text-text-tertiary">No lineage data loaded.</div>
          </div>
        </div>
      )}

      {/* Tooltip */}
      {tooltip && (
        <div
          className="pointer-events-none absolute z-50 rounded-lg border border-border bg-bg-raised px-3 py-2 text-sm shadow-lg"
          style={{
            left: tooltip.x + 14,
            top: tooltip.y - 10,
            backdropFilter: 'blur(8px)',
          }}
        >
          <div className="font-display font-semibold text-accent">{tooltip.node.name}</div>
          <div className="text-xs text-text-tertiary capitalize">
            <span
              className="inline-block px-1.5 py-0.5 rounded mr-1 text-[10px]"
              style={{ background: 'rgba(196, 100, 58, 0.2)', color: '#C4643A' }}
            >
              {tooltip.node.nodeType.replace('_', ' ')}
            </span>
            {tooltip.node.lineage && <span>{tooltip.node.lineage}</span>}
          </div>
          {tooltip.node.nodeType === 'confederation' && (
            <div className="text-xs opacity-60 mt-1">{sectionCount(tooltip.node)} sections</div>
          )}
          {tooltip.node.nodeType === 'family' && tooltip.node.isRuling && (
            <div className="text-xs mt-1">
              <span style={{ color: '#C4643A' }}>Ruling family</span>
              {tooltip.node.rulesOver && <span className="opacity-60"> of {tooltip.node.rulesOver}</span>}
            </div>
          )}
          {tooltip.node.metadata?.formationTheories && tooltip.node.metadata.formationTheories.length > 0 && (
            <div className="text-xs opacity-50 mt-1">Click to see formation theories</div>
          )}
        </div>
      )}

      {/* Controls Panel */}
      <div
        className="absolute top-2 left-2 sm:top-4 sm:left-4 z-40 flex flex-col gap-3 rounded-xl border border-border bg-bg-raised/90 p-3 sm:p-4 text-sm text-text max-h-[calc(100vh-8rem)] overflow-y-auto w-[180px] sm:w-[220px]"
        style={{ backdropFilter: 'blur(12px)' }}
      >
        <h3 className="font-display text-lg font-semibold text-accent">Lineage</h3>

        {/* Search */}
        <div className="relative">
          <input
            type="text"
            placeholder="Search tribe, family..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full rounded px-2 py-1 text-xs outline-none bg-bg-subtle border border-border text-text"
          />
          {searchResults.length > 0 && searchQuery.length >= 2 && (
            <div className="absolute top-full left-0 right-0 mt-1 rounded border border-border bg-bg-raised shadow-lg z-50 max-h-48 overflow-y-auto">
              {searchResults.map(r => (
                <button
                  key={r.id}
                  onClick={() => {
                    setSelectedNodeId(r.id);
                    setSearchQuery('');
                    onSelectEntity?.(r.type, r.id);
                    // If node not visible, enable show all
                    if (!nodes.find(n => n.id === r.id)) {
                      setShowAll(true);
                    }
                  }}
                  className="w-full text-left px-2 py-1.5 text-xs hover:bg-bg-subtle transition-colors cursor-pointer flex items-center gap-2"
                >
                  <span
                    className="inline-block px-1 py-0.5 rounded text-[9px] font-medium shrink-0"
                    style={{ background: 'rgba(196, 100, 58, 0.15)', color: '#C4643A' }}
                  >
                    {r.nodeType.replace('_', ' ')}
                  </span>
                  <span className="truncate text-text">{r.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Layout toggle */}
        <fieldset>
          <legend className="text-xs font-semibold uppercase tracking-wide opacity-60 mb-1">Layout</legend>
          <div className="flex gap-1">
            <button
              onClick={() => setLayoutMode('force')}
              className={`flex-1 rounded px-2 py-2 text-xs font-medium transition-colors cursor-pointer ${
                layoutMode === 'force'
                  ? 'bg-accent/20 text-accent border border-accent/40'
                  : 'bg-bg-subtle border border-border text-text-secondary hover:bg-bg-subtle/80'
              }`}
            >
              Galaxy
            </button>
            <button
              onClick={() => setLayoutMode('hierarchical')}
              className={`flex-1 rounded px-2 py-2 text-xs font-medium transition-colors cursor-pointer ${
                layoutMode === 'hierarchical'
                  ? 'bg-accent/20 text-accent border border-accent/40'
                  : 'bg-bg-subtle border border-border text-text-secondary hover:bg-bg-subtle/80'
              }`}
            >
              Hierarchy
            </button>
          </div>
        </fieldset>

        {/* Node type filter */}
        <fieldset>
          <legend className="text-xs font-semibold uppercase tracking-wide opacity-60 mb-1">Node Types</legend>
          {(['confederation', 'tribe', 'section', 'family'] as const).map(t => (
            <label key={t} className="flex items-center gap-2 cursor-pointer capitalize">
              <input
                type="checkbox"
                checked={filterTypes[t]}
                onChange={() => setFilterTypes(p => ({ ...p, [t]: !p[t] }))}
                className="accent-[#C4643A]"
              />
              {t === 'confederation' ? 'Confederations' : t === 'tribe' ? 'Tribes' : t === 'section' ? 'Sections' : 'Families'}
            </label>
          ))}
        </fieldset>

        {/* Lineage filter */}
        <fieldset>
          <legend className="text-xs font-semibold uppercase tracking-wide opacity-60 mb-1">Lineage</legend>
          {(['all', 'adnani', 'qahtani'] as const).map(val => (
            <label key={val} className="flex items-center gap-2 cursor-pointer capitalize">
              <input
                type="radio"
                name="lineage-filter"
                checked={filterLineage === val}
                onChange={() => setFilterLineage(val)}
                className="accent-[#C4643A]"
              />
              {val === 'all' ? 'All' : val}
            </label>
          ))}
        </fieldset>

        {/* Relations toggles */}
        <fieldset>
          <legend className="text-xs font-semibold uppercase tracking-wide opacity-60 mb-1">Relations</legend>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={showAlliances} onChange={() => setShowAlliances(p => !p)} className="accent-[#2ECC71]" />
            <span style={{ color: '#2ECC71' }}>Alliances</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={showRivalries} onChange={() => setShowRivalries(p => !p)} className="accent-[#E74C3C]" />
            <span style={{ color: '#E74C3C' }}>Rivalries</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={showIntermarriage} onChange={() => setShowIntermarriage(p => !p)} className="accent-[#8E44AD]" />
            <span style={{ color: '#8E44AD' }}>Intermarriage</span>
          </label>
        </fieldset>

        {/* Show all */}
        <label className="flex items-center gap-2 cursor-pointer text-xs">
          <input
            type="checkbox"
            checked={showAll}
            onChange={() => setShowAll(p => !p)}
            className="accent-[#C4643A]"
          />
          Show all nodes ({lineageData.nodes.length})
        </label>

        <button
          onClick={resetView}
          className="mt-1 rounded border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-semibold text-accent transition-colors cursor-pointer hover:bg-accent/20"
        >
          Reset View
        </button>
      </div>

      {/* Breadcrumb Bar */}
      {ancestryChainNames.length > 0 && (
        <div
          className="absolute bottom-2 sm:bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-1 rounded-xl border border-border bg-bg-raised/95 px-3 sm:px-4 py-2 sm:py-2.5 text-xs sm:text-sm text-text"
          style={{
            backdropFilter: 'blur(12px)',
            maxWidth: 'calc(100vw - 2rem)',
            overflowX: 'auto',
          }}
        >
          {ancestryChainNames.map((seg, i) => (
            <span key={seg.id} className="flex items-center gap-1 whitespace-nowrap">
              <button
                onClick={() => setSelectedNodeId(seg.id)}
                className="transition-colors cursor-pointer px-1 rounded"
                style={{
                  color: seg.id === selectedNodeId ? '#C4643A' : undefined,
                  fontStyle: seg.confidence === 'oral_tradition' ? 'italic' : 'normal',
                  textDecoration: seg.confidence === 'oral_tradition' ? 'underline' : 'none',
                  textDecorationStyle: seg.confidence === 'oral_tradition' ? 'dashed' : undefined,
                  fontWeight: seg.id === selectedNodeId ? 600 : 400,
                }}
                onMouseEnter={e => (e.currentTarget.style.color = '#C4643A')}
                onMouseLeave={e => (e.currentTarget.style.color = seg.id === selectedNodeId ? '#C4643A' : '')}
              >
                {seg.name}
              </button>
              {i < ancestryChainNames.length - 1 && (
                <span className="opacity-40 mx-0.5">{'\u2192'}</span>
              )}
            </span>
          ))}
        </div>
      )}

      {/* Legend */}
      <div
        className="absolute bottom-2 right-2 sm:bottom-4 sm:right-4 z-40 rounded-xl border border-border bg-bg-raised/90 p-2 sm:p-3 text-xs text-text hidden sm:block"
        style={{ backdropFilter: 'blur(12px)' }}
      >
        <div className="font-semibold mb-2 opacity-70 uppercase tracking-wide">Legend</div>
        <div className="flex flex-col gap-1.5">
          {/* Node types */}
          <div className="flex items-center gap-2">
            <svg width="14" height="14"><circle cx="7" cy="7" r="6" fill="#C4643A" stroke="#8B3D25" strokeWidth="1" /></svg>
            Lineage Root
          </div>
          <div className="flex items-center gap-2">
            <svg width="14" height="14"><rect x="1" y="3" width="12" height="8" rx="3" fill="rgba(196,100,58,0.25)" stroke="#C4643A" strokeWidth="1" /></svg>
            Confederation
          </div>
          <div className="flex items-center gap-2">
            <svg width="14" height="14"><circle cx="7" cy="7" r="5" fill="#1ABC9C" stroke="#158A6E" strokeWidth="1" /></svg>
            Tribe
          </div>
          <div className="flex items-center gap-2">
            <svg width="14" height="14"><circle cx="7" cy="7" r="4" fill="#888" stroke="#666" strokeWidth="1" /></svg>
            Section
          </div>
          <div className="flex items-center gap-2">
            <svg width="14" height="14"><rect x="3" y="3" width="8" height="8" fill="#A0503A" stroke="#6B3425" strokeWidth="1" transform="rotate(45 7 7)" /></svg>
            Family
          </div>
          <div className="flex items-center gap-2">
            <svg width="14" height="14"><polygon points="7,1 12,4.5 12,9.5 7,13 2,9.5 2,4.5" fill="#8E7CC3" stroke="#6B5A9E" strokeWidth="1" /></svg>
            Origin Group
          </div>

          <div className="border-t border-border my-1" />

          {/* Edge types */}
          <div className="flex items-center gap-2">
            <svg width="24" height="6"><line x1="0" y1="3" x2="24" y2="3" stroke="#C4643A" strokeWidth="2" /></svg>
            Descent
          </div>
          <div className="flex items-center gap-2">
            <svg width="24" height="6"><line x1="0" y1="3" x2="24" y2="3" stroke="#666" strokeWidth="1.5" strokeDasharray="3,3" /></svg>
            Confederation
          </div>
          <div className="flex items-center gap-2">
            <svg width="24" height="6"><line x1="0" y1="3" x2="24" y2="3" stroke="#666" strokeWidth="1" strokeDasharray="2,3" opacity="0.5" /></svg>
            Claimed
          </div>
          <div className="flex items-center gap-2">
            <svg width="24" height="6"><line x1="0" y1="3" x2="24" y2="3" stroke="#E74C3C" strokeWidth="1" strokeDasharray="6,4" /></svg>
            Rivalry
          </div>
          <div className="flex items-center gap-2">
            <svg width="24" height="6"><line x1="0" y1="3" x2="24" y2="3" stroke="#2ECC71" strokeWidth="1" /></svg>
            Alliance
          </div>
          <div className="flex items-center gap-2">
            <svg width="24" height="6"><line x1="0" y1="3" x2="18" y2="3" stroke="#8E44AD" strokeWidth="1.5" /><line x1="0" y1="5" x2="18" y2="5" stroke="#8E44AD" strokeWidth="0.5" /></svg>
            Intermarriage
          </div>

          <div className="border-t border-border my-1" />

          {/* Confidence levels */}
          <div className="opacity-60">Confidence:</div>
          <div className="flex items-center gap-2">
            <span className="font-semibold">Solid</span> = Confirmed
          </div>
          <div className="flex items-center gap-2">
            <span className="italic" style={{ textDecoration: 'underline', textDecorationStyle: 'dashed' }}>Dashed</span> = Oral tradition
          </div>
        </div>
      </div>
    </div>
  );
}
