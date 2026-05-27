import { forceSimulation, forceManyBody, forceLink, forceCenter, forceCollide } from 'd3-force-3d';

interface WorkerNode {
  id: string;
  x?: number;
  y?: number;
  z?: number;
  fx?: number;
  fy?: number;
  fz?: number;
}

interface WorkerLink {
  source: string;
  target: string;
}

self.onmessage = (event: MessageEvent) => {
  const { type, nodes, links, dimensions = 3, iterations = 120 } = event.data;

  if (type === 'START_SIMULATION') {
    const simNodes: WorkerNode[] = (nodes as WorkerNode[]).map((n: WorkerNode) => ({
      id: n.id,
      x: n.x !== undefined ? n.x : (Math.random() - 0.5) * 100,
      y: n.y !== undefined ? n.y : (Math.random() - 0.5) * 100,
      z: n.z !== undefined ? n.z : (Math.random() - 0.5) * 100,
      fx: n.fx,
      fy: n.fy,
      fz: n.fz,
    }));

    const simLinks: WorkerLink[] = (links as WorkerLink[]).map((l: WorkerLink) => ({
      source: l.source,
      target: l.target,
    }));

    const simulation = forceSimulation(simNodes, dimensions)
      .force('link', forceLink(simLinks).id((d: unknown) => (d as WorkerNode).id).distance(60))
      .force('charge', forceManyBody().strength(-120).theta(1.5))
      .force('center', forceCenter(0, 0, 0))
      .force('collide', forceCollide().radius(20))
      .stop();

    const step = 30;
    for (let i = 0; i < iterations; i++) {
      simulation.tick();
      if (i > 0 && i % step === 0) {
        self.postMessage({
          type: 'TICK',
          nodes: simNodes.map((n: WorkerNode) => ({
            id: n.id,
            x: n.x,
            y: n.y,
            z: n.z,
            fx: n.fx,
            fy: n.fy,
            fz: n.fz,
          })),
          progress: i / iterations,
        });
      }
    }

    self.postMessage({
      type: 'END_SIMULATION',
      nodes: simNodes.map((n: WorkerNode) => ({
        id: n.id,
        x: n.x,
        y: n.y,
        z: n.z,
        fx: n.x,
        fy: n.y,
        fz: n.z,
      })),
    });
  }
};
