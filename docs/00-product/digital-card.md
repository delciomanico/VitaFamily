# Vita Family — Cartão digital e comunicação seguradora↔clínica

> Estado: **v0.1 PROPOSTO (2026-11-14)** — nada aqui está decidido em ADR, contratado em `openapi.yaml` nem implementado. Origem: `real-flow-research.md` (§5 cartão, §2/§4 canais) e `process-flows.md`. Complementa o cartão/QR já contratado na Fase A (`insurer-phase-a.md`, BR-SEG-18/20). **Critérios do proprietário: pendente** (ver `real-flow-research.md`). Tudo o que depende de Apple/Google está **por verificar** (§7).

## 1. Canais de comunicação (por ordem de entrega)
1. **Portal web** (clínica e seguradora) — primeiro; já é o canal da Fase A.
2. **API estilo FHIR** — pedido/resposta de elegibilidade (modelo `CoverageEligibilityRequest/Response`, `real-flow-research.md` §4), só depois de uma seguradora piloto a querer integrar; formato interno do Vita, não adoção de FHIR completo. Contrato por escrever (OpenAPI) antes de qualquer código.
3. **Fallback telefone/WhatsApp** — a clínica liga/escreve à seguradora; resultado registado manualmente no processo. Número do cartão ditado ao telefone: o **número legível** (§3) existe para isto.
Princípio: o Vita não é TPA (ADR-029); a seguradora responde, o Vita encaminha e mostra.

## 2. Quem vê que cartão
| Situação | Regra proposta |
|---|---|
| Um cartão por **membro** e por **seguradora** (apólice) | Cada beneficiário reclamado (BR-SEG-20) tem o seu cartão. |
| Titular adulto | Vê o seu e os dos dependentes. |
| Menor | Cartão fica com o **tutor** (vê e apresenta). |
| Dependente adulto com conta | Vê **só o seu**. |
| **Cartão de empresa** | Mostra empresa + nº do grupo; ao sair da empresa o cartão **desativa** e o **histórico fica com o colaborador**; a **empresa nunca vê o cartão individual** (ADR-031). |
| **Várias seguradoras** | O membro escolhe qual mostrar; a **última usada** fica à frente. (A Fase A tem um cartão por seguradora, sem ordenação.) |
| **Sem seguro** | Sem cartão de seguro; mantém o **código/QR de ligação à clínica** (BR-CLN-20), que não é cartão de seguro. |

## 3. Credencial: QR de curta duração e número legível
- **QR dinâmico** de curta validade (referência de caso: **5 min [V-sec]**; valor a fixar), **renovável** na app, com **segredo próprio** (HMAC; **pendência da Fase A** por fechar em `insurer-phase-a.md`/`security.md`; não reutilizar o segredo de BR-CLN-20). Uso: leitura pela clínica no portal.
- **Número do cartão legível** (alfabeto sem ambiguidades) utilizável **sem rede** e por telefone; sozinho **não** dá acesso a dados, apenas inicia a verificação online.
- Nunca enviar imagem do cartão por e-mail/SMS (**[V-sec]**); o cartão digital vale como o físico **[C]** conforme a seguradora.
- Resposta da verificação ao prestador: mínima (sim/não, copagamento; Q-T1, BR-SEG-18).

## 4. Pré-verificação e copagamento
- **Ao marcar** (estimativa, "não garantia") e **à chegada** (verificação por QR, 1 toque): elegibilidade + copagamento estimado.
- Isto **resolve o pré-cálculo** pedido na alteração proposta a **BR-SEG-06/08** (`process-flows.md` §11a, D11); o copagamento continua pago no balcão (Q-C1). Os prazos do pedido de elegibilidade (meta interna ≤ 20 s, referência 270/271) são **por fixar** com a seguradora piloto.

## 5. Carteira do telemóvel (Apple Wallet e Google Wallet)
**Decisão do proprietário (2026-11-14): avançar, incluída no âmbito.** Entrega **após** o cartão na app (§8). Requisitos oficiais **por verificar** (§7).

### 5.1 Desenho do passe
- **Conteúdo permitido:** nº do cartão, nome, seguradora, plano, validade e um código (QR/código de barras). **SEM dados de saúde**, sem saldos, sem diagnóstico, sem lista de dependentes.
- **QR rotativo vs estático — limite do passe:** os passes são tipicamente atualizados por *push* da plataforma e não permitem, de forma fiável, um QR renovado a cada poucos minutos **[C: verificar nas docs Apple/Google; a Google tem opções de código rotativo para alguns casos, Apple não garantido]**. **Solução proposta:** o passe leva um **código estático de identificação** (token opaco, **não** o número legível nem dados), e a **clínica valida sempre online** (o portal resolve o token → elegibilidade; o token por si não dá dados). O **QR dinâmico de 5 min existe só na app Vita** (§3). Assim o passe vazado vale pouco: sem validação online e sem sessão da clínica não revela nada.
- **Revogação/atualização:** ao desligar o cartão, expirar a apólice ou sair da empresa o Vita **revoga o token** (a validação online passa a "inválido") e **atualiza/invalida o passe** via a API da plataforma (estado expirado/void). Falha de entrega do *push* não pode manter o token válido: **a revogação é do lado do servidor**.
- **Opt-in:** o titular/tutor ativa explicitamente "Adicionar à carteira" (por cartão), pode removê-lo na app (revoga token) e a app explica o que o passe contém.

### 5.2 Riscos
| Risco | Mitigação proposta |
|---|---|
| Passe visível no **ecrã de bloqueio** (Apple/Google mostram passes por contexto/localização) | Sem dados de saúde; só o identificador; desativar notificações de relevância; aviso ao ativar. |
| **Perda/roubo** do telemóvel | Revogação pelo servidor a partir da app/web; token inútil sem validação online pela clínica autenticada. |
| **Revogação não propaga** ao passe (offline) | Validação online obrigatória na clínica; o passe offline não confere acesso. |
| Dependentes/menores | Passe por beneficiário; menor só na conta do tutor. |
| Dependência de terceiros (Apple/Google) | Opcional; cartão na app e número legível continuam a funcionar. |
| Disponibilidade/custos em Angola | **Por verificar** (§7). |

### 5.3 RGPD / Lei 22/11 (Angola)
O passe é um **identificador** de beneficiário num dispositivo e serviço de terceiros (Apple/Google): confirmar enquadramento (transferência para fora de Angola, papel das plataformas, base legal = consentimento opt-in) com o **parecer jurídico e a AIPD (M10)**. Minimização: nenhum dado clínico; registo de auditoria de ativação/remoção sem o token. **[C] não é parecer jurídico.**

## 6. O que NÃO muda
O Vita não gera pagamentos; não replica o cartão físico da seguradora (usa o que a seguradora importa e reclama no Vita); sem seguro, o cartão não existe.

## 7. Verificações pendentes (carteira) — a consultar antes de qualquer ADR
Fontes: **documentação Apple PassKit/Wallet Developer** e **Google Wallet API (Generic/Loyalty/Insurance pass types)**. Listar e fechar:
1. Conta de programador/emissor necessária (Apple Developer Program; Google Wallet issuer account) e custos anuais.
2. **Certificados** de assinatura de passes Apple (Pass Type ID; renovação) e credenciais Google (service account/JWT).
3. **Disponibilidade em Angola:** Apple Wallet/Google Wallet disponíveis nos dispositivos e lojas de Angola; Google Wallet exige país suportado para **emissores/utilizadores**; aprovação de emissor por país. **Não verificado.**
4. Existência de tipo de passe adequado a **cartão de seguro** (Google tem tipos genéricos; a Apple tem *generic pass*; restrições de políticas para dados de saúde).
5. Código **rotativo** (Google) e *barcode* estático (Apple): limites reais.
6. Políticas de uso de dados de saúde em passes e requisitos de **privacidade**.
7. Atualização/revogação (APNs *push* para Apple; API Google) e latência.
8. Condições legais/contratuais da plataforma (Apple/Google) para uso comercial em seguros.

## 8. Fase de entrega proposta
1. (marco A/Fase A) Cartão na app + QR atual e número legível; segredo próprio do QR; pendência fechada.
2. Pré-verificação ao marcar/à chegada (com marco B/S4).
3. Várias seguradoras + último usado; cartão de empresa (marco Empresa fase 2).
4. **Carteira do telemóvel** (depois do 1; **só após §7 resolvido** e AIPD/parecer jurídico), por ordem Android→iOS ou ao contrário conforme a disponibilidade em Angola **[C]**.
5. API estilo FHIR (quando houver seguradora piloto interessada).
