/** Latência simulada da rede, para que os estados de loading sejam visíveis. */
const LATENCY_MS = import.meta.env.MODE === 'test' ? 0 : 450

const wait = () => new Promise((resolve) => setTimeout(resolve, LATENCY_MS))

/**
 * Executa um handler mock como se fosse um pedido HTTP:
 * espera a latência e devolve uma cópia (a UI nunca altera a “base de dados” diretamente).
 */
export async function respond<T>(handler: () => T): Promise<T> {
  await wait()
  return structuredClone(handler())
}
