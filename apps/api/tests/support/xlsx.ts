// Gerador mínimo de XLSX para testes (zip com `fflate`): 1 folha, strings inline, sem estilos.
import { strToU8, zipSync } from "fflate";

const escapeXml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const colName = (i: number): string => String.fromCharCode(65 + i);

export function buildXlsx(records: (string | number)[][]): Buffer {
  const rows = records
    .map((record, r) => {
      const cells = record
        .map((value, c) => {
          const ref = `${colName(c)}${String(r + 1)}`;
          return typeof value === "number" ? `<c r="${ref}"><v>${String(value)}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
        })
        .join("");
      return `<row r="${String(r + 1)}">${cells}</row>`;
    })
    .join("");
  const files = {
    "[Content_Types].xml": strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>'),
    "xl/workbook.xml": strToU8('<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Folha1" sheetId="1" r:id="rId1"/></sheets></workbook>'),
    "xl/_rels/workbook.xml.rels": strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>'),
    "xl/worksheets/sheet1.xml": strToU8(`<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`),
  };
  return Buffer.from(zipSync(files));
}

export const IMPORT_HEADER = ["name", "idDocumentType", "idDocumentNumber", "birthDate", "relationship", "holderIdDocumentNumber", "companyTaxId"];
