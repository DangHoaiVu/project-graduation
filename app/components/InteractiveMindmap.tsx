'use client';

import React, { useRef, useState, useEffect, useMemo, useCallback } from 'react';
import { exportElementToPng } from '@/lib/export-utils';

export interface MindmapBranchItem {
  title: string;
  items?: string[];
}

export interface MindmapData {
  root: string;
  branches: MindmapBranchItem[];
}

interface InteractiveMindmapProps {
  root: string;
  branches: MindmapBranchItem[];
  courseTitle: string;
  levelLabel?: string;
  topic?: string;
  onReconfigure?: () => void;
  notify: (msg: string) => void;
}

interface Position {
  x: number;
  y: number;
}

interface NodeLayout {
  id: string;
  label: string;
  type: 'root' | 'branch' | 'leaf';
  parentId?: string;
  depth: number;
  x: number;
  y: number;
  width: number;
  height: number;
  hasChildren: boolean;
  isExpanded: boolean;
  branchIndex?: number;
}

// Helpers for dynamic height calculation without truncation
function estimateNodeHeight(text: string, charsPerLine: number, basePadding: number, lineHeight: number) {
  const lineCount = Math.max(1, Math.ceil((text || '').length / charsPerLine));
  return basePadding + lineCount * lineHeight;
}

export function InteractiveMindmap({
  root,
  branches = [],
  courseTitle,
  levelLabel,
  topic,
  onReconfigure,
  notify,
}: InteractiveMindmapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  // Layout Orientation: 'horizontal' (Left-to-Right) or 'vertical' (Top-to-Bottom)
  const [orientation, setOrientation] = useState<'horizontal' | 'vertical'>('horizontal');

  // Expanded branches set
  const [expandedBranches, setExpandedBranches] = useState<Record<number, boolean>>(() => {
    const initial: Record<number, boolean> = {};
    branches.forEach((_, idx) => {
      initial[idx] = true;
    });
    return initial;
  });

  // Canvas Pan & Zoom
  const [pan, setPan] = useState<Position>({ x: 40, y: 40 });
  const [zoom, setZoom] = useState<number>(1);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<Position>({ x: 0, y: 0 });

  // Custom dragged node offsets
  const [nodeOffsets, setNodeOffsets] = useState<Record<string, Position>>({});
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
  const [nodeDragStart, setNodeDragStart] = useState<Position>({ x: 0, y: 0 });

  const [isExporting, setIsExporting] = useState(false);

  // Sync expanded state when branches change
  useEffect(() => {
    setExpandedBranches(prev => {
      const next = { ...prev };
      branches.forEach((_, idx) => {
        if (next[idx] === undefined) {
          next[idx] = true;
        }
      });
      return next;
    });
  }, [branches]);

  const toggleBranch = (idx: number) => {
    setExpandedBranches(prev => ({
      ...prev,
      [idx]: !prev[idx],
    }));
  };

  const expandAll = () => {
    const next: Record<number, boolean> = {};
    branches.forEach((_, idx) => {
      next[idx] = true;
    });
    setExpandedBranches(next);
  };

  const collapseAll = () => {
    setExpandedBranches({});
  };

  // Compute Layout based on Orientation (Horizontal or Vertical)
  const { nodes, connections, canvasWidth, canvasHeight } = useMemo(() => {
    const computedNodes: NodeLayout[] = [];
    const computedConnections: Array<{
      id: string;
      from: { x: number; y: number };
      to: { x: number; y: number };
      color?: string;
    }> = [];

    const rootText = root || courseTitle || 'Chủ đề chính';

    if (orientation === 'horizontal') {
      /* ── 1. HORIZONTAL LAYOUT (Left-to-Right / NotebookLM) ────────────────── */
      const rootX = 50;
      const branchX = 380;
      const leafX = 720;

      const rootWidth = 260;
      const rootHeight = estimateNodeHeight(rootText, 24, 38, 20);

      const branchWidth = 270;
      const leafWidth = 320;
      const rowGap = 16;
      const branchGroupGap = 28;

      let currentY = 40;

      const branchLayouts: Array<{
        branchIndex: number;
        branchY: number;
        branchHeight: number;
        leafNodes: NodeLayout[];
      }> = [];

      branches.forEach((b, bIdx) => {
        const isExpanded = Boolean(expandedBranches[bIdx]);
        const branchTitle = typeof b === 'string' ? b : b.title || `Nhánh ${bIdx + 1}`;
        const branchHeight = estimateNodeHeight(branchTitle, 24, 28, 18);
        const items = Array.isArray(b.items) ? b.items : [];

        const startY = currentY;
        const leafNodesForBranch: NodeLayout[] = [];

        if (isExpanded && items.length > 0) {
          items.forEach((item, itemIdx) => {
            const itemLabel = typeof item === 'string' ? item : (item as { title?: string }).title || 'Mục';
            const leafHeight = estimateNodeHeight(itemLabel, 30, 22, 18);
            const leafNode: NodeLayout = {
              id: `leaf-${bIdx}-${itemIdx}`,
              label: itemLabel,
              type: 'leaf',
              parentId: `branch-${bIdx}`,
              depth: 2,
              x: leafX,
              y: currentY,
              width: leafWidth,
              height: leafHeight,
              hasChildren: false,
              isExpanded: false,
              branchIndex: bIdx,
            };
            leafNodesForBranch.push(leafNode);
            currentY += leafHeight + rowGap;
          });
        } else {
          currentY += branchHeight + rowGap;
        }

        const branchCenterY =
          isExpanded && items.length > 0
            ? startY + (currentY - startY - rowGap) / 2 - branchHeight / 2
            : startY;

        branchLayouts.push({
          branchIndex: bIdx,
          branchY: branchCenterY,
          branchHeight,
          leafNodes: leafNodesForBranch,
        });

        currentY += branchGroupGap;
      });

      const totalH = Math.max(560, currentY + 60);
      const totalW = leafX + leafWidth + 80;
      const rootY = Math.max(40, totalH / 2 - rootHeight / 2);

      // Root Node
      computedNodes.push({
        id: 'root',
        label: rootText,
        type: 'root',
        depth: 0,
        x: rootX,
        y: rootY,
        width: rootWidth,
        height: rootHeight,
        hasChildren: branches.length > 0,
        isExpanded: true,
      });

      // Branch & Leaf nodes with connections
      branchLayouts.forEach(bl => {
        const b = branches[bl.branchIndex];
        const isExpanded = Boolean(expandedBranches[bl.branchIndex]);
        const branchId = `branch-${bl.branchIndex}`;
        const branchTitle = typeof b === 'string' ? b : b.title || `Nhánh ${bl.branchIndex + 1}`;
        const itemsCount = (b.items ?? []).length;

        computedNodes.push({
          id: branchId,
          label: branchTitle,
          type: 'branch',
          parentId: 'root',
          depth: 1,
          x: branchX,
          y: bl.branchY,
          width: branchWidth,
          height: bl.branchHeight,
          hasChildren: itemsCount > 0,
          isExpanded,
          branchIndex: bl.branchIndex,
        });

        // Connection from Root (Right edge) -> Branch (Left edge)
        const rootOffset = nodeOffsets['root'] || { x: 0, y: 0 };
        const branchOffset = nodeOffsets[branchId] || { x: 0, y: 0 };

        computedConnections.push({
          id: `conn-root-${branchId}`,
          from: {
            x: rootX + rootWidth + rootOffset.x,
            y: rootY + rootHeight / 2 + rootOffset.y,
          },
          to: {
            x: branchX + branchOffset.x,
            y: bl.branchY + bl.branchHeight / 2 + branchOffset.y,
          },
        });

        // Connections from Branch (Right edge) -> Leaves (Left edge)
        if (isExpanded) {
          bl.leafNodes.forEach(leaf => {
            computedNodes.push(leaf);
            const leafOffset = nodeOffsets[leaf.id] || { x: 0, y: 0 };

            computedConnections.push({
              id: `conn-${branchId}-${leaf.id}`,
              from: {
                x: branchX + branchWidth + branchOffset.x,
                y: bl.branchY + bl.branchHeight / 2 + branchOffset.y,
              },
              to: {
                x: leaf.x + leafOffset.x,
                y: leaf.y + leaf.height / 2 + leafOffset.y,
              },
            });
          });
        }
      });

      return {
        nodes: computedNodes,
        connections: computedConnections,
        canvasWidth: totalW,
        canvasHeight: totalH,
      };
    } else {
      /* ── 2. VERTICAL LAYOUT (Top-to-Bottom / Spring Downwards) ─────────────── */
      const branchWidth = 280;
      const branchColGap = 32;
      const leafWidth = 280;
      const leafGap = 12;
      const rootY = 40;
      const branchY = 160;

      const numBranches = Math.max(1, branches.length);
      const totalColumnsWidth = numBranches * branchWidth + (numBranches - 1) * branchColGap;
      const startX = 60;

      const rootWidth = 320;
      const rootHeight = estimateNodeHeight(rootText, 28, 38, 20);
      const rootX = startX + totalColumnsWidth / 2 - rootWidth / 2;

      // Root Node
      computedNodes.push({
        id: 'root',
        label: rootText,
        type: 'root',
        depth: 0,
        x: rootX,
        y: rootY,
        width: rootWidth,
        height: rootHeight,
        hasChildren: branches.length > 0,
        isExpanded: true,
      });

      let maxVerticalY = branchY;

      branches.forEach((b, bIdx) => {
        const isExpanded = Boolean(expandedBranches[bIdx]);
        const branchTitle = typeof b === 'string' ? b : b.title || `Nhánh ${bIdx + 1}`;
        const branchHeight = estimateNodeHeight(branchTitle, 26, 28, 18);
        const colX = startX + bIdx * (branchWidth + branchColGap);
        const branchId = `branch-${bIdx}`;
        const items = Array.isArray(b.items) ? b.items : [];

        computedNodes.push({
          id: branchId,
          label: branchTitle,
          type: 'branch',
          parentId: 'root',
          depth: 1,
          x: colX,
          y: branchY,
          width: branchWidth,
          height: branchHeight,
          hasChildren: items.length > 0,
          isExpanded,
          branchIndex: bIdx,
        });

        // Connection from Root (Bottom edge) -> Branch (Top edge)
        const rootOffset = nodeOffsets['root'] || { x: 0, y: 0 };
        const branchOffset = nodeOffsets[branchId] || { x: 0, y: 0 };

        computedConnections.push({
          id: `conn-root-${branchId}`,
          from: {
            x: rootX + rootWidth / 2 + rootOffset.x,
            y: rootY + rootHeight + rootOffset.y,
          },
          to: {
            x: colX + branchWidth / 2 + branchOffset.x,
            y: branchY + branchOffset.y,
          },
        });

        let leafCurrentY = branchY + branchHeight + 28;

        if (isExpanded && items.length > 0) {
          items.forEach((item, itemIdx) => {
            const itemLabel = typeof item === 'string' ? item : (item as { title?: string }).title || 'Mục';
            const leafHeight = estimateNodeHeight(itemLabel, 26, 22, 18);
            const leafId = `leaf-${bIdx}-${itemIdx}`;

            const leafNode: NodeLayout = {
              id: leafId,
              label: itemLabel,
              type: 'leaf',
              parentId: branchId,
              depth: 2,
              x: colX,
              y: leafCurrentY,
              width: leafWidth,
              height: leafHeight,
              hasChildren: false,
              isExpanded: false,
              branchIndex: bIdx,
            };
            computedNodes.push(leafNode);

            // Connection from Parent Branch (or previous node) to Leaf
            const leafOffset = nodeOffsets[leafId] || { x: 0, y: 0 };

            computedConnections.push({
              id: `conn-${branchId}-${leafId}`,
              from: {
                x: colX + branchWidth / 2 + branchOffset.x,
                y: branchY + branchHeight + branchOffset.y,
              },
              to: {
                x: colX + leafWidth / 2 + leafOffset.x,
                y: leafCurrentY + leafOffset.y,
              },
            });

            leafCurrentY += leafHeight + leafGap;
          });
        }

        if (leafCurrentY > maxVerticalY) {
          maxVerticalY = leafCurrentY;
        }
      });

      const totalH = Math.max(580, maxVerticalY + 60);
      const totalW = Math.max(1100, startX + totalColumnsWidth + 80);

      return {
        nodes: computedNodes,
        connections: computedConnections,
        canvasWidth: totalW,
        canvasHeight: totalH,
      };
    }
  }, [root, courseTitle, branches, expandedBranches, orientation, nodeOffsets]);

  // Generate SVG Bezier Path based on Orientation
  const createCurvedPath = useCallback(
    (from: { x: number; y: number }, to: { x: number; y: number }) => {
      if (orientation === 'horizontal') {
        const dx = Math.abs(to.x - from.x);
        const cp1x = from.x + dx * 0.5;
        const cp1y = from.y;
        const cp2x = to.x - dx * 0.5;
        const cp2y = to.y;
        return `M ${from.x} ${from.y} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${to.x} ${to.y}`;
      } else {
        // Vertical path (top to bottom)
        const dy = Math.abs(to.y - from.y);
        const cp1x = from.x;
        const cp1y = from.y + dy * 0.5;
        const cp2x = to.x;
        const cp2y = to.y - dy * 0.5;
        return `M ${from.x} ${from.y} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${to.x} ${to.y}`;
      }
    },
    [orientation]
  );

  // Pan Canvas Handlers
  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setIsPanning(true);
    setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  // Node Dragging Handlers
  const handleNodeMouseDown = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDraggingNodeId(id);
    const current = nodeOffsets[id] || { x: 0, y: 0 };
    setNodeDragStart({
      x: e.clientX - current.x,
      y: e.clientY - current.y,
    });
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (draggingNodeId) {
        const newX = e.clientX - nodeDragStart.x;
        const newY = e.clientY - nodeDragStart.y;
        setNodeOffsets(prev => ({
          ...prev,
          [draggingNodeId]: { x: newX, y: newY },
        }));
      } else if (isPanning) {
        setPan({
          x: e.clientX - panStart.x,
          y: e.clientY - panStart.y,
        });
      }
    };

    const handleMouseUp = () => {
      setIsPanning(false);
      setDraggingNodeId(null);
    };

    if (isPanning || draggingNodeId) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isPanning, panStart, draggingNodeId, nodeDragStart]);

  // Zoom controls
  const handleZoom = (delta: number) => {
    setZoom(prev => Math.min(1.8, Math.max(0.4, Number((prev + delta).toFixed(2)))));
  };

  const handleResetView = () => {
    setPan({ x: 40, y: 40 });
    setZoom(1);
    setNodeOffsets({});
    notify('Đã đặt lại góc nhìn và vị trí');
  };

  // Export to PNG
  const handleExportPng = async () => {
    if (!canvasRef.current) return;
    setIsExporting(true);
    try {
      notify('Đang xuất ảnh PNG sơ đồ tư duy full văn bản…');
      const sanitizedName = (root || courseTitle || 'NotebookLM_Mindmap')
        .replace(/[^a-zA-Z0-9_\u00C0-\u024F\u1E00-\u1EFF]/g, '_')
        .slice(0, 35);
      await exportElementToPng(canvasRef.current, `${sanitizedName}_Mindmap_${orientation}`);
      notify('Đã tải ảnh PNG thành công!');
    } catch {
      notify('Không thể xuất ảnh PNG. Vui lòng thử lại.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="artifact notebook-mindmap-wrapper">
      {/* Top Header Toolbar */}
      <div className="artifact-head">
        <div>
          <h2>Sơ đồ: {root || courseTitle}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '4px', flexWrap: 'wrap' }}>
            {levelLabel && <span className="level-badge">{levelLabel}</span>}
            {topic && <small style={{ color: '#94a3b8' }}>Chủ đề: {topic}</small>}
            <small style={{ color: '#818cf8', marginLeft: '4px' }}>
              ✦ Toàn bộ văn bản rõ ràng · Bấm nút mũi tên để ẩn/hiện nhánh
            </small>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          {/* Orientation Toggle Button */}
          <button
            className="reconfigure-btn"
            style={{
              background: orientation === 'vertical' ? 'rgba(56, 189, 248, 0.2)' : 'rgba(124, 58, 237, 0.2)',
              borderColor: orientation === 'vertical' ? '#38bdf8' : '#8b5cf6',
              color: '#ffffff',
              fontWeight: 700,
            }}
            onClick={() => {
              const next = orientation === 'horizontal' ? 'vertical' : 'horizontal';
              setOrientation(next);
              setNodeOffsets({});
              notify(`Đã chuyển sang hướng ${next === 'horizontal' ? 'Ngang (Left-to-Right)' : 'Dọc (Top-to-Bottom)'}`);
            }}
            title="Chuyển đổi giữa sơ đồ dạng ngang và dọc"
          >
            {orientation === 'horizontal' ? '⇄ Hướng Ngang' : '⇅ Hướng Dọc'}
          </button>

          {onReconfigure && (
            <button className="reconfigure-btn" onClick={onReconfigure}>
              🔄 Đổi cấp độ / Tạo lại
            </button>
          )}

          <button className="reconfigure-btn" onClick={expandAll} title="Mở rộng toàn bộ nhánh">
            👁 Mở rộng
          </button>

          <button className="reconfigure-btn" onClick={collapseAll} title="Thu gọn toàn bộ nhánh">
            ⊞ Thu gọn
          </button>

          <button className="reconfigure-btn" onClick={handleResetView} title="Đặt lại góc nhìn">
            ↺ Đặt lại
          </button>

          <button
            className="reconfigure-btn"
            style={{ background: 'rgba(124, 58, 237, 0.25)', borderColor: '#8b5cf6', color: '#ffffff' }}
            onClick={handleExportPng}
            disabled={isExporting}
          >
            {isExporting ? 'Đang xuất…' : '🖼 Xuất PNG'}
          </button>

          <button
            onClick={() => {
              window.print();
              notify('Đã mở hộp thoại in / xuất PDF');
            }}
          >
            ↓ In / PDF
          </button>
        </div>
      </div>

      {/* Interactive Infinite Canvas Container */}
      <div
        className="notebook-canvas-container"
        ref={containerRef}
        onMouseDown={handleCanvasMouseDown}
        style={{ cursor: isPanning ? 'grabbing' : 'grab' }}
      >
        {/* Floating Zoom Controls */}
        <div className="canvas-zoom-controls">
          <button type="button" onClick={() => handleZoom(0.15)} title="Phóng to">＋</button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => handleZoom(-0.15)} title="Thu nhỏ">－</button>
          <button type="button" onClick={handleResetView} title="Căn giữa">⊙</button>
        </div>

        {/* Scaled and Panned Canvas */}
        <div
          className="notebook-mindmap-canvas"
          ref={canvasRef}
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: '0 0',
            width: `${canvasWidth}px`,
            minHeight: `${canvasHeight}px`,
          }}
        >
          {/* SVG Smooth Curved Connection Lines */}
          <svg className="notebook-connections-svg" width={canvasWidth} height={canvasHeight}>
            <defs>
              <linearGradient id="curveGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.9" />
                <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.9" />
              </linearGradient>
              <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="2.5" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>
            </defs>

            {connections.map(conn => {
              const pathD = createCurvedPath(conn.from, conn.to);
              return (
                <g key={conn.id}>
                  {/* Outer dark stroke for high contrast */}
                  <path
                    d={pathD}
                    fill="none"
                    stroke="rgba(10, 8, 28, 0.85)"
                    strokeWidth="5"
                    strokeLinecap="round"
                  />
                  {/* Glowing gradient line */}
                  <path
                    d={pathD}
                    fill="none"
                    stroke="url(#curveGradient)"
                    strokeWidth="2.4"
                    strokeLinecap="round"
                    filter="url(#glow)"
                  />
                  {/* Connection Anchor Dots */}
                  <circle cx={conn.from.x} cy={conn.from.y} r="3.5" fill="#8b5cf6" />
                  <circle cx={conn.to.x} cy={conn.to.y} r="3.5" fill="#38bdf8" />
                </g>
              );
            })}
          </svg>

          {/* Full-Text HTML Interactive Nodes */}
          {nodes.map(node => {
            const offset = nodeOffsets[node.id] || { x: 0, y: 0 };
            const posX = node.x + offset.x;
            const posY = node.y + offset.y;
            const isDragging = draggingNodeId === node.id;

            if (node.type === 'root') {
              return (
                <div
                  key={node.id}
                  className={`notebook-node node-root ${isDragging ? 'is-dragging' : ''}`}
                  style={{
                    left: `${posX}px`,
                    top: `${posY}px`,
                    width: `${node.width}px`,
                    minHeight: `${node.height}px`,
                  }}
                  onMouseDown={e => handleNodeMouseDown(node.id, e)}
                >
                  <div className="node-content full-text">
                    <span className="node-badge">TRỌNG TÂM</span>
                    <strong className="full-text-title">{node.label}</strong>
                  </div>
                  {orientation === 'horizontal' ? (
                    <div className="node-anchor right" />
                  ) : (
                    <div className="node-anchor bottom" />
                  )}
                </div>
              );
            }

            if (node.type === 'branch') {
              const bIdx = node.branchIndex ?? 0;
              const isExpanded = node.isExpanded;
              const accentClass = `accent-${(bIdx % 5) + 1}`;

              return (
                <div
                  key={node.id}
                  className={`notebook-node node-branch ${accentClass} ${isDragging ? 'is-dragging' : ''} ${isExpanded ? 'is-expanded' : ''}`}
                  style={{
                    left: `${posX}px`,
                    top: `${posY}px`,
                    width: `${node.width}px`,
                    minHeight: `${node.height}px`,
                  }}
                  onMouseDown={e => handleNodeMouseDown(node.id, e)}
                >
                  {orientation === 'horizontal' ? (
                    <div className="node-anchor left" />
                  ) : (
                    <div className="node-anchor top" />
                  )}

                  <div className="node-content full-text">
                    <span className="branch-color-bar" />
                    <span className="branch-label full-text-content">
                      {node.label}
                    </span>
                  </div>

                  {node.hasChildren && (
                    <button
                      type="button"
                      className="node-toggle-btn"
                      onClick={e => {
                        e.stopPropagation();
                        toggleBranch(bIdx);
                      }}
                      title={isExpanded ? 'Thu gọn nhánh này' : 'Mở rộng nhánh này'}
                    >
                      {isExpanded ? '▾' : '▸'}
                    </button>
                  )}

                  {orientation === 'horizontal' ? (
                    <div className="node-anchor right" />
                  ) : (
                    <div className="node-anchor bottom" />
                  )}
                </div>
              );
            }

            // Leaf Node
            const bIdx = node.branchIndex ?? 0;
            const accentClass = `accent-${(bIdx % 5) + 1}`;

            return (
              <div
                key={node.id}
                className={`notebook-node node-leaf ${accentClass} ${isDragging ? 'is-dragging' : ''}`}
                style={{
                  left: `${posX}px`,
                  top: `${posY}px`,
                  width: `${node.width}px`,
                  minHeight: `${node.height}px`,
                }}
                onMouseDown={e => handleNodeMouseDown(node.id, e)}
              >
                {orientation === 'horizontal' ? (
                  <div className="node-anchor left" />
                ) : (
                  <div className="node-anchor top" />
                )}

                <div className="node-content full-text">
                  <span className="leaf-bullet">•</span>
                  <span className="leaf-label full-text-content">
                    {node.label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
