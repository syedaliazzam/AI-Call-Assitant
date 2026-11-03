/**
 * File: apps/web/scripts/lib/code-sandbox-worker.mjs
 * Purpose: Runs one code block from an evaluated answer, inside a worker thread with no environment
 *          variables: Python in Pyodide (WebAssembly, with an empty JavaScript bridge) or JavaScript
 *          in a fresh V8 context with nothing but console. Posts back whether it ran.
 * Used by: scripts/lib/code-sandbox.ts
 * Depends on: pyodide (dev dependency), node:vm, node:worker_threads
 * Architecture: docs/testing/answer-eval.md (code in answers is executed)
 *
 * The code comes from Claude, so it gets no file system, no network and no API key: the parent
 * starts this worker with `env: {}`, and terminates it at the time limit.
 */
import vm from 'node:vm';
import { parentPort, workerData } from 'node:worker_threads';
import { loadPyodide } from 'pyodide';

/**
 * Runs Python in Pyodide. `jsglobals` is empty, so `import js` reaches nothing of this process.
 *
 * @param code The code.
 * @returns Resolves when it has run; rejects with its error.
 * Called from: the bottom of this file
 */
async function runPython(code) {
  const pyodide = await loadPyodide({
    jsglobals: { Object, Array, Promise, setTimeout, clearTimeout },
  });
  // input() reads end-of-file at once, so code that wrongly asks for input fails instead of hanging.
  pyodide.setStdin({ error: true });
  pyodide.setStdout({ batched: () => undefined });
  pyodide.setStderr({ batched: () => undefined });
  await pyodide.runPythonAsync(code);
}

/**
 * Runs JavaScript in a fresh context: no require, process or fetch.
 *
 * @param code The code.
 * @returns Nothing; throws its error.
 * Called from: the bottom of this file
 */
function runJavaScript(code) {
  const log = () => undefined;
  vm.runInNewContext(
    code,
    // Timers are part of ordinary code (a debounce); they cannot reach anything.
    { console: { log, error: log, warn: log, info: log }, setTimeout, clearTimeout },
    { timeout: 10_000 },
  );
}

try {
  if (workerData.language === 'python') await runPython(workerData.code);
  else runJavaScript(workerData.code);
  parentPort.postMessage({ ok: true });
} catch (error) {
  // The error's kind and last line only: the parent saves it for diagnosis.
  const lines = String(error?.message ?? error)
    .trim()
    .split('\n');
  parentPort.postMessage({ ok: false, error: lines.at(-1)?.slice(0, 200) ?? 'failed' });
}
