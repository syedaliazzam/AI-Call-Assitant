/**
 * File: apps/web/tests/fixtures/documents/generate-fixtures.ts
 * Purpose: Writes the small, invented test documents in this folder (two-pages.pdf,
 *          encrypted.pdf, image-only.pdf, table.docx, notes.txt) from code, so their exact
 *          content is known, reviewable and reproducible. No real customer document is ever used.
 *          Usage (from apps/web): pnpm exec tsx tests/fixtures/documents/generate-fixtures.ts
 * Used by: developers, when a fixture must change (the output files are committed)
 * Depends on: Node.js (fs, crypto MD5, zlib CRC-32); no other packages
 * Architecture: docs/architecture/kite-architecture-v3.1.md §11; day-03-sessions.md Stage 2
 *
 * The PDFs are written by hand (PDF 1.4 syntax, standard Helvetica font). encrypted.pdf uses
 * the PDF Standard Security Handler, revision 2 (40-bit RC4), with the user password
 * "kite-test": the simplest scheme every PDF reader understands. The DOCX is a minimal Office
 * Open XML package (a zip without compression).
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32 } from 'node:zlib';

/** This folder. */
const DIR = path.dirname(fileURLToPath(import.meta.url));

/** Password of encrypted.pdf (also in SOURCES.md). */
export const ENCRYPTED_PDF_PASSWORD = 'kite-test';

/** Page texts of two-pages.pdf (invented). */
export const TWO_PAGES_TEXT = [
  ['Northwind Logistics pricing overview', 'The professional plan costs 52 dollars per seat.'],
  ['Page two: renewal terms', 'Bluefin Route renews every twelve months.'],
];

/** One PDF object: its number and body (without "obj" / "endobj"). */
interface PdfObject {
  /** Object number (1-based; generation is always 0). */
  num: number;
  /** The object's body, as bytes. */
  body: Buffer;
}

/**
 * RC4 stream cipher (PDF encryption). Encrypting and decrypting are the same operation.
 *
 * @param key  Key bytes.
 * @param data Bytes to encrypt.
 * @returns The encrypted bytes.
 */
function rc4(key: Buffer, data: Buffer): Buffer {
  const s = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 0, j = 0; i < 256; i += 1) {
    j = (j + s[i]! + key[i % key.length]!) & 255;
    [s[i], s[j]] = [s[j]!, s[i]!];
  }
  const out = Buffer.alloc(data.length);
  for (let n = 0, i = 0, j = 0; n < data.length; n += 1) {
    i = (i + 1) & 255;
    j = (j + s[i]!) & 255;
    [s[i], s[j]] = [s[j]!, s[i]!];
    out[n] = data[n]! ^ s[(s[i]! + s[j]!) & 255]!;
  }
  return out;
}

/**
 * MD5 of some byte strings joined.
 *
 * @param parts The bytes.
 * @returns The 16-byte digest.
 */
function md5(...parts: Buffer[]): Buffer {
  const hash = createHash('md5');
  for (const part of parts) hash.update(part);
  return hash.digest();
}

/** The 32-byte padding string from the PDF specification (Standard Security Handler). */
const PAD = Buffer.from('28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a', 'hex');

/**
 * Pads or cuts a password to 32 bytes, as the PDF specification requires.
 *
 * @param password The password.
 * @returns 32 bytes.
 */
function padPassword(password: string): Buffer {
  return Buffer.concat([Buffer.from(password, 'latin1'), PAD]).subarray(0, 32);
}

/** Everything needed to encrypt a PDF with revision 2 (40-bit RC4). */
interface Encryption {
  /** The file encryption key (5 bytes). */
  key: Buffer;
  /** The /O value (owner password check). */
  o: Buffer;
  /** The /U value (user password check). */
  u: Buffer;
  /** The /P value: permission flags (all allowed). */
  p: number;
  /** The first file identifier (/ID), part of the key. */
  id: Buffer;
}

/**
 * Computes the revision-2 encryption values (PDF 1.4 specification, algorithms 3.2–3.4).
 *
 * @param userPassword  Password needed to open the file.
 * @param ownerPassword Owner password.
 * @returns The key and the /O, /U, /P and /ID values.
 */
function encryptionFor(userPassword: string, ownerPassword: string): Encryption {
  const id = md5(Buffer.from('kite-fixture-encrypted'));
  const p = -4; // every permission bit set
  const o = rc4(md5(padPassword(ownerPassword)).subarray(0, 5), padPassword(userPassword));
  const pBytes = Buffer.alloc(4);
  pBytes.writeInt32LE(p);
  const key = md5(padPassword(userPassword), o, pBytes, id).subarray(0, 5);
  const u = rc4(key, PAD);
  return { key, o, u, p, id };
}

/**
 * Encrypts one string or stream of an object (algorithm 3.1: key + object and generation number).
 *
 * @param enc  The encryption values.
 * @param num  The object number.
 * @param data The bytes.
 * @returns The encrypted bytes.
 */
function encryptForObject(enc: Encryption, num: number, data: Buffer): Buffer {
  const objectBytes = Buffer.from([num & 255, (num >> 8) & 255, (num >> 16) & 255, 0, 0]);
  const objectKey = md5(enc.key, objectBytes).subarray(0, Math.min(enc.key.length + 5, 16));
  return rc4(objectKey, data);
}

/**
 * A PDF content stream that writes lines of text in Helvetica.
 *
 * @param lines The lines (ASCII only).
 * @returns The content stream's bytes.
 */
function textContent(lines: readonly string[]): Buffer {
  const escaped = lines.map((line) => line.replace(/([\\()])/g, '\\$1'));
  const ops = escaped.map((line, i) => `${i === 0 ? '' : '0 -24 Td '}(${line}) Tj`).join('\n');
  return Buffer.from(`BT\n/F1 14 Tf\n72 720 Td\n${ops}\nET\n`, 'latin1');
}

/**
 * Builds a complete PDF file from its objects (header, objects, cross-reference table,
 * trailer). Object 1 must be the catalog.
 *
 * @param objects The objects, numbered 1…n in order.
 * @param trailerExtra Extra trailer entries (for example /Encrypt and /ID).
 * @returns The file.
 */
function pdfFile(objects: PdfObject[], trailerExtra = ''): Buffer {
  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
  const offsets: number[] = [];
  let length = parts[0]!.length;
  for (const object of objects) {
    offsets[object.num] = length;
    const chunk = Buffer.concat([
      Buffer.from(`${object.num} 0 obj\n`, 'latin1'),
      object.body,
      Buffer.from('\nendobj\n', 'latin1'),
    ]);
    parts.push(chunk);
    length += chunk.length;
  }
  const xref = [
    'xref',
    `0 ${objects.length + 1}`,
    '0000000000 65535 f ',
    ...objects.map((o) => `${String(offsets[o.num]).padStart(10, '0')} 00000 n `),
    'trailer',
    `<< /Size ${objects.length + 1} /Root 1 0 R ${trailerExtra}>>`,
    'startxref',
    String(length),
    '%%EOF',
    '',
  ].join('\n');
  parts.push(Buffer.from(xref, 'latin1'));
  return Buffer.concat(parts);
}

/**
 * A stream object body (dictionary + stream data).
 *
 * @param data The stream bytes.
 * @param dict Extra dictionary entries.
 * @returns The body.
 */
function streamBody(data: Buffer, dict = ''): Buffer {
  return Buffer.concat([
    Buffer.from(`<< /Length ${data.length} ${dict}>>\nstream\n`, 'latin1'),
    data,
    Buffer.from('\nendstream', 'latin1'),
  ]);
}

/**
 * The objects of a text PDF: catalog, page tree, font, then one page and one content stream
 * per page.
 *
 * @param pages Lines of each page.
 * @param enc   Encryption values, or null for a plain file.
 * @returns The objects.
 */
function textPdfObjects(pages: readonly (readonly string[])[], enc: Encryption | null) {
  const pageNums = pages.map((_, i) => 4 + i * 2);
  const objects: PdfObject[] = [
    { num: 1, body: Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'latin1') },
    {
      num: 2,
      body: Buffer.from(
        `<< /Type /Pages /Kids [${pageNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${pages.length} >>`,
        'latin1',
      ),
    },
    {
      num: 3,
      body: Buffer.from(
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
        'latin1',
      ),
    },
  ];
  pages.forEach((lines, i) => {
    const pageNum = pageNums[i]!;
    const contentNum = pageNum + 1;
    objects.push({
      num: pageNum,
      body: Buffer.from(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentNum} 0 R >>`,
        'latin1',
      ),
    });
    const content = textContent(lines);
    objects.push({
      num: contentNum,
      body: streamBody(enc ? encryptForObject(enc, contentNum, content) : content),
    });
  });
  return objects;
}

/**
 * two-pages.pdf: two pages of selectable text.
 *
 * @returns The file.
 */
function twoPagesPdf(): Buffer {
  return pdfFile(textPdfObjects(TWO_PAGES_TEXT, null));
}

/**
 * encrypted.pdf: one page of text, encrypted; opening it needs ENCRYPTED_PDF_PASSWORD.
 *
 * @returns The file.
 */
function encryptedPdf(): Buffer {
  const enc = encryptionFor(ENCRYPTED_PDF_PASSWORD, 'kite-owner');
  const objects = textPdfObjects([['Confidential invented text']], enc);
  const encryptNum = objects.length + 1;
  objects.push({
    num: encryptNum,
    body: Buffer.from(
      `<< /Filter /Standard /V 1 /R 2 /O <${enc.o.toString('hex')}> /U <${enc.u.toString('hex')}> /P ${enc.p} >>`,
      'latin1',
    ),
  });
  const id = enc.id.toString('hex');
  return pdfFile(objects, `/Encrypt ${encryptNum} 0 R /ID [<${id}> <${id}>] `);
}

/**
 * image-only.pdf: one page with only a small grey image and no text, like a scanned page.
 *
 * @returns The file.
 */
function imageOnlyPdf(): Buffer {
  const pixels = Buffer.alloc(8 * 8, 0x80); // 8×8 grey, 8 bits per pixel
  const content = Buffer.from('q 200 0 0 200 72 500 cm /Im1 Do Q\n', 'latin1');
  return pdfFile([
    { num: 1, body: Buffer.from('<< /Type /Catalog /Pages 2 0 R >>', 'latin1') },
    { num: 2, body: Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>', 'latin1') },
    {
      num: 3,
      body: Buffer.from(
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>',
        'latin1',
      ),
    },
    { num: 4, body: streamBody(content) },
    {
      num: 5,
      body: streamBody(
        pixels,
        '/Type /XObject /Subtype /Image /Width 8 /Height 8 /ColorSpace /DeviceGray /BitsPerComponent 8 ',
      ),
    },
  ]);
}

/**
 * A zip file with every entry stored uncompressed (enough for a DOCX).
 *
 * @param entries File name → content.
 * @returns The zip file.
 */
function storedZip(entries: Record<string, string>): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const data = Buffer.from(content, 'utf8');
    const fileName = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); // local file header signature
    header.writeUInt16LE(20, 4); // version needed
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(fileName.length, 26);
    local.push(header, fileName, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0); // central directory signature
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(fileName.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, fileName);
    offset += header.length + fileName.length + data.length;
  }
  const centralSize = central.reduce((sum, b) => sum + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory signature
  end.writeUInt16LE(central.length / 2, 8);
  end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}

/**
 * table.docx: a heading paragraph, a 2×2 table and a closing paragraph (invented text).
 *
 * @returns The file.
 */
function tableDocx(): Buffer {
  const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const para = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
  const cell = (text: string) => `<w:tc>${para(text)}</w:tc>`;
  const body = [
    para('Quarterly review agenda'),
    `<w:tbl><w:tr>${cell('Product')}${cell('Seats')}</w:tr><w:tr>${cell('Professional plan')}${cell('150')}</w:tr></w:tbl>`,
    para('Next step: confirm the renewal date.'),
  ].join('');
  return storedZip({
    '[Content_Types].xml':
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    '_rels/.rels':
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    'word/document.xml': `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${w}"><w:body>${body}</w:body></w:document>`,
  });
}

/**
 * notes.txt: plain text with messy whitespace (Windows line ends, tabs, runs of spaces, many
 * blank lines) to test normalisation.
 *
 * @returns The file.
 */
function notesTxt(): Buffer {
  return Buffer.from(
    'Call notes\r\n\r\n\r\n\r\nAsk about   the\tNorthwind  Logistics rollout.  \r\nBudget: 12,000 dollars.\r\n',
    'utf8',
  );
}

/** Entry point: writes every fixture next to this file. */
function main(): void {
  const files: Record<string, Buffer> = {
    'two-pages.pdf': twoPagesPdf(),
    'encrypted.pdf': encryptedPdf(),
    'image-only.pdf': imageOnlyPdf(),
    'table.docx': tableDocx(),
    'notes.txt': notesTxt(),
  };
  for (const [name, bytes] of Object.entries(files)) {
    writeFileSync(path.join(DIR, name), bytes);
    console.log(`wrote ${name} (${bytes.length} bytes)`);
  }
}

// Run only when executed directly (tests import the constants above).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
