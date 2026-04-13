import { Settings, ChevronRight } from 'lucide-react';
import type { ProviderConfig } from '../../types';

type ProviderCardProps = {
  config: ProviderConfig | null;
  onClick: () => void;
};

export function ProviderCard({ config, onClick }: ProviderCardProps) {
  const isConfigured = Boolean(config?.apiKey);

  return (
    <button
      className="w-full flex items-center gap-4 p-5 card card-hover text-left group"
      onClick={onClick}
    >
      <div className="bg-accent-bg text-primary p-3 rounded-lg group-hover:bg-accent-bg/80 transition-colors">
        <Settings className="w-6 h-6" />
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <div className="font-semibold text-text-primary">Setup provider</div>
          <div
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
              isConfigured
                ? 'bg-success/10 text-success border border-success/20'
                : 'bg-gray-100 text-text-tertiary border border-border'
            }`}
          >
            <div
              className={`w-1.5 h-1.5 rounded-full ${
                isConfigured ? 'bg-success' : 'bg-gray-400'
              }`}
            />
            {isConfigured ? 'Configured' : 'Not setup'}
          </div>
        </div>
        <div className="text-sm text-text-secondary font-medium">
          {isConfigured
            ? `${config?.model} via ${config?.sdkType}`
            : 'Configure your LLM model and endpoint'}
        </div>
      </div>
      <ChevronRight className="w-5 h-5 text-text-tertiary group-hover:text-primary transition-colors" />
    </button>
  );
}
