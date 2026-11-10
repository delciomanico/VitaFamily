// Adaptador `PdfRenderer` sobre `pdfkit` (biblioteca JS pura; sem Chromium, ADR-027). Só desenha a estrutura simples montada
// no domínio: texto e tabelas com as fontes padrão do PDF (Helvetica), SEM HTML, imagens, ligações, scripts, anexos nem
// formulários (o PDF resultante não contém /JavaScript, /Launch, /URI, /EmbeddedFile nem /AcroForm — testado).
import PDFDocument from "pdfkit";
import type { PdfRendererPort } from "../application/ports.js";
import type { PdfBlock, PdfDocument } from "../domain/pdf-document.js";

const MARGIN = 50;
const BODY = 10;

/** As fontes padrão só codificam WinAnsi: o que não couber vira "?" (nunca falha nem injeta bytes). */
function safe(text: string): string {
  return Array.from(text.normalize("NFC"))
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 63;
      if (ch === "\n" || (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) return ch;
      if ("€–—‘’“”•…«»≥≤".includes(ch)) return ch;
      return "?";
    })
    .join("");
}

export class PdfKitRenderer implements PdfRendererPort {
  /** `compress=false` só para os testes inspecionarem a estrutura do PDF (produção comprime os fluxos). */
  constructor(private readonly options: { compress?: boolean } = {}) {}

  render(document: PdfDocument): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const pdf = new PDFDocument({ size: "A4", margin: MARGIN, bufferPages: true, compress: this.options.compress ?? true, info: { Title: "Documento Vita Family", Producer: "Vita Family", CreationDate: document.generatedAt } });
      const chunks: Buffer[] = [];
      pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
      pdf.on("end", () => { resolve(Buffer.concat(chunks)); });
      pdf.on("error", reject);
      try {
        this.draw(pdf, document);
        pdf.end();
      } catch (error) {
        reject(error instanceof Error ? error : new Error("falha a gerar o PDF"));
      }
    });
  }

  private draw(pdf: PDFKit.PDFDocument, document: PdfDocument): void {
    const [name, ...rest] = document.header;
    pdf.font("Helvetica-Bold").fontSize(14).text(safe(name ?? ""));
    pdf.font("Helvetica").fontSize(9).fillColor("#444444");
    for (const line of rest) pdf.text(safe(line));
    pdf.moveDown(0.5);
    pdf.strokeColor("#999999").moveTo(MARGIN, pdf.y).lineTo(pdf.page.width - MARGIN, pdf.y).stroke();
    pdf.moveDown(0.8).fillColor("#000000").font("Helvetica-Bold").fontSize(16).text(safe(document.title));
    pdf.moveDown(0.6).font("Helvetica").fontSize(BODY);
    for (const block of document.blocks) this.block(pdf, block);

    // Marca e rodapé em todas as páginas (depois de saber quantas são).
    const range = pdf.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      pdf.switchToPage(i);
      if (document.watermark) {
        pdf.save();
        pdf.fillColor("#cc0000").opacity(0.18).font("Helvetica-Bold").fontSize(40);
        pdf.rotate(-30, { origin: [pdf.page.width / 2, pdf.page.height / 2] });
        pdf.text(safe(document.watermark), 0, pdf.page.height / 2 - 30, { width: pdf.page.width, align: "center", lineBreak: false });
        pdf.restore();
      }
      const bottom = pdf.page.height - MARGIN + 12;
      pdf.page.margins.bottom = 0;
      pdf.fillColor("#555555").opacity(1).font("Helvetica").fontSize(8).text(safe(document.footer), MARGIN, bottom, { width: pdf.page.width - 2 * MARGIN, align: "center", lineBreak: false });
      pdf.text(`${String(i + 1)} / ${String(range.count)}`, MARGIN, bottom + 10, { width: pdf.page.width - 2 * MARGIN, align: "right", lineBreak: false });
    }
  }

  private block(pdf: PDFKit.PDFDocument, block: PdfBlock): void {
    const width = pdf.page.width - 2 * MARGIN;
    switch (block.kind) {
      case "spacer":
        pdf.moveDown(0.6);
        return;
      case "heading":
        pdf.moveDown(0.4).font("Helvetica-Bold").fontSize(12).fillColor("#000000").text(safe(block.text), MARGIN, undefined, { width });
        pdf.font("Helvetica").fontSize(BODY);
        return;
      case "paragraph":
        pdf.font("Helvetica").fontSize(block.muted ? 8 : BODY).fillColor(block.muted ? "#555555" : "#000000").text(safe(block.text), MARGIN, undefined, { width });
        pdf.fillColor("#000000").fontSize(BODY).moveDown(0.3);
        return;
      case "section":
        pdf.font("Helvetica-Bold").fontSize(BODY).fillColor("#000000").text(safe(block.title), MARGIN, undefined, { width });
        pdf.font("Helvetica").fontSize(BODY).text(safe(block.body), MARGIN, undefined, { width });
        pdf.moveDown(0.6);
        return;
      case "table":
        this.table(pdf, block, width);
        return;
    }
  }

  private table(pdf: PDFKit.PDFDocument, block: Extract<PdfBlock, { kind: "table" }>, width: number): void {
    const widths = block.columns.map((c) => c.width * width);
    const row = (cells: string[], bold: boolean, highlightLast: boolean): void => {
      const heights = cells.map((cell, i) => pdf.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9).heightOfString(safe(cell), { width: (widths[i] ?? 60) - 6 }));
      const height = Math.max(...heights, 12) + 6;
      if (pdf.y + height > pdf.page.height - MARGIN - 20) pdf.addPage();
      const top = pdf.y;
      let x = MARGIN;
      cells.forEach((cell, i) => {
        const w = widths[i] ?? 60;
        const last = i === cells.length - 1;
        pdf.font(last && highlightLast ? "Helvetica-Bold" : bold ? "Helvetica-Bold" : "Helvetica").fontSize(9).fillColor("#000000").text(safe(cell), x + 3, top + 3, { width: w - 6 });
        x += w;
      });
      pdf.strokeColor("#cccccc").moveTo(MARGIN, top + height).lineTo(MARGIN + width, top + height).stroke();
      pdf.x = MARGIN;
      pdf.y = top + height;
    };
    row(block.columns.map((c) => c.title), true, false);
    for (const r of block.rows) row(r.cells, false, r.highlightLastCell ?? false);
    pdf.moveDown(0.5).font("Helvetica").fontSize(BODY);
  }
}
