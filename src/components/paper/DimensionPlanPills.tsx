'use client';

import { Check, Circle } from 'lucide-react';

interface DimensionPlanItem {
  dimensionKey: string;
  dimensionLabel: string;
  status: 'accepted' | 'pending' | 'todo';
}

interface DimensionPlanPillsProps {
  plan: DimensionPlanItem[];
  activeDimensionKey?: string | null;
  acceptedCount: number;
  totalCount: number;
  disabled?: boolean;
  onSelect?: (dimensionKey: string) => void;
}

export default function DimensionPlanPills({
  plan,
  activeDimensionKey,
  acceptedCount,
  totalCount,
  disabled,
  onSelect,
}: DimensionPlanPillsProps) {
  if (!plan || plan.length === 0) return null;

  return (
    <div className="mt-0.5 mb-1 flex flex-wrap items-center gap-1">
      {plan.map((item) => {
        const isAccepted = item.status === 'accepted';
        const isActive = activeDimensionKey && activeDimensionKey === item.dimensionKey;

        const classes = isAccepted
          ? 'text-emerald-600 bg-emerald-50/60 border-emerald-200/70'
          : isActive || item.status === 'pending'
            ? 'text-indigo-500 bg-indigo-50/50 border-indigo-200'
            : 'text-slate-400 bg-slate-50/50 border-slate-200/70';

        return (
          <button
            key={item.dimensionKey}
            type="button"
            onClick={() => onSelect?.(item.dimensionKey)}
            disabled={Boolean(disabled)}
            className={`inline-flex items-center gap-0.5 rounded-full border px-2 py-0.5 text-[10px] font-medium tracking-[0.15px] transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${classes}`}
            title={item.dimensionLabel}
          >
            {isAccepted ? (
              <Check className="h-2.5 w-2.5" />
            ) : (
              <Circle className="h-2 w-2" />
            )}
            <span className="max-w-[120px] truncate">{item.dimensionLabel}</span>
          </button>
        );
      })}

      <span className="ml-0.5 text-[10px] font-medium text-slate-400">
        {acceptedCount}/{totalCount}
      </span>
    </div>
  );
}
