import { PageHeader } from '../components/PageHeader';
import { EmptyState } from '../components/dashboard/EmptyState';
import { StatCard } from '../components/dashboard/StatCard';

type DashboardPageProps = {
  token: string;
};

export function DashboardPage({}: DashboardPageProps) {
  return (
    <div className="min-h-screen bg-transparent font-sans">
      <main className="max-w-[600px] mx-auto py-12 px-6">
        <div className="bg-card rounded-3xl p-8 border border-border shadow-sm">
          <PageHeader
            title="Jules Dispatch Dashboard"
            showBack
            showSettings
            backHref="/settings"
            settingsHref="/settings"
          />

          <EmptyState
            title="Session Tracking Coming Soon"
            description="This dashboard will soon display your active sessions, statistics, and activity history. Stay tuned!"
          />

          <div className="grid grid-cols-3 gap-4 mt-8">
            <StatCard label="Active Sessions" />
            <StatCard label="Total Sessions" />
            <StatCard label="Messages" />
          </div>
        </div>
      </main>
    </div>
  );
}
