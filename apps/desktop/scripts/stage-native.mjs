/**
 * File: apps/desktop/scripts/stage-native.mjs
 * Purpose: Copies the accurate-transcription engine's native runtime (sherpa-onnx-node, the
 *          JavaScript wrapper, and its build for this OS and CPU) as real files into
 *          native/sherpa-onnx/modules/ (not "node_modules": electron-builder leaves folders of that
 *          name out of extraResources), where the engine's utility process loads it and from
 *          where the installer ships it (electron-builder extraResources). pnpm links packages, so
 *          they are copied with links resolved. When there is no build for this OS, nothing is
 *          staged and the feature reports "not available on this computer".
 * Used by: the "build" script in apps/desktop/package.json
 * Depends on: Node's fs and path; sherpa-onnx-node 1.13.8 (pinned, ADR-0034)
 * Architecture: docs/decisions/ADR-0034-accurate-transcription-opt-in.md
 */
import { cpSync, existsSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(desktopDir, 'native', 'sherpa-onnx', 'modules');
const require = createRequire(path.join(desktopDir, 'package.json'));

/** The platform package name sherpa-onnx-node looks for ("win" for Windows). */
const platformArch = `${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`;

const wrapperDir = realpathSync(path.dirname(require.resolve('sherpa-onnx-node/package.json')));
// The build sits next to the wrapper (pnpm links it there as the wrapper's optional dependency).
const buildDir = path.join(wrapperDir, '..', `sherpa-onnx-${platformArch}`);

rmSync(target, { recursive: true, force: true });
if (!existsSync(path.join(buildDir, 'sherpa-onnx.node'))) {
  console.log(`stage-native: no sherpa-onnx build for ${platformArch}; nothing staged`);
} else {
  mkdirSync(target, { recursive: true });
  cpSync(wrapperDir, path.join(target, 'sherpa-onnx-node'), { recursive: true, dereference: true });
  cpSync(realpathSync(buildDir), path.join(target, `sherpa-onnx-${platformArch}`), {
    recursive: true,
    dereference: true,
  });
  console.log(`stage-native: staged sherpa-onnx-node and sherpa-onnx-${platformArch}`);
}
