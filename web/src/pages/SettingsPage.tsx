import { useState, useEffect, startTransition } from 'react';
import { Loader2, AlertCircle, Settings } from 'lucide-react';
import { ApiKeyInput } from '../components/settings/ApiKeyInput';
import { ProviderCard } from '../components/settings/ProviderCard';
import { NotificationsToggle } from '../components/settings/NotificationsToggle';
import { CustomBYOKCard } from '../components/CustomBYOKCard';
import { ProviderModal } from '../components/ProviderModal';
import { SuccessScreen } from '../components/SuccessScreen';
import {
  fetchConfig,
  saveConfig,
  saveJulesKey,
  saveExaKey,
  saveNotificationPreference,
} from '../api';
import type { SettingsData, ProviderConfig, Preset } from '../types';

type ViewState = 'entry' | 'provider-setup' | 'provider-modal' | 'success';

type AppStatus =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: SettingsData; token: string };

type SettingsPageProps = {
  token: string;
};

export function SettingsPage({ token }: SettingsPageProps) {
  const [appStatus, setAppStatus] = useState<AppStatus>({ status: 'loading' });
  const [viewState, setViewState] = useState<ViewState>('entry');
  const [previousViewState, setPreviousViewState] = useState<ViewState>('entry');

  useEffect(() => {
    if (token === 'dev') {
      startTransition(() => {
        setAppStatus({
          status: 'ready',
          data: {
            telegramChatId: 'dev',
            config: null,
            julesApiKey: '',
            exaApiKey: '',
          },
          token: 'dev',
        });
      });
      return;
    }

    fetchConfig(token)
      .then((data) => {
        if (!data) {
          setAppStatus({
            status: 'error',
            message: 'Failed to load settings — no data returned.',
          });
        } else {
          setAppStatus({ status: 'ready', data, token });
        }
      })
      .catch((err) => {
        setAppStatus({
          status: 'error',
          message:
            err instanceof Error ? err.message : 'Failed to load settings',
        });
      });
  }, [token]);

  const handleProviderSave = async (config: ProviderConfig) => {
    if (appStatus.status !== 'ready') return;
    try {
      await saveConfig(appStatus.token, config);
      setViewState('success');
    } catch (error) {
      console.error('Save failed:', error);
      throw error;
    }
  };

  const handlePresetSelect = (preset: Preset) => {
    if (appStatus.status !== 'ready') return;

    setAppStatus((prev) => {
      if (prev.status !== 'ready') return prev;
      return {
        ...prev,
        data: {
          ...prev.data,
          config: {
            endpoint: preset.endpoint,
            model: preset.model,
            sdkType: preset.sdkType,
            apiKey: prev.data.config?.apiKey || '',
          },
        },
      };
    });
    setViewState('provider-setup');
  };

  if (appStatus.status === 'loading') {
    return (
      <div className="min-h-screen bg-accent-bg flex flex-col items-center justify-center p-6 text-center">
        <Loader2 className="w-10 h-10 text-primary animate-spin mb-4" />
        <p className="text-text-secondary font-medium">Loading settings...</p>
      </div>
    );
  }

  if (appStatus.status === 'error') {
    return (
      <div className="min-h-screen bg-accent-bg flex flex-col items-center justify-center p-6 text-center">
        <div className="bg-card p-8 rounded-xl border border-border max-w-md w-full">
          <AlertCircle className="w-12 h-12 text-error mx-auto mb-4" />
          <h2 className="text-xl font-bold text-text-primary mb-2">
            Unable to Load Settings
          </h2>
          <p className="text-text-secondary">{appStatus.message}</p>
        </div>
      </div>
    );
  }

  const { data, token: authToken } = appStatus;

  const renderContent = () => {
    switch (viewState) {
      case 'entry':
        return (
          <div className="space-y-8">
            <div className="border-b border-border pb-4">
              <h1 className="text-3xl font-extrabold text-text-primary tracking-tight">
                Settings
              </h1>
              <p className="text-text-secondary mt-1">
                Configure your Jules AI experience.
              </p>
            </div>

            <div className="space-y-6">
              <ApiKeyInput
                type="jules"
                initialValue={data.julesApiKey || ''}
                onSave={(value) => saveJulesKey(authToken, value)}
              />

              <ApiKeyInput
                type="exa"
                initialValue={data.exaApiKey || ''}
                onSave={(value) => saveExaKey(authToken, value)}
              />

              <ProviderCard
                config={data.config}
                onClick={() => setViewState('provider-setup')}
              />

              <NotificationsToggle
                initialEnabled={data.updateNotificationsEnabled ?? false}
                onSave={(enabled) =>
                  saveNotificationPreference(authToken, enabled)
                }
              />
            </div>
          </div>
        );

      case 'provider-setup':
        return (
          <CustomBYOKCard
            initialConfig={data.config}
            token={authToken}
            onSave={handleProviderSave}
            onCancel={() => setViewState('entry')}
            onOpenPresets={() => {
              setPreviousViewState('provider-setup');
              setViewState('provider-modal');
            }}
          />
        );

      case 'provider-modal':
        return (
          <ProviderModal
            onSelect={handlePresetSelect}
            onClose={() => setViewState(previousViewState)}
          />
        );

      case 'success':
        return <SuccessScreen />;
    }
  };

  return (
    <div className="min-h-screen bg-transparent font-sans">
      <main className="max-w-[600px] mx-auto py-12 px-6">
        <div className="bg-transparent rounded-3xl p-0 relative">
          <a
            href="/dashboard"
            className="absolute top-0 right-0 p-2 text-text-tertiary hover:text-primary transition-colors rounded-lg hover:bg-accent-bg/50"
            title="Go to Dashboard"
          >
            <Settings className="w-5 h-5" />
          </a>
          {renderContent()}
        </div>
      </main>
    </div>
  );
}
