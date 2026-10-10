import { z } from 'zod'
import { ageOn, isValidISODate, todayISO } from '@/lib/date'
import { ADULT_AGE, PASSWORD_MIN_LENGTH } from '@/lib/policy'

/** Registo segundo UC-ACC-01: maior de idade, palavra-passe forte e termos aceites. */
export const registerSchema = z
  .object({
    name: z.string().trim().min(2, 'Introduza o seu nome.'),
    email: z.email('Introduza um e-mail válido.'),
    birthDate: z
      .string()
      .refine(isValidISODate, 'Introduza a data de nascimento.')
      .refine((date) => date <= todayISO(), 'A data não pode ser futura.')
      .refine((date) => ageOn(date) >= ADULT_AGE, `É necessário ter ${ADULT_AGE} anos ou mais para criar conta.`),
    password: z.string().min(PASSWORD_MIN_LENGTH, `Use pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`),
    confirmPassword: z.string().min(1, 'Confirme a palavra-passe.'),
    acceptTerms: z.boolean().refine(Boolean, 'É necessário aceitar os termos para continuar.'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'As palavras-passe não coincidem.',
    path: ['confirmPassword'],
  })

export type RegisterFormValues = z.infer<typeof registerSchema>
