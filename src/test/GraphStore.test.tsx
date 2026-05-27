import { describe, test, expect, vi, beforeEach } from 'vitest';
import { useAppStore } from '../store/appStore';
import { invoke } from '@tauri-apps/api/core';

// Mock Tauri invoke implementation specifically for graph commands
vi.mocked(invoke).mockImplementation((cmd: string, args?: unknown) => {
  if (cmd === 'get_graph_data') {
    return Promise.resolve({
      nodes: [
        { id: 'path/A.md', label: 'Nota A', exists: true, degree: 1 },
        { id: 'phantom:Nota B', label: 'Nota B', exists: false, degree: 1 },
      ],
      links: [
        { source: 'path/A.md', target: 'phantom:Nota B' },
      ],
    });
  }
  if (cmd === 'load_graph_positions') {
    return Promise.resolve({
      'path/A.md': { x: 100, y: 200, z: 300 },
    });
  }
  if (cmd === 'save_graph_positions') {
    return Promise.resolve();
  }
  if (cmd === 'search_notes') {
    const query = (args as { query?: string })?.query;
    if (query === 'termo') {
      return Promise.resolve([
        { path: 'path/A.md', title: 'Nota A', snippet: 'Este é o <b>termo</b> destacado.' },
      ]);
    }
    return Promise.resolve([]);
  }
  if (cmd === 'get_matching_paths') {
    const query = (args as { query?: string })?.query;
    if (query === 'termo') {
      return Promise.resolve(['path/A.md']);
    }
    return Promise.resolve([]);
  }
  return Promise.resolve();
});

// Mock Web Worker class to execute ticks and completion events in jsdom environment
class MockWorker {
  url: string | URL;
  options?: WorkerOptions;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  
  constructor(url: string | URL, options?: WorkerOptions) {
    this.url = url;
    this.options = options;
  }

  postMessage(data: unknown) {
    const msg = data as { type: string };
    if (msg.type === 'START_SIMULATION') {
      // Dispatch intermediate TICK event
      setTimeout(() => {
        if (this.onmessage) {
          this.onmessage({
            data: {
              type: 'TICK',
              nodes: [
                { id: 'path/A.md', x: 100, y: 200, z: 300, fx: 100, fy: 200, fz: 300 },
                { id: 'phantom:Nota B', x: 50, y: 50, z: 50, fx: undefined, fy: undefined, fz: undefined },
              ],
            },
          } as MessageEvent);
        }
      }, 5);

      // Dispatch final END_SIMULATION event
      setTimeout(() => {
        if (this.onmessage) {
          this.onmessage({
            data: {
              type: 'END_SIMULATION',
              nodes: [
                { id: 'path/A.md', x: 100, y: 200, z: 300 },
                { id: 'phantom:Nota B', x: 45, y: 55, z: 65 },
              ],
            },
          } as MessageEvent);
        }
      }, 15);
    }
  }

  terminate() {
    // Terminated successfully
  }
}

// Override global window.Worker
Object.defineProperty(globalThis, 'Worker', {
  value: MockWorker,
  configurable: true,
  writable: true,
});

describe('Graph View Store Actions', () => {
  beforeEach(() => {
    useAppStore.setState({
      graphData: null,
      graphViewMode: '3d',
      graphPositions: {},
      graphSearchQuery: '',
    });
  });

  test('toggleGraphViewMode switches between 2D and 3D modes', () => {
    const store = useAppStore.getState();
    expect(store.graphViewMode).toBe('3d');
    
    store.toggleGraphViewMode();
    expect(useAppStore.getState().graphViewMode).toBe('2d');
    
    useAppStore.getState().toggleGraphViewMode();
    expect(useAppStore.getState().graphViewMode).toBe('3d');
  });

  test('setGraphSearchQuery updates search text state', () => {
    const store = useAppStore.getState();
    expect(store.graphSearchQuery).toBe('');
    
    store.setGraphSearchQuery('query-termo');
    expect(useAppStore.getState().graphSearchQuery).toBe('query-termo');
  });

  test('loadGraphData fetches graph schema, merges cached items, and runs worker simulation for uncached nodes', async () => {
    const store = useAppStore.getState();
    expect(store.graphData).toBeNull();

    // Trigger loadGraphData which fetches sqlite info and spins up Worker
    await store.loadGraphData();

    const partialState = useAppStore.getState();
    expect(partialState.graphData).not.toBeNull();
    expect(partialState.graphData?.nodes.length).toBe(2);

    const nodeA = partialState.graphData?.nodes.find(n => n.id === 'path/A.md');
    expect(nodeA?.x).toBe(100);
    expect(nodeA?.fx).toBe(100); // Merged from cache and locked

    const nodeB = partialState.graphData?.nodes.find(n => n.id === 'phantom:Nota B');
    expect(nodeB?.fx).toBeUndefined(); // Needs simulation

    // Wait for the MockWorker tick and completion timers
    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify coordinates settle and freeze
    const finalState = useAppStore.getState();
    const finalNodeB = finalState.graphData?.nodes.find(n => n.id === 'phantom:Nota B');
    expect(finalNodeB?.x).toBe(45);
    expect(finalNodeB?.fx).toBe(45); // Locked in place post-simulation

    // Confirm that positions were successfully saved to AppData config
    expect(invoke).toHaveBeenCalledWith('save_graph_positions', expect.objectContaining({
      positions: expect.any(Object)
    }));
  });

  test('searchNotesFts queries FTS5 and updates state', async () => {
    const store = useAppStore.getState();
    expect(store.searchResults).toEqual([]);
    expect(store.matchingPaths.size).toBe(0);
    
    useAppStore.setState({ graphSearchQuery: 'termo' });
    await store.searchNotesFts('termo');
    
    const updatedState = useAppStore.getState();
    expect(updatedState.searchResults.length).toBe(1);
    expect(updatedState.searchResults[0].path).toBe('path/A.md');
    expect(updatedState.searchResults[0].snippet).toBe('Este é o <b>termo</b> destacado.');
    expect(updatedState.matchingPaths.has('path/A.md')).toBe(true);
  });

  test('setGraphSearchQuery triggers debounced search and clears on empty', async () => {
    const store = useAppStore.getState();
    store.setGraphSearchQuery('termo');
    
    expect(useAppStore.getState().graphSearchQuery).toBe('termo');
    expect(useAppStore.getState().isSearching).toBe(true);
    
    await new Promise((resolve) => setTimeout(resolve, 300));
    
    expect(useAppStore.getState().searchResults.length).toBe(1);
    expect(useAppStore.getState().matchingPaths.has('path/A.md')).toBe(true);
    expect(useAppStore.getState().isSearching).toBe(false);
    
    store.setGraphSearchQuery('');
    expect(useAppStore.getState().graphSearchQuery).toBe('');
    expect(useAppStore.getState().searchResults).toEqual([]);
    expect(useAppStore.getState().matchingPaths.size).toBe(0);
    expect(useAppStore.getState().isSearching).toBe(false);
  });
});


