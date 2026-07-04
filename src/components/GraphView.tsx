import React, { useMemo, useState, useEffect, useRef, Suspense } from 'react';
import { useAppStore, GraphNode, GraphLink } from '../store/appStore';
import ForceGraph2D, { ForceGraphMethods as ForceGraph2DMethods, NodeObject, LinkObject } from 'react-force-graph-2d';
import { RefreshCw, Layers } from 'lucide-react';
import * as THREE from 'three';
import { GraphErrorBoundary } from './GraphErrorBoundary';
import type { ForceGraphMethods as ForceGraph3DMethods, ForceGraphProps as ForceGraph3DProps } from 'react-force-graph-3d';

// Lazy load the 3D Force Graph and Three.js as requested with strict generic props
const ForceGraph3D = React.lazy(() => import('react-force-graph-3d')) as unknown as React.ComponentType<
  ForceGraph3DProps<GraphNode, GraphLink> & {
    ref?: React.MutableRefObject<ForceGraph3DMethods<GraphNode, GraphLink> | undefined>;
  }
>;

// Helper to convert hex to RGBA for canvas rendering
function hexToRgba(hex: string, alpha: number): string {
  const cleanHex = hex.replace('#', '');
  const r = parseInt(cleanHex.substring(0, 2), 16);
  const g = parseInt(cleanHex.substring(2, 4), 16);
  const b = parseInt(cleanHex.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function hexToRgb(hex: string) {
  const cleanHex = hex.replace('#', '');
  const r = parseInt(cleanHex.substring(0, 2), 16);
  const g = parseInt(cleanHex.substring(2, 4), 16);
  const b = parseInt(cleanHex.substring(4, 6), 16);
  return { r, g, b };
}

function interpolateColor(color1: string, color2: string, factor: number): string {
  const f = Math.max(0, Math.min(1, factor));
  const c1 = hexToRgb(color1);
  const c2 = hexToRgb(color2);
  const r = Math.round(c1.r + (c2.r - c1.r) * f);
  const g = Math.round(c1.g + (c2.g - c1.g) * f);
  const b = Math.round(c1.b + (c2.b - c1.b) * f);
  return `rgb(${r}, ${g}, ${b})`;
}

// Line-rectangle intersection check for precise edge culling
function lineIntersectsRect(
  x1: number, y1: number,
  x2: number, y2: number,
  xmin: number, ymin: number,
  xmax: number, ymax: number
): boolean {
  if (x1 >= xmin && x1 <= xmax && y1 >= ymin && y1 <= ymax) return true;
  if (x2 >= xmin && x2 <= xmax && y2 >= ymin && y2 <= ymax) return true;

  const intersect = (
    ax: number, ay: number, bx: number, by: number,
    cx: number, cy: number, dx: number, dy: number
  ): boolean => {
    const det = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
    if (det === 0) return false;
    const lambda = ((dy - cy) * (dx - ax) + (cx - dx) * (dy - ay)) / det;
    const gamma = ((ay - by) * (dx - ax) + (ax - bx) * (dy - ay)) / det;
    return (0 <= lambda && lambda <= 1) && (0 <= gamma && gamma <= 1);
  };

  if (intersect(x1, y1, x2, y2, xmin, ymin, xmax, ymin)) return true;
  if (intersect(x1, y1, x2, y2, xmin, ymax, xmax, ymax)) return true;
  if (intersect(x1, y1, x2, y2, xmin, ymin, xmin, ymax)) return true;
  if (intersect(x1, y1, x2, y2, xmax, ymin, xmax, ymax)) return true;

  return false;
}

function getLinkId(val: string | number | NodeObject<GraphNode> | undefined): string {
  if (!val) return '';
  if (typeof val === 'object') return String(val.id ?? '');
  return String(val);
}

const isPathEqual = (pathA: string | null | undefined, pathB: string | null | undefined): boolean => {
  if (!pathA || !pathB) return false;
  const isWindows = useAppStore.getState().platform === 'windows';
  const cleanA = pathA.replace(/\\/g, '/');
  const cleanB = pathB.replace(/\\/g, '/');
  return isWindows ? cleanA.toLowerCase() === cleanB.toLowerCase() : cleanA === cleanB;
};

const GraphViewInner: React.FC = () => {
  const {
    graphData,
    graphViewMode,
    graphSearchQuery,
    matchingPaths,
    activeTab,
    isGraphSimulating,
    loadGraphData,
    toggleGraphViewMode,
    openTab,
    theme,
    platform
  } = useAppStore();

  const isMac = platform === 'darwin' || platform === 'macos';
  const mod = isMac ? '⌘ Cmd' : 'Ctrl';

  const colors = useMemo(() => {
    const style = getComputedStyle(document.documentElement);
    const getVar = (name: string) => style.getPropertyValue(name).trim();
    return {
      accent: getVar('--accent'),
      accentBright: getVar('--accent-bright'),
      accentDim: getVar('--accent-dim'),
      accentMuted: getVar('--accent-muted'),
      voidBg: getVar('--substrate-void'),
      border: getVar('--border-default'),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);

  const [hoveredNode, setHoveredNode] = useState<GraphNode | null>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<ForceGraph2DMethods<GraphNode, GraphLink> | ForceGraph3DMethods<GraphNode, GraphLink> | null>(null);

  const [windowFocused, setWindowFocused] = useState(true);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [transitionProgress, setTransitionProgress] = useState(0);
  const transitionProgressRef = useRef(0);

  useEffect(() => {
    transitionProgressRef.current = transitionProgress;
  }, [transitionProgress]);

  // WebGL Cleanup upon mode switch or unmount to prevent GPU memory leaks.
  // BUG-05 (fix): NÃO forçar perda de contexto (forceContextLoss/loseContext) — no WebView2,
  // matar o contexto na mão envenenava o contexto do PRÓXIMO mount (canvas novo nascia com
  // isContextLost()=true, drawingBuffer 0x0 → grafo BRANCO ao abrir/fechar nota). O toggle
  // 2D↔3D "consertava" porque nesse caminho o cleanup era no-op (instância 2D sem renderer).
  // renderer.dispose() + dispose de geometria/material + scene.clear() já liberam a GPU;
  // o contexto morre com o canvas no GC.
  useEffect(() => {
    const fgInstance = fgRef.current;
    return () => {
      if (fgInstance && 'renderer' in fgInstance) {
        try {
          const forceGraph3D = fgInstance as ForceGraph3DMethods<GraphNode, GraphLink>;
          const renderer = forceGraph3D.renderer();
          if (renderer) {
            renderer.dispose();
          }
          const scene = forceGraph3D.scene();
          if (scene) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            scene.traverse((object: any) => {
              if (object.geometry) {
                object.geometry.dispose();
              }
              if (object.material) {
                if (Array.isArray(object.material)) {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  object.material.forEach((mat: any) => mat.dispose());
                } else {
                  object.material.dispose();
                }
              }
            });
            scene.clear();
          }
        } catch (e) {
          console.error('Falha ao limpar contexto WebGL:', e);
        }
      }
    };
  }, [graphViewMode]);

  // Monitor window focus/blur to freeze animation
  useEffect(() => {
    const handleFocus = () => setWindowFocused(true);
    const handleBlur = () => setWindowFocused(false);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  // Monitor prefers-reduced-motion media query
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mediaQuery.matches);
    const handleChange = (e: MediaQueryListEvent) => {
      setPrefersReducedMotion(e.matches);
    };
    mediaQuery.addEventListener('change', handleChange);
    return () => {
      mediaQuery.removeEventListener('change', handleChange);
    };
  }, []);

  // Interpolate search transition state smoothly (duration-slow / ease-organic)
  useEffect(() => {
    const target = graphSearchQuery.trim() !== '' ? 1 : 0;
    if (prefersReducedMotion) {
      setTransitionProgress(target);
      return;
    }

    const duration = 400; // duration-slow: 400ms
    const startValue = transitionProgressRef.current;
    const startTime = performance.now();

    let frameId: number;
    const animate = (time: number) => {
      const elapsed = time - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      // Easing: organic (in-out cubic)
      const eased = progress < 0.5 
        ? 4 * progress * progress * progress 
        : 1 - Math.pow(-2 * progress + 2, 3) / 2;

      const currentValue = startValue + (target - startValue) * eased;
      setTransitionProgress(currentValue);

      if (progress < 1) {
        frameId = requestAnimationFrame(animate);
      }
    };

    frameId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameId);
  }, [graphSearchQuery, prefersReducedMotion]);

  // Load graph data on mount
  useEffect(() => {
    loadGraphData();
  }, [loadGraphData]);

  // Force graph updates when search state changes
  useEffect(() => {
    if (fgRef.current) {
      if ('refresh' in fgRef.current && typeof fgRef.current.refresh === 'function') {
        fgRef.current.refresh();
      } else if ('resumeAnimation' in fgRef.current && typeof fgRef.current.resumeAnimation === 'function') {
        fgRef.current.resumeAnimation();
      }
    }
  }, [graphSearchQuery, matchingPaths, activeTab, hoveredNode]);

  // Wake up 2D graph redraw loop when active tab or theme changes programmatically
  useEffect(() => {
    if (fgRef.current && 'resumeAnimation' in fgRef.current && typeof fgRef.current.resumeAnimation === 'function') {
      fgRef.current.resumeAnimation();
    }
  }, [activeTab, theme]);

  // Handle container resizing
  useEffect(() => {
    if (!containerRef.current) return;
    const resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height
        });
      }
    });
    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  // Compute maximum degree in the graph for radius scaling normalization
  const maxDegree = useMemo(() => {
    if (!graphData || !graphData.nodes.length) return 1;
    return Math.max(...graphData.nodes.map(n => n.degree || 0), 1);
  }, [graphData]);

  // Compute node radius: 3px to 10px proportional to connection degree
  const getRadius = (node: GraphNode) => {
    const minRadius = 3;
    const maxRadius = 10;
    const degree = node.degree || 0;
    const ratio = degree / maxDegree;
    return minRadius + (maxRadius - minRadius) * ratio;
  };

  // Node drawing callback for Canvas 2D
  const drawNode = (node: NodeObject<GraphNode>, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const baseRadius = getRadius(node);
    const isHovered = hoveredNode?.id === node.id;
    const isSelected = isPathEqual(activeTab, node.id);
    const isMatch = matchingPaths.has(node.id);
    const queryActive = graphSearchQuery.trim() !== '';

    let scaleFactor = 1.0;
    if (queryActive && isMatch && windowFocused && !prefersReducedMotion) {
      const time = performance.now();
      scaleFactor = 1.0 + 0.25 * Math.sin(time * 0.006);
    } else if (isHovered && isSelected) {
      scaleFactor = 1.25;
    } else if (isSelected) {
      scaleFactor = 1.15; // Selected node is slightly larger (DS §6)
    } else if (isHovered) {
      scaleFactor = 1.15;
    }

    const radius = baseRadius * scaleFactor;
    const nx = node.x ?? 0;
    const ny = node.y ?? 0;

    // Viewport coordinates check for Culling
    const transform = ctx.getTransform();
    const scale = transform.a;
    const xmin = -transform.e / scale;
    const ymin = -transform.f / scale;
    const xmax = (ctx.canvas.width - transform.e) / scale;
    const ymax = (ctx.canvas.height - transform.f) / scale;

    const cullRadius = radius * 5.5; // include wider glow radius
    if (
      nx + cullRadius < xmin ||
      nx - cullRadius > xmax ||
      ny + cullRadius < ymin ||
      ny - cullRadius > ymax
    ) {
      return; // Culled!
    }

    const showDetail = globalScale >= 1.5;

    // Radial gradient glow halo (bloom bioluminescente pleno)
    const shouldShowGlow = theme === 'dark' && (isHovered || isSelected || (queryActive && isMatch));
    if (showDetail && shouldShowGlow) {
      let glowColor = colors.accent;
      if (isSelected || (queryActive && isMatch)) {
        glowColor = colors.accentBright;
      }
      
      ctx.save();
      const glowScale = (queryActive && isMatch) ? 3.8 : 3.5;
      const grad = ctx.createRadialGradient(nx, ny, radius, nx, ny, radius * glowScale);
      
      let glowAlphaBase = 0.35;
      if (queryActive && isMatch) {
        glowAlphaBase = 0.30 * transitionProgress;
      } else if (queryActive && !isMatch) {
        glowAlphaBase = 0.35 * (1 - transitionProgress);
      }
      
      grad.addColorStop(0, hexToRgba(glowColor, glowAlphaBase));
      grad.addColorStop(0.3, hexToRgba(glowColor, glowAlphaBase * 0.33));
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(nx, ny, radius * glowScale, 0, 2 * Math.PI);
      ctx.fill();
      ctx.restore();
    }

    // Draw main circle node
    ctx.beginPath();
    ctx.arc(nx, ny, radius, 0, 2 * Math.PI);

    let baseColor = colors.accentDim;
    if (isSelected) {
      baseColor = colors.accentBright;
    } else if (isHovered) {
      baseColor = colors.accent;
    }

    if (node.exists) {
      if (queryActive) {
        if (isMatch) {
          ctx.fillStyle = interpolateColor(baseColor, colors.accentBright, transitionProgress);
        } else {
          const targetOpacity = theme === 'light' ? 0.3 : 0.1;
          const opacity = 1.0 - (1.0 - targetOpacity) * transitionProgress;
          ctx.fillStyle = hexToRgba(baseColor, opacity);
        }
      } else {
        if (transitionProgress > 0) {
          const targetOpacity = theme === 'light' ? 0.3 : 0.1;
          const opacity = targetOpacity + (1.0 - targetOpacity) * (1 - transitionProgress);
          ctx.fillStyle = hexToRgba(baseColor, opacity);
        } else {
          ctx.fillStyle = baseColor;
        }
      }
      ctx.fill();
    } else {
      // Phantom node: hollow outline with dashed stroke
      ctx.save();
      const strokeColor = isHovered ? colors.accent : colors.accentDim;
      ctx.lineWidth = 1.2 / globalScale;
      ctx.setLineDash([3, 3]);
      
      if (queryActive) {
        if (isMatch) {
          ctx.strokeStyle = interpolateColor(strokeColor, colors.accentBright, transitionProgress);
        } else {
          const targetOpacity = theme === 'light' ? 0.3 : 0.1;
          const opacity = 1.0 - (1.0 - targetOpacity) * transitionProgress;
          ctx.strokeStyle = hexToRgba(strokeColor, opacity);
        }
      } else {
        if (transitionProgress > 0) {
          const targetOpacity = theme === 'light' ? 0.3 : 0.1;
          const opacity = targetOpacity + (1.0 - targetOpacity) * (1 - transitionProgress);
          ctx.strokeStyle = hexToRgba(strokeColor, opacity);
        } else {
          ctx.strokeStyle = strokeColor;
        }
      }
      ctx.beginPath();
      ctx.arc(nx, ny, radius, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.restore();
    }

    // Render node label (Outfit/Inter/sans-serif font matching Design System)
    if (showDetail) {
      const label = node.label || '';
      ctx.save();
      ctx.font = `${Math.max(11 / globalScale, 6)}px Outfit, Inter, sans-serif`;
      
      let baseLabelColor = colors.accentDim;
      if (isSelected) {
        baseLabelColor = colors.accentBright;
      } else if (isHovered) {
        baseLabelColor = colors.accent;
      }

      if (queryActive) {
        if (isMatch) {
          ctx.fillStyle = interpolateColor(baseLabelColor, colors.accentBright, transitionProgress);
        } else {
          const targetOpacity = theme === 'light' ? 0.3 : 0.1;
          const opacity = 1.0 - (1.0 - targetOpacity) * transitionProgress;
          ctx.fillStyle = hexToRgba(baseLabelColor, opacity);
        }
      } else {
        if (transitionProgress > 0) {
          const targetOpacity = theme === 'light' ? 0.3 : 0.1;
          const opacity = targetOpacity + (1.0 - targetOpacity) * (1 - transitionProgress);
          ctx.fillStyle = hexToRgba(baseLabelColor, opacity);
        } else {
          ctx.fillStyle = baseLabelColor;
        }
      }
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(label, nx, ny + radius + 3.5);
      ctx.restore();
    }
  };

  // Edge drawing callback for Canvas 2D
  const drawLink = (link: LinkObject<GraphNode, GraphLink>, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const source = link.source;
    const target = link.target;
    if (!source || !target || typeof source !== 'object' || typeof target !== 'object') return;

    const sNode = source as NodeObject<GraphNode>;
    const tNode = target as NodeObject<GraphNode>;

    const x1 = sNode.x ?? 0;
    const y1 = sNode.y ?? 0;
    const x2 = tNode.x ?? 0;
    const y2 = tNode.y ?? 0;

    // Viewport boundaries for Culling
    const transform = ctx.getTransform();
    const scale = transform.a;
    const xmin = -transform.e / scale;
    const ymin = -transform.f / scale;
    const xmax = (ctx.canvas.width - transform.e) / scale;
    const ymax = (ctx.canvas.height - transform.f) / scale;

    // Precise segment-rectangle intersection check
    if (!lineIntersectsRect(x1, y1, x2, y2, xmin, ymin, xmax, ymax)) {
      return; // Culled!
    }

    const sourceId = getLinkId(sNode);
    const targetId = getLinkId(tNode);
    const isConnectedToSelected = isPathEqual(sourceId, activeTab) || isPathEqual(targetId, activeTab);
    const queryActive = graphSearchQuery.trim() !== '';
    const matchSource = matchingPaths.has(sourceId);
    const matchTarget = matchingPaths.has(targetId);

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    
    if (queryActive) {
      if (matchSource && matchTarget) {
        const opacity = 0.12 + 0.23 * transitionProgress; // transitions from 0.12 to 0.35
        ctx.strokeStyle = hexToRgba(colors.accentDim, opacity);
        ctx.lineWidth = (0.6 + 0.1 * transitionProgress) / globalScale;
      } else {
        const opacity = 0.12 - 0.10 * transitionProgress; // smooth transition down to 0.02
        const startColor = isConnectedToSelected ? colors.accent : colors.accentDim;
        ctx.strokeStyle = hexToRgba(startColor, opacity);
        ctx.lineWidth = (isConnectedToSelected ? 1.6 - 1.0 * transitionProgress : 0.6) / globalScale;
      }
    } else {
      if (transitionProgress > 0) {
        if (matchSource && matchTarget) {
          const opacity = 0.12 + 0.23 * transitionProgress;
          ctx.strokeStyle = hexToRgba(colors.accentDim, opacity);
          ctx.lineWidth = (0.6 + 0.1 * transitionProgress) / globalScale;
        } else {
          const opacity = 0.02 + 0.10 * (1 - transitionProgress);
          ctx.strokeStyle = hexToRgba(isConnectedToSelected ? colors.accent : colors.accentDim, opacity);
          ctx.lineWidth = (isConnectedToSelected ? 1.6 : 0.6) / globalScale;
        }
      } else {
        if (isConnectedToSelected) {
          ctx.strokeStyle = colors.accent; // Active connection
          ctx.lineWidth = 1.6 / globalScale;
        } else {
          ctx.strokeStyle = hexToRgba(colors.accentDim, 0.12); // Dormant
          ctx.lineWidth = 0.6 / globalScale;
        }
      }
    }
    
    ctx.stroke();
    ctx.restore();
  };

  // Shared geometry for performance in 3D mode
  const sphereGeometry = useMemo(() => new THREE.SphereGeometry(1, 12, 12), []);

  const nodeThreeObject = (node: NodeObject<GraphNode>): THREE.Object3D => {
    const r = getRadius(node);
    const material = new THREE.MeshBasicMaterial({ color: colors.accentDim });
    const mesh = new THREE.Mesh(sphereGeometry, material);
    mesh.scale.set(r, r, r);
    mesh.userData = { id: node.id, baseRadius: r, material };
    return mesh;
  };

  // Loop to handle pulsing and updating 3D node colors/scales in real-time
  useEffect(() => {
    let animationFrameId: number;
    
    const update3DNodes = () => {
      if (graphViewMode === '3d' && fgRef.current) {
        const fg = fgRef.current;
        const scene = (fg && 'scene' in fg) ? (fg as ForceGraph3DMethods<GraphNode, GraphLink>).scene() : null;
        if (scene) {
          const time = performance.now();
          const queryActive = graphSearchQuery.trim() !== '';
          
          scene.traverse((obj: THREE.Object3D) => {
            if (obj instanceof THREE.Mesh && obj.userData && obj.userData.id) {
              const nodeId = obj.userData.id as string;
              const baseRadius = obj.userData.baseRadius as number;
              const material = obj.userData.material as THREE.MeshBasicMaterial;
              
              const isSelected = isPathEqual(activeTab, nodeId);
              const isHovered = hoveredNode?.id === nodeId;
              const isMatch = matchingPaths.has(nodeId);
              
              // 1. Determine target color
              let colorStr = colors.accentDim;
              if (isSelected) {
                colorStr = colors.accentBright;
              } else if (isHovered) {
                colorStr = colors.accent;
              }

              let finalColor = colorStr;
              let finalOpacity = 1.0;
              let isTransparent = false;

              if (queryActive) {
                if (isMatch) {
                  finalColor = interpolateColor(colorStr, colors.accentBright, transitionProgress);
                } else {
                  finalOpacity = 1.0 - 0.85 * transitionProgress; // down to 0.15
                  isTransparent = true;
                }
              } else if (transitionProgress > 0) {
                if (isMatch) {
                  finalColor = interpolateColor(colorStr, colors.accentBright, transitionProgress);
                } else {
                  finalOpacity = 0.15 + 0.85 * (1 - transitionProgress);
                  isTransparent = true;
                }
              }
              
              if (material) {
                material.color.set(finalColor);
                material.transparent = isTransparent;
                material.opacity = finalOpacity;
              }
              
              // 2. Determine scale with pulse
              let scaleFactor = 1.0;
              if (queryActive && isMatch && windowFocused && !prefersReducedMotion) {
                scaleFactor = 1.0 + 0.25 * Math.sin(time * 0.006);
              } else if (isHovered && isSelected) {
                scaleFactor = 1.25;
              } else if (isSelected) {
                scaleFactor = 1.15; // Selected node is slightly larger (DS §6)
              } else if (isHovered) {
                scaleFactor = 1.15;
              }
              
              const finalScale = baseRadius * scaleFactor;
              obj.scale.set(finalScale, finalScale, finalScale);
            }
          });
        }
      }
      animationFrameId = requestAnimationFrame(update3DNodes);
    };
    
    animationFrameId = requestAnimationFrame(update3DNodes);
    return () => cancelAnimationFrame(animationFrameId);
  }, [graphViewMode, graphSearchQuery, matchingPaths, activeTab, hoveredNode, windowFocused, prefersReducedMotion, transitionProgress, sphereGeometry, colors]);

  const handleNodeClick = (node: NodeObject<GraphNode>) => {
    if (node.exists && typeof node.id === 'string') {
      openTab(node.id);
    }
  };

  return (
    <div 
      ref={containerRef} 
      className="relative w-full h-full flex flex-col items-center justify-center overflow-hidden select-none"
      style={{
        backgroundColor: colors.voidBg,
        backgroundImage: `radial-gradient(circle at center, ${hexToRgba(colors.accentMuted, theme === 'dark' ? 0.3 : 0.4)} 0%, ${colors.voidBg} 100%)`
      }}
    >
      {/* Floating Control Panel */}
      <div 
        className="absolute top-4 left-4 z-50 flex items-center gap-3 p-1.5 rounded-lg backdrop-blur-md shadow-xl transition-all duration-300"
        style={{
          border: `1px solid ${hexToRgba(colors.accentDim, 0.2)}`,
          backgroundColor: hexToRgba(colors.voidBg, 0.85),
        }}
      >
        {/* Toggle Mode Button */}
        <button
          onClick={toggleGraphViewMode}
          className="flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-all duration-200 cursor-pointer"
          style={{
            color: colors.accent,
            backgroundColor: hexToRgba(colors.accent, 0.08)
          }}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>{graphViewMode === '2d' ? 'Modo 3D' : 'Modo 2D'}</span>
        </button>

        <div className="h-4 w-px" style={{ backgroundColor: hexToRgba(colors.accentDim, 0.2) }} />

        {/* Recalculate Layout Button */}
        <button
          onClick={() => loadGraphData()}
          title={`Recalcular Layout (${mod} + Shift + R)`}
          className="p-1.5 rounded-md active:scale-95 transition-all duration-150 cursor-pointer"
          style={{
            color: colors.accentDim,
          }}
          onMouseEnter={(e) => e.currentTarget.style.color = colors.accent}
          onMouseLeave={(e) => e.currentTarget.style.color = colors.accentDim}
        >
          <RefreshCw className="w-4 h-4 animate-hover" />
        </button>
      </div>

      {/* Dynamic Graph Legend */}
      <div 
        className="absolute bottom-4 right-4 z-50 flex flex-col gap-1.5 p-3 rounded-lg backdrop-blur-sm text-[10px]"
        style={{
          border: `1px solid ${hexToRgba(colors.accentDim, 0.15)}`,
          backgroundColor: hexToRgba(colors.voidBg, 0.8),
          color: colors.accentDim,
        }}
      >
        <div className="flex items-center gap-2">
          <div 
            className="w-2 h-2 rounded-full" 
            style={{ 
              backgroundColor: colors.accentBright,
              boxShadow: theme === 'dark' ? `0 0 4px ${colors.accentBright}` : 'none' 
            }} 
          />
          <span style={{ color: colors.accentBright }}>Nota Ativa (Selecionada)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: colors.accentDim }} />
          <span>Nota Existente</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full border border-dashed" style={{ borderColor: colors.accentDim }} />
          <span>Nota Inexistente (Link)</span>
        </div>
      </div>

      {/* Bioluminescent Simulation Indicator */}
      {isGraphSimulating && (
        <div 
          className="absolute bottom-4 left-4 z-50 flex items-center gap-2 px-3 py-1.5 rounded-lg shadow-xl text-[10px] transition-all duration-300"
          style={{
            border: `1px solid ${hexToRgba(colors.accent, 0.2)}`,
            backgroundColor: hexToRgba(colors.voidBg, 0.9),
            color: colors.accent
          }}
        >
          <RefreshCw className="w-3 h-3 animate-spin" style={{ color: colors.accent }} />
          <span className="font-medium tracking-wide">Calculando layout do grafo ({graphViewMode === '2d' ? '2D' : '3D'})...</span>
        </div>
      )}

      {/* Render graph */}
      {graphData && graphData.nodes.length > 0 ? (
        graphViewMode === '2d' ? (
          <ForceGraph2D
            ref={fgRef as React.MutableRefObject<ForceGraph2DMethods<GraphNode, GraphLink> | undefined>}
            width={dimensions.width}
            height={dimensions.height}
            graphData={graphData}
            nodeCanvasObject={drawNode}
            linkCanvasObject={drawLink}
            onNodeClick={handleNodeClick}
            onNodeHover={(node) => setHoveredNode(node as GraphNode | null)}
            cooldownTicks={0} // Disable main thread force physics!
            backgroundColor={colors.voidBg}
            autoPauseRedraw={!graphSearchQuery.trim()}
          />
        ) : (
          <Suspense fallback={
            <div className="flex flex-col items-center gap-3 text-xs" style={{ color: colors.accent }}>
              <RefreshCw className="w-5 h-5 animate-spin" />
              <span>Carregando Three.js & Engine 3D...</span>
            </div>
          }>
            <ForceGraph3D
              ref={fgRef as React.MutableRefObject<ForceGraph3DMethods<GraphNode, GraphLink> | undefined>}
              width={dimensions.width}
              height={dimensions.height}
              graphData={graphData}
              cooldownTicks={0} // Disable main thread force physics!
              backgroundColor={colors.voidBg}
              nodeThreeObject={nodeThreeObject}
              onNodeClick={handleNodeClick}
              onNodeHover={(node) => setHoveredNode(node as GraphNode | null)}
              linkColor={(link: LinkObject<GraphNode, GraphLink>) => {
                const queryActive = graphSearchQuery.trim() !== '';
                const sourceId = getLinkId(link.source);
                const targetId = getLinkId(link.target);
                const isConnected = isPathEqual(sourceId, activeTab) || isPathEqual(targetId, activeTab);
                
                if (queryActive) {
                  const matchSource = matchingPaths.has(sourceId);
                  const matchTarget = matchingPaths.has(targetId);
                  if (matchSource && matchTarget) {
                    return interpolateColor(colors.accentDim, colors.accentBright, transitionProgress);
                  }
                  // Dim non-matches
                  const opacity = 0.15 - 0.13 * transitionProgress; // transition from 0.15 to 0.02
                  return hexToRgba(isConnected ? colors.accent : colors.accentDim, opacity);
                } else {
                  if (transitionProgress > 0) {
                    const matchSource = matchingPaths.has(sourceId);
                    const matchTarget = matchingPaths.has(targetId);
                    if (matchSource && matchTarget) {
                      return interpolateColor(colors.accentDim, colors.accentBright, transitionProgress);
                    }
                    const opacity = 0.02 + 0.13 * (1 - transitionProgress);
                    return hexToRgba(isConnected ? colors.accent : colors.accentDim, opacity);
                  }
                  return isConnected ? colors.accent : hexToRgba(colors.accentDim, 0.15);
                }
              }}
              linkWidth={(link: LinkObject<GraphNode, GraphLink>) => {
                const queryActive = graphSearchQuery.trim() !== '';
                const sourceId = getLinkId(link.source);
                const targetId = getLinkId(link.target);
                const isConnected = isPathEqual(sourceId, activeTab) || isPathEqual(targetId, activeTab);
                
                if (queryActive) {
                  const matchSource = matchingPaths.has(sourceId);
                  const matchTarget = matchingPaths.has(targetId);
                  if (matchSource && matchTarget) {
                    return 0.5 + 1.1 * transitionProgress; // transitions from 0.5 to 1.6
                  }
                  return 0.5 - 0.3 * transitionProgress; // transitions from 0.5 to 0.2
                } else {
                  if (transitionProgress > 0) {
                    const matchSource = matchingPaths.has(sourceId);
                    const matchTarget = matchingPaths.has(targetId);
                    if (matchSource && matchTarget) {
                      return 0.5 + 1.1 * transitionProgress;
                    }
                    return 0.2 + 0.3 * (1 - transitionProgress);
                  }
                  return isConnected ? 1.5 : 0.5;
                }
              }}
            />
          </Suspense>
        )
      ) : (
        <div className="text-xs flex items-center gap-2" style={{ color: colors.accentDim }}>
          <RefreshCw className="w-4 h-4 animate-spin" />
          <span>Aguardando dados de rede do grafo...</span>
        </div>
      )}
    </div>
  );
};

export const GraphView: React.FC = () => {
  return (
    <GraphErrorBoundary>
      <GraphViewInner />
    </GraphErrorBoundary>
  );
};
