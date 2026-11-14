// openapi createInsurerImport / getInsurerImport / cancelInsurerImport / commitInsurerImport (BR-SEG-17, UC-SEG-02):
// CSV/XLSX ≤ 5.000 linhas; a pré-visualização NÃO grava beneficiários; o `commit` corre numa só transação, grava as linhas
// válidas como `PENDING` (nunca `ACTIVE`) e conta as inválidas/duplicadas, sem duplicar nem atualizar.
import { ConflictError } from "../../../platform/errors/index.js";
import { newId } from "../../../platform/ids/index.js";
import type { OpsActor } from "../domain/access.js";
import { generateCardNumber } from "../domain/beneficiary.js";
import { buildReport, type ImportBatch } from "../domain/import-batch.js";
import { classifyImportRows, parseImportFile, type ImportLookups, type RawImportRow } from "../domain/import-file.js";
import type { NewBeneficiaryRecord, OpsDeps, RequestContext } from "./ports.js";
import { auditEvent, authorize, notFound } from "./support.js";

const CARD_NUMBER_ATTEMPTS = 5;

const unique = (values: string[]): string[] => [...new Set(values.filter((v) => v !== ""))];

async function loadLookups<Trx>(deps: OpsDeps<Trx>, trx: Trx, insurerId: string, rows: RawImportRow[]): Promise<ImportLookups> {
  return {
    existingDocuments: await deps.beneficiaries.existingDocumentKeys(trx, insurerId, unique(rows.map((r) => r.idDocumentNumber))),
    holdersByNumber: await deps.beneficiaries.holderCountsByNumber(trx, insurerId, unique(rows.map((r) => r.holderIdDocumentNumber))),
    companyTaxIds: new Set(await deps.companies.findTaxIds(trx, insurerId, unique(rows.map((r) => r.companyTaxId)))),
  };
}

export interface UploadedImportFile {
  buffer: Buffer;
  originalName: string;
}

export function createCreateImportUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function createImport(actor: OpsActor, file: UploadedImportFile, context: RequestContext): Promise<ImportBatch> {
    await deps.withTransaction((trx) => authorize(deps, trx, actor, "write"));
    const { format, rows } = parseImportFile(file.buffer, file.originalName);
    return deps.withTransaction(async (trx) => {
      const classification = classifyImportRows(rows, await loadLookups(deps, trx, actor.insurerId, rows));
      const report = buildReport({ validRows: classification.valid.length, errorRows: classification.errorRows, duplicateRows: classification.duplicateRows, importedRows: null, issues: classification.issues });
      const batch = await deps.imports.insert(trx, {
        id: newId(),
        insurerId: actor.insurerId,
        format,
        rowCount: rows.length,
        report,
        rows: classification.valid,
        createdBy: actor.insuranceAccountId,
        createdAt: deps.clock.now(),
      });
      await deps.audit.record(
        trx,
        auditEvent(deps, actor, context, {
          action: "INSURER_IMPORT_PREVIEW",
          resourceType: "InsurerImport",
          resourceId: batch.id,
          metadata: { rowCount: rows.length, validRows: report.validRows, errorRows: report.errorRows, duplicateRows: report.duplicateRows },
        }),
      );
      return batch;
    });
  };
}

export function createGetImportUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function getImport(actor: OpsActor, importId: string): Promise<ImportBatch> {
    return deps.withTransaction(async (trx) => {
      await authorize(deps, trx, actor, "read");
      const batch = await deps.imports.findById(trx, actor.insurerId, importId);
      if (!batch) throw notFound();
      return batch;
    });
  };
}

export function createCancelImportUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function cancelImport(actor: OpsActor, importId: string, context: RequestContext): Promise<void> {
    await deps.withTransaction(async (trx) => {
      await authorize(deps, trx, actor, "write");
      const batch = await deps.imports.findById(trx, actor.insurerId, importId, true);
      if (!batch) throw notFound();
      if (batch.status !== "PREVIEW") throw new ConflictError({ detail: "Só se cancela um lote em pré-visualização." });
      await deps.imports.close(trx, actor.insurerId, importId, "CANCELLED", batch.report, deps.clock.now());
      await deps.audit.record(trx, auditEvent(deps, actor, context, { action: "INSURER_IMPORT_CANCEL", resourceType: "InsurerImport", resourceId: importId, metadata: { rowCount: batch.rowCount } }));
    });
  };
}

/** Gera nºs de cartão únicos (no lote e na seguradora); colisões voltam a ser sorteadas. */
async function allocateCardNumbers<Trx>(deps: OpsDeps<Trx>, trx: Trx, insurerId: string, count: number): Promise<string[]> {
  const numbers = new Set<string>();
  for (let attempt = 0; attempt < CARD_NUMBER_ATTEMPTS && numbers.size < count; attempt++) {
    while (numbers.size < count) numbers.add(generateCardNumber());
    const taken = await deps.beneficiaries.existingCardNumbers(trx, insurerId, [...numbers]);
    for (const n of taken) numbers.delete(n);
  }
  if (numbers.size < count) throw new ConflictError({ detail: "Não foi possível gerar números de cartão únicos; tente novamente." });
  return [...numbers];
}

export function createCommitImportUseCase<Trx>(deps: OpsDeps<Trx>) {
  return async function commitImport(actor: OpsActor, importId: string, context: RequestContext): Promise<ImportBatch> {
    return deps.withTransaction(async (trx) => {
      await authorize(deps, trx, actor, "write");
      const batch = await deps.imports.findById(trx, actor.insurerId, importId, true);
      if (!batch) throw notFound();
      if (batch.status !== "PREVIEW") throw new ConflictError({ detail: "O lote já foi confirmado ou cancelado." });

      // Revalida contra o estado atual (entre a pré-visualização e a confirmação podem surgir duplicados/titulares).
      const rows = batch.rows ?? [];
      const fresh = classifyImportRows(rows, await loadLookups(deps, trx, actor.insurerId, rows));
      const now = deps.clock.now();
      const cards = await allocateCardNumbers(deps, trx, actor.insurerId, fresh.valid.length);
      const companyIds = await deps.companies.idsByTaxId(trx, actor.insurerId, unique(fresh.valid.map((r) => r.companyTaxId)));
      const existingHolders = await deps.beneficiaries.holderIdsByNumber(trx, actor.insurerId, unique(fresh.valid.map((r) => r.holderIdDocumentNumber)));

      const records = fresh.valid.map((row, i): NewBeneficiaryRecord & { holderNumber: string } => ({
        id: newId(),
        insurerId: actor.insurerId,
        companyId: row.companyTaxId === "" ? null : (companyIds.get(row.companyTaxId) ?? null),
        holderId: null,
        name: row.name,
        idDocumentType: row.idDocumentType,
        idDocumentNumber: row.idDocumentNumber,
        birthDate: row.birthDate,
        relationship: row.relationship as NewBeneficiaryRecord["relationship"],
        cardNumber: cards[i] ?? "",
        createdAt: now,
        holderNumber: row.holderIdDocumentNumber,
      }));
      const holders = records.filter((r) => r.relationship === "HOLDER");
      const inFile = new Map(holders.map((h) => [h.idDocumentNumber, h.id]));
      const dependents = records
        .filter((r) => r.relationship !== "HOLDER")
        .map((r) => ({ ...r, holderId: inFile.get(r.holderNumber) ?? existingHolders.get(r.holderNumber) ?? null }));
      // Titulares primeiro (FK composta `holder_id`); um conflito de unicidade aborta a transação inteira (nada gravado).
      await deps.beneficiaries.insertMany(trx, holders);
      await deps.beneficiaries.insertMany(trx, dependents.filter((r) => r.holderId !== null));

      const imported = holders.length + dependents.filter((r) => r.holderId !== null).length;
      const unresolved = dependents.length - (imported - holders.length);
      const issues = [...batch.report.errors, ...fresh.issues].sort((a, b) => a.row - b.row);
      const report = buildReport({
        validRows: imported,
        errorRows: batch.report.errorRows + fresh.errorRows + unresolved,
        duplicateRows: batch.report.duplicateRows + fresh.duplicateRows,
        importedRows: imported,
        issues,
      });
      report.errorsTruncated = report.errorsTruncated || batch.report.errorsTruncated;
      const closed = await deps.imports.close(trx, actor.insurerId, importId, "COMMITTED", report, now);
      await deps.audit.record(
        trx,
        auditEvent(deps, actor, context, {
          action: "INSURER_IMPORT_COMMIT",
          resourceType: "InsurerImport",
          resourceId: importId,
          metadata: { rowCount: batch.rowCount, importedRows: imported, errorRows: report.errorRows, duplicateRows: report.duplicateRows },
        }),
      );
      return closed;
    });
  };
}

/** Antiguidade a partir da qual um lote em PREVIEW (nunca confirmado nem cancelado) é expurgado. */
export const IMPORT_PREVIEW_TTL_MS = 24 * 60 * 60 * 1000;

/** Job `insurer.purge-import-previews`: descarta as linhas (dados pessoais de terceiros) e cancela o lote; auditoria só com contagem. */
export function createPurgeImportPreviewsJobUseCase<Trx>(deps: Pick<OpsDeps<Trx>, "imports" | "audit" | "withTransaction" | "clock">) {
  return async function purgeImportPreviews(): Promise<{ purged: number }> {
    return deps.withTransaction(async (trx) => {
      const now = deps.clock.now();
      const perInsurer = await deps.imports.expireStalePreviews(trx, new Date(now.getTime() - IMPORT_PREVIEW_TTL_MS), now);
      for (const { insurerId, count } of perInsurer) {
        await deps.audit.record(trx, {
          occurredAt: now,
          actorType: "SYSTEM",
          action: "INSURER_IMPORT_CANCEL",
          resourceType: "InsurerImport",
          result: "SUCCESS",
          requestId: "job:insurer.purge-import-previews",
          metadata: { insurerId, reason: "EXPIRED", count },
        });
      }
      return { purged: perInsurer.reduce((sum, r) => sum + r.count, 0) };
    });
  };
}
