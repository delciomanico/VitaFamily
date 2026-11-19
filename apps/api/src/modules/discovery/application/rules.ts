// «Como ordenamos» (UC-MKT-16, BR-MKT-36/37/61): texto estático e versionado derivado de `RANKING_V2` (única fonte dos pesos).
import { RANKING_V2 } from "../domain/ranking.js";

export interface RankingRulesView {
  version: string;
  signals: { code: "REVIEWS" | "PROFILE_COMPLETENESS" | "AVAILABILITY" | "PRICE" | "SENIORITY"; weightPercent: number; description: string }[];
  notUsed: string[];
  statement: string;
}

export function getRankingRules(): RankingRulesView {
  const w = RANKING_V2.weights;
  return {
    version: RANKING_V2.version,
    signals: [
      { code: "REVIEWS", weightPercent: w.reviews, description: "Avaliações: nota das avaliações verificadas (só de quem consultou), suavizada pela média da especialidade; com menos de 3 avaliações o profissional é «Novo» e este sinal é neutro." },
      { code: "PROFILE_COMPLETENESS", weightPercent: w.profileCompleteness, description: "Perfil completo: apresentação preenchida, notas nas ofertas e mais do que um método ou oferta." },
      { code: "AVAILABILITY", weightPercent: w.availability, description: "Disponibilidade: horários livres nos próximos 14 dias." },
      { code: "PRICE", weightPercent: w.price, description: "Preço: o preço mais baixo do profissional face aos restantes da mesma especialidade." },
      { code: "SENIORITY", weightPercent: w.seniority, description: "Antiguidade: tempo desde a aprovação do perfil na Vita Family." },
    ],
    notUsed: ["Pagamento ou subscrição", "Destaques pagos", "Ordem definida manualmente (nem pela equipa da Vita Family)", "Dados pessoais, nome ou cidade do profissional"],
    statement: "O pagamento e os destaques pagos nunca influenciam a ordem.",
  };
}
