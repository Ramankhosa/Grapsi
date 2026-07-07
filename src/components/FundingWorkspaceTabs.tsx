import Link from 'next/link';

type StepKey = 'call' | 'guidelines' | 'template' | 'documents';

type FundingWorkspaceTabsProps = {
  current: StepKey;
  callHref?: string | null;
  guidelinesHref?: string | null;
  templateHref?: string | null;
  documentsHref?: string | null;
  guidelineStatus?: string | null;
  templateStatus?: string | null;
  documentStatus?: string | null;
};

type StepItem = {
  key: StepKey;
  label: string;
  subtitle: string;
  href: string | null;
  status?: string | null;
};

// Plain-language labels for raw workflow statuses shown in the tab badges.
const STATUS_LABELS: Record<string, string> = {
  none: 'Not started',
  draft: 'In progress',
  needs_review: 'Needs review',
  approved: 'Approved',
};

function formatStatusLabel(status: string): string {
  return STATUS_LABELS[status] || status.replace(/_/g, ' ');
}

export default function FundingWorkspaceTabs(props: FundingWorkspaceTabsProps) {
  const steps: StepItem[] = [
    {
      key: 'call',
      label: '1. Call Details',
      subtitle: 'What the funding call is about',
      href: props.callHref || null,
    },
    {
      key: 'guidelines',
      label: '2. Guidelines',
      subtitle: 'Rules applicants must follow',
      href: props.guidelinesHref || null,
      status: props.guidelineStatus || null,
    },
    {
      key: 'template',
      label: '3. Template',
      subtitle: 'Application form structure',
      href: props.templateHref || null,
      status: props.templateStatus || null,
    },
    {
      key: 'documents',
      label: '4. Documents',
      subtitle: 'Uploaded source files',
      href: props.documentsHref || null,
      status: props.documentStatus || null,
    },
  ];

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="grid gap-3 md:grid-cols-4">
        {steps.map((step) => {
          const active = step.key === props.current;
          const disabled = !step.href;
          const content = (
            <div
              className={`rounded-2xl border px-4 py-4 transition ${
                active
                  ? 'border-emerald-300 bg-emerald-50'
                  : disabled
                    ? 'border-slate-200 bg-slate-50 opacity-60'
                    : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className={`text-sm font-semibold ${active ? 'text-emerald-900' : 'text-slate-900'}`}>{step.label}</div>
                  <div className="mt-1 text-xs uppercase tracking-[0.16em] text-slate-500">{step.subtitle}</div>
                </div>
                {step.status && (
                  <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-700">
                    {formatStatusLabel(step.status)}
                  </span>
                )}
              </div>
            </div>
          );

          if (disabled || active) {
            return <div key={step.key}>{content}</div>;
          }

          return (
            <Link key={step.key} href={step.href!} className="block">
              {content}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
