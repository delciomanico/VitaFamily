import type { ReportSection } from '@/types/clinicReport'

/**
 * Textos-guia (placeholders) do relatório por especialidade (ADR-027, clinic-portal-v2 §5.1).
 * Estáticos no cliente: sem tabela, sem API, sem lógica clínica. Orientam o que escrever mas
 * **nunca** preenchem o texto do relatório.
 */
export type ReportTemplate = Record<ReportSection, string>

const GENERAL: ReportTemplate = {
  reason: 'Ex.: queixa principal e há quanto tempo.',
  findings: 'Ex.: observação, exame físico e dados relevantes da consulta.',
  impression: 'Ex.: diagnóstico ou impressão do profissional.',
  plan: 'Ex.: conduta, tratamento, exames pedidos e quando reavaliar.',
}

const TEMPLATES: Record<string, ReportTemplate> = {
  cardiologia: {
    reason: 'Ex.: palpitações, dor torácica, falta de ar, seguimento.',
    findings: 'Ex.: tensão arterial, frequência cardíaca, auscultação, ECG.',
    impression: 'Ex.: impressão cardiológica.',
    plan: 'Ex.: ajuste terapêutico, exames a pedir, próxima consulta.',
  },
  dermatologia: {
    reason: 'Ex.: lesão ou sintoma cutâneo e evolução.',
    findings: 'Ex.: localização, aspeto e extensão das lesões.',
    impression: 'Ex.: impressão dermatológica.',
    plan: 'Ex.: tratamento tópico ou sistémico, cuidados, reavaliação.',
  },
  pediatria: {
    reason: 'Ex.: motivo da consulta e idade da criança.',
    findings: 'Ex.: peso, altura, desenvolvimento, observação.',
    impression: 'Ex.: impressão pediátrica.',
    plan: 'Ex.: conduta, sinais de alarme explicados, próxima consulta.',
  },
  ortopedia: {
    reason: 'Ex.: dor ou limitação articular, mecanismo de lesão.',
    findings: 'Ex.: mobilidade, força, testes realizados, imagem.',
    impression: 'Ex.: impressão ortopédica.',
    plan: 'Ex.: repouso, fisioterapia, exames, reavaliação.',
  },
  ginecologia: {
    reason: 'Ex.: motivo da consulta e antecedentes relevantes.',
    findings: 'Ex.: observação e exames realizados.',
    impression: 'Ex.: impressão ginecológica.',
    plan: 'Ex.: conduta, rastreios, próxima consulta.',
  },
  oftalmologia: {
    reason: 'Ex.: alteração da visão ou sintoma ocular.',
    findings: 'Ex.: acuidade visual, pressão ocular, fundo do olho.',
    impression: 'Ex.: impressão oftalmológica.',
    plan: 'Ex.: correção, tratamento, reavaliação.',
  },
}

const normalize = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

/** Texto-guia da especialidade (correspondência por palavra, sem acentos); modelo geral por omissão. */
export function reportTemplateFor(specialty?: string): ReportTemplate {
  if (!specialty) return GENERAL
  const key = Object.keys(TEMPLATES).find((k) => normalize(specialty).includes(k))
  return key ? TEMPLATES[key]! : GENERAL
}
