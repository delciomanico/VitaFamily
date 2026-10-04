# ADR-005 — Dados de saúde pertencem ao FamilyMember (por família)

**Estado:** Aceite (delegação do proprietário, 2026-10-04)

## Contexto
D2 permite um User em várias famílias; D13 dá a cada adulto controlo sobre o que partilha; R4 exige "levar ou apagar" dados ao sair.

## Decisão
Os registos de saúde ligam-se a **FamilyMember** (pessoa dentro de uma família). Um User em duas famílias tem dois perfis independentes.

## Alternativas
Entidade `Person` global partilhada por várias famílias; dados ligados ao `User`.

## Justificação
Cascata simples para sair/apagar; privacidade e isolamento por família por construção; sem sincronização entre famílias. A alternativa criaria dados partilhados entre famílias e consentimentos cruzados difíceis de garantir.

## Consequências
O utilizador regista dados duas vezes se estiver em duas famílias. Pode ser revisto por change control se a necessidade se confirmar.
