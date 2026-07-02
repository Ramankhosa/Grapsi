import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { FaBell, FaEnvelope, FaLinkedin, FaSave, FaWhatsapp } from 'react-icons/fa';
import {
  BellRing,
  Building2,
  Check,
  ChevronRight,
  CircleHelp,
  Fingerprint,
  Link2,
  Radar,
  Sparkles,
  UserRound,
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
        {hint ? <span className="text-xs text-slate-500">{hint}</span> : null}
      </div>
      <div className="mt-2">{children}</div>
      {why ? (
        <span className="mt-2 flex items-start gap-1.5 text-xs leading-5 text-slate-500">
          <CircleHelp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-cyan-600" />
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
    <div className="grid gap-4 border-b border-slate-200 pb-5 md:grid-cols-[minmax(0,1fr)_minmax(260px,0.8fr)] md:items-start">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-800 bg-slate-950 text-cyan-300">
          {icon}
        </div>
        <div>
          <h2 className="text-base font-semibold text-slate-950">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">{description}</p>
        </div>
      </div>
      <div className="flex items-start gap-2 border-l-2 border-cyan-500 bg-cyan-50 px-3 py-2 text-xs leading-5 text-cyan-950">
        <CircleHelp className="mt-0.5 h-4 w-4 shrink-0" />
        <span><strong>Why we ask:</strong> {purpose}</span>
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
    <label className="flex items-center justify-between gap-4 border-b border-slate-200 py-3 last:border-b-0">
      <span className="flex items-start gap-3">
        <span className="mt-0.5 text-slate-500">{icon}</span>
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
        <span className="absolute inset-0 rounded-full bg-slate-300 transition-colors peer-checked:bg-cyan-600 peer-focus-visible:ring-2 peer-focus-visible:ring-cyan-400 peer-focus-visible:ring-offset-2" />
        <span className="absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5" />
      </span>
    </label>
  );
}

const inputClass = 'w-full rounded-md border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-950 outline-none transition focus:border-cyan-600 focus:ring-2 focus:ring-cyan-100';
const textareaClass = `${inputClass} leading-6`;

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
        <div className="rounded-md border border-slate-200 bg-white p-8 text-sm text-slate-600 shadow-sm">
          Loading your researcher workspace...
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
          className="inline-flex items-center gap-2 rounded-md bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <FaSave />
          {saving ? 'Saving...' : 'Save Profile'}
        </button>
      }
    >
      <div className="grid gap-6 xl:grid-cols-[250px_minmax(0,1fr)]">
        <aside className="xl:sticky xl:top-6 xl:self-start">
          <div className="overflow-hidden rounded-md border border-slate-800 bg-slate-950 text-white shadow-[0_18px_50px_rgba(15,23,42,0.18)]">
            <div className="border-b border-slate-800 p-5">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase text-cyan-300">
                <Radar className="h-4 w-4" />
                Profile signal
              </div>
              <div className="mt-4 flex items-end justify-between">
                <span className="text-3xl font-semibold">{profileCompletion}%</span>
                <span className="pb-1 text-xs text-slate-400">{completedSignals}/{profileSignals.length} complete</span>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-800">
                <div className="h-full rounded-full bg-cyan-400 transition-all" style={{ width: `${profileCompletion}%` }} />
              </div>
              <p className="mt-4 text-xs leading-5 text-slate-400">More complete signals improve eligibility filtering and reduce repeated questions during Grant Prep.</p>
            </div>

            <nav className="p-2" aria-label="Profile sections">
              {[
                ['#identity', 'Identity'],
                ['#eligibility', 'Institution & eligibility'],
                ['#research', 'Research context'],
                ['#profiles', 'Academic profiles'],
                ['#alerts', 'Alerts'],
              ].map(([href, label], index) => (
                <a key={href} href={href} className="flex items-center justify-between rounded-md px-3 py-2.5 text-sm text-slate-300 hover:bg-slate-900 hover:text-white">
                  <span className="flex items-center gap-3"><span className="font-mono text-xs text-cyan-400">0{index + 1}</span>{label}</span>
                  <ChevronRight className="h-4 w-4 text-slate-600" />
                </a>
              ))}
            </nav>

            <div className="border-t border-slate-800 p-4 text-xs leading-5 text-slate-400">
              <div className="flex gap-2"><Fingerprint className="mt-0.5 h-4 w-4 shrink-0 text-lime-300" /><span>Your profile stays editable and is used as reusable matching context.</span></div>
            </div>
          </div>
        </aside>

        <div className="space-y-4">
          {(error || success) ? (
            <div className={`flex items-center gap-3 rounded-md border px-4 py-3 text-sm ${error ? 'border-rose-300 bg-rose-50 text-rose-900' : 'border-emerald-300 bg-emerald-50 text-emerald-950'}`}>
              {error ? <CircleHelp className="h-4 w-4" /> : <Check className="h-4 w-4" />}
              {error || success}
            </div>
          ) : null}

          <section id="identity" className="scroll-mt-6 rounded-md border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <SectionHeader
              icon={<UserRound className="h-4 w-4" />}
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

          <section id="eligibility" className="scroll-mt-6 rounded-md border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <SectionHeader
              icon={<Building2 className="h-4 w-4" />}
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

          <section id="research" className="scroll-mt-6 rounded-md border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <SectionHeader
              icon={<Sparkles className="h-4 w-4" />}
              title="Research context"
              description="A concise description of the problems, methods, and outcomes that define your work."
              purpose="This is the semantic signal used to compare your work with call priorities and to give Grant Prep relevant background without asking again."
            />
            <div className="mt-6">
              <Field label="Research Summary" hint="2-5 sentences" why="Include your domain, core methods, target population or system, and intended impact.">
                <textarea rows={6} value={data.profile.researchSummary} onChange={(event) => updateProfileField('researchSummary', event.target.value)} className={textareaClass} />
              </Field>
            </div>
            <div className="mt-6 flex flex-col gap-4 border-t border-slate-200 pt-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-950">Research areas and key publications</div>
                <p className="mt-1 text-sm leading-6 text-slate-600">Manage matching topics and the five publications that best represent your funding direction.</p>
              </div>
              <Link href="/profile/research-fit" className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-800">
                Open Research Fit <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
          </section>

          <section id="profiles" className="scroll-mt-6 rounded-md border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <SectionHeader
              icon={<Link2 className="h-4 w-4" />}
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

          <section id="alerts" className="scroll-mt-6 rounded-md border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <SectionHeader
              icon={<BellRing className="h-4 w-4" />}
              title="Funding alerts"
              description="Control where, when, and how opportunity updates reach you."
              purpose="Your delivery choices prevent missed deadlines while quiet hours and frequency controls reduce unnecessary interruption."
            />
            <div className="mt-5 grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
              <div className="border-y border-slate-200">
                <PreferenceToggle icon={<FaBell />} label="In-app notifications" description="Show relevant updates inside GrantGenie." checked={data.notificationPreferences.inAppEnabled} onChange={(checked) => updateNotificationField('inAppEnabled', checked)} />
                <PreferenceToggle icon={<FaEnvelope />} label="Email alerts" description="Send opportunities to your saved email address." checked={data.notificationPreferences.emailEnabled} onChange={(checked) => updateNotificationField('emailEnabled', checked)} />
                <PreferenceToggle icon={<FaWhatsapp />} label="WhatsApp alerts" description="Send time-sensitive updates to your saved number." checked={data.notificationPreferences.whatsappEnabled} onChange={(checked) => updateNotificationField('whatsappEnabled', checked)} />
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
        </div>
      </div>
    </ResearcherWorkspaceShell>
  );
}
