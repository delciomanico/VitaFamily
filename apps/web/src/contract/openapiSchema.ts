import { readFileSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import { parse } from 'yaml'

/*
 * Valida valores contra as schemas de `docs/05-api/openapi.yaml` (fonte única do contrato).
 * Só para testes: o contrato manda e os mocks não podem divergir dele.
 */

type Json = Record<string, unknown>

const spec = parse(readFileSync(resolvePath(process.cwd(), '../../docs/05-api/openapi.yaml'), 'utf8')) as {
  components: { schemas: Record<string, Json> }
}

const ajv = new Ajv({ strict: false, allErrors: true })
addFormats(ajv)
ajv.addSchema(spec, 'openapi')

/** Erros de validação (vazio = válido) de `value` contra `components.schemas[name]`. */
export function contractErrors(name: string, value: unknown, options: { ignoreUuid?: boolean } = {}): string[] {
  const validate = ajv.getSchema(`openapi#/components/schemas/${name}`)
  if (!validate) throw new Error(`Schema desconhecida no openapi: ${name}`)
  if (validate(value) || options.ignoreUuid) {
    const fromSchema = (validate.errors ?? []).filter((e) => !(options.ignoreUuid && e.keyword === 'format' && e.params.format === 'uuid'))
    if (fromSchema.length === 0) return unknownKeys(spec.components.schemas[name], value, name)
  }
  return (validate.errors ?? [])
    .filter((e) => !(options.ignoreUuid && e.keyword === 'format' && e.params.format === 'uuid'))
    .map((e) => `${e.instancePath || '/'} ${e.message}`)
}

function resolve(schema: Json): Json {
  const ref = schema.$ref as string | undefined
  return ref ? resolve(spec.components.schemas[ref.split('/').pop() as string] as Json) : schema
}

function allProperties(schema: Json): Record<string, Json> {
  const s = resolve(schema)
  const own = (s.properties as Record<string, Json> | undefined) ?? {}
  const merged = ((s.allOf as Json[] | undefined) ?? []).reduce<Record<string, Json>>((acc, part) => ({ ...acc, ...allProperties(part) }), {})
  return { ...merged, ...own }
}

/** O contrato não fecha os objetos (`additionalProperties`), mas um campo que o openapi não declara é divergência. */
function unknownKeys(schema: Json | undefined, value: unknown, path: string): string[] {
  if (!schema || value === null || typeof value !== 'object') return []
  const s = resolve(schema)
  if (Array.isArray(value)) return value.flatMap((item, i) => unknownKeys(s.items as Json | undefined, item, `${path}[${i}]`))
  if (s.additionalProperties && typeof s.additionalProperties === 'object') {
    return Object.entries(value).flatMap(([k, v]) => unknownKeys(s.additionalProperties as Json, v, `${path}.${k}`))
  }
  const props = allProperties(s)
  if (Object.keys(props).length === 0) return []
  return Object.entries(value as Json).flatMap(([k, v]) =>
    props[k] ? unknownKeys(props[k], v, `${path}.${k}`) : [`${path}.${k}: campo não declarado no openapi`],
  )
}
