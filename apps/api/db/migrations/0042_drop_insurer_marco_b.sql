-- R8 do arquivo do marco B (ADR-037, docs/11-implementation/arquivo-marco-b.md): remove o que ficou inerte depois de R1-R7
-- (módulos, rotas e contrato de seguradora já saíram). Forward-only. O proprietário confirmou que NÃO há dados reais de
-- seguradora em nenhum ambiente (só teste). NÃO se mexe em valores de enums partilhados (audit_event/alert_type/alert_source/
-- document_resource_type/actor_type/process_kind/process_origin_type): o PostgreSQL não remove valores de enum.

-- 1) Fotos de cartão de apólice (documents.insurance_policy_id): enfileira o apagamento dos ficheiros (outbox) e apaga as linhas
--    de metadados antes de repor o CHECK de "exatamente um recurso" só com prescription_id e examination_id.
INSERT INTO file_deletions (storage_key)
  SELECT storage_key FROM documents WHERE insurance_policy_id IS NOT NULL;
DELETE FROM documents WHERE insurance_policy_id IS NOT NULL;

ALTER TABLE documents DROP CONSTRAINT documents_exactly_one_resource;
DROP INDEX documents_insurance_policy_idx;
ALTER TABLE documents DROP CONSTRAINT documents_insurance_policy_fk;
ALTER TABLE documents DROP COLUMN insurance_policy_id;
ALTER TABLE documents
  ADD CONSTRAINT documents_exactly_one_resource CHECK (num_nonnulls(prescription_id, examination_id) = 1);

-- 2) Coluna de ator da seguradora na auditoria (sem FK; as linhas históricas mantêm o resto).
ALTER TABLE audit_logs DROP COLUMN actor_insurance_account_id;

-- 3) Tabelas inertes (sem CASCADE de propósito: falha se algo fora da lista ainda as referir). Uma só instrução resolve a ordem
--    das dependências entre elas.
DROP TABLE
  insurer_auto_approval_rules,
  insurer_attachments,
  insurer_authorization_events,
  insurer_authorizations,
  insurer_policy_settings,
  insurer_service_kinds,
  policy_setting_definitions,
  expense_types,
  guide_types,
  insurer_plan_coverages,
  insurer_services,
  insurer_providers,
  insurer_import_batches,
  insurer_beneficiary_link_requests,
  insurer_beneficiaries,
  insurer_policies,
  insurer_plans,
  insurer_companies,
  reimbursement_claim_receipts,
  reimbursement_claim_documents,
  reimbursement_claims,
  insurance_policies,
  insurance_sessions,
  insurance_accounts,
  insurer_accounts;

DROP FUNCTION insurer_beneficiaries_bump_card_version();

-- 4) Enums próprios de seguradora (só depois das tabelas que os usavam).
DROP TYPE
  authorization_status,
  authorization_closed_reason,
  authorization_channel,
  authorization_attachment_kind,
  authorization_decider,
  reimbursement_claim_status,
  insurer_service_status,
  coverage_type,
  provider_type,
  provider_status,
  insurer_company_status,
  beneficiary_status,
  beneficiary_relationship,
  link_request_status,
  plan_status_ins,
  insurer_policy_status,
  import_format,
  import_status,
  insurance_account_role,
  insurance_account_status,
  insurer_status;
