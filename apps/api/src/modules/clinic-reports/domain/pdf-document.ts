// Estrutura simples de um documento PDF (ADR-027): o domínio monta o conteúdo, a porta `PdfRenderer` só desenha.
// Só texto e tabelas: sem HTML, imagens, ligações, scripts nem formulários.
export type PdfBlock =
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string; muted?: boolean }
  | { kind: "section"; title: string; body: string }
  | { kind: "table"; columns: { title: string; width: number }[]; rows: { cells: string[]; highlightLastCell?: boolean }[] }
  | { kind: "spacer" };

export interface PdfDocument {
  /** Cabeçalho (perfil da clínica): uma linha por entrada, a primeira em destaque. */
  header: string[];
  title: string;
  /** Marca a todo o documento (ex.: "RASCUNHO — sem valor"). */
  watermark?: string;
  blocks: PdfBlock[];
  footer: string;
  /** Instante de geração (porta `Clock`): metadados do PDF determinísticos para os testes. */
  generatedAt: Date;
}

/** BR-CLN-49: o laudo gerado tem ≤ 256 KB. */
export const MAX_GENERATED_PDF_BYTES = 256 * 1024;
