import { useAuth, type AuthState } from './hooks/useAuth';
import { SettingsPage } from './pages/SettingsPage';
import { DashboardPage } from './pages/DashboardPage';
import { AlertCircle } from 'lucide-react';

type Route = 'settings' | 'dashboard';

function getCurrentRoute(): Route {
  const path = window.location.pathname;
  return path.startsWith('/dashboard') ? 'dashboard' : 'settings';
}

function ErrorScreen({ message }: { message: string }) {
  return (
    <div className="min-h-screen bg-accent-bg flex flex-col items-center justify-center p-6 text-center">
      <div className="bg-card p-8 rounded-xl border border-border max-w-md w-full">
        <AlertCircle className="w-12 h-12 text-error mx-auto mb-4" />
        <h2 className="text-xl font-bold text-text-primary mb-2">
          Unable to Load Settings
        </h2>
        <p className="text-text-secondary">{message}</p>
      </div>
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-accent-bg flex flex-col items-center justify-center p-6 text-center">
      <div className="w-10 h-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin mb-4" />
      <p className="text-text-secondary font-medium">Loading...</p>
    </div>
  );
}

function RouterContent({ authState, route }: { authState: AuthState; route: Route }) {
  if (authState.status === 'loading') {
    return <LoadingScreen />;
  }

  if (authState.status === 'error') {
    return <ErrorScreen message={authState.message} />;
  }

  const { token } = authState;

  return route === 'dashboard' ? (
    <DashboardPage token={token} />
  ) : (
    <SettingsPage token={token} />
  );
}

export function Router() {
  const authState = useAuth();
  const route = getCurrentRoute();

  return <RouterContent authState={authState} route={route} />;
}
