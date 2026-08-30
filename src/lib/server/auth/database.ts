import type { QueryResult, QueryResultRow } from 'pg';

export interface AuthDatabase {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
}

export interface AuthTransaction extends AuthDatabase {
  release(): void;
}

export interface AuthPool {
  connect(): Promise<AuthTransaction>;
}
