// Application de `record-sharing`: `createSharedRecordsReader` com fontes falsas (stubs à mão, chamadas registadas). TC-MKT-124/142:
// só as secções concedidas existem (omitidas, nunca null), idade sempre presente, data de nascimento nunca sai, sem cache.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ALLOWED_CATEGORIES, DATA_CATEGORIES, type DataCategory } from "../domain/index.js";
import { createSharedRecordsReader, type SharedRecordsSources } from "./shared-records.js";

type Trx = object;
const FAMILY = "11111111-1111-4111-8111-111111111111";
const MEMBER = "22222222-2222-4222-8222-222222222222";
/** 2031-03-10 10:00Z = 11:00 em Luanda ⇒ 31 anos (nascido 2000-03-10); janela de 24 meses começa em 2029-03-10. */
const NOW = new Date("2031-03-10T10:00:00Z");

const SECTION_KEYS: Record<DataCategory, string[]> = {
  ALLERGIES: ["allergies", "bloodType"],
  CONDITIONS: ["conditions"],
  MEDICATION: ["medications"],
  APPOINTMENTS: ["appointments"],
  EXAMS: ["examinations"],
};

function fontesFalsas() {
  const sources = {
    birthDate: vi.fn<SharedRecordsSources<Trx>["birthDate"]>(() => Promise.resolve("2000-03-10")),
    bloodType: vi.fn<SharedRecordsSources<Trx>["bloodType"]>(() => Promise.resolve("O+")),
    allergies: vi.fn<SharedRecordsSources<Trx>["allergies"]>(() => Promise.resolve([{ name: "Penicilina", since: "2020-01-01" }])),
    conditions: vi.fn<SharedRecordsSources<Trx>["conditions"]>(() => Promise.resolve([
      { name: "Asma", kind: "CONDITION", since: "2015-05-01", until: null },
    ])),
    activeMedications: vi.fn<SharedRecordsSources<Trx>["activeMedications"]>(() => Promise.resolve([
      { name: "Paracetamol", dosage: "500 mg", startAt: new Date("2031-01-01T00:00:00Z"), endAt: null, continuous: true },
    ])),
    appointments: vi.fn<SharedRecordsSources<Trx>["appointments"]>(() => Promise.resolve([
      { scheduledAt: new Date("2031-04-01T09:00:00Z"), status: "CONFIRMED", specialty: "Pediatria", professionalName: "Dr. X" },
    ])),
    examinations: vi.fn<SharedRecordsSources<Trx>["examinations"]>(() => Promise.resolve([
      {
        name: "Hemograma",
        examDate: "2031-01-05",
        status: "COMPLETED",
        results: [{ parameter: "Hb", valueNumeric: 13.5, unit: "g/dL", referenceMin: 12, referenceMax: 16 }],
      },
    ])),
  };
  return sources;
}

type Fontes = ReturnType<typeof fontesFalsas>;

function leitor(fontes: Fontes) {
  return createSharedRecordsReader<Trx>(fontes);
}

describe("createSharedRecordsReader", () => {
  let trx: Trx;
  let fontes: Fontes;

  beforeEach(() => {
    trx = {};
    fontes = fontesFalsas();
  });

  describe("secções concedidas (TC-MKT-124)", () => {
    it.each(DATA_CATEGORIES.map((c) => [c, SECTION_KEYS[c]] as const))(
      "categoria %s isolada traz só as suas secções (mais ageYears)",
      async (categoria, secoes) => {
        const conteudo = await leitor(fontes).read(trx, { familyId: FAMILY, memberId: MEMBER, categories: [categoria], now: NOW });
        expect(Object.keys(conteudo).sort()).toEqual(["ageYears", ...secoes].sort());
        for (const chave of ["allergies", "bloodType", "conditions", "medications", "appointments", "examinations"]) {
          expect(chave in conteudo).toBe(secoes.includes(chave));
        }
      },
    );

    it("todas as categorias trazem todas as secções", async () => {
      const conteudo = await leitor(fontes).read(trx, { familyId: FAMILY, memberId: MEMBER, categories: DATA_CATEGORIES, now: NOW });
      expect(Object.keys(conteudo).sort()).toEqual(
        ["ageYears", "allergies", "bloodType", "conditions", "medications", "appointments", "examinations"].sort(),
      );
    });

    it("categoria permitida a WELLNESS (MEDICATION) traz só medicação e não chama as outras fontes", async () => {
      const categorias = ALLOWED_CATEGORIES.WELLNESS;
      const conteudo = await leitor(fontes).read(trx, { familyId: FAMILY, memberId: MEMBER, categories: categorias, now: NOW });
      expect(Object.keys(conteudo).sort()).toEqual(["ageYears", "medications"]);
      expect(fontes.allergies).not.toHaveBeenCalled();
      expect(fontes.bloodType).not.toHaveBeenCalled();
      expect(fontes.conditions).not.toHaveBeenCalled();
      expect(fontes.appointments).not.toHaveBeenCalled();
      expect(fontes.examinations).not.toHaveBeenCalled();
    });

    it("ALLERGIES traz allergies e bloodType", async () => {
      const conteudo = await leitor(fontes).read(trx, { familyId: FAMILY, memberId: MEMBER, categories: ["ALLERGIES"], now: NOW });
      expect(conteudo.allergies).toEqual([{ name: "Penicilina", since: "2020-01-01" }]);
      expect(conteudo.bloodType).toBe("O+");
    });

    it("bloodType é omitido (sem chave) quando a fonte devolve null", async () => {
      fontes.bloodType.mockResolvedValue(null);
      const conteudo = await leitor(fontes).read(trx, { familyId: FAMILY, memberId: MEMBER, categories: ["ALLERGIES"], now: NOW });
      expect(Object.keys(conteudo).sort()).toEqual(["ageYears", "allergies"]);
      expect("bloodType" in conteudo).toBe(false);
    });
  });

  describe("fontes de categorias não concedidas (spy)", () => {
    it("não chama as fontes das categorias não concedidas", async () => {
      await leitor(fontes).read(trx, { familyId: FAMILY, memberId: MEMBER, categories: ["CONDITIONS"], now: NOW });
      expect(fontes.conditions).toHaveBeenCalledTimes(1);
      expect(fontes.allergies).not.toHaveBeenCalled();
      expect(fontes.bloodType).not.toHaveBeenCalled();
      expect(fontes.activeMedications).not.toHaveBeenCalled();
      expect(fontes.appointments).not.toHaveBeenCalled();
      expect(fontes.examinations).not.toHaveBeenCalled();
    });
  });

  describe("idade e data de nascimento (OP-119)", () => {
    it("ageYears está sempre presente, mesmo com uma só categoria", async () => {
      const conteudo = await leitor(fontes).read(trx, { familyId: FAMILY, memberId: MEMBER, categories: ["EXAMS"], now: NOW });
      expect(conteudo.ageYears).toBe(31);
    });

    it("ageYears está presente sem categorias concedidas", async () => {
      const conteudo = await leitor(fontes).read(trx, { familyId: FAMILY, memberId: MEMBER, categories: [], now: NOW });
      expect(Object.keys(conteudo)).toEqual(["ageYears"]);
    });

    it("a resposta serializada não contém a data de nascimento nem o texto 'birthDate'", async () => {
      const conteudo = await leitor(fontes).read(trx, { familyId: FAMILY, memberId: MEMBER, categories: DATA_CATEGORIES, now: NOW });
      const json = JSON.stringify(conteudo);
      expect(json).not.toContain("2000-03-10");
      expect(json).not.toContain("birthDate");
    });

    it("birthDate null lança erro e nenhuma outra fonte é chamada", async () => {
      fontes.birthDate.mockResolvedValue(null);
      await expect(leitor(fontes).read(trx, { familyId: FAMILY, memberId: MEMBER, categories: DATA_CATEGORIES, now: NOW })).rejects.toThrow(
        "data de nascimento do membro indisponível",
      );
      expect(fontes.allergies).not.toHaveBeenCalled();
      expect(fontes.bloodType).not.toHaveBeenCalled();
      expect(fontes.conditions).not.toHaveBeenCalled();
      expect(fontes.activeMedications).not.toHaveBeenCalled();
      expect(fontes.appointments).not.toHaveBeenCalled();
      expect(fontes.examinations).not.toHaveBeenCalled();
    });
  });

  describe("argumentos das fontes", () => {
    it("todas as fontes recebem trx e (familyId, memberId)", async () => {
      await leitor(fontes).read(trx, { familyId: FAMILY, memberId: MEMBER, categories: DATA_CATEGORIES, now: NOW });
      expect(fontes.birthDate).toHaveBeenCalledWith(trx, FAMILY, MEMBER);
      expect(fontes.bloodType).toHaveBeenCalledWith(trx, FAMILY, MEMBER);
      expect(fontes.allergies).toHaveBeenCalledWith(trx, FAMILY, MEMBER);
      expect(fontes.conditions).toHaveBeenCalledWith(trx, FAMILY, MEMBER);
      expect(fontes.activeMedications).toHaveBeenCalledWith(trx, FAMILY, MEMBER);
      expect(fontes.appointments).toHaveBeenCalledWith(trx, FAMILY, MEMBER, new Date("2029-03-10T00:00:00+01:00"));
      expect(fontes.examinations).toHaveBeenCalledWith(trx, FAMILY, MEMBER, "2029-03-10");
    });

    it("appointments recebe since = 24 meses antes em Luanda como Date", async () => {
      await leitor(fontes).read(trx, { familyId: FAMILY, memberId: MEMBER, categories: ["APPOINTMENTS"], now: NOW });
      expect(fontes.appointments).toHaveBeenCalledWith(trx, FAMILY, MEMBER, new Date("2029-03-10T00:00:00+01:00"));
    });

    it("examinations recebe since = '2029-03-10'", async () => {
      await leitor(fontes).read(trx, { familyId: FAMILY, memberId: MEMBER, categories: ["EXAMS"], now: NOW });
      expect(fontes.examinations).toHaveBeenCalledWith(trx, FAMILY, MEMBER, "2029-03-10");
    });
  });

  describe("formato da saída", () => {
    it("datas de medicação saem em ISO e endAt null mantém-se null", async () => {
      const conteudo = await leitor(fontes).read(trx, { familyId: FAMILY, memberId: MEMBER, categories: ["MEDICATION"], now: NOW });
      expect(conteudo.medications).toEqual([
        {
          name: "Paracetamol",
          dosage: "500 mg",
          startAt: "2031-01-01T00:00:00.000Z",
          endAt: null,
          continuous: true,
        },
      ]);
    });

    it("since de alergia ausente é omitido (sem chave)", async () => {
      fontes.allergies.mockResolvedValue([{ name: "Látex", since: null }]);
      const conteudo = await leitor(fontes).read(trx, { familyId: FAMILY, memberId: MEMBER, categories: ["ALLERGIES"], now: NOW });
      const [alergia] = conteudo.allergies ?? [];
      expect(Object.keys(alergia ?? {})).toEqual(["name"]);
      expect("since" in (alergia ?? {})).toBe(false);
    });

    it("since e until de condição ausentes são omitidos (sem chave)", async () => {
      fontes.conditions.mockResolvedValue([{ name: "Hipertensão", kind: "HISTORY", since: null, until: null }]);
      const conteudo = await leitor(fontes).read(trx, { familyId: FAMILY, memberId: MEMBER, categories: ["CONDITIONS"], now: NOW });
      const [condicao] = conteudo.conditions ?? [];
      expect(Object.keys(condicao ?? {}).sort()).toEqual(["kind", "name"]);
    });
  });

  describe("sem cache (leitura no momento)", () => {
    it("a segunda leitura reflete a fonte alterada entre as duas", async () => {
      let alergias: { name: string; since: string | null }[] = [{ name: "Penicilina", since: "2020-01-01" }];
      fontes.allergies.mockImplementation(() => Promise.resolve(alergias));
      const reader = leitor(fontes);

      const primeira = await reader.read(trx, { familyId: FAMILY, memberId: MEMBER, categories: ["ALLERGIES"], now: NOW });
      alergias = [{ name: "Amoxicilina", since: null }];
      const segunda = await reader.read(trx, { familyId: FAMILY, memberId: MEMBER, categories: ["ALLERGIES"], now: NOW });

      expect(primeira.allergies?.map((a) => a.name)).toEqual(["Penicilina"]);
      expect(segunda.allergies?.map((a) => a.name)).toEqual(["Amoxicilina"]);
      expect(fontes.allergies).toHaveBeenCalledTimes(2);
    });
  });
});
