-- Partilha de dados de saúde por categoria (schema.md §2, entities.md SharingGrant, M3). FK
-- compostas para family_members garantem que dono e destinatário pertencem à MESMA família
-- (ADR-008, AC-ISO-01) — nunca um FK simples por id. Enum `data_category` já criado em
-- 0001_extensions_and_enums.sql. SQL simples, sem marcadores +goose (ADR-014/ADR-015).

CREATE TABLE sharing_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES families (id) ON DELETE CASCADE,
  owner_member_id uuid NOT NULL,
  -- nulo = toda a família (DM3/relationships.md).
  grantee_member_id uuid,
  category data_category NOT NULL,
  granted_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sharing_grants_owner_grantee_distinct CHECK (grantee_member_id IS DISTINCT FROM owner_member_id),
  CONSTRAINT sharing_grants_owner_fk FOREIGN KEY (family_id, owner_member_id)
    REFERENCES family_members (family_id, id) ON DELETE CASCADE,
  CONSTRAINT sharing_grants_grantee_fk FOREIGN KEY (family_id, grantee_member_id)
    REFERENCES family_members (family_id, id) ON DELETE CASCADE
);
-- BR-PRV-01..04: uma concessão por (dono, destinatário, categoria); `grantee_member_id` nulo
-- (toda a família) conta como um valor distinto de qualquer outro nulo (NULLS NOT DISTINCT) para
-- que não se possa duplicar a concessão "para toda a família" da mesma categoria.
CREATE UNIQUE INDEX sharing_grants_owner_grantee_category_key
  ON sharing_grants (owner_member_id, grantee_member_id, category) NULLS NOT DISTINCT;
-- Resolver partilha por categoria (AccessPolicy, relação OTHER) e "partilhado comigo" (indexes.md).
CREATE INDEX sharing_grants_grantee_category_idx ON sharing_grants (grantee_member_id, category);
CREATE INDEX sharing_grants_owner_idx ON sharing_grants (owner_member_id);
