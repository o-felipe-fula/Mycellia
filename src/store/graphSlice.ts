/* eslint-disable @typescript-eslint/no-explicit-any */
// Slice do grafo + busca FTS (F3 — Spec 17): extraído intacto do appStore.ts, incluindo
// o estado de módulo que só ele usa (worker da simulação e debounce da busca). A simulação
// roda num Web Worker (congelável, LOD no GraphView); posições persistem via Rust
// (escrita atômica). Zero relação com o fluxo de save.
import type { StoreApi } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { AppState } from './appStore';
import type { GraphData, GraphPosition, SearchResult } from './types';
import { telemetry, checkAndPrintConsolidatedMetrics } from './telemetry';

type Set = StoreApi<AppState>['setState'];
type Get = StoreApi<AppState>['getState'];

let searchTimeout: ReturnType<typeof setTimeout> | null = null;
let activeWorker: Worker | null = null;

export const createGraphSlice = (set: Set, get: Get) => ({
  graphData: null as GraphData | null,
  graphViewMode: '3d' as '2d' | '3d',
  graphPositions: {} as Record<string, GraphPosition>,
  graphSearchQuery: '',
  isGraphSimulating: false,
  searchResults: [] as SearchResult[],
  matchingPaths: new Set<string>(),
  isSearching: false,

  loadGraphData: async () => {
    const startTime = performance.now();
    const mode = get().graphViewMode;
    try {
      const data = await invoke<GraphData>('get_graph_data');
      const cached = await invoke<Record<string, GraphPosition>>('load_graph_positions');

      const nodes = data.nodes.map(node => {
        const cachePos = cached[node.id];
        if (cachePos) {
          let x: number | undefined;
          let y: number | undefined;
          let z: number | undefined;
          if (mode === '2d') {
            if (cachePos.x2d !== undefined && cachePos.y2d !== undefined) {
              x = cachePos.x2d;
              y = cachePos.y2d;
              z = 0;
            } else if (cachePos.x !== undefined && cachePos.y !== undefined) {
              x = cachePos.x;
              y = cachePos.y;
              z = 0;
            }
          } else {
            if (cachePos.x3d !== undefined && cachePos.y3d !== undefined && cachePos.z3d !== undefined) {
              x = cachePos.x3d;
              y = cachePos.y3d;
              z = cachePos.z3d;
            } else if (cachePos.x !== undefined && cachePos.y !== undefined && cachePos.z !== undefined) {
              x = cachePos.x;
              y = cachePos.y;
              z = cachePos.z;
            }
          }

          if (x !== undefined && y !== undefined) {
            return {
              ...node,
              x,
              y,
              z: z || 0,
              fx: x,
              fy: y,
              fz: z || 0,
            };
          }
        }
        return {
          ...node,
          fx: undefined,
          fy: undefined,
          fz: undefined,
        };
      });

      const hasUncached = nodes.some(n => n.fx === undefined);
      const isCacheEmpty = Object.keys(cached).length === 0;

      set({ graphData: { nodes, links: data.links }, graphPositions: cached });

      if (activeWorker) {
        activeWorker.terminate();
        activeWorker = null;
      }

      if (!hasUncached && !isCacheEmpty) {
        const cacheLoadTime = performance.now() - startTime;
        console.log(`[Telemetry] Graph loaded from cache in ${cacheLoadTime.toFixed(2)} ms`);
        telemetry.graphTime = cacheLoadTime;
        telemetry.hasGraphLoaded = true;
        set({ isGraphSimulating: false });
        checkAndPrintConsolidatedMetrics();
      }

      if (hasUncached || isCacheEmpty) {
        set({ isGraphSimulating: true });
        const simStartTime = performance.now();
        let longTasksCount = 0;
        let observer: PerformanceObserver | null = null;
        try {
          if (typeof PerformanceObserver !== 'undefined') {
            observer = new PerformanceObserver((list) => {
              for (const entry of list.getEntries()) {
                if (entry.duration > 50) {
                  longTasksCount++;
                }
              }
            });
            observer.observe({ entryTypes: ['longtask'] });
          }
        } catch (e) {
          // Ignore if environment does not support PerformanceObserver or longtask entry
        }

        activeWorker = new Worker(new URL('../utils/graphWorker.ts', import.meta.url), { type: 'module' });

        activeWorker.postMessage({
          type: 'START_SIMULATION',
          nodes: nodes.map(n => ({
            id: n.id,
            x: n.x,
            y: n.y,
            z: n.z,
            fx: n.fx,
            fy: n.fy,
            fz: n.fz,
          })),
          links: data.links,
          dimensions: mode === '2d' ? 2 : 3,
          iterations: 120,
        });

        activeWorker.onmessage = async (event: MessageEvent) => {
          const { type: msgType, nodes: updatedNodes } = event.data;

          if (msgType === 'TICK') {
            const currentData = get().graphData;
            if (!currentData) return;

            const nodeMap = new Map<string, any>(updatedNodes.map((un: any) => [un.id, un]));
            const nextNodes = currentData.nodes.map(n => {
              const un = nodeMap.get(n.id);
              if (un) {
                return {
                  ...n,
                  x: un.x,
                  y: un.y,
                  z: un.z,
                  fx: un.fx,
                  fy: un.fy,
                  fz: un.fz,
                };
              }
              return n;
            });
            set({ graphData: { nodes: nextNodes, links: currentData.links } });
          } else if (msgType === 'END_SIMULATION') {
            const currentData = get().graphData;
            if (!currentData) return;

            const nodeMap = new Map<string, any>(updatedNodes.map((un: any) => [un.id, un]));
            const nextNodes = currentData.nodes.map(n => {
              const un = nodeMap.get(n.id);
              if (un) {
                return {
                  ...n,
                  x: un.x,
                  y: un.y,
                  z: un.z,
                  fx: un.x,
                  fy: un.y,
                  fz: un.z,
                };
              }
              return n;
            });

            const currentPositions = { ...get().graphPositions };
            nextNodes.forEach(n => {
              const existing = currentPositions[n.id] || {};
              if (mode === '2d') {
                currentPositions[n.id] = {
                  ...existing,
                  x2d: n.x,
                  y2d: n.y,
                };
              } else {
                currentPositions[n.id] = {
                  ...existing,
                  x3d: n.x,
                  y3d: n.y,
                  z3d: n.z,
                };
              }
            });

            set({ graphData: { nodes: nextNodes, links: currentData.links }, isGraphSimulating: false });
            await get().saveGraphPositions(currentPositions);

            const simDuration = performance.now() - simStartTime;
            telemetry.graphTime = simDuration;
            telemetry.hasGraphLoaded = true;
            if (observer) {
              observer.disconnect();
            }
            console.log(`[Telemetry] Worker Simulation settled in ${simDuration.toFixed(2)} ms`);
            console.log(`[Telemetry] Main thread Long Tasks (>50ms) during simulation: ${longTasksCount}`);

            if (activeWorker) {
              activeWorker.terminate();
              activeWorker = null;
            }
            checkAndPrintConsolidatedMetrics();
          }
        };
      }
    } catch (e) {
      console.error('Failed to load graph data:', e);
      get().notify('error', 'Falha ao carregar o grafo.');
      telemetry.graphTime = 0;
      telemetry.hasGraphLoaded = true;
      checkAndPrintConsolidatedMetrics();
    }
  },

  toggleGraphViewMode: () => {
    const currentMode = get().graphViewMode;
    const nextMode = currentMode === '2d' ? '3d' : '2d';
    set({ graphViewMode: nextMode });
    get().loadGraphData();
  },

  saveGraphPositions: async (positions: Record<string, GraphPosition>) => {
    try {
      await invoke('save_graph_positions', { positions });
      set({ graphPositions: positions });
    } catch (e) {
      console.error('Failed to save graph positions:', e);
      get().notify('warning', 'Falha ao salvar as posições do grafo.');
    }
  },

  setGraphSearchQuery: (query: string) => {
    set({ graphSearchQuery: query });
    if (searchTimeout) {
      clearTimeout(searchTimeout);
      searchTimeout = null;
    }
    if (!query.trim()) {
      set({
        searchResults: [],
        matchingPaths: new Set<string>(),
        isSearching: false,
      });
      return;
    }
    set({ isSearching: true });
    searchTimeout = setTimeout(async () => {
      searchTimeout = null;
      await get().searchNotesFts(query);
    }, 250);
  },

  searchNotesFts: async (query: string) => {
    if (!query.trim()) {
      set({
        searchResults: [],
        matchingPaths: new Set<string>(),
        isSearching: false,
      });
      return;
    }
    try {
      const [results, paths] = await Promise.all([
        invoke<SearchResult[]>('search_notes', { query }),
        invoke<string[]>('get_matching_paths', { query }),
      ]);
      if (get().graphSearchQuery === query) {
        set({
          searchResults: results,
          matchingPaths: new Set(paths),
          isSearching: false,
        });
      }
    } catch (e) {
      console.error('Failed to search notes:', e);
      get().notify('error', 'Falha na busca.');
      if (get().graphSearchQuery === query) {
        set({
          isSearching: false,
        });
      }
    }
  },
});
