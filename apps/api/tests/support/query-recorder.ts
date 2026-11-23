/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- instrumentação de teste sobre o protótipo do cliente `pg` */
// Regista as instruções SQL enviadas ao PostgreSQL por TODAS as ligações do processo (patch do `pg.Client.prototype.query`), para os testes
// contarem consultas (deteção de N+1) e fazerem EXPLAIN do SQL real. Só para testes; cada ficheiro de teste corre no seu próprio processo/worker.
import pg from "pg";

export interface RecordedQuery {
  text: string;
  values: unknown[];
}

const CONTROL = /^\s*(BEGIN|COMMIT|ROLLBACK|SET |SAVEPOINT|RELEASE)/i;

export function installQueryRecorder() {
  const log: RecordedQuery[] = [];
  const proto = pg.Client.prototype as any;
  const original = proto.query;
  proto.query = function patched(this: unknown, ...args: any[]) {
    const first = args[0];
    if (typeof first === "string") log.push({ text: first, values: Array.isArray(args[1]) ? args[1] : [] });
    else if (first && typeof first.text === "string") log.push({ text: first.text, values: Array.isArray(first.values) ? first.values : [] });
    return original.apply(this, args);
  };
  return {
    reset: () => {
      log.length = 0;
    },
    /** Todas as instruções desde o último `reset`. */
    statements: (): RecordedQuery[] => [...log],
    /** Só as instruções de dados (sem BEGIN/COMMIT/ROLLBACK). */
    dataStatements: (): RecordedQuery[] => log.filter((q) => !CONTROL.test(q.text)),
    restore: () => {
      proto.query = original;
    },
  };
}
