import { useCallback, useEffect, useState } from 'react';

import { api, ApiError } from './client.js';

export interface Resource<T> {
  data?: T;
  error?: string;
  loading: boolean;
  reload(): Promise<void>;
}

/**
 * Loads something from the API and keeps the three states every screen needs.
 * Written once here so no screen has to reinvent "still loading" versus
 * "loaded and empty" — a distinction that is easy to get wrong and shows up as
 * a flash of "nothing found" before the data arrives.
 */
export function useResource<T>(path: string | undefined): Resource<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(Boolean(path));

  const load = useCallback(async () => {
    if (!path) {
      return;
    }

    setLoading(true);

    try {
      setData(await api.get<T>(path));
      setError(undefined);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Die Daten konnten nicht geladen werden');
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, error, loading, reload: load };
}

/** Turns any thrown value into something worth showing a person. */
export function messageOf(failure: unknown, fallback: string): string {
  return failure instanceof ApiError ? failure.message : failure instanceof Error ? failure.message : fallback;
}
