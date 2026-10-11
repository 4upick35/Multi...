export type ElmaRequestKind =
  | 'network'
  | 'timeout'
  | 'server'
  | 'rate'
  | 'unauthorized'
  | 'other';

export class ElmaRequestError extends Error {
  kind: ElmaRequestKind;
  status?: number;

  constructor(kind: ElmaRequestKind, message: string, status?: number) {
    super(message);
    this.name = 'ElmaRequestError';
    this.kind = kind;
    this.status = status;
  }
}
