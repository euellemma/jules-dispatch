import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

type SaveStatusIndicatorProps = {
  status: SaveStatus;
};

export function SaveStatusIndicator({ status }: SaveStatusIndicatorProps) {
  if (status === 'idle') return null;

  return (
    <span
      className={`flex items-center gap-1.5 text-xs font-semibold ${
        status === 'saving'
          ? 'text-text-secondary italic'
          : status === 'saved'
            ? 'text-success'
            : 'text-error'
      }`}
    >
      {status === 'saving' && <Loader2 className="w-3 h-3 animate-spin" />}
      {status === 'saved' && <CheckCircle2 className="w-3 h-3" />}
      {status === 'error' && <AlertCircle className="w-3 h-3" />}
      {status === 'saving' && 'Saving...'}
      {status === 'saved' && 'Saved'}
      {status === 'error' && 'Error saving'}
    </span>
  );
}
