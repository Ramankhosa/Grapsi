import { useEffect, useState } from 'react';
import { X } from 'lucide-react';

import { rememberFunderNames, useFunderNames } from '@/hooks/useFunderNames';
import { useAuth } from '@/lib/auth-context';

type FunderOption = { id: string; name: string; acronym: string | null; countryCode: string | null; callCount: number };

/**
 * Funder filter: search by name, acronym or alias; the filter keeps funder
 * ids. `showSelected` off when the caller lists the chosen funders itself.
 */
export default function FunderPicker({
  values,
  onChange,
  label = 'Funder',
  showSelected = true,
  placeholder = 'Search funders: NIH, Wellcome, European Research Council',
}: {
  values: string[] | undefined;
  onChange: (ids: string[]) => void;
  label?: string | null;
  showSelected?: boolean;
  placeholder?: string;
}) {
  const { authFetch } = useAuth();
  const selected = values || [];
  const names = useFunderNames(selected);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<FunderOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
    const timer = setTimeout(() => {
      authFetch(`/api/recommendations/funders?q=${encodeURIComponent(q)}`)
        .then((response) => (response.ok ? response.json() : { funders: [] }))
        .then((data: { funders?: FunderOption[] }) => {
          if (!live) return;
          rememberFunderNames(data.funders || []);
          setResults(data.funders || []);
        })
        .catch(() => {
          if (live) setResults([]);
        })
        .finally(() => {
          if (live) setLoading(false);
        });
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, authFetch]);

  return (
    <div>
      {label ? <div className="cb-label">{label}</div> : null}
      {showSelected && selected.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {selected.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => onChange(selected.filter((value) => value !== id))}
              className="cb-chip cb-chip-active"
              title="Remove this funder"
            >
              {names[id]}
              <X className="h-3 w-3" />
            </button>
          ))}
        </div>
      ) : null}
      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={placeholder}
        aria-label="Search funders"
        className={`cb-input ${label || (showSelected && selected.length > 0) ? 'mt-2' : ''}`}
      />
      {loading ? <p className="mt-1.5 text-[12px] text-muted">Searching…</p> : null}
      {!loading && query.trim().length >= 2 && results.length === 0 ? (
        <p className="mt-1.5 text-[12px] text-muted">No funder with published calls matches that.</p>
      ) : null}
      {results.length > 0 ? (
        <ul className="mt-1.5 max-h-56 overflow-y-auto rounded-lg border border-hairline">
          {results.map((funder) => {
            const chosen = selected.includes(funder.id);
            return (
              <li key={funder.id} className="border-b border-hairline last:border-b-0">
                <button
                  type="button"
                  disabled={chosen}
                  onClick={() => {
                    onChange([...selected, funder.id]);
                    setQuery('');
                  }}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[13px] text-ink hover:bg-inset disabled:cursor-default disabled:opacity-50"
                >
                  <span className="min-w-0 truncate">
                    {funder.name}
                    {funder.acronym && !funder.name.includes(funder.acronym) ? ` (${funder.acronym})` : ''}
                    {funder.countryCode ? <span className="text-muted"> · {funder.countryCode}</span> : null}
                  </span>
                  <span className="shrink-0 text-[12px] text-muted">
                    {chosen ? 'Added' : `${funder.callCount} ${funder.callCount === 1 ? 'call' : 'calls'}`}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
