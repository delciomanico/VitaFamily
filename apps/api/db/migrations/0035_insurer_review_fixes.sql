-- Correções da revisão de segurança da Fase A de seguradoras (módulo `insurer-ops`).
-- (#5) Índices para os pontos de acesso do lado do paciente (`listRequests`/`listLinked`/`findLinked`) e para as ações
-- referenciais `ON DELETE CASCADE/SET NULL` de `family_members` (sem eles cada remoção de membro varre as tabelas).
CREATE INDEX insurer_link_requests_member_idx ON insurer_beneficiary_link_requests (family_id, family_member_id);
CREATE INDEX insurer_beneficiaries_member_idx ON insurer_beneficiaries (family_id, family_member_id) WHERE family_member_id IS NOT NULL;

-- (#10) Quando a ligação a um membro desaparece (SET NULL ao apagar o membro/família, ou revogação), os QR já emitidos têm de
-- deixar de valer: sobe `card_version`, salvo se a própria instrução já o fez (revogação explícita no repositório).
CREATE FUNCTION insurer_beneficiaries_bump_card_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.family_member_id IS NOT NULL AND NEW.family_member_id IS NULL AND NEW.card_version = OLD.card_version THEN
    NEW.card_version := OLD.card_version + 1;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER insurer_beneficiaries_unlink_card_version
  BEFORE UPDATE ON insurer_beneficiaries
  FOR EACH ROW EXECUTE FUNCTION insurer_beneficiaries_bump_card_version();

-- (#3) Expurgo dos lotes de importação em PREVIEW esquecidos: o job percorre-os por idade.
CREATE INDEX insurer_import_batches_preview_idx ON insurer_import_batches (created_at) WHERE status = 'PREVIEW';
