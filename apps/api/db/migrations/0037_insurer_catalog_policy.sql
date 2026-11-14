-- Catálogo `service_kind`, política da seguradora em dados (marco B fatia 2, ADR-033; schema.md §3c, migrations.md "0037").
-- Só aditiva: não toca em `reimbursement_claims` (BR-SEG-42) nem apaga nada. SQL simples, sem triggers.
-- Os limites (min ≤ valor ≤ max, `service_id` só com `allows_service_scope`) validam-se no domínio (conventions §2.2).

-- 1. Catálogos globais do Vita (dados: um tipo novo = uma linha, sem alterar código) + sementes.
CREATE TABLE guide_types (
  code text PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z_]{1,29}$'),
  sort_order int NOT NULL,
  active boolean NOT NULL DEFAULT true
);
INSERT INTO guide_types (code, sort_order) VALUES ('CONSULTATION', 1), ('SERVICES', 2), ('ADMISSION', 3);

CREATE TABLE expense_types (
  code text PRIMARY KEY CHECK (code ~ '^[A-Z][A-Z_]{1,29}$'),
  legacy_code text NOT NULL UNIQUE,
  default_guide_type text NOT NULL REFERENCES guide_types (code),
  default_name text NOT NULL,
  sort_order int NOT NULL,
  active boolean NOT NULL DEFAULT true
);
INSERT INTO expense_types (code, legacy_code, default_guide_type, default_name, sort_order) VALUES
  ('INPATIENT', 'I', 'ADMISSION', 'Internamento', 1),
  ('CHILDBIRTH', 'P', 'ADMISSION', 'Parto', 2),
  ('CONSULTATION', 'C', 'CONSULTATION', 'Consultas', 3),
  ('DIAGNOSTICS', 'EAD', 'SERVICES', 'Exames e diagnóstico', 4),
  ('TREATMENT', 'T', 'SERVICES', 'Tratamentos', 5),
  ('DENTAL', 'E', 'SERVICES', 'Estomatologia', 6),
  ('PROSTHETICS', 'PO', 'SERVICES', 'Próteses e ortóteses', 7),
  ('MEDICATION', 'M', 'SERVICES', 'Medicamentos', 8),
  ('DAILY_ALLOWANCE', 'SD', 'SERVICES', 'Subsídio diário', 9);

CREATE TABLE policy_setting_definitions (
  key text PRIMARY KEY CHECK (key ~ '^[A-Z][A-Z0-9_]{2,59}$'),
  unit text NOT NULL CHECK (unit IN ('HOURS', 'DAYS')),
  min_value int NOT NULL,
  max_value int NOT NULL,
  default_value int NOT NULL,
  allows_service_scope boolean NOT NULL DEFAULT false,
  CONSTRAINT policy_setting_definitions_range CHECK (0 < min_value AND min_value <= default_value AND default_value <= max_value)
);
INSERT INTO policy_setting_definitions (key, unit, min_value, max_value, default_value, allows_service_scope) VALUES
  ('AUTHORIZATION_DECISION_HOURS', 'HOURS', 24, 120, 48, true),
  ('APPEAL_REQUEST_DAYS', 'DAYS', 5, 30, 15, false),
  ('APPEAL_RESPONSE_HOURS', 'HOURS', 24, 120, 72, false),
  ('INFO_REQUEST_EXPIRY_DAYS', 'DAYS', 1, 30, 7, false),
  ('URGENT_NOTICE_HOURS', 'HOURS', 24, 72, 48, false);

-- 2. Tipos de serviço por seguradora (`service_kind`; nunca se apagam, só `INACTIVE`) e política da seguradora.
CREATE TABLE insurer_service_kinds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  insurer_id uuid NOT NULL REFERENCES insurer_accounts (id) ON DELETE CASCADE,
  code text NOT NULL CHECK (char_length(code) BETWEEN 1 AND 40),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 120),
  guide_type text NOT NULL REFERENCES guide_types (code) ON DELETE RESTRICT,
  expense_type text NOT NULL REFERENCES expense_types (code) ON DELETE RESTRICT,
  status insurer_service_status NOT NULL DEFAULT 'ACTIVE',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT insurer_service_kinds_code_key UNIQUE (insurer_id, code),
  CONSTRAINT insurer_service_kinds_insurer_id_id_key UNIQUE (insurer_id, id)
);

CREATE TABLE insurer_policy_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  insurer_id uuid NOT NULL REFERENCES insurer_accounts (id) ON DELETE CASCADE,
  setting_key text NOT NULL REFERENCES policy_setting_definitions (key) ON DELETE RESTRICT,
  -- Nulo = valor da seguradora; preenchido = exceção por serviço (só chaves com `allows_service_scope`).
  service_id uuid,
  value int NOT NULL,
  updated_by_insurance_account_id uuid REFERENCES insurance_accounts (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT insurer_policy_settings_service_fk FOREIGN KEY (insurer_id, service_id) REFERENCES insurer_services (insurer_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX insurer_policy_settings_insurer_key_idx ON insurer_policy_settings (insurer_id, setting_key) WHERE service_id IS NULL;
CREATE UNIQUE INDEX insurer_policy_settings_service_key_idx ON insurer_policy_settings (insurer_id, setting_key, service_id) WHERE service_id IS NOT NULL;

-- 3. Semeadura por seguradora existente: 9 tipos (um por `expense_types`); idempotente (novas: na primeira utilização, na `application`).
INSERT INTO insurer_service_kinds (insurer_id, code, name, guide_type, expense_type)
SELECT i.id, e.code, e.default_name, e.default_guide_type, e.code
FROM insurer_accounts i CROSS JOIN expense_types e
WHERE e.active
ON CONFLICT (insurer_id, code) DO NOTHING;

-- 4. Ligação do serviço ao tipo (nulo = por classificar).
ALTER TABLE insurer_services ADD COLUMN service_kind_id uuid;
ALTER TABLE insurer_services ADD CONSTRAINT insurer_services_kind_fk
  FOREIGN KEY (insurer_id, service_kind_id) REFERENCES insurer_service_kinds (insurer_id, id) ON DELETE RESTRICT;
CREATE INDEX insurer_services_kind_idx ON insurer_services (insurer_id, service_kind_id);

-- 5. Mapeamento conservador da `category` livre (normalizada: minúsculas, sem acentos): só se EXATAMENTE UM tipo de despesa
-- corresponder; ambíguos e sem correspondência ficam NULL («por classificar»). Idempotente. Não toca em code/name/status.
CREATE TEMP TABLE category_patterns (expense_type text PRIMARY KEY, pattern text NOT NULL) ON COMMIT DROP;
INSERT INTO category_patterns (expense_type, pattern) VALUES
  ('CONSULTATION', 'consult'),
  ('INPATIENT', 'internament|internac'),
  ('CHILDBIRTH', 'parto|matern'),
  ('DIAGNOSTICS', 'exame|diagn|laborat|imagem|radiolog|analise'),
  ('TREATMENT', 'tratament|fisio|terap'),
  ('DENTAL', 'estomat|dent'),
  ('PROSTHETICS', 'protese|ortese'),
  ('MEDICATION', 'medicament|farmac'),
  ('DAILY_ALLOWANCE', 'subsidio');

WITH normalized AS (
  SELECT s.id, s.insurer_id,
         translate(lower(s.category), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc') AS category
  FROM insurer_services s
  WHERE s.service_kind_id IS NULL AND s.category IS NOT NULL
), matches AS (
  SELECT n.id, n.insurer_id, min(p.expense_type) AS expense_type, count(*) AS hits
  FROM normalized n JOIN category_patterns p ON n.category ~ p.pattern
  GROUP BY n.id, n.insurer_id
)
UPDATE insurer_services s
SET service_kind_id = k.id
FROM matches m
JOIN insurer_service_kinds k ON k.insurer_id = m.insurer_id AND k.code = m.expense_type
WHERE s.id = m.id AND s.insurer_id = m.insurer_id AND m.hits = 1 AND s.service_kind_id IS NULL;
