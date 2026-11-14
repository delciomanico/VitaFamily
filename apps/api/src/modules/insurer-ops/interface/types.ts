// Tipos comuns da camada de interface.
export type { RequestContext } from "../../../platform/http/index.js";

/** Ficheiro carregado (forma mínima do objeto do multer: o módulo não importa bibliotecas de I/O). */
export interface UploadedFile {
  buffer: Buffer;
  originalName: string;
}
