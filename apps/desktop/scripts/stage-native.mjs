/**
 * File: apps/desktop/scripts/stage-native.mjs
 * Purpose: Copies the accurate-transcription engine's native runtime (sherpa-onnx-node, the
 *          JavaScript wrapper, and its build for this OS and CPU) as real files into
 *          native/sherpa-onnx/modules/ (not "node_modules": electron-builder leaves folders of that
 *          name out of extraResources), where the engine's utility process loads it and from
 *          where the installer ships it (electron-builder extraResources). pnpm links packages, so
 *          they are copied with links resolved. When there is no build for this OS, nothing is
 *          staged and the feature reports "not available on this computer".
 *          1.8.0 (ADR-0109): with --mac-universal (the Mac release), BOTH Mac builds are staged
 *          (darwin-arm64 and darwin-x64), because one universal app runs on Apple-chip and Intel Macs;
 *          the wrapper loads the one for the Mac's CPU at run time. A missing one stops the build.
 * Used by: the "build" script in apps/desktop/package.json; "mac:prepare" (--mac-universal)
 * Depends on: Node's fs and path; sherpa-onnx-node 1.13.8 (pinned, ADR-0034)
 * Architecture: docs/decisions/ADR-0034-accurate-transcription-opt-in.md; ADR-0109 §2
 */
import { cpSync, existsSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(desktopDir, 'native', 'sherpa-onnx', 'modules');
const require = createRequire(path.join(desktopDir, 'package.json'));

/** True for the Mac release: stage both Mac builds and fail if one is missing. */
const macUniversal = process.argv.includes('--mac-universal');
if (macUniversal && process.platform !== 'darwin') {
  console.error('stage-native: --mac-universal runs on a Mac only');
  process.exit(1);
}

/** The platform package names sherpa-onnx-node looks for ("win" for Windows). */
const platformArchs = macUniversal
  ? ['darwin-arm64', 'darwin-x64']
  : [`${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`];

const wrapperDir = realpathSync(path.dirname(require.resolve('sherpa-onnx-node/package.json')));

/**
 * The folder of one platform build: it sits next to the wrapper (pnpm links it there as the wrapper's
 * optional dependency; on the build Mac `pnpm install --cpu=arm64,x64` links both Mac builds).
 *
 * @param platformArch For example 'darwin-arm64'.
 * @returns The folder's path (it may not exist).
 */
const buildDirOf = (platformArch) => path.join(wrapperDir, '..', `sherpa-onnx-${platformArch}`);

const available = platformArchs.filter((platformArch) =>
  existsSync(path.join(buildDirOf(platformArch), 'sherpa-onnx.node')),
);

rmSync(target, { recursive: true, force: true });
if (macUniversal && available.length !== platformArchs.length) {
  const missing = platformArchs.filter((platformArch) => !available.includes(platformArch));
  console.error(
    `stage-native: missing sherpa-onnx build(s) ${missing.join(', ')}; run "pnpm install --frozen-lockfile --cpu=arm64,x64" first`,
  );
  process.exit(1);
}
if (available.length === 0) {
  console.log(`stage-native: no sherpa-onnx build for ${platformArchs.join(', ')}; nothing staged`);
} else {
  mkdirSync(target, { recursive: true });
  cpSync(wrapperDir, path.join(target, 'sherpa-onnx-node'), { recursive: true, dereference: true });
  for (const platformArch of available) {
    cpSync(
      realpathSync(buildDirOf(platformArch)),
      path.join(target, `sherpa-onnx-${platformArch}`),
      {
        recursive: true,
        dereference: true,
      },
    );
  }
  console.log(
    `stage-native: staged sherpa-onnx-node and ${available.map((one) => `sherpa-onnx-${one}`).join(', ')}`,
  );
}
