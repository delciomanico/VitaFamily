-- +goose Up
-- Extensões (schema.md §8) e enums (schema.md §6). Gerado a partir do documento; manter alinhado.
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE user_status AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED');
CREATE TYPE platform_role AS ENUM ('NONE', 'PLATFORM_ADMIN');
CREATE TYPE auth_token_type AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET');
CREATE TYPE family_role AS ENUM ('FAMILY_ADMIN', 'FAMILY_MEMBER');
CREATE TYPE member_status AS ENUM ('ACTIVE', 'BLOCKED');
CREATE TYPE blood_type AS ENUM ('A_POS', 'A_NEG', 'B_POS', 'B_NEG', 'AB_POS', 'AB_NEG', 'O_POS', 'O_NEG', 'UNKNOWN');
CREATE TYPE invitation_type AS ENUM ('MEMBER', 'DEPENDENT_ACCOUNT');
CREATE TYPE invitation_status AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED');
CREATE TYPE data_category AS ENUM ('ALLERGIES', 'CONDITIONS', 'MEDICATION', 'APPOINTMENTS', 'EXAMS');
CREATE TYPE condition_kind AS ENUM ('CONDITION', 'HISTORY');
CREATE TYPE prescription_status AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED');
CREATE TYPE schedule_type AS ENUM ('FIXED_TIMES', 'INTERVAL');
CREATE TYPE plan_status AS ENUM ('ACTIVE', 'ENDED');
CREATE TYPE dose_status AS ENUM ('PENDING', 'TAKEN', 'NOT_TAKEN', 'UNCONFIRMED');
CREATE TYPE appointment_status AS ENUM ('SCHEDULED', 'COMPLETED', 'NO_SHOW', 'CANCELLED');
CREATE TYPE exam_status AS ENUM ('SCHEDULED', 'COMPLETED', 'CANCELLED');
CREATE TYPE scan_status AS ENUM ('PENDING', 'CLEAN', 'INFECTED');
CREATE TYPE clinic_type AS ENUM ('PARTNER', 'PRIVATE');
CREATE TYPE clinic_status AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE alert_type AS ENUM ('MEDICATION_DUE', 'APPOINTMENT_REMINDER', 'EXAM_REMINDER', 'APPOINTMENT_OUTCOME_REQUEST');
CREATE TYPE alert_source AS ENUM ('DOSE', 'APPOINTMENT', 'EXAMINATION');
CREATE TYPE channel AS ENUM ('PUSH', 'EMAIL');
CREATE TYPE notification_status AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');
CREATE TYPE actor_type AS ENUM ('USER', 'SYSTEM', 'PLATFORM_ADMIN');
CREATE TYPE audit_result AS ENUM ('SUCCESS', 'DENIED', 'FAILURE');
CREATE TYPE export_reason AS ENUM ('USER_REQUEST', 'LEAVE_FAMILY', 'REMOVED_BY_ADMIN');
CREATE TYPE export_status AS ENUM ('PENDING', 'READY', 'EXPIRED', 'FAILED');

-- +goose Down
DROP TYPE IF EXISTS export_status;
DROP TYPE IF EXISTS export_reason;
DROP TYPE IF EXISTS audit_result;
DROP TYPE IF EXISTS actor_type;
DROP TYPE IF EXISTS notification_status;
DROP TYPE IF EXISTS channel;
DROP TYPE IF EXISTS alert_source;
DROP TYPE IF EXISTS alert_type;
DROP TYPE IF EXISTS clinic_status;
DROP TYPE IF EXISTS clinic_type;
DROP TYPE IF EXISTS scan_status;
DROP TYPE IF EXISTS exam_status;
DROP TYPE IF EXISTS appointment_status;
DROP TYPE IF EXISTS dose_status;
DROP TYPE IF EXISTS plan_status;
DROP TYPE IF EXISTS schedule_type;
DROP TYPE IF EXISTS prescription_status;
DROP TYPE IF EXISTS condition_kind;
DROP TYPE IF EXISTS data_category;
DROP TYPE IF EXISTS invitation_status;
DROP TYPE IF EXISTS invitation_type;
DROP TYPE IF EXISTS blood_type;
DROP TYPE IF EXISTS member_status;
DROP TYPE IF EXISTS family_role;
DROP TYPE IF EXISTS auth_token_type;
DROP TYPE IF EXISTS platform_role;
DROP TYPE IF EXISTS user_status;
-- As extensões não são removidas no Down (podem ser usadas por outras bases/objetos).
