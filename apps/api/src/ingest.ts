import ExcelJS from "exceljs";
import { extractText, getDocumentProxy } from "unpdf";
import { embedTexts, prisma, toVectorLiteral } from "@workora/core";

export interface Segment {
  text: string;
  metadata: Record<string, unknown>;
}

const CHUNK_SIZE = 3000; // ~750 tokens
const OVERLAP = 400;

export function splitText(text: string, size = CHUNK_SIZE, overlap = OVERLAP): string[] {
  const clean = text.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return [];
  const out: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + size, clean.length);
    if (end < clean.length) {
      const window = clean.slice(start, end);
      const cut = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf(". "), window.lastIndexOf("\n"));
      if (cut > size * 0.5) end = start + cut + 1;
    }
    const piece = clean.slice(start, end).trim();
    if (piece) out.push(piece);
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return out;
}

async function parsePdf(buf: Buffer): Promise<Segment[]> {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: false });
  const segments: Segment[] = [];
  text.forEach((pageText, i) => {
    for (const piece of splitText(pageText)) segments.push({ text: piece, metadata: { page: i + 1 } });
  });
  if (!segments.length) throw new Error("No extractable text found (scanned PDFs are not supported yet).");
  return segments;
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as unknown as Record<string, unknown>;
    if ("result" in o) return cellText(o.result as ExcelJS.CellValue);
    if ("richText" in o) return (o.richText as { text: string }[]).map((r) => r.text).join("");
    if ("text" in o) return String(o.text);
    if ("error" in o) return "";
    return "";
  }
  return String(v).trim();
}

async function parseXlsx(buf: Buffer): Promise<Segment[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const segments: Segment[] = [];

  for (const ws of wb.worksheets) {
    let headers: string[] | null = null;
    let lines: string[] = [];
    let size = 0;
    let firstRow = 0;
    let lastRow = 0;

    const flush = () => {
      if (!lines.length) return;
      segments.push({
        text: `Sheet: ${ws.name}\n${lines.join("\n")}`,
        metadata: { sheet: ws.name, rows: `${firstRow}-${lastRow}` },
      });
      lines = [];
      size = 0;
    };

    ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      const values = (row.values as ExcelJS.CellValue[]).slice(1).map(cellText);
      if (values.every((v) => !v)) return;
      if (!headers) {
        headers = values.map((v, i) => v || `Column ${i + 1}`);
        return;
      }
      const line = values
        .map((v, i) => (v ? `${headers![i] ?? `Column ${i + 1}`}: ${v}` : ""))
        .filter(Boolean)
        .join(" | ");
      if (!line) return;
      if (!lines.length) firstRow = rowNumber;
      lines.push(`Row ${rowNumber}: ${line}`);
      lastRow = rowNumber;
      size += line.length;
      if (size >= CHUNK_SIZE) flush();
    });
    flush();
  }
  if (!segments.length) throw new Error("The spreadsheet contains no data rows.");
  return segments;
}

export function detectKind(buf: Buffer, fileName: string): "pdf" | "xlsx" | null {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".pdf") && buf.subarray(0, 4).toString("latin1") === "%PDF") return "pdf";
  if (lower.endsWith(".xlsx") && buf[0] === 0x50 && buf[1] === 0x4b) return "xlsx";
  return null;
}

export async function processDocument(documentId: string, buf: Buffer, kind: "pdf" | "xlsx") {
  try {
    await prisma.document.update({ where: { id: documentId }, data: { status: "PROCESSING", error: null } });
    const segments = kind === "pdf" ? await parsePdf(buf) : await parseXlsx(buf);
    const embeddings = await embedTexts(segments.map((s) => s.text), "RETRIEVAL_DOCUMENT");

    await prisma.$transaction(async (tx) => {
      await tx.chunk.deleteMany({ where: { documentId } });
      for (let i = 0; i < segments.length; i++) {
        await tx.$executeRaw`
          INSERT INTO "Chunk" (id, "documentId", position, content, metadata, embedding)
          VALUES (gen_random_uuid()::text, ${documentId}, ${i}, ${segments[i].text},
                  ${JSON.stringify(segments[i].metadata)}::jsonb, ${toVectorLiteral(embeddings[i])}::vector)`;
      }
      await tx.document.update({ where: { id: documentId }, data: { status: "READY", chunkCount: segments.length } });
    }, { timeout: 120_000 });
  } catch (err) {
    console.error(`[ingest] ${documentId} failed:`, err);
    await prisma.document
      .update({ where: { id: documentId }, data: { status: "FAILED", error: err instanceof Error ? err.message.slice(0, 500) : "Processing failed" } })
      .catch(() => undefined);
  }
}
