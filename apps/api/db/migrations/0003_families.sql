-- Família e pessoas (schema.md §2): families, family_members, guardianships, invitations.
-- Isolamento entre famílias (ADR-008, AC-ISO-01): os filhos usam FK composta
-- (family_id, member_id) -> family_members(family_id, id), nunca um FK simples por id — impede, na
-- própria BD, que um registo aponte para um membro de outra família. Enums já criados em
-- 0001_extensions_and_enums.sql. SQL simples, sem marcadores +goose (ADR-014/ADR-015).

CREATE TABLE families (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Pessoa numa família (entities.md FamilyMember); `user_id` nulo = sem conta (schema.md §2).
-- As invariantes de negócio não expressáveis em CHECK (menor ⇒ dependente; admin adulto; máx. 120
-- anos) são garantidas no serviço e por testes (schema.md §2 nota) — aqui só as estruturais.
CREATE TABLE family_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES families (id) ON DELETE CASCADE,
  user_id uuid REFERENCES users (id) ON DELETE CASCADE,
  name text NOT NULL,
  birth_date date NOT NULL,
  role family_role,
  is_dependent boolean NOT NULL DEFAULT false,
  blood_type blood_type,
  status member_status NOT NULL DEFAULT 'ACTIVE',
  blocked_at timestamptz,
  scheduled_deletion_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT family_members_birth_date_not_future CHECK (birth_date <= current_date),
  CONSTRAINT family_members_role_requires_account CHECK (role IS NULL OR user_id IS NOT NULL),
  CONSTRAINT family_members_blocked_requires_no_account CHECK (status <> 'BLOCKED' OR user_id IS NULL),
  -- Alvo das FK compostas de guardianships/invitations/futuros módulos de saúde (ADR-008).
  CONSTRAINT family_members_family_id_id_key UNIQUE (family_id, id)
);
CREATE UNIQUE INDEX family_members_family_user_unique_idx ON family_members (family_id, user_id) WHERE user_id IS NOT NULL;
CREATE INDEX family_members_user_id_idx ON family_members (user_id);
CREATE INDEX family_members_family_id_idx ON family_members (family_id);
-- Job de apagamento a 90 dias (B2, M9).
CREATE INDEX family_members_scheduled_deletion_idx ON family_members (scheduled_deletion_at) WHERE status = 'BLOCKED';
-- Job de maioridade (avisos 30/7/0 dias, B1, M9).
CREATE INDEX family_members_birth_date_idx ON family_members (birth_date);

-- Relação tutor<->dependente (N1, BR-MEM-03..08); FK compostas para family_members garantem que
-- tutor e dependente pertencem à MESMA família (AC-ISO-01).
CREATE TABLE guardianships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES families (id) ON DELETE CASCADE,
  dependent_id uuid NOT NULL,
  guardian_id uuid NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guardianships_dependent_guardian_distinct CHECK (dependent_id <> guardian_id),
  CONSTRAINT guardianships_dependent_guardian_unique UNIQUE (dependent_id, guardian_id),
  CONSTRAINT guardianships_dependent_fk FOREIGN KEY (family_id, dependent_id)
    REFERENCES family_members (family_id, id) ON DELETE CASCADE,
  CONSTRAINT guardianships_guardian_fk FOREIGN KEY (family_id, guardian_id)
    REFERENCES family_members (family_id, id) ON DELETE CASCADE
);
-- BR-MEM-06: exatamente um tutor principal por dependente — garantido na própria BD (não só na
-- aplicação) por um índice único parcial (indexes.md regra 1: índices parciais em SQL manual).
CREATE UNIQUE INDEX guardianships_primary_guardian_idx ON guardianships (dependent_id) WHERE is_primary;
-- "Quem são os meus dependentes" (autorização e alertas, FR-MEM-06).
CREATE INDEX guardianships_guardian_id_idx ON guardianships (guardian_id);

-- Convite de membro ou de conta de dependente (BR-MEM-12, R3); `member_id` liga a um perfil sem
-- conta existente (FK composta opcional — nula não viola a constraint, families.md).
CREATE TABLE invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family_id uuid NOT NULL REFERENCES families (id) ON DELETE CASCADE,
  email citext NOT NULL,
  type invitation_type NOT NULL,
  member_id uuid,
  token_hash text NOT NULL UNIQUE,
  status invitation_status NOT NULL DEFAULT 'PENDING',
  expires_at timestamptz NOT NULL,
  invited_by uuid REFERENCES users (id) ON DELETE SET NULL,
  accepted_by uuid REFERENCES users (id) ON DELETE SET NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT invitations_member_fk FOREIGN KEY (family_id, member_id)
    REFERENCES family_members (family_id, id) ON DELETE CASCADE
);
CREATE INDEX invitations_family_status_idx ON invitations (family_id, status);
CREATE INDEX invitations_pending_email_idx ON invitations (email) WHERE status = 'PENDING';
CREATE INDEX invitations_pending_expires_idx ON invitations (expires_at) WHERE status = 'PENDING';
