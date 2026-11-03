/**
 * File: scripts/check-file-headers.ts
 * Purpose: Enforces the parts of the CLAUDE.md commenting standard that ESLint cannot check:
 *          1. every source file starts with the header block (File / Purpose / Used by /
 *             Depends on / Architecture), and its "File:" line names the file's real path;
 *          2. every test file (*.test.ts, *.spec.ts) opens with a comment saying what it covers;
 *          3. every exported function's JSDoc says where it is called from ("Called from:", or
 *             "Rendered by:" for a React component), except the entry points Next.js calls;
 *          4. every table, column and index in the database schema (schema.ts) has a comment.
 *          It prints each gap with its file and line and exits with code 1 if there is any.
 *          ESLint (eslint-plugin-jsdoc) checks the JSDoc blocks themselves.
 * Used by: the root "lint" script (`pnpm lint`), so CI's Web job enforces it; developers
 *          (`node scripts/check-file-headers.ts`, add --summary for counts per check)
 * Depends on: typescript (compiler API, to find exported functions and schema columns);
 *             Node.js 22.18+ (runs .ts files directly by stripping the types)
 * Architecture: CLAUDE.md "Commenting standard"; docs/architecture/kite-architecture-v3.1.md §9.2
 *
 * Plain Node, erasable TypeScript only (no enums or parameter properties), so it runs without
 * a build step or tsx.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/** Repository root (this file is in <root>/scripts). */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The folders the standard applies to. */
const SOURCE_DIRS = ['apps/web', 'apps/desktop', 'packages/shared', 'scripts'];

/** File types checked. JSON cannot hold comments; CSS and Markdown are not code. */
const EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs']);

/**
 * Folders never checked: dependencies, build output, downloaded files, generated SQL
 * migrations and test reports. They are generated, not written by us.
 */
const SKIP_DIRS = new Set([
  'node_modules',
  '.next',
  'dist',
  'out',
  'coverage',
  '.vercel',
  'public',
  'drizzle',
  'test-results',
  'playwright-report',
  // apps/desktop build output (v1.0.1): the staged sherpa-onnx runtime (third-party, unmodified)
  // and the packaged installers.
  'native',
  'release',
]);

/** Single generated files (written by Next.js on every dev, build or typegen run). */
const SKIP_FILES = new Set(['apps/web/next-env.d.ts']);

/** The header fields every non-test source file must have, in this order. */
export const HEADER_FIELDS = ['File:', 'Purpose:', 'Used by:', 'Depends on:', 'Architecture:'];

/**
 * Next.js calls these files' exports itself (pages, layouts, route handlers, the proxy), so
 * their exported functions need no "Called from".
 */
const NEXT_ENTRY_FILE = /^apps\/web\/app\/.*\/?(page|layout|route|error|not-found|loading)\.tsx?$/;

/** One gap found. */
export interface Problem {
  /** Which check failed. */
  check: 'header' | 'test-comment' | 'called-from' | 'schema';
  /** File path relative to the repository root, with forward slashes. */
  file: string;
  /** 1-based line number. */
  line: number;
  /** What is missing, in plain words. */
  message: string;
}

/**
 * Lists every source file under the given folders, skipping generated ones.
 *
 * @param dirs Folders relative to the repository root.
 * @returns Paths relative to the root, with forward slashes, sorted.
 * Called from: main()
 */
function sourceFiles(dirs: readonly string[]): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(path.join(ROOT, dir))) {
      const relative = `${dir}/${name}`;
      if (statSync(path.join(ROOT, relative)).isDirectory()) {
        if (!SKIP_DIRS.has(name)) walk(relative);
      } else if (EXTENSIONS.has(path.extname(name)) && !SKIP_FILES.has(relative)) {
        found.push(relative);
      }
    }
  };
  for (const dir of dirs) walk(dir);
  return found.sort();
}

/**
 * Tells whether a file is a test (it needs the test comment instead of the header block).
 *
 * @param file Path relative to the root.
 * @returns True for *.test.* and *.spec.* files.
 * Called from: checkFile()
 */
export function isTestFile(file: string): boolean {
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(file);
}

/**
 * Returns the block comment a file starts with (after an optional "#!" line), or null.
 *
 * @param text The file's text.
 * @returns The comment including its delimiters, or null when the file does not start with one.
 * Called from: checkHeader(); tests
 */
export function leadingBlockComment(text: string): string | null {
  const body = text.replace(/^#![^\n]*\n/, '').trimStart();
  if (!body.startsWith('/*')) return null;
  const end = body.indexOf('*/');
  return end < 0 ? null : body.slice(0, end + 2);
}

/**
 * Checks the header block of a non-test file, or the opening comment of a test file.
 *
 * @param file Path relative to the root.
 * @param text The file's text.
 * @returns The problems found (empty when the header is complete).
 * Called from: checkFile(); tests
 */
export function checkHeader(file: string, text: string): Problem[] {
  const comment = leadingBlockComment(text);
  if (isTestFile(file)) {
    // CLAUDE.md rule 6: a test opens with a comment saying which file and behaviour it covers.
    return comment && comment.replace(/[/*\s]/g, '').length >= 40
      ? []
      : [
          {
            check: 'test-comment',
            file,
            line: 1,
            message: 'test file must open with a comment saying which file and behaviour it covers',
          },
        ];
  }
  if (!comment) {
    return [{ check: 'header', file, line: 1, message: 'missing the header block comment' }];
  }
  const problems: Problem[] = [];
  const missing = HEADER_FIELDS.filter((field) => !comment.includes(field));
  if (missing.length > 0) {
    problems.push({
      check: 'header',
      file,
      line: 1,
      message: `header block lacks ${missing.join(', ')}`,
    });
  }
  // The "File:" line must name this file, so a header copied from another file is caught.
  const named = /File:\s*(\S+)/.exec(comment)?.[1];
  if (named && named !== file) {
    problems.push({
      check: 'header',
      file,
      line: 1,
      message: `header says "File: ${named}" but the file is ${file}`,
    });
  }
  return problems;
}

/**
 * The JSDoc comment text directly before a node (the last /** ... *\/ in its leading
 * comments), or ''.
 *
 * @param source The parsed file.
 * @param node   The declaration.
 * @returns The comment text, or '' when there is none.
 * Called from: checkCalledFrom(), checkSchema()
 */
function jsdocBefore(source: ts.SourceFile, node: ts.Node): string {
  const ranges = ts.getLeadingCommentRanges(source.text, node.getFullStart()) ?? [];
  const docs = ranges
    .map((range) => source.text.slice(range.pos, range.end))
    .filter((text) => text.startsWith('/*'));
  return docs.at(-1) ?? '';
}

/**
 * Tells whether a statement carries the `export` keyword.
 *
 * @param node The statement.
 * @returns True when exported.
 * Called from: checkCalledFrom()
 */
function isExported(node: ts.Node): boolean {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  );
}

/**
 * Checks that every exported function's JSDoc says where it is called from.
 *
 * @param file   Path relative to the root.
 * @param source The parsed file.
 * @returns The problems found.
 * Called from: checkFile(); tests
 */
export function checkCalledFrom(file: string, source: ts.SourceFile): Problem[] {
  // Next.js entry points and tool config files are called by the framework or the tool.
  if (isTestFile(file) || NEXT_ENTRY_FILE.test(file) || /\.config\.[cm]?[jt]s$/.test(file)) {
    return [];
  }
  const problems: Problem[] = [];
  const check = (node: ts.Node, name: string) => {
    const doc = jsdocBefore(source, node);
    // A missing JSDoc block is ESLint's report (jsdoc/require-jsdoc); this only checks its text.
    if (doc && !/Called from|Rendered by/.test(doc)) {
      problems.push({
        check: 'called-from',
        file,
        line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        message: `exported function ${name} has no "Called from:" (or "Rendered by:") line`,
      });
    }
  };
  for (const statement of source.statements) {
    if (!isExported(statement)) continue;
    if (ts.isFunctionDeclaration(statement)) {
      check(statement, statement.name?.text ?? 'default');
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        const init = declaration.initializer;
        if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
          check(statement, declaration.name.getText(source));
        }
      }
    }
  }
  return problems;
}

/**
 * Checks that every table, column and index in a Drizzle schema file has a comment
 * (CLAUDE.md rule 4: what is stored and why).
 *
 * @param file   Path relative to the root.
 * @param source The parsed file.
 * @returns The problems found.
 * Called from: checkFile(); tests
 */
export function checkSchema(file: string, source: ts.SourceFile): Problem[] {
  const problems: Problem[] = [];
  const report = (node: ts.Node, message: string) =>
    problems.push({
      check: 'schema',
      file,
      line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      message,
    });
  /**
   * Tells whether a node has a comment right before it (any style counts here: // or /** *\/).
   *
   * @param node A table column, an index, or the function that returns the indexes.
   * @returns True when at least one comment precedes it.
   */
  const hasComment = (node: ts.Node) =>
    (ts.getLeadingCommentRanges(source.text, node.getFullStart()) ?? []).length > 0;

  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const call = declaration.initializer;
      if (!call || !ts.isCallExpression(call) || call.expression.getText(source) !== 'pgTable') {
        continue;
      }
      const table = declaration.name.getText(source);
      if (!jsdocBefore(source, statement)) report(statement, `table ${table} has no comment`);
      const [, columns, extras] = call.arguments;
      if (columns && ts.isObjectLiteralExpression(columns)) {
        for (const column of columns.properties) {
          if (!hasComment(column)) {
            report(column, `column ${table}.${column.name?.getText(source)} has no comment`);
          }
        }
      }
      // Indexes: the array returned by the third argument, (table) => [index(...), ...]. One
      // comment on that function covers its indexes (Kite's style: one index per table);
      // otherwise each index needs its own.
      if (
        extras &&
        ts.isArrowFunction(extras) &&
        !hasComment(extras) &&
        ts.isArrayLiteralExpression(extras.body)
      ) {
        for (const element of extras.body.elements) {
          if (!hasComment(element)) report(element, `an index of ${table} has no comment`);
        }
      }
    }
  }
  return problems;
}

/**
 * Runs every check on one file.
 *
 * @param file Path relative to the root.
 * @returns The problems found.
 * Called from: main()
 */
function checkFile(file: string): Problem[] {
  const text = readFileSync(path.join(ROOT, file), 'utf8');
  const problems = checkHeader(file, text);
  const kind = file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  problems.push(...checkCalledFrom(file, source));
  if (path.basename(file) === 'schema.ts') problems.push(...checkSchema(file, source));
  return problems;
}

/**
 * Entry point: checks every source file and prints the gaps (or a one-line OK).
 * With --summary it also prints the number of gaps per check.
 */
function main(): void {
  const files = sourceFiles(SOURCE_DIRS);
  const problems = files.flatMap(checkFile);
  for (const problem of problems) {
    console.error(`${problem.file}:${problem.line}  [${problem.check}] ${problem.message}`);
  }
  if (process.argv.includes('--summary')) {
    const counts: Record<string, number> = {};
    for (const problem of problems) counts[problem.check] = (counts[problem.check] ?? 0) + 1;
    console.log(`files checked: ${files.length}; gaps per check: ${JSON.stringify(counts)}`);
  }
  if (problems.length > 0) {
    console.error(
      `\n${problems.length} commenting-standard gap(s) (CLAUDE.md "Commenting standard").`,
    );
    process.exitCode = 1;
  } else {
    console.log(`File headers and comments: ${files.length} files OK.`);
  }
}

// Run only when executed directly (tests import the checks).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
