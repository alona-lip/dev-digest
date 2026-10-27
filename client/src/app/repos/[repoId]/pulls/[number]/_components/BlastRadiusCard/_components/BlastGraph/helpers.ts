import type { PrBlastRadius } from "@devdigest/shared";
import { GRAPH, type NodeKind } from "./constants";

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  /** SVG cubic Bezier from the right edge of `from` to the left edge of `to`. */
  path: string;
}

export interface GraphLayout {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width: number;
  height: number;
}

/** Cut a label to `max` characters with an ellipsis (the full text goes into <title>). */
export function truncate(label: string, max: number = GRAPH.MAX_LABEL_CHARS): string {
  return label.length <= max ? label : `${label.slice(0, max - 1)}…`;
}

/** Pure 3-column layout: changed symbols | callers | endpoints/crons
    (edges: symbol -> caller, symbol -> endpoint/cron). */
export function layoutGraph(blast: PrBlastRadius): GraphLayout {
  const { WIDTH, NODE_WIDTH, NODE_HEIGHT, ROW_GAP, PAD } = GRAPH;
  const colX = [PAD, (WIDTH - NODE_WIDTH) / 2, WIDTH - NODE_WIDTH - PAD];
  const counts = [0, 0, 0];
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const byId = new Map<string, GraphNode>();

  const addNode = (col: number, id: string, kind: NodeKind, label: string): GraphNode => {
    const existing = byId.get(id);
    if (existing) return existing;
    const node: GraphNode = {
      id,
      kind,
      label,
      x: colX[col]!,
      y: PAD + counts[col]! * (NODE_HEIGHT + ROW_GAP),
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    };
    counts[col]!++;
    byId.set(id, node);
    nodes.push(node);
    return node;
  };

  const addEdge = (from: GraphNode, to: GraphNode) => {
    const x1 = from.x + from.width;
    const y1 = from.y + from.height / 2;
    const x2 = to.x;
    const y2 = to.y + to.height / 2;
    const mid = (x1 + x2) / 2;
    edges.push({
      id: `${from.id}->${to.id}`,
      from: from.id,
      to: to.id,
      path: `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`,
    });
  };

  for (const group of blast.downstream) {
    const symbolNode = addNode(0, `s:${group.symbol}`, "symbol", group.symbol);
    const targets = [
      ...group.endpoints_affected.map((e) => addNode(2, `e:${e}`, "endpoint", e)),
      ...group.crons_affected.map((c) => addNode(2, `c:${c}`, "cron", c)),
    ];
    for (const caller of group.callers) {
      const callerNode = addNode(1, `k:${group.symbol}:${caller.file}:${caller.line}:${caller.name}`, "caller", caller.name);
      addEdge(symbolNode, callerNode);
    }
    // The wire knows endpoints/crons per symbol group, not per caller: link from the symbol.
    for (const target of targets) addEdge(symbolNode, target);
  }

  const rows = Math.max(...counts, 1);
  return { nodes, edges, width: WIDTH, height: PAD * 2 + rows * NODE_HEIGHT + (rows - 1) * ROW_GAP };
}

/** What hovering `nodeId` lights up: the node, the nodes its edges lead to, and those edges' ids.
    Edges only leave symbols, so for a symbol that is exactly its callers and endpoints/crons. */
export function connectedTo(layout: GraphLayout, nodeId: string): Set<string> {
  const lit = new Set<string>([nodeId]);
  for (const edge of layout.edges) {
    if (edge.from !== nodeId) continue;
    lit.add(edge.to);
    lit.add(edge.id);
  }
  return lit;
}
