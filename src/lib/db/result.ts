// Typed result wrapper — avoids throwing across the data layer

export type DbResult<T> =
  | { data: T; error: null }
  | { data: null; error: string };

export function ok<T>(data: T): DbResult<T> {
  return { data, error: null };
}

export function fail<T>(error: string): DbResult<T> {
  return { data: null, error };
}
