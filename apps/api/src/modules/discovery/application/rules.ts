// «Como ordenamos» (UC-MKT-16, BR-MKT-36/37): texto estático e versionado derivado de `RANKING_V1` (única fonte dos pesos).
import { RANKING_V1 } from "../domain/ranking.js";

export interface RankingRulesView {
  version: string;
  signals: { code: "PROFILE_COMPLETENESS" | "AVAILABILITY" | "PRICE" | "SENIORITY"; weightPercent: number; description: string }[];
  notUsed: string[];
  statement: string;
}

export function getRankingRules(): RankingRulesView {
  const w = RANKING_V1.weights;
  return {
    version: RANKING_V1.version,
    signals: [
      { code: "PROFILE_COMPLETENESS", weightPercent: w.profileCompleteness, description: "Perfil completo: apresentação preenchida, notas nas ofertas e mais do que um método ou oferta." },
      { code: "AVAILABILITY", weightPercent: w.availability, description: "Disponibilidade: horários livres nos próximos 14 dias." },
      { code: "PRICE", weightPercent: w.price, description: "Preço: o preço mais baixo do profissional face aos restantes da mesma especialidade." },
      { code: "SENIORITY", weightPercent: w.seniority, description: "Antiguidade: tempo desde a aprovação do perfil na Vita Family." },
    ],
    notUsed: ["Pagamento ou subscrição", "Destaques pagos", "Ordem definida manualmente (nem pela equipa da Vita Family)", "Dados pessoais, nome ou cidade do profissional"],
    statement: "O pagamento e os destaques pagos nunca influenciam a ordem.",
  };
}
