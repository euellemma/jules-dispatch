import { ArrowLeft, Settings } from 'lucide-react';

type PageHeaderProps = {
  title: string;
  showBack?: boolean;
  showSettings?: boolean;
  backHref?: string;
  settingsHref?: string;
};

export function PageHeader({
  title,
  showBack = false,
  showSettings = false,
  backHref = '/settings',
  settingsHref = '/settings',
}: PageHeaderProps) {
  return (
    <div className="flex items-center justify-between mb-8">
      {showBack ? (
        <a
          href={backHref}
          className="p-2 text-text-tertiary hover:text-primary transition-colors rounded-lg hover:bg-accent-bg/50"
          title="Back"
        >
          <ArrowLeft className="w-5 h-5" />
        </a>
      ) : (
        <div className="w-9" />
      )}

      <h1 className="text-2xl font-extrabold text-text-primary tracking-tight">
        {title}
      </h1>

      {showSettings ? (
        <a
          href={settingsHref}
          className="p-2 text-text-tertiary hover:text-primary transition-colors rounded-lg hover:bg-accent-bg/50"
          title="Settings"
        >
          <Settings className="w-5 h-5" />
        </a>
      ) : (
        <div className="w-9" />
      )}
    </div>
  );
}
