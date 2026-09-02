import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { FaLinkedin } from 'react-icons/fa';
import {
  BellRing,
  Building2,
  Check,
  ChevronRight,
  Link2,
  Mail,
  MonitorSmartphone,
  Save,
  Sparkles,
  UserRound,
  X,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useEntitlements } from '@/hooks/useEntitlements';
import ResearcherWorkspaceShell from '@/components/ResearcherWorkspaceShell';
import type { ResearcherProfilePayload } from '@/lib/researcherProfile/types';

const notificationOptions = [
  { value: 'instant', label: 'Instant' },
  { value: 'daily', label: 'Daily Digest' },
  { value: 'weekly', label: 'Weekly Digest' },
] as const;

const sections = [
  { href: '#identity', label: 'Identity' },
  { href: '#eligibility', label: 'Institution' },
  { href: '#research', label: 'Research' },
  { href: '#profiles', label: 'Profiles' },
  { href: '#alerts', label: 'Alerts' },
];

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
      <div className="flex min-h-5 items-baseline justify-between gap-3">
        <span className="cb-label">{label}</span>
        {hint ? <span className="text-[11px] text-muted-soft">{hint}</span> : null}
      </div>
      <div className="mt-1.5">{children}</div>
      {why ? <span className="mt-1.5 block text-[12px] leading-5 text-muted">{why}</span> : null}
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
    <div className="border-b border-hairline pb-4">
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cobalt-50 text-cobalt-700">
          {icon}
        </span>
        <div className="min-w-0">
          <h2 className="cb-title">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-muted">{description}</p>
        </div>
      </div>
      <p className="mt-3 text-[12px] leading-5 text-muted sm:pl-11">
        <span className="font-medium text-ink-soft">Why the AI asks:</span> {purpose}
      </p>
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
    <label className="flex cursor-pointer items-center justify-between gap-4 border-b border-hairline py-3.5 last:border-b-0">
      <span className="flex items-start gap-3">
        <span className="mt-0.5 text-muted-soft">{icon}</span>
        <span>
          <span className="block text-[13px] font-medium text-ink">{label}</span>
          <span className="mt-0.5 block text-[12px] leading-5 text-muted">{description}</span>
        </span>
      </span>
      <span className="relative inline-flex h-6 w-11 shrink-0">
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="peer sr-only"
        />
        <span className="absolute inset-0 rounded-full bg-hairline transition-colors peer-checked:bg-cobalt-600 peer-focus-visible:ring-2 peer-focus-visible:ring-cobalt-200 peer-focus-visible:ring-offset-2" />
        <span className="absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5" />
      </span>
    </label>
  );
}

const sectionCardClass = 'cb-card scroll-mt-32 p-4 sm:p-6';

export default function ResearcherProfilePage() {
  const { user, isLoading, authFetch } = useAuth();
  const { hasFeature, isPlatform, isLoading: entitlementsLoading } = useEntitlements();
  // Funding Alerts is a separately sold service — preferences always save, but
  // delivery only happens for plans that include FUNDING_ALERTS.
  const alertsEntitled = entitlementsLoading || isPlatform || hasFeature('FUNDING_ALERTS');
  const router = useRouter();
  const [data, setData] = useState<ResearcherProfilePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
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

  // Warn before discarding unsaved edits — covers tab close/refresh and any in-app navigation.
  // Reads dirtyRef (kept in sync where dirty changes) so a just-completed save is seen
  // immediately, without waiting for a re-render.
  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };

    const handleRouteChangeStart = () => {
      if (!dirtyRef.current) return;
      if (window.confirm('You have unsaved profile changes. Leave without saving?')) return;
      router.events.emit('routeChangeError');
      throw 'Route change aborted: unsaved profile changes.';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    router.events.on('routeChangeStart', handleRouteChangeStart);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      router.events.off('routeChangeStart', handleRouteChangeStart);
    };
  }, [router.events]);

  function updateProfileField<K extends keyof ResearcherProfilePayload['profile']>(key: K, value: ResearcherProfilePayload['profile'][K]) {
    setDirty(true);
    dirtyRef.current = true;
    setData((current) => (current ? { ...current, profile: { ...current.profile, [key]: value } } : current));
  }

  function updateNotificationField<K extends keyof ResearcherProfilePayload['notificationPreferences']>(
    key: K,
    value: ResearcherProfilePayload['notificationPreferences'][K]
  ) {
    setDirty(true);
    dirtyRef.current = true;
    setData((current) =>
      current ? { ...current, notificationPreferences: { ...current.notificationPreferences, [key]: value } } : current
    );
  }

  async function handleSave(): Promise<boolean> {
    if (!data) return false;
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
      dirtyRef.current = false;
      setSuccess('Researcher profile saved. Finder can now reuse your profile defaults and alert keywords.');
      return true;
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to save profile');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleOpenResearchFit() {
    if (dirtyRef.current) {
      const saved = await handleSave();
      if (!saved) return;
    }
    router.push('/profile/research-fit');
  }

  if (isLoading || loading || !data) {
    return (
      <ResearcherWorkspaceShell
        title="Researcher Profile"
        description="Store your research identity, eligibility defaults, and notification settings for reusable funding searches."
        eyebrow="Research Identity"
      >
        <div className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
          <div className="h-48 animate-pulse rounded-xl bg-hairline/70" />
          <div className="space-y-4">
            <div className="h-52 animate-pulse rounded-xl bg-hairline/60" />
            <div className="h-52 animate-pulse rounded-xl bg-hairline/50" />
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
        <button type="button" onClick={handleSave} disabled={saving} className="cb-btn-primary hidden sm:inline-flex">
          <Save className="h-4 w-4" />
          {saving ? 'Saving…' : dirty ? 'Save changes' : 'Save profile'}
        </button>
      }
    >
      <div className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-32 lg:self-start">
          <div className="cb-card p-4">
            <div className="cb-eyebrow">Profile signal</div>
            <div className="mt-3 flex items-baseline justify-between gap-2">
              <span className="text-2xl font-semibold tracking-[-0.02em] text-ink">{profileCompletion}%</span>
              <span className="cb-badge-cobalt">{completionLabel}</span>
            </div>
            <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-inset">
              <div className="h-full rounded-full bg-cobalt-600 transition-all duration-500" style={{ width: `${profileCompletion}%` }} />
            </div>
            <p className="mt-2 text-[12px] text-muted">
              {completedSignals} of {profileSignals.length} signals complete. More signals mean sharper eligibility
              filtering and fewer repeated questions in Grant Prep.
            </p>
          </div>

          <nav aria-label="Profile sections" className="cb-scroll-x mt-3 flex gap-1 lg:mt-3 lg:flex-col lg:gap-0.5">
            {sections.map((section) => (
              <a
                key={section.href}
                href={section.href}
                className="cb-tab shrink-0 justify-between lg:w-full"
              >
                {section.label}
                <ChevronRight className="hidden h-3.5 w-3.5 text-muted-soft lg:block" />
              </a>
            ))}
          </nav>
        </aside>

        <div className="space-y-4">
          {(error || success) ? (
            <div
              role="status"
              className={`flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-[13px] ${
                error ? 'border-red-200 bg-red-50 text-red-800' : 'border-cobalt-200 bg-cobalt-50 text-cobalt-800'
              }`}
            >
              <span className="flex items-start gap-2">
                {error ? <X className="mt-0.5 h-4 w-4 shrink-0" /> : <Check className="mt-0.5 h-4 w-4 shrink-0" />}
                {error || success}
              </span>
              <button
                type="button"
                onClick={() => { setError(null); setSuccess(null); }}
                aria-label="Dismiss message"
                className="shrink-0 rounded p-1 opacity-60 transition hover:opacity-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : null}

          <section id="identity" className={sectionCardClass}>
            <SectionHeader
              icon={<UserRound className="h-4 w-4" />}
              title="Identity and location"
              description="Basic details used to establish who is applying and where they are based."
              purpose="Many calls restrict applicants by age band, residence, nationality, or host country. We store birth year only, never a full birth date."
            />
            <div className="mt-5 grid gap-x-5 gap-y-5 md:grid-cols-2">
              <Field label="Display name" why="Used to personalize your workspace and generated project context.">
                <input type="text" value={data.profile.displayName} onChange={(event) => updateProfileField('displayName', event.target.value)} className="cb-input" />
              </Field>
              <Field label="Birth year" hint="Year only" why="Helps screen calls with early-career or age-based eligibility rules.">
                <input type="number" min={1900} max={new Date().getFullYear()} value={data.profile.birthYear ?? ''} onChange={(event) => updateProfileField('birthYear', event.target.value ? Number(event.target.value) : null)} className="cb-input" />
              </Field>
              <Field label="Country of residence" why="Used for residency, host-country, and geographic eligibility checks.">
                <input type="text" value={data.profile.countryOfResidence} onChange={(event) => updateProfileField('countryOfResidence', event.target.value)} className="cb-input" />
              </Field>
              <Field label="Citizenship countries" hint="Comma-separated" why="Some funders limit opportunities by nationality independently of residence.">
                <input type="text" value={joinList(data.profile.citizenshipCountries)} onChange={(event) => updateProfileField('citizenshipCountries', parseList(event.target.value))} className="cb-input" />
              </Field>
            </div>
          </section>

          <section id="eligibility" className={sectionCardClass}>
            <SectionHeader
              icon={<Building2 className="h-4 w-4" />}
              title="Institution and eligibility"
              description="Your institutional setting and career position shape which calls are realistic."
              purpose="Funders commonly filter by institution type, department, career stage, experience, and permitted application language."
            />
            <div className="mt-5 grid gap-x-5 gap-y-5 md:grid-cols-2">
              <Field label="Institution name" why="Adds institutional context when assessing applicant and host fit.">
                <input type="text" value={data.profile.institutionName} onChange={(event) => updateProfileField('institutionName', event.target.value)} className="cb-input" />
              </Field>
              <Field label="Institution type" why="Distinguishes universities, hospitals, nonprofits, companies, and public bodies for eligibility.">
                <input type="text" value={data.profile.institutionType} onChange={(event) => updateProfileField('institutionType', event.target.value)} className="cb-input" />
              </Field>
              <Field label="Department" why="Improves disciplinary fit when a call targets specific faculties or domains.">
                <input type="text" value={data.profile.department} onChange={(event) => updateProfileField('department', event.target.value)} className="cb-input" />
              </Field>
              <Field label="Career stage" why="Used for doctoral, postdoctoral, early-career, established, and senior investigator criteria.">
                <input type="text" value={data.profile.careerStage} onChange={(event) => updateProfileField('careerStage', event.target.value)} className="cb-input" />
              </Field>
              <Field label="Years of experience" why="Supports minimum-experience checks and appropriate proposal positioning.">
                <input type="number" min={0} max={80} value={data.profile.yearsOfExperience ?? ''} onChange={(event) => updateProfileField('yearsOfExperience', event.target.value ? Number(event.target.value) : null)} className="cb-input" />
              </Field>
              <Field label="Application languages" hint="Comma-separated" why="Filters out calls whose required submission language is not suitable.">
                <input type="text" value={joinList(data.profile.applicationLanguages)} onChange={(event) => updateProfileField('applicationLanguages', parseList(event.target.value))} className="cb-input" />
              </Field>
            </div>
          </section>

          <section id="research" className={sectionCardClass}>
            <SectionHeader
              icon={<Sparkles className="h-4 w-4" />}
              title="Research context"
              description="A concise description of the problems, methods, and outcomes that define your work."
              purpose="This is the semantic signal used to compare your work with call priorities and to give Grant Prep relevant background without asking again."
            />
            <div className="mt-5">
              <Field label="Research summary" hint="2–5 sentences" why="Include your domain, core methods, target population or system, and intended impact.">
                <textarea rows={6} value={data.profile.researchSummary} onChange={(event) => updateProfileField('researchSummary', event.target.value)} className="cb-textarea" />
              </Field>
            </div>
            <div className="mt-5 flex flex-col gap-3 rounded-lg border border-hairline bg-inset p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-[13px] font-medium text-ink">Research areas and key publications</div>
                <p className="mt-1 text-[13px] leading-5 text-muted">
                  Manage matching topics and the five publications that best represent your funding direction.
                </p>
              </div>
              <button
                type="button"
                onClick={handleOpenResearchFit}
                disabled={saving}
                className="cb-btn-secondary cb-btn-sm shrink-0 justify-center"
              >
                {saving ? 'Saving…' : dirty ? 'Save & open Research Fit' : 'Open Research Fit'}
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </section>

          <section id="profiles" className={sectionCardClass}>
            <SectionHeader
              icon={<Link2 className="h-4 w-4" />}
              title="Academic profiles"
              description="Canonical links that help identify your public research record."
              purpose="Profile links reduce identity ambiguity and provide trusted destinations when reviewing your track record. They are not used to publish or edit external profiles."
            />
            <div className="mt-5 grid gap-x-5 gap-y-5 md:grid-cols-2">
              <Field label="LinkedIn URL" why="Adds professional role and institutional context.">
                <div className="relative">
                  <FaLinkedin className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-soft" />
                  <input type="url" value={data.profile.linkedinUrl} onChange={(event) => updateProfileField('linkedinUrl', event.target.value)} className="cb-input pl-9" />
                </div>
              </Field>
              <Field label="Google Scholar URL" why="Provides a direct reference to your publication record.">
                <input type="url" value={data.profile.googleScholarUrl} onChange={(event) => updateProfileField('googleScholarUrl', event.target.value)} className="cb-input" />
              </Field>
              <Field label="Scopus URL" why="Helps distinguish authors with similar names and verify indexed work.">
                <input type="url" value={data.profile.scopusUrl} onChange={(event) => updateProfileField('scopusUrl', event.target.value)} className="cb-input" />
              </Field>
              <Field label="ORCID URL" why="Provides a persistent researcher identifier across institutions.">
                <input type="url" value={data.profile.orcidUrl} onChange={(event) => updateProfileField('orcidUrl', event.target.value)} className="cb-input" />
              </Field>
            </div>
          </section>

          <section id="alerts" className={sectionCardClass}>
            <SectionHeader
              icon={<BellRing className="h-4 w-4" />}
              title="Funding alerts"
              description="Control where and how often opportunity updates reach you."
              purpose="Your delivery choices prevent missed deadlines while frequency controls reduce unnecessary interruption."
            />
            {!alertsEntitled && (
              <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <BellRing className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  Funding alert delivery is not included in your institution&apos;s current plan. Your
                  preferences are saved, but matched opportunities will not be emailed or shown as
                  notifications until the <span className="font-medium">Funding Alerts</span> service is
                  enabled for your plan. Contact your administrator to add it.
                </p>
              </div>
            )}
            <div className="mt-5 grid gap-5 lg:grid-cols-[0.85fr_1.15fr]">
              <div className="rounded-lg border border-hairline bg-inset px-4">
                <PreferenceToggle icon={<MonitorSmartphone className="h-4 w-4" />} label="In-app notifications" description="Show relevant updates inside GrantGenie." checked={data.notificationPreferences.inAppEnabled} onChange={(checked) => updateNotificationField('inAppEnabled', checked)} />
                <PreferenceToggle icon={<Mail className="h-4 w-4" />} label="Email alerts" description="Send opportunities to your saved email address." checked={data.notificationPreferences.emailEnabled} onChange={(checked) => updateNotificationField('emailEnabled', checked)} />
              </div>
              <div className="grid gap-x-5 gap-y-5 md:grid-cols-2">
                <Field label="Notification frequency" why="Controls alert batching across enabled channels.">
                  <select value={data.notificationPreferences.notificationFrequency} onChange={(event) => updateNotificationField('notificationFrequency', event.target.value as ResearcherProfilePayload['notificationPreferences']['notificationFrequency'])} className="cb-select">
                    {notificationOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </Field>
                <Field label="Email address" why="Used only when email alerts are enabled.">
                  <input type="email" value={data.notificationPreferences.emailAddress} onChange={(event) => updateNotificationField('emailAddress', event.target.value)} className="cb-input" />
                </Field>
                <div className="md:col-span-2">
                  <Field label="Alert keywords" hint="Comma-separated" why="Adds explicit topics, methods, regions, or funders that should raise an opportunity's alert relevance.">
                    <textarea rows={3} value={joinList(data.notificationPreferences.alertKeywords)} onChange={(event) => updateNotificationField('alertKeywords', parseList(event.target.value))} className="cb-textarea" />
                  </Field>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* Mobile save bar — the desktop save action lives in the page header. */}
      <div className="sticky bottom-0 z-20 -mx-4 mt-4 border-t border-hairline bg-ground/95 px-4 py-3 backdrop-blur sm:hidden">
        <button type="button" onClick={handleSave} disabled={saving} className="cb-btn-primary w-full">
          <Save className="h-4 w-4" />
          {saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}
        </button>
      </div>
    </ResearcherWorkspaceShell>
  );
}
