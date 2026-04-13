import { BarChart3 } from 'lucide-react';

type EmptyStateProps = {
  title: string;
  description: string;
};

export function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <div className="bg-accent-bg/50 rounded-2xl p-12 text-center border border-border">
      <div className="w-16 h-16 bg-accent-bg rounded-full flex items-center justify-center mx-auto mb-4">
        <BarChart3 className="w-8 h-8 text-primary" />
      </div>
      <h2 className="text-lg font-semibold text-text-primary mb-2">{title}</h2>
      <p className="text-text-secondary max-w-sm mx-auto">{description}</p>
    </div>
  );
}
