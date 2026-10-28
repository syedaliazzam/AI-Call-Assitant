/**
 * Tests for apps/web/scripts/fetch-models.ts: archive member matching (normalizeMember,
 * findArchiveMembers). Members are found with and without a "./" prefix, with Windows line
 * endings from `tar -t`, and by file name when the folder differs. Missing or ambiguous files are
 * reported, and the member name is returned exactly as listed (GNU tar needs the exact name), and
 * the pin list contains every pinned file (pinList).
 */
import { describe, expect, it } from 'vitest';
import { findArchiveMembers, normalizeMember, pinList } from '../../../scripts/fetch-models';
import { RUNTIME_ARCHIVE, RUNTIME_FILES } from '@/core/stt/models';

/** The three runtime file names. */
const NAMES = Object.values(RUNTIME_FILES).map((file) => file.name);
/** The archive's top-level folder. */
const FOLDER = RUNTIME_ARCHIVE.folder;

/** A listing like the real v1.13.7 archive's, with an optional prefix on every entry. */
function listing(prefix: string): string[] {
  return [
    `${prefix}${FOLDER}/`,
    `${prefix}${FOLDER}/index.html`,
    `${prefix}${FOLDER}/app-asr.js`,
    ...NAMES.map((name) => `${prefix}${FOLDER}/${name}`),
    `${prefix}${FOLDER}/sherpa-onnx-wasm-main-asr.data`,
  ];
}

describe('normalizeMember', () => {
  it('removes leading "./" segments and surrounding space', () => {
    expect(normalizeMember('./a/b.js')).toBe('a/b.js');
    expect(normalizeMember('././a/b.js\r')).toBe('a/b.js');
    expect(normalizeMember('a/b.js')).toBe('a/b.js');
  });
});

describe('findArchiveMembers', () => {
  it('finds the files in an archive with a "./" prefix (the real v1.13.7 layout)', () => {
    const { found, missing } = findArchiveMembers(listing('./'), FOLDER, NAMES);
    expect(missing).toEqual([]);
    // Exactly as listed, prefix included: that is the name GNU tar accepts.
    expect(found.get('sherpa-onnx-asr.js')).toBe(`./${FOLDER}/sherpa-onnx-asr.js`);
    expect(found.size).toBe(3);
  });

  it('finds the files without a prefix', () => {
    const { found, missing } = findArchiveMembers(listing(''), FOLDER, NAMES);
    expect(missing).toEqual([]);
    expect(found.get('sherpa-onnx-wasm-main-asr.wasm')).toBe(
      `${FOLDER}/sherpa-onnx-wasm-main-asr.wasm`,
    );
  });

  it('accepts Windows line endings from tar -t', () => {
    const lines = listing('./').map((line) => `${line}\r`);
    const { found, missing } = findArchiveMembers(lines, FOLDER, NAMES);
    expect(missing).toEqual([]);
    expect(found.get('sherpa-onnx-asr.js')).toBe(`./${FOLDER}/sherpa-onnx-asr.js`);
  });

  it('falls back to a unique file name when the folder differs', () => {
    const lines = NAMES.map((name) => `./other-folder/${name}`);
    const { found, missing } = findArchiveMembers(lines, FOLDER, NAMES);
    expect(missing).toEqual([]);
    expect(found.get(NAMES[0]!)).toBe(`./other-folder/${NAMES[0]}`);
  });

  it('prefers the expected folder when a name appears twice', () => {
    const lines = [...listing('./'), './copy/sherpa-onnx-asr.js'];
    expect(findArchiveMembers(lines, FOLDER, NAMES).found.get('sherpa-onnx-asr.js')).toBe(
      `./${FOLDER}/sherpa-onnx-asr.js`,
    );
  });

  it('reports missing files, and ambiguous ones outside the expected folder', () => {
    const lines = [
      `./${FOLDER}/sherpa-onnx-asr.js`,
      './a/sherpa-onnx-wasm-main-asr.js',
      './b/sherpa-onnx-wasm-main-asr.js',
    ];
    const { found, missing } = findArchiveMembers(lines, FOLDER, NAMES);
    expect(found.size).toBe(1);
    expect(missing).toEqual(['sherpa-onnx-wasm-main-asr.js', 'sherpa-onnx-wasm-main-asr.wasm']);
  });
});

describe('pinList', () => {
  it('lists the archive, runtime files and model files with their SHA-256s', () => {
    const text = pinList();
    expect(text).toContain(RUNTIME_ARCHIVE.sha256);
    for (const file of Object.values(RUNTIME_FILES)) expect(text).toContain(file.sha256);
    expect(text.split('\n').every((line) => /^[0-9a-f]{64} {2}\S/.test(line))).toBe(true);
  });
});
