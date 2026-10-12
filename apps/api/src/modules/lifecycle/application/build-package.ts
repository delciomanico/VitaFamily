// UC-ACC-06 (Q6): pacote JSON + documentos com os dados de que o pedinte é titular (ou, se for
// tutor, os do dependente). Só entra o que as leituras dos módulos dono deixam ler.
import { buffer } from "node:stream/consumers";
import { createZip, type ZipEntry } from "../domain/zip.js";
import type { ActorIdentity, ApiObject, ExportSources, RequestContext } from "./ports.js";
import { readAll, readable, str } from "./support.js";

export interface ExportScope {
  /** Dependente: só esse membro, sem dados da conta do tutor. */
  family?: { familyId: string; memberId: string };
}

const safeName = (name: string) => name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "ficheiro";

async function memberPackage(
  sources: ExportSources,
  actor: ActorIdentity,
  familyId: string,
  member: ApiObject,
  context: RequestContext,
  files: ZipEntry[],
) {
  const memberId = str(member, "id");
  const [bloodType, allergies, conditions, prescriptions, plans, doses, appointments, examinations] = await Promise.all([
    readable(() => sources.bloodType(actor, familyId, memberId, context)),
    readable(() => sources.allergies(actor, familyId, memberId, context)),
    readable(() => sources.conditions(actor, familyId, memberId, context)),
    readable(() => readAll(sources.prescriptions, actor, familyId, memberId, context)),
    readable(() => readAll(sources.plans, actor, familyId, memberId, context)),
    readable(() => readAll(sources.doses, actor, familyId, memberId, context)),
    readable(() => readAll(sources.appointments, actor, familyId, memberId, context)),
    readable(() => readAll(sources.examinations, actor, familyId, memberId, context)),
  ]);

  const resources = [
    ...(prescriptions ?? []).map((p) => ({ resourceType: "PRESCRIPTION" as const, resourceId: str(p, "id") })),
    ...(examinations ?? []).map((e) => ({ resourceType: "EXAMINATION" as const, resourceId: str(e, "id") })),
  ];
  const documents: ApiObject[] = [];
  for (const { resourceType, resourceId } of resources) {
    documents.push(...((await readable(() => sources.documents(actor, familyId, memberId, resourceType, resourceId))) ?? []));
  }

  const documentEntries: ApiObject[] = [];
  for (const document of documents) {
    const path = `documentos/${familyId}/${str(document, "id")}-${safeName(str(document, "originalName"))}`;
    // Só documentos já aprovados pelo antivírus são descarregáveis; os outros ficam só nos metadados.
    const file = await readable(() => sources.downloadDocument(actor, familyId, memberId, str(document, "id"), context)).catch(() => undefined);
    if (file) {
      files.push({ name: path, data: await buffer(file.stream) });
      documentEntries.push({ ...document, file: path });
    } else {
      documentEntries.push({ ...document, file: null });
    }
  }

  return {
    member,
    ...(bloodType !== undefined ? { bloodType } : {}),
    ...(allergies !== undefined ? { allergies } : {}),
    ...(conditions !== undefined ? { conditions } : {}),
    ...(prescriptions !== undefined ? { prescriptions } : {}),
    ...(plans !== undefined ? { medicationPlans: plans } : {}),
    ...(doses !== undefined ? { doses } : {}),
    ...(appointments !== undefined ? { appointments } : {}),
    ...(examinations !== undefined ? { examinations } : {}),
    documents: documentEntries,
  };
}

export async function buildExportPackage(
  sources: ExportSources,
  actor: ActorIdentity,
  scope: ExportScope,
  now: Date,
  context: RequestContext,
): Promise<Buffer> {
  const files: ZipEntry[] = [];
  const families: ApiObject[] = [];

  if (scope.family) {
    const { familyId, memberId } = scope.family;
    const [family, members] = await Promise.all([sources.listFamilies(actor.userId), sources.listMembers(actor.userId, familyId)]);
    const member = members.find((m) => str(m, "id") === memberId);
    if (member) {
      families.push({ family: family.find((f) => str(f, "id") === familyId) ?? { id: familyId }, ...(await memberPackage(sources, actor, familyId, member, context, files)) });
    }
  } else {
    for (const family of await sources.listFamilies(actor.userId)) {
      const familyId = str(family, "id");
      const self = (await sources.listMembers(actor.userId, familyId)).find((m) => m.isSelf === true);
      if (self) families.push({ family, ...(await memberPackage(sources, actor, familyId, self, context, files)) });
    }
  }

  const account = scope.family ? undefined : await sources.account(actor.userId);
  const data = { exportedAt: now.toISOString(), ...(account ? { account } : {}), families };
  return createZip([{ name: "dados.json", data: Buffer.from(JSON.stringify(data, null, 2), "utf8") }, ...files], now);
}
