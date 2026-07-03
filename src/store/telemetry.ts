// Telemetria de cold start (F3 — Spec 17): extraída intacta do appStore.ts. Estado
// mutável de módulo, escrito por initApp/loadVault/loadGraphData/setupIndexingListener
// e consolidado num único print quando árvore+índice+grafo terminam. Zero relação com
// o fluxo de save.
export const telemetry = {
  rustStartupTime: 0,
  dbLoadTime: 0,
  treeLoadStartTime: 0,
  treeLoadTime: 0,
  indexStartTime: 0,
  indexTime: 0,
  graphTime: 0,
  metricsPrinted: false,
  hasTreeLoaded: false,
  hasIndexed: false,
  hasGraphLoaded: false,
};

interface BootstrapWindow extends Window {
  __bootstrapStart?: number;
}

export const checkAndPrintConsolidatedMetrics = () => {
  if (telemetry.metricsPrinted) return;
  if (telemetry.hasTreeLoaded && telemetry.hasIndexed && telemetry.hasGraphLoaded) {
    telemetry.metricsPrinted = true;
    const jsBootstrapStart = (window as BootstrapWindow).__bootstrapStart || 0;
    const totalTime = performance.now();

    console.log('=== TELEMETRY: COLD START METRICS ===');
    console.log(`1. Rust Core Startup:       ${telemetry.rustStartupTime} ms`);
    console.log(`2. Webview JS Bootstrap:    ${jsBootstrapStart.toFixed(2)} ms`);
    console.log(`3. DB/Config Load:          ${telemetry.dbLoadTime.toFixed(2)} ms`);
    console.log(`4. FileTree Load:           ${telemetry.treeLoadTime.toFixed(2)} ms`);
    console.log(`5. Search Indexing:         ${telemetry.indexTime.toFixed(2)} ms`);
    console.log(`6. Graph Layout Settle:     ${telemetry.graphTime.toFixed(2)} ms`);
    console.log('-------------------------------------');
    console.log(`TOTAL COLD START DURATION:  ${totalTime.toFixed(2)} ms`);
    console.log('=====================================');
  }
};
