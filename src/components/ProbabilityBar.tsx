import React from 'react';

interface Props {
  label: string;
  percentage: number;
  secondaryLabel?: string;
  color?: 'emerald' | 'cyan' | 'amber' | 'blue';
  showPercentageText?: boolean;
  subtext?: string;
}

export const ProbabilityBar: React.FC<Props> = ({
  label,
  percentage,
  secondaryLabel,
  color = 'emerald',
  showPercentageText = true,
  subtext,
}) => {
  const clamped = Math.max(0, Math.min(100, percentage));

  const colorStyles = {
    emerald: 'bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.3)]',
    cyan: 'bg-cyan-500 shadow-[0_0_12px_rgba(6,182,212,0.3)]',
    amber: 'bg-amber-500 shadow-[0_0_12px_rgba(245,158,11,0.3)]',
    blue: 'bg-blue-500 shadow-[0_0_12px_rgba(59,130,246,0.3)]',
  }[color];

  return (
    <div className="w-full">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-xs mb-1.5 font-medium">
        <span className="text-slate-300 flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0">
          <span className="truncate max-w-full">{label}</span>
          {subtext && <span className="text-slate-500 text-[11px] font-normal">{subtext}</span>}
        </span>
        <div className="flex items-center gap-2 shrink-0 ms-auto">
          {secondaryLabel && <span className="text-slate-400 text-[11px]">{secondaryLabel}</span>}
          {showPercentageText && (
            <span className="font-mono tabular-nums text-slate-100 font-semibold" dir="ltr">
              {percentage.toFixed(1)}%
            </span>
          )}
        </div>
      </div>
      <div className="w-full h-2 bg-slate-800/80 rounded-full overflow-hidden border border-slate-700/50">
        <div
          className={`h-full rounded-full transition-all duration-500 ease-out ${colorStyles}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
};
