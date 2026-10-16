import { useEffect, useState } from 'react';

import { useAuth } from '@/lib/auth-context';

/**
 * Funder filters hold ids; chips need names. Names learned from the funder
 * typeahead are remembered for the session, and any id still unknown (a
 * filter restored from an earlier visit) is looked up once.
 */
const funderNames = new Map<string, string>();

export function rememberFunderNames(funders: Array<{ id: string; name: string }>) {
  for (const funder of funders) funderNames.set(funder.id, funder.name);
}

export function useFunderNames(ids: string[]): Record<string, string> {
  const { authFetch } = useAuth();
  const [, setVersion] = useState(0);
  const missing = ids.filter((id) => !funderNames.has(id)).join(',');

  useEffect(() => {
    if (!missing) return;
    let live = true;
    authFetch(`/api/recommendations/funders?ids=${encodeURIComponent(missing)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { funders?: Array<{ id: string; name: string }> } | null) => {
        if (!live || !data?.funders) return;
        rememberFunderNames(data.funders);
        setVersion((version) => version + 1);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [missing, authFetch]);

  return Object.fromEntries(ids.map((id) => [id, funderNames.get(id) || 'Selected funder']));
}
