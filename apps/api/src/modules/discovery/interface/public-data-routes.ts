// `PUBLIC_DATA_ROUTES` (authorization.md §11.1, TC-MKT-53): lista FECHADA das operações «sem decisão de política» da descoberta. São rotas
// de User autenticado (`bearerAuth`; MK3 acrescenta `listBookableSlots`, authorization.md §12.4; `listProfessionalReviews` entra na S10) que só leem dados públicos de profissionais `APPROVED`; nenhuma é rota de família nem de saúde.
// O teste de arquitetura verifica esta lista contra `openapi.yaml` (todas sob `/marketplace/`, nenhuma sob `/families/`, sem omissões).
export const PUBLIC_DATA_ROUTES = ["getMarketplaceFilters", "getRankingRules", "searchProfessionals", "compareProfessionals", "getMarketplaceProfessional", "listBookableSlots", "listProfessionalReviews"] as const;
