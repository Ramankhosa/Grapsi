import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FaLinkedin, FaWhatsapp } from 'react-icons/fa';
import {
  Bell,
  BellRing,
  Building2,
  Check,
  ChevronRight,
  CircleHelp,
  Fingerprint,
  Link2,
  Mail,
  MonitorSmartphone,
  Radar,
  Save,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react';
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

const inputClass =
  'w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-950 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100';
const textareaClass = `${inputClass} leading-6`;

function Field({
  label,
  hint,
  why,
  children,
}: {
  label: string;
  hint?: string;
  why?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="flex min-h-5 items-center justify-between gap-3">
        <span className="text-sm font-semibold text-slate-900">{label}</span>
        {hint ? <span className="text-xs text-slate-400">{hint}</span> : null}
      </div>
      <div className="mt-2">{children}</div>
      {why ? (
        <span className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-slate-500">
          <CircleHelp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
          {why}
        </span>
      ) : null}
    </label>
  );
}

function SectionHeader({
  icon,
  title,
  description,
  purpose,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  purpose: string;
}) {
  return (
    <div className="grid gap-4 border-b border-slate-100 pb-5 md:grid-cols-[minmax(0,1fr)_minmax(260px,0.8fr)] md:items-start">
      <div className="flex items-start gap-3.5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-sm">
          {icon}
        </div>
        <div>
          <h2 className="text-base font-semibold text-slate-950">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">{description}</p>
        </div>
      </div>
      <div className="flex items-start gap-2 rounded-xl border border-emerald-100 bg-emerald-50/70 px-3.5 py-2.5 text-xs leading-5 text-emerald-950">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
        <span><strong>Why the AI asks:</strong> {purpose}</span>
      </div>
    </div>
  );
}

function PreferenceToggle({
  icon,
  label,
  description,
  checked,
  onChange,
}: {
  icon: React.ReactNode;
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-4 border-b border-slate-100 py-3.5 last:border-b-0">
      <span className="flex items-start gap-3">
        <span className="mt-0.5 text-slate-400">{icon}</span>
        <span>
          <span className="block text-sm font-semibold text-slate-900">{label}</span>
          <span className="mt-0.5 block text-xs leading-5 text-slate-500">{description}</span>
        </span>
      </span>
      <span className="relative inline-flex h-6 w-11 shrink-0">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="peer sr-only"
        />
        <span className="absolute inset-0 rounded-full bg-slate-200 transition-colors peer-checked:bg-emerald-500 peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-400 peer-focus-visible:ring-offset-2" />
        <span className="absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5" />
      </span>
    </label>
  );
}

const sectionCardClass = 'scroll-mt-6 rounded-[24px] border border-white/70 bg-white/85 p-5 shadow-sm sm:p-6';

export default function ResearcherProfilePage() {
  const { user, isLoading, authFetch } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<ResearcherProfilePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
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

  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => setSuccess(null), 4000);
    return () => clearTimeout(timer);
  }, [success]);

  function updateProfileField<K extends keyof ResearcherProfilePayload['profile']>(key: K, value: ResearcherProfilePayload['profile'][K]) {
    setDirty(true);
    setData((current) => (current ? { ...current, profile: { ...current.profile, [key]: value } } : current));
  }

  function updateNotificationField<K extends keyof ResearcherProfilePayload['notificationPreferences']>(
    key: K,
    value: ResearcherProfilePayload['notificationPreferences'][K]
  ) {
    setDirty(true);
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
      setDirty(false);
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
        eyebrow="Research Identity"
      >
        <div className="grid gap-6 xl:grid-cols-[260px_minmax(0,1fr)]">
          <div className="h-72 animate-pulse rounded-[24px] bg-slate-200/70" />
          <div className="space-y-4">
            <div className="h-52 animate-pulse rounded-[24px] bg-slate-200/60" />
            <div className="h-52 animate-pulse rounded-[24px] bg-slate-200/50" />
          </div>
        </div>
      </ResearcherWorkspaceShell>
    );
  }

  const profileSignals = [
    data.profile.displayName,
    data.profile.birthYear,
    data.profile.countryOfResidence,
    data.profile.citizenshipCountries,
    data.profile.institutionName,
    data.profile.institutionType,
    data.profile.department,
    data.profile.careerStage,
    data.profile.yearsOfExperience,
    data.profile.applicationLanguages,
    data.profile.researchSummary,
    data.profile.linkedinUrl,
    data.profile.googleScholarUrl,
    data.profile.scopusUrl,
    data.profile.orcidUrl,
  ];
  const completedSignals = profileSignals.filter((value) => Array.isArray(value) ? value.length > 0 : value !== null && value !== '').length;
  const profileCompletion = Math.round((completedSignals / profileSignals.length) * 100);
  const completionLabel = profileCompletion >= 80 ? 'Strong' : profileCompletion >= 45 ? 'Growing' : 'Just starting';

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
          className="relative inline-flex items-center gap-2 rounded-full bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Save className="h-4 w-4" />
          {saving ? 'Saving...' : dirty ? 'Save changes' : 'Save Profile'}
          {dirty && !saving ? (
            <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-amber-400" aria-hidden />
          ) : null}
        </button>
      }
    >
      <div className="grid gap-6 xl:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="xl:sticky xl:top-6 xl:self-start">
          <div className="overflow-hidden rounded-[24px] border border-slate-800 bg-gradient-to-br from-slate-950 via-slate-900 to-emerald-950 text-white shadow-[0_18px_50px_rgba(15,23,42,0.18)]">
            <div className="border-b border-white/10 p-5">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300">
                <Radar className="h-4 w-4" />
                Profile signal
              </div>
              <div className="mt-4 flex items-end justify-between">
                <span className="text-3xl font-semibold">{profileCompletion}%</span>
                <span className="rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-200">
                  {completionLabel}
                </span>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-300 transition-all duration-500"
                  style={{ width: `${profileCompletion}%` }}
                />
              </div>
              <p className="mt-2 text-right text-[11px] text-slate-400">{completedSignals}/{profileSignals.length} signals complete</p>
              <p className="mt-2 text-xs leading-5 text-slate-300">
                More complete signals improve eligibility filtering and reduce repeated questions during Grant Prep.
              </p>
            </div>

            <nav className="p-2" aria-label="Profile sections">
              {[
                ['#identity', 'Identity'],
                ['#eligibility', 'Institution & eligibility'],
                ['#research', 'Research context'],
                ['#profiles', 'Academic profiles'],
                ['#alerts', 'Alerts'],
              ].map(([href, label], index) => (
                <a
                  key={href}
                  href={href}
                  className="flex items-center justify-between rounded-xl px-3 py-2.5 text-sm text-slate-300 transition hover:bg-white/5 hover:text-white"
                >
                  <span className="flex items-center gap-3">
                    <span className="font-mono text-xs text-emerald-400">0{index + 1}</span>
                    {label}
                  </span>
                  <ChevronRight className="h-4 w-4 text-slate-600" />
                </a>
              ))}
            </nav>

            <div className="border-t border-white/10 p-4 text-xs leading-5 text-slate-400">
              <div className="flex gap-2">
                <Fingerprint className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                <span>Your profile stays editable and is used as reusable matching context.</span>
              </div>
            </div>
          </div>
        </aside>

        <div className="space-y-4">
          {(error || success) ? (
            <div
              role="status"
              className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-sm ${
                error ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-emerald-200 bg-emerald-50 text-emerald-900'
              }`}
            >
              <span className="flex items-center gap-2.5">
                {error ? <X className="h-4 w-4 shrink-0" /> : <Check className="h-4 w-4 shrink-0" />}
                {error || success}
              </span>
              <button
                type="button"
                onClick={() => { setError(null); setSuccess(null); }}
                aria-label="Dismiss message"
                className="shrink-0 rounded-full p-1 opacity-60 transition hover:opacity-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : null}

          <section id="identity" className={sectionCardClass}>
            <SectionHeader
              icon={<UserRound className="h-5 w-5" />}
              title="Identity and location"
              description="Basic details used to establish who is applying and where they are based."
              purpose="Many calls restrict applicants by age band, residence, nationality, or host country. We store birth year only, never a full birth date."
            />
            <div className="mt-6 grid gap-x-5 gap-y-6 md:grid-cols-2">
              <Field label="Display Name" why="Used to personalize your workspace and generated project context.">
                <input type="text" value={data.profile.displayName} onChange={(event) => updateProfileField('displayName', event.target.value)} className={inputClass} />
              </Field>
              <Field label="Birth Year" hint="Year only" why="Helps screen calls with early-career or age-based eligibility rules.">
                <input type="number" min={1900} max={new Date().getFullYear()} value={data.profile.birthYear ?? ''} onChange={(event) => updateProfileField('birthYear', event.target.value ? Number(event.target.value) : null)} className={inputClass} />
              </Field>
              <Field label="Country of Residence" why="Used for residency, host-country, and geographic eligibility checks.">
                <input type="text" value={data.profile.countryOfResidence} onChange={(event) => updateProfileField('countryOfResidence', event.target.value)} className={inputClass} />
              </Field>
              <Field label="Citizenship Countries" hint="Comma-separated" why="Some funders limit opportunities by nationality independently of residence.">
                <input type="text" value={joinList(data.profile.citizenshipCountries)} onChange={(event) => updateProfileField('citizenshipCountries', parseList(event.target.value))} className={inputClass} />
              </Field>
            </div>
          </section>

          <section id="eligibility" className={sectionCardClass}>
            <SectionHeader
              icon={<Building2 className="h-5 w-5" />}
              title="Institution and eligibility"
              description="Your institutional setting and career position shape which calls are realistic."
              purpose="Funders commonly filter by institution type, department, career stage, experience, and permitted application language."
            />
            <div className="mt-6 grid gap-x-5 gap-y-6 md:grid-cols-2">
              <Field label="Institution Name" why="Adds institutional context when assessing applicant and host fit.">
                <input type="text" value={data.profile.institutionName} onChange={(event) => updateProfileField('institutionName', event.target.value)} className={inputClass} />
              </Field>
              <Field label="Institution Type" why="Distinguishes universities, hospitals, nonprofits, companies, and public bodies for eligibility.">
                <input type="text" value={data.profile.institutionType} onChange={(event) => updateProfileField('institutionType', event.target.value)} className={inputClass} />
              </Field>
              <Field label="Department" why="Improves disciplinary fit when a call targets specific faculties or domains.">
                <input type="text" value={data.profile.department} onChange={(event) => updateProfileField('department', event.target.value)} className={inputClass} />
              </Field>
              <Field label="Career Stage" why="Used for doctoral, postdoctoral, early-career, established, and senior investigator criteria.">
                <input type="text" value={data.profile.careerStage} onChange={(event) => updateProfileField('careerStage', event.target.value)} className={inputClass} />
              </Field>
              <Field label="Years of Experience" why="Supports minimum-experience checks and appropriate proposal positioning.">
                <input type="number" min={0} max={80} value={data.profile.yearsOfExperience ?? ''} onChange={(event) => updateProfileField('yearsOfExperience', event.target.value ? Number(event.target.value) : null)} className={inputClass} />
              </Field>
              <Field label="Application Languages" hint="Comma-separated" why="Filters out calls whose required submission language is not suitable.">
                <input type="text" value={joinList(data.profile.applicationLanguages)} onChange={(event) => updateProfileField('applicationLanguages', parseList(event.target.value))} className={inputClass} />
              </Field>
            </div>
          </section>

          <section id="research" className={sectionCardClass}>
            <SectionHeader
              icon={<Sparkles className="h-5 w-5" />}
              title="Research context"
              description="A concise description of the problems, methods, and outcomes that define your work."
              purpose="This is the semantic signal used to compare your work with call priorities and to give Grant Prep relevant background without asking again."
            />
            <div className="mt-6">
              <Field label="Research Summary" hint="2-5 sentences" why="Include your domain, core methods, target population or system, and intended impact.">
                <textarea rows={6} value={data.profile.researchSummary} onChange={(event) => updateProfileField('researchSummary', event.target.value)} className={textareaClass} />
              </Field>
            </div>
            <div className="mt-6 flex flex-col gap-4 rounded-2xl border border-slate-100 bg-gradient-to-r from-slate-50 to-emerald-50/50 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-950">Research areas and key publications</div>
                <p className="mt-1 text-sm leading-6 text-slate-600">Manage matching topics and the five publications that best represent your funding direction.</p>
              </div>
              <Link
                href="/profile/research-fit"
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                Open Research Fit <ChevronRight className="h-4 w-4 text-emerald-400" />
              </Link>
            </div>
          </section>

          <section id="profiles" className={sectionCardClass}>
            <SectionHeader
              icon={<Link2 className="h-5 w-5" />}
              title="Academic profiles"
              description="Canonical links that help identify your public research record."
              purpose="Profile links reduce identity ambiguity and provide trusted destinations when reviewing your track record. They are not used to publish or edit external profiles."
            />
            <div className="mt-6 grid gap-x-5 gap-y-6 md:grid-cols-2">
              <Field label="LinkedIn URL" why="Adds professional role and institutional context.">
                <div className="relative"><FaLinkedin className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" /><input type="url" value={data.profile.linkedinUrl} onChange={(event) => updateProfileField('linkedinUrl', event.target.value)} className={`${inputClass} pl-10`} /></div>
              </Field>
              <Field label="Google Scholar URL" why="Provides a direct reference to your publication record.">
                <input type="url" value={data.profile.googleScholarUrl} onChange={(event) => updateProfileField('googleScholarUrl', event.target.value)} className={inputClass} />
              </Field>
              <Field label="Scopus URL" why="Helps distinguish authors with similar names and verify indexed work.">
                <input type="url" value={data.profile.scopusUrl} onChange={(event) => updateProfileField('scopusUrl', event.target.value)} className={inputClass} />
              </Field>
              <Field label="ORCID URL" why="Provides a persistent researcher identifier across institutions.">
                <input type="url" value={data.profile.orcidUrl} onChange={(event) => updateProfileField('orcidUrl', event.target.value)} className={inputClass} />
              </Field>
            </div>
          </section>

          <section id="alerts" className={sectionCardClass}>
            <SectionHeader
              icon={<BellRing className="h-5 w-5" />}
              title="Funding alerts"
              description="Control where, when, and how opportunity updates reach you."
              purpose="Your delivery choices prevent missed deadlines while quiet hours and frequency controls reduce unnecessary interruption."
            />
            <div className="mt-5 grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
              <div className="rounded-2xl border border-slate-100 bg-slate-50/60 px-4">
                <PreferenceToggle icon={<MonitorSmartphone className="h-4 w-4" />} label="In-app notifications" description="Show relevant updates inside GrantGenie." checked={data.notificationPreferences.inAppEnabled} onChange={(checked) => updateNotificationField('inAppEnabled', checked)} />
                <PreferenceToggle icon={<Mail className="h-4 w-4" />} label="Email alerts" description="Send opportunities to your saved email address." checked={data.notificationPreferences.emailEnabled} onChange={(checked) => updateNotificationField('emailEnabled', checked)} />
                <PreferenceToggle icon={<FaWhatsapp className="h-4 w-4" />} label="WhatsApp alerts" description="Send time-sensitive updates to your saved number." checked={data.notificationPreferences.whatsappEnabled} onChange={(checked) => updateNotificationField('whatsappEnabled', checked)} />
              </div>
              <div className="grid gap-x-5 gap-y-6 md:grid-cols-2">
                <Field label="Notification Frequency" why="Controls alert batching across enabled channels.">
                  <select value={data.notificationPreferences.notificationFrequency} onChange={(event) => updateNotificationField('notificationFrequency', event.target.value as ResearcherProfilePayload['notificationPreferences']['notificationFrequency'])} className={inputClass}>
                    {notificationOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </Field>
                <Field label="Email Address" why="Used only when email alerts are enabled.">
                  <input type="email" value={data.notificationPreferences.emailAddress} onChange={(event) => updateNotificationField('emailAddress', event.target.value)} className={inputClass} />
                </Field>
                <Field label="WhatsApp Number" why="Used only when WhatsApp alerts are enabled.">
                  <input type="text" value={data.notificationPreferences.whatsappNumber} onChange={(event) => updateNotificationField('whatsappNumber', event.target.value)} className={inputClass} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Quiet Start" why="Start of your no-alert window."><input type="time" value={data.notificationPreferences.quietHoursStart} onChange={(event) => updateNotificationField('quietHoursStart', event.target.value)} className={inputClass} /></Field>
                  <Field label="Quiet End" why="End of your no-alert window."><input type="time" value={data.notificationPreferences.quietHoursEnd} onChange={(event) => updateNotificationField('quietHoursEnd', event.target.value)} className={inputClass} /></Field>
                </div>
                <div className="md:col-span-2">
                  <Field label="Alert Keywords" hint="Comma-separated" why="Adds explicit topics, methods, regions, or funders that should raise an opportunity's alert relevance.">
                    <textarea rows={3} value={joinList(data.notificationPreferences.alertKeywords)} onChange={(event) => updateNotificationField('alertKeywords', parseList(event.target.value))} className={textareaClass} />
                  </Field>
                </div>
              </div>
            </div>
          </section>

          {/* Mobile sticky save bar */}
          <div className="sticky bottom-4 z-10 flex justify-end xl:hidden">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className={`inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-semibold text-white shadow-lg transition disabled:cursor-not-allowed disabled:opacity-60 ${
                dirty ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-slate-950/90 hover:bg-slate-800'
              }`}
            >
              <Save className="h-4 w-4" />
              {saving ? 'Saving...' : dirty ? 'Save changes' : 'Saved'}
            </button>
          </div>
        </div>
      </div>
    </ResearcherWorkspaceShell>
  );
}
