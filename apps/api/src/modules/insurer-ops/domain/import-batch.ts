// Lote de importação (`insurer_import_batches`, BR-SEG-17): estado e visão. Entidade pura.
import type { ImportFormat, ImportIssue, ImportRow } from "./import-file.js";
import { MAX_REPORTED_ERRORS, PREVIEW_ROWS } from "./import-file.js";

export type ImportStatus = "PREVIEW" | "COMMITTED" | "FAILED" | "CANCELLED";

/** Resumo persistido em `error_report` (sem dados pessoais: nº de linha, campo e código). */
export interface ImportReport {
  validRows: number;
  errorRows: number;
  duplicateRows: number;
  importedRows: number | null;
  errors: ImportIssue[];
  errorsTruncated: boolean;
}

export interface ImportBatch {
  id: string;
  insurerId: string;
  format: ImportFormat;
  rowCount: number;
  status: ImportStatus;
  report: ImportReport;
  /** Linhas válidas à espera do `commit`; `null` depois de confirmado/cancelado (dados pessoais descartados). */
  rows: ImportRow[] | null;
  createdAt: Date;
}

export function buildReport(input: { validRows: number; errorRows: number; duplicateRows: number; importedRows: number | null; issues: ImportIssue[] }): ImportReport {
  return {
    validRows: input.validRows,
    errorRows: input.errorRows,
    duplicateRows: input.duplicateRows,
    importedRows: input.importedRows,
    errors: input.issues.slice(0, MAX_REPORTED_ERRORS),
    errorsTruncated: input.issues.length > MAX_REPORTED_ERRORS,
  };
}

/** Primeiras 50 linhas válidas (pré-visualização); vazia quando as linhas já foram descartadas. */
export function previewOf(batch: ImportBatch): ImportRow[] {
  return batch.status === "PREVIEW" ? (batch.rows ?? []).slice(0, PREVIEW_ROWS) : [];
}
