import { useCallback, useEffect, useState } from 'react';
import { Building2, X } from 'lucide-react';
import toast from 'react-hot-toast';

import { useAuth } from '@/lib/auth-context';

type Verdict = 'ELIGIBLE' | 'INELIGIBLE' | 'NEEDS_CHECK' | 'NOT_EVALUATED';

interface Preview {
  callId: string;
  title: string;
  promoted: { at: string; by: string; notify: { officers: boolean; researchers: boolean } } | null;
  promotable: boolean;
  blockers: string[];
  warnings: string[];
  tenants: Array<{ tenantId: string; name: string; countryName: string; verdict: Verdict; schools: Array<{ id: string; name: string }> }>;
  enrichmentLevel: string | null;
  sourceCheckedAt: string | null;
  attribution: string | null;
  defaults: { notifyOfficers: boolean; alertResearchers: boolean };
}

const VERDICT_LABEL: Record<Verdict, string> = {
  ELIGIBLE: 'Eligible',
  NEEDS_CHECK: 'Check eligibility',
  INELIGIBLE: 'Not eligible',
  NOT_EVALUATED: 'Not stated',
};

/** Who may promote: the same people who release imported calls. */
export function canPromoteToDsr(user: { roles?: string[]; platformPermissions?: string[]; ati_id?: string | null } | null | undefined) {
  const roles = user?.roles || [];
  return (
    roles.includes('SUPER_ADMIN') ||
    (roles.includes('ADMIN') && user?.ati_id === 'PLATFORM') ||
    (user?.platformPermissions || []).includes('funding.publisher.write')
  );
}

const day = (value: string) => new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * Send an imported catalogue call to the funding department, or take it back.
 * Shows what promotion would do before anything changes.
 */
export default function PromoteToDsrPanel({ callId, onChanged }: { callId: string; onChanged?: () => void }) {
  const { authFetch } = useAuth();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notifyOfficers, setNotifyOfficers] = useState(true);
  const [alertResearchers, setAlertResearchers] = useState(false);

  const load = useCallback(async () => {
    const response = await authFetch(`/api/admin/funding/import-review/promote?callId=${encodeURIComponent(callId)}`);
    if (!response.ok) return setPreview(null);
    const data = (await response.json()) as Preview;
    setPreview(data);
    setNotifyOfficers(data.defaults.notifyOfficers);
    setAlertResearchers(data.defaults.alertResearchers);
  }, [authFetch, callId]);

  useEffect(() => {
    load().catch(() => setPreview(null));
  }, [load]);

  if (!preview) return null;

  async function promote() {
    setBusy(true);
    try {
      const response = await authFetch('/api/admin/funding/import-review/promote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId, notifyOfficers, alertResearchers }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Promotion failed');
      const parts = [
        `mapped to ${data.schoolsMapped + data.schoolsReinstated} school${data.schoolsMapped + data.schoolsReinstated === 1 ? '' : 's'}`,
        data.officersNotified ? `${data.officersNotified} officer${data.officersNotified === 1 ? '' : 's'} notified` : null,
        data.researcherAlerts === 'queued' ? 'researcher alerts on their way' : null,
        data.guidelines === 'fetching' ? 'fetching the official guidelines' : null,
      ].filter(Boolean);
      toast.success(`In the funding department: ${parts.join(', ')}.`);
      setOpen(false);
      await load();
      onChanged?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Promotion failed');
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    if (!window.confirm('Take this call out of the funding department?\n\nIts school mappings end and it returns to the global catalogue. Notices already sent stay sent.')) return;
    setBusy(true);
    try {
      const response = await authFetch('/api/admin/funding/import-review/withdraw', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Withdraw failed');
      toast.success('Withdrawn from the funding department.');
      await load();
      onChanged?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Withdraw failed');
    } finally {
      setBusy(false);
    }
  }

  if (preview.promoted) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-900">
        <Building2 className="h-4 w-4" />
        <span>
          In the funding department since {day(preview.promoted.at)} · sent by {preview.promoted.by}
        </span>
        <button type="button" onClick={() => void withdraw()} disabled={busy} className="cb-btn-ghost cb-btn-sm">
          Withdraw
        </button>
      </div>
    );
  }

  const schoolCount = preview.tenants.reduce((n, tenant) => n + tenant.schools.length, 0);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="cb-btn-secondary cb-btn-sm">
        <Building2 className="h-4 w-4" />
        Send to funding department
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="promote-title">
          <button type="button" aria-label="Close" onClick={() => setOpen(false)} className="absolute inset-0 bg-ink/30" />
          <div className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-ground p-5 shadow-cb-sheet">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="promote-title" className="text-[16px] font-semibold text-ink">Send to the funding department</h2>
                <p className="mt-1 text-[13px] text-muted">{preview.title}</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="cb-btn-ghost cb-btn-sm px-2">
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="mt-3 text-[13px] leading-6 text-ink-soft">
              The call becomes a department call for every institution with a funding office: it enters their queues, pendency and
              escalations apply to it, and researcher matching runs for each institution.
            </p>

            {preview.blockers.length > 0 ? (
              <ul className="mt-3 space-y-1 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800">
                {preview.blockers.map((item) => <li key={item}>{item}</li>)}
              </ul>
            ) : null}
            {preview.warnings.length > 0 ? (
              <ul className="mt-3 space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
                {preview.warnings.map((item) => <li key={item}>{item}</li>)}
              </ul>
            ) : null}

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead className="text-[11px] uppercase tracking-wide text-muted-soft">
                  <tr>
                    <th className="py-1.5 pr-3 font-medium">Institution</th>
                    <th className="py-1.5 pr-3 font-medium">Country</th>
                    <th className="py-1.5 pr-3 font-medium">Eligibility</th>
                    <th className="py-1.5 font-medium">Schools reached</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.tenants.map((tenant) => (
                    <tr key={tenant.tenantId} className="border-t border-hairline align-top">
                      <td className="py-2 pr-3 text-ink">{tenant.name}</td>
                      <td className="py-2 pr-3 text-ink-soft">{tenant.countryName}</td>
                      <td className="py-2 pr-3 text-ink-soft">{VERDICT_LABEL[tenant.verdict]}</td>
                      <td className="py-2 text-ink-soft">
                        {tenant.schools.length ? tenant.schools.map((school) => school.name).join(', ') : 'None mapped by subject'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="cb-hint mt-1.5">
                Eligibility is checked for a researcher living, working and holding citizenship in each institution&rsquo;s country.
              </p>
            </div>

            <p className="cb-hint mt-3">
              {preview.attribution ? `Details as ${preview.attribution} lists them` : 'Details as the source lists them'}
              {preview.sourceCheckedAt ? `, last checked ${day(preview.sourceCheckedAt)}` : ''}.
              {preview.enrichmentLevel !== 'ENRICHED' ? ' The official guidelines are fetched from the funder’s page after sending.' : ''}
            </p>

            <fieldset className="mt-4 space-y-2">
              <legend className="cb-label">Who is told</legend>
              <label className="flex cursor-pointer items-start gap-2.5 text-[13px] text-ink">
                <input type="checkbox" checked={notifyOfficers} onChange={(event) => setNotifyOfficers(event.target.checked)} className="mt-0.5 h-4 w-4 accent-cobalt-600" />
                <span>
                  Covering officers
                  <span className="block text-[12px] text-muted">The usual “new call for your school” notice{schoolCount ? ` (${schoolCount} school${schoolCount === 1 ? '' : 's'})` : ''}.</span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2.5 text-[13px] text-ink">
                <input type="checkbox" checked={alertResearchers} onChange={(event) => setAlertResearchers(event.target.checked)} className="mt-0.5 h-4 w-4 accent-cobalt-600" />
                <span>
                  Matched researchers
                  <span className="block text-[12px] text-muted">In-app and email alerts in every institution with alerts (they can already find the call in the directory).</span>
                </span>
              </label>
            </fieldset>

            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className="cb-btn-secondary cb-btn-sm">Cancel</button>
              <button type="button" onClick={() => void promote()} disabled={busy || !preview.promotable} className="cb-btn-primary cb-btn-sm">
                {busy ? 'Sending…' : 'Send to funding department'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
