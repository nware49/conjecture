/**
 * The dependency view — what actually holds up the roof.
 *
 * Layout is bottom-up: assumptions at the floor, the goal at the ceiling, so
 * reading up the page is reading the proof. One hollow node on the critical
 * path means the whole result is hollow, however much yellow surrounds it.
 */

import { useEffect, useMemo, useState } from 'react';
import { api, type DependencyGraph, type GraphNode } from '../api.js';
import { Mark } from '../components/Mark.js';
import { useStore } from '../store.js';

const NODE = 14;
const COL_W = 118;
const ROW_H = 74;
const PAD_X = 34;
const PAD_Y = 34;

interface Placed extends GraphNode {
  x: number;
  y: number;
}

export function GraphScreen(): JSX.Element {
  const { selectedId, select, workspace } = useStore();
  const [graph, setGraph] = useState<DependencyGraph | null>(null);

  useEffect(() => {
    void api.graph(selectedId).then(setGraph);
  }, [selectedId, workspace?.claims.length]);

  const layout = useMemo(() => {
    if (!graph) return null;

    const byLayer = new Map<number, GraphNode[]>();
    for (const node of graph.nodes) {
      const list = byLayer.get(node.layer) ?? [];
      list.push(node);
      byLayer.set(node.layer, list);
    }

    const widest = Math.max(1, ...[...byLayer.values()].map((list) => list.length));
    const placed = new Map<string, Placed>();

    for (const [layer, nodes] of byLayer) {
      nodes.forEach((node, index) => {
        // Centre each layer, so the picture reads as a shape rather than a grid.
        const offset = (widest - nodes.length) / 2;
        placed.set(node.id, {
          ...node,
          x: PAD_X + (offset + index) * COL_W,
          y: PAD_Y + (graph.layerCount - 1 - layer) * ROW_H,
        });
      });
    }

    return {
      placed,
      width: PAD_X * 2 + widest * COL_W,
      height: PAD_Y * 2 + graph.layerCount * ROW_H,
    };
  }, [graph]);

  if (!graph || !layout) {
    return (
      <div className="page">
        <div className="page__in">
          <p className="empty">Reading the dependency graph…</p>
        </div>
      </div>
    );
  }

  if (graph.nodes.length === 0) {
    return (
      <div className="page">
        <div className="page__in">
          <p className="empty">No claims to draw. State one first.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page__in">
        <p className="eyebrow">Figure 5.2</p>
        <h1 style={{ fontSize: 24, letterSpacing: '-0.02em', margin: '0 0 6px' }}>
          What actually holds up the roof
        </h1>
        <p className="note">
          Edges are citations between claims in this workspace, not anyone’s account of the proof.
          The heavy path leads to the selected claim; every unproved node on it blocks the top.
        </p>

        <div style={{ border: '1px solid var(--ink)', background: '#fff', overflowX: 'auto' }}>
          <svg
            className="dag"
            viewBox={`0 0 ${layout.width} ${layout.height}`}
            style={{ minWidth: Math.min(layout.width, 900) }}
            role="img"
            aria-label="Dependency graph of claims"
          >
            {graph.edges.map((edge, index) => {
              const from = layout.placed.get(edge.from);
              const to = layout.placed.get(edge.to);
              if (!from || !to) return null;
              const midY = (from.y + to.y) / 2;
              return (
                <path
                  key={index}
                  className={`edge ${edge.dead ? 'edge--dead' : edge.onCriticalPath ? 'edge--crit' : ''}`}
                  d={`M${from.x + NODE / 2} ${from.y} L${from.x + NODE / 2} ${midY} L${to.x + NODE / 2} ${midY} L${to.x + NODE / 2} ${to.y + NODE}`}
                />
              );
            })}

            {[...layout.placed.values()].map((node) => (
              <g
                key={node.id}
                onClick={() => select(node.id)}
                style={{ cursor: 'pointer' }}
                opacity={node.invalidated ? 0.55 : 1}
              >
                <rect
                  x={node.x}
                  y={node.y}
                  width={NODE}
                  height={NODE}
                  fill={node.state === 'proved' ? 'var(--proved)' : '#fff'}
                  stroke={
                    node.state === 'refuted'
                      ? 'var(--refuted)'
                      : node.id === selectedId
                        ? 'var(--proved-deep)'
                        : 'var(--ink)'
                  }
                  strokeWidth={node.id === selectedId ? 2.6 : 1.6}
                />
                {node.state === 'refuted' && (
                  <path
                    d={`M${node.x} ${node.y + NODE} L${node.x + NODE} ${node.y}`}
                    stroke="var(--refuted)"
                    strokeWidth={1.6}
                  />
                )}
                <text
                  x={node.x + NODE / 2}
                  y={node.y + NODE + 12}
                  textAnchor="middle"
                  fill={node.state === 'refuted' ? 'var(--refuted)' : 'var(--ink-2)'}
                >
                  {clip(node.title)}
                </text>
              </g>
            ))}
          </svg>
        </div>

        <div style={{ display: 'flex', gap: 18, marginTop: 12, flexWrap: 'wrap' }}>
          <Legend swatch={<hr style={{ width: 18, border: 0, borderTop: '2px solid var(--ink)' }} />} label="critical path" />
          <Legend
            swatch={<hr style={{ width: 18, border: 0, borderTop: '2px dashed var(--refuted)' }} />}
            label="invalidated by a counterexample"
          />
          <Legend swatch={<Mark state="proved" size={12} />} label="proved" />
          <Legend swatch={<Mark state="open" size={12} />} label="open" />
        </div>

        {graph.blockers.length > 0 && (
          <div className="banner banner--warn" style={{ marginTop: 18 }}>
            <Mark state="open" size={14} />
            <span>
              {graph.blockers.length === 1 ? 'One claim' : `${graph.blockers.length} claims`} on the
              critical path {graph.blockers.length === 1 ? 'is' : 'are'} not proved:{' '}
              {graph.blockers
                .map((id) => graph.nodes.find((n) => n.id === id)?.title ?? id)
                .join(', ')}
              . Until {graph.blockers.length === 1 ? 'it lands' : 'they land'}, the top holds up
              nothing.
            </span>
          </div>
        )}

        {graph.cycles.length > 0 && (
          <div className="banner" style={{ marginTop: 12, borderColor: 'var(--refuted)' }}>
            A citation cycle was found. That is a malformed proof, not a rendering problem:{' '}
            {graph.cycles[0]!.map((id) => graph.nodes.find((n) => n.id === id)?.title ?? id).join(' → ')}
          </div>
        )}
      </div>
    </div>
  );
}

function Legend({ swatch, label }: { swatch: JSX.Element; label: string }): JSX.Element {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      {swatch}
      <span className="meta">{label}</span>
    </span>
  );
}

function clip(title: string): string {
  return title.length > 18 ? `${title.slice(0, 16)}…` : title;
}
