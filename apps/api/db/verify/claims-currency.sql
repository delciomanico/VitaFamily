-- Verificação da moeda (BR-SEG-42; migrations.md «Verificação da moeda»). SÓ LEITURA: correr em CÓPIA de dados reais,
-- antes da fatia 2b. Nunca altera `amount`. Zero linhas com claim_currency <> insurer_currency ⇒ nada a corrigir.
-- Com divergências: relatório ao proprietário; a corretiva `0038_claims_currency_reconcile.sql` só com autorização expressa.
SELECT i.id AS insurer_id, i.currency AS insurer_currency, c.currency AS claim_currency,
       c.status, count(*) AS claims, sum(c.amount) AS total
FROM reimbursement_claims c JOIN insurer_accounts i ON i.id = c.insurer_id
GROUP BY 1, 2, 3, 4 ORDER BY 1, 3, 4;

-- Resumo: nº de linhas divergentes (esperado: 0).
SELECT count(*) AS divergentes
FROM reimbursement_claims c JOIN insurer_accounts i ON i.id = c.insurer_id
WHERE c.currency <> i.currency;
