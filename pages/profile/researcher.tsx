import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { FaBell, FaEnvelope, FaGlobe, FaLinkedin, FaSave, FaWhatsapp } from 'react-icons/fa';
import { useAuth } from '@/lib/auth-context';
import ResearcherWorkspaceShell from '@/components/ResearcherWorkspaceShell';
import type { ResearcherProfilePayload } from '@/lib/researcherProfile/types';

const notificationOptions = [
  { value: 'instant', label: 'Instant' },
  { value: 'daily', label: 'Daily Digest' },
  { value: 'weekly', label: 'Weekly Digest' },
] as const;

function parseList(value: string) {
  return value
    .split(/[\n,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinList(values: string[]) {
  return values.join(', ');
}

async function apiRequest<T>(authFetch: (url: string, options?: RequestInit) => Promise<Response>, url: string, options?: RequestInit): Promise<T> {
  const response = await authFetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || payload?.details || 'Request failed');
  }
  return payload as T;
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</div>
      {hint ? <div className="mt-1 text-xs leading-5 text-slate-500">{hint}</div> : null}
      <div className="mt-3">{children}</div>
    </label>
  );
}

export default function ResearcherProfilePage() {
  const { user, isLoading, authFetch } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<ResearcherProfilePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/login');
    }
  }, [isLoading, router, user]);

  useEffect(() => {
    if (!user) return;
    apiRequest<ResearcherProfilePayload>(authFetch, '/api/researcher/profile')
      .then((payload) => {
        setData(payload);
        setError(null);
      })
      .catch((nextError) => setError(nextError instanceof Error ? nextError.message : 'Failed to load profile'))
      .finally(() => setLoading(false));
  }, [authFetch, user]);

  function updateProfileField<K extends keyof ResearcherProfilePayload['profile']>(key: K, value: ResearcherProfilePayload['profile'][K]) {
    setData((current) => (current ? { ...current, profile: { ...current.profile, [key]: value } } : current));
  }

  function updateNotificationField<K extends keyof ResearcherProfilePayload['notificationPreferences']>(
    key: K,
    value: ResearcherProfilePayload['notificationPreferences'][K]
  ) {
    setData((current) =>
      current ? { ...current, notificationPreferences: { ...current.notificationPreferences, [key]: value } } : current
    );
  }

  async function handleSave() {
    if (!data) return;
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const payload = await apiRequest<ResearcherProfilePayload>(authFetch, '/api/researcher/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      setData(payload);
      setSuccess('Researcher profile saved. Finder can now reuse your profile defaults and alert keywords.');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  }

  if (isLoading || loading || !data) {
    return (
      <ResearcherWorkspaceShell
        title="Researcher Profile"
        description="Store your research identity, eligibility defaults, and notification settings for reusable funding searches."
        eyebrow="Module 4"
      >
        <div className="rounded-[28px] border border-white/70 bg-white/80 p-8 text-sm text-slate-600 shadow-[0_24px_70px_rgba(15,23,42,0.10)]">
          Loading your researcher workspace...
        </div>
      </ResearcherWorkspaceShell>
    );
  }

  return (
    <ResearcherWorkspaceShell
      title="Researcher Profile"
      description="Set the profile defaults GrantGenie can reuse for funding search, recommendation alerts, and future researcher matching."
      eyebrow="Research Identity"
      actions={
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-full bg-emerald-500 px-5 py-3 text-sm font-semibold text-slate-950 transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <FaSave />
          {saving ? 'Saving...' : 'Save Profile'}
        </button>
      }
    >
      <div className="grid gap-8 xl:grid-cols-[1.45fr_1fr]">
        <div className="space-y-8">
          <section className="rounded-[28px] border border-white/80 bg-white/85 p-6 shadow-[0_26px_70px_rgba(15,23,42,0.08)]">
            <div className="text-[11px] font-semibold uppercase tracking-[0.26em] text-emerald-700">Identity</div>
            <div className="mt-4 grid gap-5 md:grid-cols-2">
              <Field label="Display Name">
                <input type="text" value={data.profile.displayName} onChange={(event) => updateProfileField('displayName', event.target.value)} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" />
              </Field>
              <Field label="Birth Year" hint="Store year only, not full date of birth.">
                <input type="number" min={1900} max={new Date().getFullYear()} value={data.profile.birthYear ?? ''} onChange={(event) => updateProfileField('birthYear', event.target.value ? Number(event.target.value) : null)} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" />
              </Field>
              <Field label="Country of Residence">
                <input type="text" value={data.profile.countryOfResidence} onChange={(event) => updateProfileField('countryOfResidence', event.target.value)} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" />
              </Field>
              <Field label="Citizenship Countries" hint="Comma-separated. Used later for opportunity eligibility defaults.">
                <input type="text" value={joinList(data.profile.citizenshipCountries)} onChange={(event) => updateProfileField('citizenshipCountries', parseList(event.target.value))} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" />
              </Field>
            </div>
          </section>

          <section className="rounded-[28px] border border-white/80 bg-white/85 p-6 shadow-[0_26px_70px_rgba(15,23,42,0.08)]">
            <div className="text-[11px] font-semibold uppercase tracking-[0.26em] text-emerald-700">Institution And Eligibility</div>
            <div className="mt-4 grid gap-5 md:grid-cols-2">
              <Field label="Institution Name">
                <input type="text" value={data.profile.institutionName} onChange={(event) => updateProfileField('institutionName', event.target.value)} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" />
              </Field>
              <Field label="Institution Type">
                <input type="text" value={data.profile.institutionType} onChange={(event) => updateProfileField('institutionType', event.target.value)} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" />
              </Field>
              <Field label="Department">
                <input type="text" value={data.profile.department} onChange={(event) => updateProfileField('department', event.target.value)} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" />
              </Field>
              <Field label="Career Stage">
                <input type="text" value={data.profile.careerStage} onChange={(event) => updateProfileField('careerStage', event.target.value)} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" />
              </Field>
              <Field label="Years of Experience">
                <input type="number" min={0} max={80} value={data.profile.yearsOfExperience ?? ''} onChange={(event) => updateProfileField('yearsOfExperience', event.target.value ? Number(event.target.value) : null)} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" />
              </Field>
              <Field label="Application Languages">
                <input type="text" value={joinList(data.profile.applicationLanguages)} onChange={(event) => updateProfileField('applicationLanguages', parseList(event.target.value))} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" />
              </Field>
            </div>
          </section>

          <section className="rounded-[28px] border border-white/80 bg-white/85 p-6 shadow-[0_26px_70px_rgba(15,23,42,0.08)]">
            <div className="text-[11px] font-semibold uppercase tracking-[0.26em] text-emerald-700">Research Identity</div>
            <div className="mt-4 space-y-5">
              <Field label="Research Summary" hint="Use a short summary of your area, methods, and long-term themes.">
                <textarea rows={5} value={data.profile.researchSummary} onChange={(event) => updateProfileField('researchSummary', event.target.value)} className="w-full rounded-[24px] border border-slate-300 bg-white px-4 py-3 text-sm leading-7 outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" />
              </Field>
              <div className="grid gap-5 md:grid-cols-2">
                <Field label="Profile Research Areas">
                  <textarea rows={3} value={joinList(data.profile.researchAreas)} onChange={(event) => updateProfileField('researchAreas', parseList(event.target.value))} className="w-full rounded-[24px] border border-slate-300 bg-white px-4 py-3 text-sm leading-7 outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" />
                </Field>
                <Field label="Keywords">
                  <textarea rows={3} value={joinList(data.profile.keywords)} onChange={(event) => updateProfileField('keywords', parseList(event.target.value))} className="w-full rounded-[24px] border border-slate-300 bg-white px-4 py-3 text-sm leading-7 outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" />
                </Field>
              </div>
            </div>
          </section>
        </div>

        <div className="space-y-8">
          <section className="rounded-[28px] border border-white/80 bg-white/85 p-6 shadow-[0_26px_70px_rgba(15,23,42,0.08)]">
            <div className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.26em] text-emerald-700">
              <FaGlobe />
              Academic Profiles
            </div>
            <div className="mt-4 space-y-5">
              <Field label="LinkedIn URL">
                <div className="relative">
                  <FaLinkedin className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input type="url" value={data.profile.linkedinUrl} onChange={(event) => updateProfileField('linkedinUrl', event.target.value)} className="w-full rounded-2xl border border-slate-300 bg-white py-3 pl-12 pr-4 text-sm outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" />
                </div>
              </Field>
              <Field label="Google Scholar URL">
                <input type="url" value={data.profile.googleScholarUrl} onChange={(event) => updateProfileField('googleScholarUrl', event.target.value)} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" />
              </Field>
              <Field label="Scopus URL">
                <input type="url" value={data.profile.scopusUrl} onChange={(event) => updateProfileField('scopusUrl', event.target.value)} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" />
              </Field>
              <Field label="ORCID URL">
                <input type="url" value={data.profile.orcidUrl} onChange={(event) => updateProfileField('orcidUrl', event.target.value)} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" />
              </Field>
            </div>
          </section>

          <section className="rounded-[28px] border border-white/80 bg-white/85 p-6 shadow-[0_26px_70px_rgba(15,23,42,0.08)]">
            <div className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.26em] text-emerald-700">
              <FaBell />
              Notification Preferences
            </div>
            <div className="mt-5 space-y-4">
              <label className="flex items-center justify-between gap-4 rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                <span className="flex items-center gap-3 font-medium"><FaBell /> In-app notifications</span>
                <input type="checkbox" checked={data.notificationPreferences.inAppEnabled} onChange={(event) => updateNotificationField('inAppEnabled', event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-emerald-600" />
              </label>
              <label className="flex items-center justify-between gap-4 rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                <span className="flex items-center gap-3 font-medium"><FaEnvelope /> Email alerts</span>
                <input type="checkbox" checked={data.notificationPreferences.emailEnabled} onChange={(event) => updateNotificationField('emailEnabled', event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-emerald-600" />
              </label>
              <label className="flex items-center justify-between gap-4 rounded-[22px] border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                <span className="flex items-center gap-3 font-medium"><FaWhatsapp /> WhatsApp alerts</span>
                <input type="checkbox" checked={data.notificationPreferences.whatsappEnabled} onChange={(event) => updateNotificationField('whatsappEnabled', event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-emerald-600" />
              </label>
              <Field label="Notification Frequency">
                <select value={data.notificationPreferences.notificationFrequency} onChange={(event) => updateNotificationField('notificationFrequency', event.target.value as ResearcherProfilePayload['notificationPreferences']['notificationFrequency'])} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100">
                  {notificationOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </Field>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Email Address">
                  <input type="email" value={data.notificationPreferences.emailAddress} onChange={(event) => updateNotificationField('emailAddress', event.target.value)} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" />
                </Field>
                <Field label="WhatsApp Number">
                  <input type="text" value={data.notificationPreferences.whatsappNumber} onChange={(event) => updateNotificationField('whatsappNumber', event.target.value)} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" />
                </Field>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Quiet Hours Start">
                  <input type="time" value={data.notificationPreferences.quietHoursStart} onChange={(event) => updateNotificationField('quietHoursStart', event.target.value)} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" />
                </Field>
                <Field label="Quiet Hours End">
                  <input type="time" value={data.notificationPreferences.quietHoursEnd} onChange={(event) => updateNotificationField('quietHoursEnd', event.target.value)} className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" />
                </Field>
              </div>
              <Field label="Alert Keywords" hint="Used later for in-app, email, and WhatsApp opportunity notifications.">
                <textarea rows={3} value={joinList(data.notificationPreferences.alertKeywords)} onChange={(event) => updateNotificationField('alertKeywords', parseList(event.target.value))} className="w-full rounded-[24px] border border-slate-300 bg-white px-4 py-3 text-sm leading-7 outline-none transition-colors focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100" />
              </Field>
            </div>
          </section>

          {(error || success) ? (
            <section className={`rounded-[24px] border px-5 py-4 text-sm ${error ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}>
              {error || success}
            </section>
          ) : null}
        </div>
      </div>
    </ResearcherWorkspaceShell>
  );
}
