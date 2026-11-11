/**
 * File: apps/desktop/src/recordings/manager.ts
 * Purpose: The shell's side of meeting recording (desktop 1.5.0, ADR-0068): opens a recording's files in
 *          the Recordings folder, appends the pieces the live page sends in order (crash-safe: each piece
 *          is on disk within about a second), watches the free space, closes and finalises the files,
 *          and keeps an index of every recording in the app's data folder. A recording still marked
 *          'recording' when the app starts (a crash, a closed window, Windows shutting down) is finalised
 *          then and marked 'recovered'. Never reads or logs what a file holds: only ids, sizes and times.
 * Used by: src/recordings/host.ts; tests/unit/recordings.test.ts
 * Depends on: node:fs, node:path, @kite/shared (recording contract)
 * Architecture: docs/decisions/ADR-0068-meeting-recording.md; architecture §7.3
 */
import { closeSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { open, rename, rm, stat, writeFile, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import {
  RECORDING_DISK,
  RECORDING_KINDS,
  recordingFileName,
  stereoFileName,
  type LocalRecording,
  type LocalRecordingStatus,
  type RecordingCloseResult,
  type RecordingContainer,
  type RecordingDiskState,
  type RecordingOpenRequest,
  type RecordingOpenResult,
  type RecordingTrack,
  type RecordingWriteResult,
} from '@kite/shared';

/** How often the free space is measured while recording, in ms (statfs is cheap, but not free). */
export const DISK_CHECK_MS = 5_000;

/** A UUID, as the page makes them (crypto.randomUUID()). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether a file name from the index is a plain name in the Recordings folder (1.5.1): no "/" or "\" on
 * any platform, not "." or "..", and nothing else basename would change. The names this manager makes
 * never contain separators, so anything else is a damaged or edited index.
 *
 * @param name The file name.
 * @returns True for a plain name.
 * Called from: readIndex()
 */
function isPlainName(name: string): boolean {
  return (
    name !== '' &&
    name !== '.' &&
    name !== '..' &&
    !/[\\/]/.test(name) &&
    path.basename(name) === name
  );
}

/** One entry of the index file: the recording, plus the stereo file's name. */
interface IndexEntry extends LocalRecording {
  /** The stereo sound file's name, or null. */
  stereoFileName: string | null;
  /** The main file's container while it is written. */
  container: RecordingContainer;
}

/** What finalise() reports. */
export interface FinaliseOutcome {
  /** The finalised file's length, ms. */
  durationMs: number;
}

/** What the manager needs from outside (tests pass fakes). */
export interface ManagerDeps {
  /** The Recordings folder (Documents/Paramount AI/Recordings), created when needed. */
  folder: () => string;
  /** The index file (in the app's data folder). */
  indexFile: string;
  /** Free bytes on the drive holding a folder. */
  freeBytes: (dir: string) => Promise<number>;
  /**
   * Rewrites a finished file with its length and seek index, into `output` (the background process,
   * worker.ts). Rejects when the file cannot be read; the original then stays as it is.
   */
  finalise: (input: string, output: string) => Promise<FinaliseOutcome>;
  /** Moves a file to the Recycle Bin (Electron's shell.trashItem). */
  trash: (file: string) => Promise<void>;
  /** The clock, Unix ms. */
  now: () => number;
}

/** The manager. */
export interface RecordingManager {
  /**
   * Opens a recording's files and adds it to the index as 'recording'.
   * @param request What is recorded (checked here: the page is not trusted).
   * @param owner   The web contents that records (its files close when it goes).
   * @returns The file's name, or why it cannot start.
   */
  open(request: unknown, owner: number): Promise<RecordingOpenResult>;
  /**
   * Appends one piece, after every piece sent before it.
   * @param id    The recording.
   * @param track Which file.
   * @param bytes The piece.
   * @returns Whether it was written, and how full the drive is.
   */
  write(id: unknown, track: unknown, bytes: unknown): Promise<RecordingWriteResult>;
  /**
   * Closes a recording's files and finalises them.
   * @param id The recording.
   * @returns The recording as it now is.
   */
  close(id: unknown): Promise<RecordingCloseResult>;
  /**
   * Every recording in the index; a file that has gone is reported 'missing'.
   * @returns The recordings, newest first.
   */
  list(): LocalRecording[];
  /**
   * One recording's main file, when it is on this computer and not being written.
   * @param id The recording.
   * @returns Its path and container, or null.
   */
  fileOf(id: unknown): { file: string; recording: LocalRecording } | null;
  /**
   * Moves a recording's files to the Recycle Bin and forgets it (not while it is being written).
   * @param id The recording.
   * @returns False when it could not be deleted.
   */
  remove(id: unknown): Promise<boolean>;
  /**
   * The web contents that recorded went away (a closed window, a reload, a crash of its page): its open
   * recordings are closed and finalised as 'recovered'.
   * @param owner The web contents' id.
   * @returns When done.
   */
  abandon(owner: number): Promise<void>;
  /** The app is quitting: every open file is closed now (synchronously). Finalising waits for the next start. */
  closeAllNow(): void;
  /**
   * The app started: every recording still marked 'recording' is finalised and marked 'recovered'.
   * @returns How many were recovered.
   */
  recover(): Promise<number>;
}

/** A recording being written. */
interface OpenRecording {
  /** Its index entry. */
  entry: IndexEntry;
  /** Who records it. */
  owner: number;
  /** The open files. */
  handles: Partial<Record<RecordingTrack, FileHandle>>;
  /** Raw descriptors, for closing synchronously at quit. */
  fds: number[];
  /** Pieces waiting, in order, per file. */
  queues: Record<RecordingTrack, Promise<unknown>>;
  /** Bytes written to the main file. */
  bytes: number;
  /** Free bytes at the last check. */
  freeBytes: number;
  /** When the free space was last measured. */
  checkedAt: number;
  /** True once a write failed (later pieces are dropped; the page stops). */
  failed: boolean;
}

/**
 * Whether a value is an open request the shell accepts.
 * @param value What arrived over IPC.
 * @returns True for a well-formed request.
 * Called from: open(); tests
 */
export function isOpenRequest(value: unknown): value is RecordingOpenRequest {
  const r = value as Partial<RecordingOpenRequest> | null;
  return (
    !!r &&
    typeof r.id === 'string' &&
    UUID.test(r.id) &&
    typeof r.sessionId === 'string' &&
    UUID.test(r.sessionId) &&
    typeof r.meetingId === 'string' &&
    UUID.test(r.meetingId) &&
    Number.isInteger(r.part) &&
    r.part! >= 1 &&
    r.part! <= 999 &&
    (RECORDING_KINDS as readonly unknown[]).includes(r.kind) &&
    typeof r.startedAt === 'number' &&
    Number.isFinite(r.startedAt) &&
    (r.container === 'mkv' || r.container === 'webm') &&
    // A sound-only recording is always WebM (Opus).
    (r.kind === 'screen' || r.container === 'webm') &&
    typeof r.stereo === 'boolean'
  );
}

/**
 * The disk state for an amount of free space.
 * @param freeBytes Free bytes.
 * @returns 'stop' at RECORDING_DISK.stopBytes or below, 'low' below lowBytes, else 'ok'.
 * Called from: write(); tests
 */
export function diskState(freeBytes: number): RecordingDiskState {
  if (freeBytes <= RECORDING_DISK.stopBytes) return 'stop';
  if (freeBytes < RECORDING_DISK.lowBytes) return 'low';
  return 'ok';
}

/**
 * A file name that is not taken in a folder: "<name>", then "<name> (2)", "(3)"…
 * @param dir  The folder.
 * @param name The wanted name.
 * @returns A free name.
 */
function freeName(dir: string, name: string): string {
  if (!existsSync(path.join(dir, name))) return name;
  const ext = path.extname(name);
  const base = name.slice(0, -ext.length);
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})${ext}`;
    if (!existsSync(path.join(dir, candidate))) return candidate;
  }
}

/**
 * Creates the manager.
 * @param deps Folders, the free-space check, the finaliser, the Recycle Bin and the clock.
 * @returns The manager.
 * Called from: installRecordings() in host.ts; tests
 */
export function createRecordingManager(deps: ManagerDeps): RecordingManager {
  const opened = new Map<string, OpenRecording>();
  // The index is small (one entry per recording); it is read once and written after each change.
  let index: IndexEntry[] = readIndex(deps.indexFile);
  let saving: Promise<unknown> = Promise.resolve();

  /**
   * Writes the index (one write at a time, through a temporary file so a crash never leaves half).
   * @returns When this write (and every earlier one) is done.
   */
  const save = () => {
    const text = JSON.stringify({ version: 1, recordings: index }, null, 1);
    saving = saving.then(async () => {
      try {
        mkdirSync(path.dirname(deps.indexFile), { recursive: true });
        await writeFile(`${deps.indexFile}.tmp`, text);
        await rename(`${deps.indexFile}.tmp`, deps.indexFile);
      } catch (error) {
        console.warn('recordings: index not saved', { error: String(error) });
      }
    });
    return saving;
  };
  /**
   * Replaces one entry (by id) and saves.
   * @param entry The entry's new state.
   * @returns When saved.
   */
  const update = (entry: IndexEntry) => {
    index = index.map((e) => (e.id === entry.id ? entry : e));
    return save();
  };

  /**
   * Finalises an entry's files (the main file, then the stereo file) and records the result. A file the
   * finaliser cannot read stays as it is: it still plays, without its length and seeking.
   * @param entry  The entry.
   * @param status What it becomes: 'complete' (stopped) or 'recovered'.
   * @param fallbackMs The length to keep when finalising fails (the wall clock).
   * @returns The entry afterwards.
   */
  const finaliseEntry = async (
    entry: IndexEntry,
    status: Extract<LocalRecordingStatus, 'complete' | 'recovered'>,
    fallbackMs: number,
  ): Promise<IndexEntry> => {
    const dir = deps.folder();
    let durationMs = fallbackMs;
    for (const name of [entry.fileName, entry.stereoFileName]) {
      if (!name) continue;
      const file = path.join(dir, name);
      if (!existsSync(file)) continue;
      const temp = path.join(dir, `.${name}.finalising`);
      try {
        const outcome = await deps.finalise(file, temp);
        // The finalised copy replaces the original only once it is complete.
        renameSync(temp, file);
        if (name === entry.fileName) durationMs = Math.round(outcome.durationMs);
      } catch (error) {
        await rm(temp, { force: true }).catch(() => undefined);
        console.warn('recordings: finalise failed, original kept', {
          id: entry.id,
          error: String(error),
        });
      }
    }
    const main = path.join(dir, entry.fileName);
    const bytes = existsSync(main) ? statSync(main).size : 0;
    const next: IndexEntry = { ...entry, status, durationMs, bytes };
    await update(next);
    return next;
  };

  /**
   * Closes an open recording's files (waiting for the pieces still queued).
   * @param rec The open recording.
   */
  const closeFiles = async (rec: OpenRecording) => {
    opened.delete(rec.entry.id);
    await Promise.allSettled([rec.queues.main, rec.queues.stereo]);
    await Promise.allSettled(Object.values(rec.handles).map((handle) => handle?.close()));
  };

  const publicEntry = (entry: IndexEntry): LocalRecording => {
    const { stereoFileName: _stereo, container: _container, ...rest } = entry;
    return rest;
  };

  return {
    async open(request, owner) {
      if (!isOpenRequest(request)) return { ok: false, reason: 'failed' };
      if (opened.has(request.id) || index.some((e) => e.id === request.id)) {
        return { ok: false, reason: 'busy' };
      }
      let dir: string;
      try {
        dir = deps.folder();
        mkdirSync(dir, { recursive: true });
      } catch (error) {
        console.warn('recordings: folder not available', { error: String(error) });
        return { ok: false, reason: 'failed' };
      }
      let free: number;
      try {
        free = await deps.freeBytes(dir);
      } catch {
        free = Number.POSITIVE_INFINITY;
      }
      if (free < RECORDING_DISK.minStartBytes) {
        return { ok: false, reason: 'low-disk', freeBytes: free };
      }
      const fileName = freeName(
        dir,
        recordingFileName(request.startedAt, request.part, request.container),
      );
      const stereoName = request.stereo ? freeName(dir, stereoFileName(fileName)) : null;
      const handles: Partial<Record<RecordingTrack, FileHandle>> = {};
      try {
        // 'wx': never overwrite a file that appeared in the meantime.
        handles.main = await open(path.join(dir, fileName), 'wx');
        if (stereoName) handles.stereo = await open(path.join(dir, stereoName), 'wx');
      } catch (error) {
        await Promise.allSettled(Object.values(handles).map((h) => h?.close()));
        console.warn('recordings: could not create the files', { error: String(error) });
        return { ok: false, reason: 'failed' };
      }
      const entry: IndexEntry = {
        id: request.id,
        sessionId: request.sessionId,
        meetingId: request.meetingId,
        part: request.part,
        kind: request.kind,
        startedAt: request.startedAt,
        durationMs: 0,
        bytes: 0,
        fileName,
        hasStereo: stereoName !== null,
        status: 'recording',
        stereoFileName: stereoName,
        container: request.container,
      };
      opened.set(request.id, {
        entry,
        owner,
        handles,
        fds: Object.values(handles).map((h) => h!.fd),
        queues: { main: Promise.resolve(), stereo: Promise.resolve() },
        bytes: 0,
        freeBytes: free,
        checkedAt: deps.now(),
        failed: false,
      });
      // In the index before the first piece: a crash from here on is recovered at the next start.
      index = [entry, ...index];
      await save();
      console.info('recordings: started', {
        id: request.id,
        kind: request.kind,
        part: request.part,
      });
      return { ok: true, fileName, freeBytes: free };
    },

    async write(id, track, bytes) {
      const rec = typeof id === 'string' ? opened.get(id) : undefined;
      const fileTrack = track === 'main' || track === 'stereo' ? track : null;
      if (!rec || !fileTrack || !(bytes instanceof Uint8Array) || rec.failed) {
        return { ok: false, disk: 'ok', freeBytes: rec?.freeBytes ?? 0 };
      }
      const handle = rec.handles[fileTrack];
      if (!handle) return { ok: false, disk: 'ok', freeBytes: rec.freeBytes };
      // Chained, so pieces land in the order they arrived even though each write is asynchronous.
      const written = rec.queues[fileTrack].then(() => handle.write(bytes));
      rec.queues[fileTrack] = written.catch(() => undefined);
      try {
        await written;
      } catch (error) {
        rec.failed = true;
        console.warn('recordings: write failed', { id: rec.entry.id, error: String(error) });
        return { ok: false, disk: diskState(rec.freeBytes), freeBytes: rec.freeBytes };
      }
      if (fileTrack === 'main') rec.bytes += bytes.byteLength;
      if (deps.now() - rec.checkedAt >= DISK_CHECK_MS) {
        rec.checkedAt = deps.now();
        try {
          rec.freeBytes = await deps.freeBytes(deps.folder());
        } catch {
          // Unknown: keep the last figure.
        }
      }
      return { ok: true, disk: diskState(rec.freeBytes), freeBytes: rec.freeBytes };
    },

    async close(id) {
      const rec = typeof id === 'string' ? opened.get(id) : undefined;
      if (!rec) {
        const known = index.find((e) => e.id === id);
        return { ok: false, recording: known ? publicEntry(known) : null };
      }
      await closeFiles(rec);
      const finished = await finaliseEntry(rec.entry, 'complete', deps.now() - rec.entry.startedAt);
      console.info('recordings: stopped', {
        id: finished.id,
        durationMs: finished.durationMs,
        bytes: finished.bytes,
      });
      return { ok: true, recording: publicEntry(finished) };
    },

    list() {
      const dir = deps.folder();
      return index
        .map((entry) => {
          const there = existsSync(path.join(dir, entry.fileName));
          return publicEntry(
            there || opened.has(entry.id) ? entry : { ...entry, status: 'missing' },
          );
        })
        .sort((a, b) => b.startedAt - a.startedAt);
    },

    fileOf(id) {
      if (typeof id !== 'string' || opened.has(id)) return null;
      const entry = index.find((e) => e.id === id);
      if (!entry) return null;
      const file = path.join(deps.folder(), entry.fileName);
      return existsSync(file) ? { file, recording: publicEntry(entry) } : null;
    },

    async remove(id) {
      if (typeof id !== 'string' || opened.has(id)) return false;
      const entry = index.find((e) => e.id === id);
      if (!entry) return false;
      const dir = deps.folder();
      for (const name of [entry.fileName, entry.stereoFileName]) {
        if (!name) continue;
        const file = path.join(dir, name);
        if (!existsSync(file)) continue;
        try {
          await deps.trash(file);
        } catch (error) {
          console.warn('recordings: could not move to the Recycle Bin', { error: String(error) });
          return false;
        }
      }
      index = index.filter((e) => e.id !== id);
      await save();
      console.info('recordings: deleted', { id });
      return true;
    },

    async abandon(owner) {
      const mine = [...opened.values()].filter((rec) => rec.owner === owner);
      for (const rec of mine) {
        await closeFiles(rec);
        await finaliseEntry(rec.entry, 'recovered', deps.now() - rec.entry.startedAt);
        console.info('recordings: recovered after the page went', { id: rec.entry.id });
      }
    },

    closeAllNow() {
      for (const rec of opened.values()) {
        for (const fd of rec.fds) {
          try {
            closeSync(fd);
          } catch {
            // Already closed.
          }
        }
      }
      // Still 'recording' in the index: the next start finalises them as 'recovered'.
      opened.clear();
    },

    async recover() {
      const stale = index.filter((e) => e.status === 'recording' && !opened.has(e.id));
      for (const entry of stale) {
        const dir = deps.folder();
        const main = path.join(dir, entry.fileName);
        // The length if finalising fails: from the file's last change, which is about when it stopped.
        const fallback = existsSync(main)
          ? Math.max(0, (await stat(main)).mtimeMs - entry.startedAt)
          : 0;
        await finaliseEntry(entry, 'recovered', Math.round(fallback));
      }
      if (stale.length > 0) console.info('recordings: recovered at start', { count: stale.length });
      return stale.length;
    },
  };
}

/**
 * Reads the index file. A missing or broken file is an empty index (the files stay in the folder).
 * @param file The index file.
 * @returns Its entries (malformed ones are skipped).
 */
function readIndex(file: string): IndexEntry[] {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { recordings?: unknown };
    if (!Array.isArray(raw.recordings)) return [];
    return raw.recordings.filter((e): e is IndexEntry => {
      const entry = e as Partial<IndexEntry> | null;
      return (
        !!entry &&
        typeof entry.id === 'string' &&
        UUID.test(entry.id) &&
        typeof entry.fileName === 'string' &&
        // Only a plain name: never a path that leaves the Recordings folder. 1.5.1: on every platform
        // (a "\" is no separator on macOS, so basename alone let "..\..\x" through there).
        isPlainName(entry.fileName) &&
        (entry.stereoFileName === null ||
          (typeof entry.stereoFileName === 'string' && isPlainName(entry.stereoFileName))) &&
        typeof entry.startedAt === 'number'
      );
    });
  } catch {
    return [];
  }
}
