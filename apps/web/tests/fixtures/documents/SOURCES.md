# Document fixtures: sources

These files are used by the document-extraction tests (`tests/unit/core/documents/extract.test.ts`). **All of them were generated for these tests** by [`generate-fixtures.ts`](generate-fixtures.ts) in this folder. Their content is invented: no real customer document, no real person, no third-party file. They contain no licensed material.

To change them, edit `generate-fixtures.ts`, then run it from `apps/web`:

```sh
pnpm exec tsx tests/fixtures/documents/generate-fixtures.ts
```

Commit the script and the files together, and update the table below.

| File             | Bytes | SHA-256                                                            | What it is                                                                                                               |
| ---------------- | ----- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `two-pages.pdf`  | 1,043 | `80f33c01ce57bbb50166e94f6d6ba59616636bbf37b23fe4bcb3b82cb76f4551` | PDF 1.4 with two pages of selectable text (Helvetica).                                                                   |
| `table.docx`     | 1,695 | `abf2993a6f164c6a045088ce3f04cf94471c04983f92039eb412b911b7d92b8e` | A minimal Word document: a paragraph, a 2×2 table and a closing paragraph.                                               |
| `notes.txt`      | 92    | `8727055afaf5e1f43b52da7a3c19cae400910dad7228afd6a1eea85e68b5a6bf` | UTF-8 text with Windows line ends, tabs, runs of spaces and extra blank lines, to test whitespace normalisation.         |
| `encrypted.pdf`  | 941   | `18e4f01dc9d3a007d6675e2efed10b72badc9bbabb82debba43bc68302f7d2ec` | One page of text, encrypted with the PDF Standard Security Handler (revision 2, 40-bit RC4). User password: `kite-test`. |
| `image-only.pdf` | 726   | `ad01e4c9c689de0842c2d9f85dd079610aabaaeb3b46295918b90cc85a6a3766` | One page with only a small grey image and no text layer, like a scanned page.                                            |

The PDFs and the DOCX are written byte by byte by the script, so they contain no generator metadata, dates or machine names.
