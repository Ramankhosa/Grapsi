import { useState } from 'react';
import { X } from 'lucide-react';

import { allCountryCodes, countryNameFor, resolveCountryList } from '@/lib/geo/countries';

const COUNTRY_NAMES = Array.from(new Set(allCountryCodes().map(countryNameFor))).sort((a, b) => a.localeCompare(b));

const sameCountry = (a: string, b: string) => {
  const [codeA] = resolveCountryList([a]).codes;
  const [codeB] = resolveCountryList([b]).codes;
  return Boolean(codeA) && codeA === codeB;
};

/**
 * Chosen countries as removable chips, plus a field that suggests country
 * names. Only recognised countries are added, by their canonical name.
 */
export default function CountryPicker({
  id,
  label,
  hint,
  values,
  onChange,
  suggestion,
}: {
  id: string;
  label: string;
  hint?: string;
  values: string[];
  onChange: (values: string[]) => void;
  /** A one-click choice, e.g. the country on the researcher's profile. */
  suggestion?: string | null;
}) {
  const [text, setText] = useState('');
  const [unknown, setUnknown] = useState(false);
  const listId = `${id}-countries`;
  const add = (raw: string) => {
    const [code] = resolveCountryList([raw.trim()]).codes;
    if (!code) {
      setUnknown(Boolean(raw.trim()));
      return;
    }
    const name = countryNameFor(code);
    if (!values.some((value) => sameCountry(value, name))) onChange([...values, name]);
    setText('');
    setUnknown(false);
  };
  const showSuggestion = suggestion && !values.some((value) => sameCountry(value, suggestion));

  return (
    <div className="py-1">
      <label htmlFor={id} className="cb-label">{label}</label>
      {values.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {values.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => onChange(values.filter((item) => item !== value))}
              className="cb-chip cb-chip-active"
              aria-label={`Remove ${value}`}
            >
              {value}
              <X className="h-3 w-3" />
            </button>
          ))}
        </div>
      ) : null}
      <div className="mt-2 flex gap-1.5">
        <input
          id={id}
          list={listId}
          value={text}
          onChange={(event) => {
            const value = event.target.value;
            setText(value);
            setUnknown(false);
            // Picked from the list (not typed letter by letter): add it now.
            const inputType = (event.nativeEvent as InputEvent).inputType;
            if ((!inputType || inputType === 'insertReplacementText') && COUNTRY_NAMES.includes(value)) add(value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add(text);
            }
          }}
          placeholder="Type a country"
          className="cb-input py-2 text-[13px]"
        />
        <button type="button" onClick={() => add(text)} disabled={!text.trim()} className="cb-btn-secondary cb-btn-sm shrink-0">
          Add
        </button>
      </div>
      <datalist id={listId}>
        {COUNTRY_NAMES.map((name) => (
          <option key={name} value={name} />
        ))}
      </datalist>
      {unknown ? <p className="mt-1 text-[12px] text-amber-700">Not a country we recognise.</p> : null}
      {showSuggestion ? (
        <button type="button" onClick={() => add(suggestion)} className="mt-1.5 text-[12px] font-medium text-cobalt-700 hover:underline">
          + {suggestion} (your profile)
        </button>
      ) : null}
      {hint ? <p className="cb-hint mt-1.5">{hint}</p> : null}
    </div>
  );
}
