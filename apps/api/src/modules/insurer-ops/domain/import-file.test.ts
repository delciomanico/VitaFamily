// BR-SEG-17 / TC-SEG-01 (unidade): leitura CSV/XLSX e classificação por linha; sem I/O.
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { classifyImportRows, detectFormat, excelSerialToIsoDate, MAX_IMPORT_ROWS, parseCsvRecords, parseImportFile, type ImportLookups, type RawImportRow } from "./import-file.js";

/** Código do erro de domínio lançado por `fn` (ou `undefined` se não lançar). */
function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return undefined;
}


const HEADER = "name,idDocumentType,idDocumentNumber,birthDate,relationship,holderIdDocumentNumber,companyTaxId";
const csv = (...lines: string[]): Buffer => Buffer.from([HEADER, ...lines].join("\n"), "utf-8");

function xlsx(records: (string | number)[][]): Buffer {
  const rows = records
    .map((rec, r) => `<row r="${String(r + 1)}">${rec.map((v, c) => (typeof v === "number" ? `<c r="${String.fromCharCode(65 + c)}${String(r + 1)}"><v>${String(v)}</v></c>` : `<c r="${String.fromCharCode(65 + c)}${String(r + 1)}" t="inlineStr"><is><t>${v}</t></is></c>`)).join("")}</row>`)
    .join("");
  return Buffer.from(
    zipSync({
      "xl/workbook.xml": strToU8('<workbook xmlns:r="x"><sheets><sheet name="a" sheetId="1" r:id="rId1"/></sheets></workbook>'),
      "xl/_rels/workbook.xml.rels": strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
      "xl/worksheets/sheet1.xml": strToU8(`<worksheet><sheetData>${rows}</sheetData></worksheet>`),
    }),
  );
}

const NO_LOOKUPS: ImportLookups = { existingDocuments: new Set(), holdersByNumber: new Map(), companyTaxIds: new Set() };
const row = (over: Partial<RawImportRow> = {}): RawImportRow => ({
  row: 2,
  name: "Ana",
  idDocumentType: "bi",
  idDocumentNumber: "001",
  birthDate: "1990-01-31",
  relationship: "holder",
  holderIdDocumentNumber: "",
  companyTaxId: "",
  ...over,
});

describe("leitura de ficheiros", () => {
  it("CSV com ';', aspas, aspas duplicadas, quebra de linha entre aspas e BOM", () => {
    const text = '﻿name;idDocumentType;idDocumentNumber;birthDate;relationship\n"Silva; ""Jr""\nX";BI;1;1990-01-01;HOLDER\n';
    const { format, rows } = parseImportFile(Buffer.from(text, "utf-8"), "lote.csv");
    expect(format).toBe("CSV");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ row: 2, name: 'Silva; "Jr"\nX', idDocumentType: "BI" });
  });

  it("parseCsvRecords lida com CRLF e linha final sem quebra", () => {
    expect(parseCsvRecords("a,b\r\nc,d", ",")).toEqual([["a", "b"], ["c", "d"]]);
  });

  it("XLSX: 1.ª folha, números de linha reais e data em série do Excel", () => {
    const { format, rows } = parseImportFile(xlsx([["name", "idDocumentType", "idDocumentNumber", "birthDate", "relationship"], ["Rui", "BI", "9", 32874, "HOLDER"]]), "lote.xlsx");
    expect(format).toBe("XLSX");
    expect(rows[0]).toMatchObject({ row: 2, name: "Rui", birthDate: "1990-01-01" });
    expect(excelSerialToIsoDate(32874)).toBe("1990-01-01");
  });

  describe("XLSX malicioso (DoS)", () => {
    const wrap = (sheet: string, extra: Record<string, Uint8Array> = {}): Buffer =>
      Buffer.from(
        zipSync({
          "xl/workbook.xml": strToU8('<workbook xmlns:r="x"><sheets><sheet name="a" sheetId="1" r:id="rId1"/></sheets></workbook>'),
          "xl/_rels/workbook.xml.rels": strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),
          "xl/worksheets/sheet1.xml": strToU8(sheet),
          ...extra,
        }),
      );

    it("linha com número gigante (r=\"99999999999\") ⇒ FILE_TYPE_NOT_ALLOWED, sem alocar milhões de linhas", () => {
      expect(codeOf(() => parseImportFile(wrap('<worksheet><sheetData><row r="99999999999"><c r="A1" t="inlineStr"><is><t>x</t></is></c></row></sheetData></worksheet>'), "a.xlsx"))).toBe("FILE_TYPE_NOT_ALLOWED");
    });

    it("coluna fora do limite do Excel (ZZZZZZZZZZ1) ⇒ FILE_TYPE_NOT_ALLOWED, sem laço gigante", () => {
      expect(codeOf(() => parseImportFile(wrap('<worksheet><sheetData><row r="1"><c r="ZZZZZZZZZZ1" t="inlineStr"><is><t>x</t></is></c></row></sheetData></worksheet>'), "a.xlsx"))).toBe("FILE_TYPE_NOT_ALLOWED");
    });

    it("r:id com metacaracteres de regex não é compilado como expressão regular (sem ReDoS)", () => {
      const evil = "(a+)+$";
      const buffer = Buffer.from(
        zipSync({
          "xl/workbook.xml": strToU8(`<workbook xmlns:r="x"><sheets><sheet name="a" sheetId="1" r:id="${evil}"/></sheets></workbook>`),
          "xl/_rels/workbook.xml.rels": strToU8(`<Relationships><Relationship Id="${"a".repeat(40)}!" Target="worksheets/sheet1.xml"/></Relationships>`),
          "xl/worksheets/sheet1.xml": strToU8(`<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>name</t></is></c></row></sheetData></worksheet>`),
        }),
      );
      const started = Date.now();
      expect(codeOf(() => parseImportFile(buffer, "a.xlsx"))).toBe("VALIDATION_ERROR"); // cabeçalho incompleto, não bloqueio
      expect(Date.now() - started).toBeLessThan(1000);
    });

    it("referências numéricas inválidas (&#0;, substituto solto, > U+10FFFF) viram U+FFFD: nunca 500 nem \\u0000 no jsonb", () => {
      const cell = (ref: string, v: string) => `<c r="${ref}" t="inlineStr"><is><t>${v}</t></is></c>`;
      const header = ["name", "idDocumentType", "idDocumentNumber", "birthDate", "relationship"].map((h, i) => cell(`${String.fromCharCode(65 + i)}1`, h)).join("");
      const data = [cell("A2", "Ana&#0;&#xD800;&#x110000;&#99999999999;"), cell("B2", "BI"), cell("C2", "1"), cell("D2", "1990-01-01"), cell("E2", "HOLDER")].join("");
      const { rows } = parseImportFile(wrap(`<worksheet><sheetData><row r="1">${header}</row><row r="2">${data}</row></sheetData></worksheet>`), "a.xlsx");
      expect(rows[0]?.name).toBe("Ana\uFFFD\uFFFD\uFFFD\uFFFD");
      expect(JSON.stringify(rows)).not.toContain("\\u0000");
    });

    it("soma dos tamanhos descomprimidos (declarados) acima do limite ⇒ FILE_TYPE_NOT_ALLOWED, antes de alocar", () => {
      // Duas «folhas» de 1 byte reais que declaram 40 MB cada (cada uma abaixo do limite; a soma, acima).
      const zip = wrap("<worksheet/>", { "xl/worksheets/extra1.xml": strToU8("x"), "xl/worksheets/extra2.xml": strToU8("y") });
      const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
      for (let i = 0; i < zip.length - 46; i++) {
        if (view.getUint32(i, true) !== 0x02014b50) continue; // entrada do diretório central
        const nameLength = view.getUint16(i + 28, true);
        const name = zip.subarray(i + 46, i + 46 + nameLength).toString("utf8");
        if (name.startsWith("xl/worksheets/extra")) view.setUint32(i + 24, 40 * 1024 * 1024, true);
      }
      expect(codeOf(() => parseImportFile(zip, "a.xlsx"))).toBe("FILE_TYPE_NOT_ALLOWED");
    });
  });

  it.each([
    ["vazio", Buffer.alloc(0), "a.csv"],
    ["extensão errada", csv("A,BI,1,1990-01-01,HOLDER,,"), "a.pdf"],
    ["PDF binário como .csv", Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0x01]), "a.csv"],
    ["zip com extensão .csv", xlsx([["a"]]), "a.csv"],
    ["texto com extensão .xlsx", csv("A,BI,1,1990-01-01,HOLDER,,"), "a.xlsx"],
    ["CSV não UTF-8", Buffer.from([0x6e, 0xe3, 0x6f]), "a.csv"],
  ])("tipo/conteúdo inválido (%s) ⇒ FILE_TYPE_NOT_ALLOWED", (_n, buffer, name) => {
    expect(codeOf(() => detectFormat(buffer, name))).toBe("FILE_TYPE_NOT_ALLOWED");
  });

  it("acima de 10 MB ⇒ FILE_TOO_LARGE", () => {
    expect(codeOf(() => detectFormat(Buffer.alloc(10 * 1024 * 1024 + 1, 0x61), "a.csv"))).toBe("FILE_TOO_LARGE");
  });

  it("5.000 linhas OK; 5.001 ⇒ VALIDATION_ERROR; só cabeçalho ⇒ VALIDATION_ERROR; coluna obrigatória em falta ⇒ VALIDATION_ERROR", () => {
    const lines = (n: number) => Array.from({ length: n }, (_v, i) => `P${String(i)},BI,${String(i)},1990-01-01,HOLDER,,`);
    expect(parseImportFile(csv(...lines(MAX_IMPORT_ROWS)), "a.csv").rows).toHaveLength(MAX_IMPORT_ROWS);
    expect(codeOf(() => parseImportFile(csv(...lines(MAX_IMPORT_ROWS + 1)), "a.csv"))).toBe("VALIDATION_ERROR");
    expect(codeOf(() => parseImportFile(csv(), "a.csv"))).toBe("VALIDATION_ERROR");
    expect(codeOf(() => parseImportFile(Buffer.from("name,idDocumentNumber\nA,1"), "a.csv"))).toBe("VALIDATION_ERROR");
  });

  it("linhas totalmente vazias são ignoradas mas mantêm a numeração", () => {
    const { rows } = parseImportFile(csv("", "Ana,BI,1,1990-01-01,HOLDER,,"), "a.csv");
    expect(rows.map((r) => r.row)).toEqual([3]);
  });
});

describe("classifyImportRows", () => {
  it("linha válida: tipo e relação normalizados; resultado sem erros", () => {
    const r = classifyImportRows([row()], NO_LOOKUPS);
    expect(r.valid[0]).toMatchObject({ idDocumentType: "BI", relationship: "HOLDER" });
    expect(r).toMatchObject({ errorRows: 0, duplicateRows: 0, issues: [] });
  });

  it.each([
    ["REQUIRED", row({ name: "" }), "name"],
    ["INVALID_FORMAT", row({ birthDate: "31/01/1990" }), "birthDate"],
    ["INVALID_FORMAT", row({ birthDate: "2026-02-30" }), "birthDate"],
    ["INVALID_VALUE", row({ relationship: "PRIMO" }), "relationship"],
    ["REQUIRED", row({ relationship: "CHILD" }), "holderIdDocumentNumber"],
    ["INVALID_VALUE", row({ holderIdDocumentNumber: "5" }), "holderIdDocumentNumber"],
    ["COMPANY_NOT_FOUND", row({ companyTaxId: "999" }), "companyTaxId"],
    ["HOLDER_NOT_FOUND", row({ relationship: "CHILD", holderIdDocumentNumber: "404" }), "holderIdDocumentNumber"],
  ])("%s", (code, input, field) => {
    const r = classifyImportRows([input], NO_LOOKUPS);
    expect(r.valid).toHaveLength(0);
    expect(r.issues).toEqual([expect.objectContaining({ row: 2, code, field })]);
    expect(r.errorRows).toBe(1);
  });

  it("duplicado no ficheiro (1.ª ocorrência fica) e duplicado na seguradora; ambos contam em duplicateRows", () => {
    const lookups = { ...NO_LOOKUPS, existingDocuments: new Set(["BI|7"]) };
    const r = classifyImportRows([row({ row: 2 }), row({ row: 3 }), row({ row: 4, idDocumentNumber: "7" })], lookups);
    expect(r.valid.map((v) => v.row)).toEqual([2]);
    expect(r.issues.map((i) => [i.row, i.code])).toEqual([[3, "DUPLICATE_IN_FILE"], [4, "DUPLICATE_EXISTING"]]);
    expect(r).toMatchObject({ errorRows: 2, duplicateRows: 2 });
  });

  it("titular no próprio ficheiro ou já existente; titular inválido não serve de titular", () => {
    const lookups = { ...NO_LOOKUPS, holdersByNumber: new Map([["EXIST", 1]]) };
    const r = classifyImportRows(
      [
        row({ row: 2, idDocumentNumber: "H1" }),
        row({ row: 3, idDocumentNumber: "D1", relationship: "SPOUSE", holderIdDocumentNumber: "H1" }),
        row({ row: 4, idDocumentNumber: "D2", relationship: "CHILD", holderIdDocumentNumber: "EXIST" }),
        row({ row: 5, idDocumentNumber: "H2", birthDate: "x" }),
        row({ row: 6, idDocumentNumber: "D3", relationship: "CHILD", holderIdDocumentNumber: "H2" }),
      ],
      lookups,
    );
    expect(r.valid.map((v) => v.row)).toEqual([2, 3, 4]);
    expect(r.issues.map((i) => [i.row, i.code])).toEqual([[5, "INVALID_FORMAT"], [6, "HOLDER_NOT_FOUND"]]);
  });

  it("os erros nunca ecoam dados pessoais (mensagens fixas)", () => {
    const r = classifyImportRows([row({ name: "SEGREDO-NOME", idDocumentNumber: "SEGREDO-DOC", birthDate: "SEGREDO-DATA" })], NO_LOOKUPS);
    expect(JSON.stringify(r.issues)).not.toContain("SEGREDO");
  });
});
