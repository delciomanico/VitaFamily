// Importação de beneficiários (BR-SEG-17, UC-SEG-02): leitura de CSV/XLSX e validação por linha. Tudo puro (sem I/O);
// `fflate` é só descompressão em memória (conventions.md §3.2). Mensagens e erros nunca ecoam dados pessoais.
import { unzipSync } from "fflate";
import { DomainError } from "../../../platform/errors/index.js";
import { isRelationship, normalizeDocumentType } from "./beneficiary.js";
import { fail, isIsoDate } from "./validation.js";

export const MAX_IMPORT_ROWS = 5000;
/** errors.md: `FILE_TOO_LARGE` acima de 10 MB. */
export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
export const MAX_REPORTED_ERRORS = 500;
export const PREVIEW_ROWS = 50;
/** Proteção contra «zip bomb»: soma dos tamanhos descomprimidos (declarados) das entradas lidas do XLSX. */
const MAX_UNZIPPED_BYTES = 64 * 1024 * 1024;
/** Limites do Excel (1.048.576 linhas × 16.384 colunas): referências fora deles são ficheiro inválido (evita linhas/colunas gigantes). */
const MAX_XLSX_ROW = 1_048_576;
const MAX_XLSX_COLUMNS = 16_384;

export type ImportFormat = "CSV" | "XLSX";

export const REQUIRED_COLUMNS = ["name", "idDocumentType", "idDocumentNumber", "birthDate", "relationship"] as const;
const OPTIONAL_COLUMNS = ["holderIdDocumentNumber", "companyTaxId"] as const;
const ALL_COLUMNS = [...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS] as const;
type Column = (typeof ALL_COLUMNS)[number];

/** Linha lida do ficheiro (texto) com o nº da linha (cabeçalho = 1). */
export interface RawImportRow {
  row: number;
  name: string;
  idDocumentType: string;
  idDocumentNumber: string;
  birthDate: string;
  relationship: string;
  holderIdDocumentNumber: string;
  companyTaxId: string;
}

/** Linha válida normalizada (tipo em maiúsculas; `""` = ausente); é o que fica à espera do `commit`. */
export type ImportRow = RawImportRow;

export type ImportIssueCode = "REQUIRED" | "INVALID_FORMAT" | "INVALID_VALUE" | "DUPLICATE_IN_FILE" | "DUPLICATE_EXISTING" | "HOLDER_NOT_FOUND" | "COMPANY_NOT_FOUND";

export interface ImportIssue {
  row: number;
  field: string | null;
  code: ImportIssueCode;
  message: string;
}

export interface ImportLookups {
  /** `TIPO|número` já existentes na seguradora. */
  existingDocuments: Set<string>;
  /** Nº de documento → quantos titulares (HOLDER) existentes o têm. */
  holdersByNumber: Map<string, number>;
  /** NIF das empresas existentes na seguradora. */
  companyTaxIds: Set<string>;
}

export interface ImportClassification {
  valid: ImportRow[];
  issues: ImportIssue[];
  /** Linhas com erro (inclui duplicadas). */
  errorRows: number;
  /** Subconjunto de `errorRows`: documento já existente ou repetido no ficheiro. */
  duplicateRows: number;
}

function notAllowed(detail: string): DomainError {
  return new DomainError("FILE_TYPE_NOT_ALLOWED", { detail });
}

/** Deteta o formato pelo conteúdo e confirma a extensão (CSV ou XLSX; qualquer outra coisa ⇒ `FILE_TYPE_NOT_ALLOWED`). */
export function detectFormat(buffer: Buffer, originalName: string): ImportFormat {
  if (buffer.length === 0) throw notAllowed("Ficheiro vazio.");
  if (buffer.length > MAX_IMPORT_BYTES) throw new DomainError("FILE_TOO_LARGE", { detail: "Ficheiro acima do limite permitido (10 MB)." });
  const extension = originalName.toLowerCase().split(".").pop() ?? "";
  const isZip = buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
  if (extension === "xlsx" && isZip) return "XLSX";
  if (extension === "csv" && !isZip && !buffer.includes(0)) {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(buffer);
      return "CSV";
    } catch {
      throw notAllowed("O CSV tem de estar em UTF-8.");
    }
  }
  throw notAllowed("Tipo de ficheiro não permitido (só CSV e XLSX).");
}

// ---------- CSV ----------

/** Registos CSV (RFC 4180: aspas, aspas duplicadas, quebras de linha entre aspas). */
export function parseCsvRecords(text: string, separator: string): string[][] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (quoted) {
      if (ch === '"') {
        if (text.charAt(i + 1) === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === separator) {
      record.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text.charAt(i + 1) === "\n") i++;
      record.push(field);
      records.push(record);
      field = "";
      record = [];
    } else field += ch;
  }
  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }
  return records;
}

function detectSeparator(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  return (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
}

function readCsv(buffer: Buffer): string[][] {
  const text = new TextDecoder("utf-8").decode(buffer).replace(/^\uFEFF/, "");
  return parseCsvRecords(text, detectSeparator(text));
}

// ---------- XLSX (1.ª folha) ----------

/** Referência numérica de caractere (`&#..;`): NUL, substitutos soltos e acima de U+10FFFF dariam `RangeError` (500) ou `\u0000` (o jsonb rejeita) ⇒ U+FFFD. */
function codePointOf(value: number): string {
  const valid = Number.isInteger(value) && value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff);
  return valid ? String.fromCodePoint(value) : "\uFFFD";
}

function decodeXml(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => codePointOf(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => codePointOf(parseInt(dec, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** Concatena os `<t>` de um bloco (strings partilhadas/inline podem vir em vários `<r><t>`). */
function textOf(xml: string): string {
  let out = "";
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += decodeXml(m[1] ?? "");
  return out;
}

function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref.replace(/\d+/g, "")) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Série de data do Excel (dias desde 1899-12-30) → `AAAA-MM-DD`. */
export function excelSerialToIsoDate(serial: number): string {
  return new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000).toISOString().slice(0, 10);
}

function readXlsx(buffer: Buffer): string[][] {
  let files: Record<string, Uint8Array>;
  let declaredTotal = 0;
  try {
    files = unzipSync(new Uint8Array(buffer), {
      // O fflate aloca e limita a descompressão ao tamanho declarado; o limite é sobre a SOMA das entradas lidas (muitas
      // entradas de 64 MB cada seriam uma «zip bomb» de vários GB).
      filter: (f) => {
        if (!(f.name === "xl/workbook.xml" || f.name === "xl/_rels/workbook.xml.rels" || f.name === "xl/sharedStrings.xml" || f.name.startsWith("xl/worksheets/"))) return false;
        declaredTotal += f.originalSize;
        if (declaredTotal > MAX_UNZIPPED_BYTES) throw new Error("XLSX descomprimido demasiado grande");
        return true;
      },
    });
  } catch {
    throw notAllowed("XLSX inválido.");
  }
  const read = (name: string): string | undefined => {
    const data = files[name];
    return data ? new TextDecoder("utf-8").decode(data) : undefined;
  };
  const workbook = read("xl/workbook.xml");
  if (workbook === undefined) throw notAllowed("XLSX inválido.");
  // 1.ª folha pela ordem do livro; sem relações legíveis cai em `sheet1.xml`.
  const firstRid = /<sheet\b[^>]*\br:id="([^"]+)"/.exec(workbook)?.[1];
  const rels = read("xl/_rels/workbook.xml.rels") ?? "";
  let target = "worksheets/sheet1.xml";
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const tag = m[0];
    if (firstRid !== undefined && /\bId="([^"]*)"/.exec(tag)?.[1] === firstRid) {
      const t = /\bTarget="([^"]+)"/.exec(tag)?.[1];
      if (t !== undefined) target = t.replace(/^\/?(xl\/)?/, "");
    }
  }
  const sheet = read(`xl/${target}`) ?? read("xl/worksheets/sheet1.xml");
  if (sheet === undefined) throw notAllowed("XLSX inválido.");

  const shared: string[] = [];
  for (const m of (read("xl/sharedStrings.xml") ?? "").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) shared.push(textOf(m[1] ?? ""));

  const rows: string[][] = [];
  for (const rowMatch of sheet.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rowNumber = Number(/\br="(\d+)"/.exec(rowMatch[1] ?? "")?.[1] ?? rows.length + 1);
    if (!Number.isSafeInteger(rowNumber) || rowNumber < 1 || rowNumber > MAX_XLSX_ROW) throw notAllowed("XLSX inválido.");
    const cells: string[] = [];
    let next = 0;
    for (const cell of (rowMatch[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cell[1] ?? "";
      const index = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const col = index === undefined ? next : columnIndex(index);
      if (col < 0 || col >= MAX_XLSX_COLUMNS) throw notAllowed("XLSX inválido.");
      next = col + 1;
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1];
      const body = cell[2] ?? "";
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = "";
      if (type === "s") value = shared[Number(v)] ?? "";
      else if (type === "inlineStr") value = textOf(body);
      else if (v !== undefined) value = decodeXml(v);
      cells[col] = value;
    }
    // preserva o nº real da linha; as intermédias ficam por preencher (array esparso: nunca se materializam milhões de linhas)
    for (let i = 0; i < cells.length; i++) cells[i] ??= ""; // células intermédias ausentes
    rows[rowNumber - 1] = cells;
  }
  return rows;
}

/** Registos (linha 1 = cabeçalho) do ficheiro; `XLSX` é lido da 1.ª folha. */
export function readRecords(format: ImportFormat, buffer: Buffer): string[][] {
  return format === "CSV" ? readCsv(buffer) : readXlsx(buffer);
}

/**
 * Converte registos em linhas: valida o cabeçalho (colunas obrigatórias ⇒ `VALIDATION_ERROR`), ignora linhas totalmente
 * vazias, exige 1..5.000 linhas de dados. No XLSX uma `birthDate` numérica (série do Excel) converte-se para `AAAA-MM-DD`.
 */
export function recordsToRows(records: string[][], format: ImportFormat): RawImportRow[] {
  const header = (records[0] ?? []).map((h) => h.trim().toLowerCase());
  const indexOf = new Map<Column, number>();
  for (const column of ALL_COLUMNS) {
    const i = header.indexOf(column.toLowerCase());
    if (i >= 0) indexOf.set(column, i);
  }
  const missing = REQUIRED_COLUMNS.filter((c) => !indexOf.has(c));
  if (missing.length > 0) fail("file", `colunas em falta: ${missing.join(", ")}`, "Cabeçalho do ficheiro inválido.");

  const rows: RawImportRow[] = [];
  records.forEach((record, i) => {
    if (i === 0 || record.every((c) => c.trim() === "")) return;
    const cell = (c: Column): string => (record[indexOf.get(c) ?? -1] ?? "").trim();
    let birthDate = cell("birthDate");
    if (format === "XLSX" && /^\d{4,6}(\.\d+)?$/.test(birthDate)) birthDate = excelSerialToIsoDate(Number(birthDate));
    rows.push({
      row: i + 1,
      name: cell("name"),
      idDocumentType: cell("idDocumentType"),
      idDocumentNumber: cell("idDocumentNumber"),
      birthDate,
      relationship: cell("relationship"),
      holderIdDocumentNumber: cell("holderIdDocumentNumber"),
      companyTaxId: cell("companyTaxId"),
    });
  });
  if (rows.length === 0) fail("file", "sem linhas de dados", "O ficheiro não tem linhas de dados.");
  if (rows.length > MAX_IMPORT_ROWS) fail("file", `no máximo ${String(MAX_IMPORT_ROWS)} linhas`, "O ficheiro excede o limite de linhas.");
  return rows;
}

export function parseImportFile(buffer: Buffer, originalName: string): { format: ImportFormat; rows: RawImportRow[] } {
  const format = detectFormat(buffer, originalName);
  return { format, rows: recordsToRows(readRecords(format, buffer), format) };
}

// ---------- Classificação por linha ----------

const documentKey = (type: string, number: string): string => `${type}|${number}`;

/**
 * Valida cada linha (campos), deteta duplicados (no ficheiro: a 1.ª ocorrência fica; na seguradora) e resolve titular e
 * empresa. Pura: o `commit` volta a chamá-la com `lookups` frescos para apanhar alterações entre a pré-visualização e a
 * confirmação.
 */
export function classifyImportRows(rows: RawImportRow[], lookups: ImportLookups): ImportClassification {
  const issues: ImportIssue[] = [];
  const errored = new Set<number>();
  const duplicated = new Set<number>();
  const flag = (row: number, field: string | null, code: ImportIssueCode, message: string): void => {
    issues.push({ row, field, code, message });
    errored.add(row);
    if (code === "DUPLICATE_IN_FILE" || code === "DUPLICATE_EXISTING") duplicated.add(row);
  };

  const candidates: ImportRow[] = [];
  for (const raw of rows) {
    const before = issues.length;
    const required: [keyof RawImportRow, string][] = [["name", "name"], ["idDocumentType", "idDocumentType"], ["idDocumentNumber", "idDocumentNumber"], ["birthDate", "birthDate"], ["relationship", "relationship"]];
    for (const [key, field] of required) if (String(raw[key]).trim() === "") flag(raw.row, field, "REQUIRED", "Campo obrigatório.");
    if (raw.name.length > 200) flag(raw.row, "name", "INVALID_VALUE", "Demasiado longo.");
    if (raw.idDocumentType.length > 40) flag(raw.row, "idDocumentType", "INVALID_VALUE", "Demasiado longo.");
    if (raw.idDocumentNumber.length > 60) flag(raw.row, "idDocumentNumber", "INVALID_VALUE", "Demasiado longo.");
    if (raw.birthDate !== "" && !isIsoDate(raw.birthDate)) flag(raw.row, "birthDate", "INVALID_FORMAT", "Data inválida (AAAA-MM-DD).");
    const relationship = raw.relationship.toUpperCase();
    if (raw.relationship !== "" && !isRelationship(relationship)) flag(raw.row, "relationship", "INVALID_VALUE", "Valor inválido.");
    else if (raw.relationship !== "") {
      if (relationship === "HOLDER" && raw.holderIdDocumentNumber !== "") flag(raw.row, "holderIdDocumentNumber", "INVALID_VALUE", "Proibido para o titular.");
      if (relationship !== "HOLDER" && raw.holderIdDocumentNumber === "") flag(raw.row, "holderIdDocumentNumber", "REQUIRED", "Obrigatório para dependentes.");
    }
    if (issues.length === before) {
      candidates.push({ ...raw, idDocumentType: normalizeDocumentType(raw.idDocumentType), relationship });
    }
  }

  // Duplicados (documento) e empresa — só em linhas sem erro de campo.
  const seen = new Set<string>();
  const afterDuplicates: ImportRow[] = [];
  for (const row of candidates) {
    const key = documentKey(row.idDocumentType, row.idDocumentNumber);
    if (lookups.existingDocuments.has(key)) flag(row.row, "idDocumentNumber", "DUPLICATE_EXISTING", "Documento já existente na seguradora.");
    else if (seen.has(key)) flag(row.row, "idDocumentNumber", "DUPLICATE_IN_FILE", "Documento repetido no ficheiro.");
    else {
      seen.add(key);
      if (row.companyTaxId !== "" && !lookups.companyTaxIds.has(row.companyTaxId)) flag(row.row, "companyTaxId", "COMPANY_NOT_FOUND", "Empresa inexistente.");
      else afterDuplicates.push(row);
    }
  }

  // Titulares: existentes na seguradora ou titulares válidos do próprio ficheiro.
  const fileHolders = new Set(afterDuplicates.filter((r) => r.relationship === "HOLDER").map((r) => r.idDocumentNumber));
  const valid: ImportRow[] = [];
  for (const row of afterDuplicates) {
    if (row.relationship === "HOLDER") valid.push(row);
    else if (fileHolders.has(row.holderIdDocumentNumber)) valid.push(row);
    else {
      const existing = lookups.holdersByNumber.get(row.holderIdDocumentNumber) ?? 0;
      if (existing === 0) flag(row.row, "holderIdDocumentNumber", "HOLDER_NOT_FOUND", "Titular inexistente.");
      else if (existing > 1) flag(row.row, "holderIdDocumentNumber", "INVALID_VALUE", "Titular ambíguo.");
      else valid.push(row);
    }
  }
  issues.sort((a, b) => a.row - b.row);
  return { valid, issues, errorRows: errored.size, duplicateRows: duplicated.size };
}

export { documentKey };
