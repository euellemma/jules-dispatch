import { useState, useCallback } from 'react';
import { Bell, BellOff } from 'lucide-react';
import { SaveStatusIndicator, type SaveStatus } from '../SaveStatusIndicator';

type NotificationsToggleProps = {
  initialEnabled: boolean;
  onSave: (enabled: boolean) => Promise<void>;
};

export function NotificationsToggle({
  initialEnabled,
  onSave,
}: NotificationsToggleProps) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [status, setStatus] = useState<SaveStatus>('idle');

  const handleChange = useCallback(
    async (newEnabled: boolean) => {
      setEnabled(newEnabled);
      setStatus('saving');
      try {
        await onSave(newEnabled);
        setStatus('saved');
        setTimeout(() => setStatus('idle'), 3000);
      } catch (_e) {
        console.error(_e);
        setStatus('error');
      }
    },
    [onSave]
  );

  return (
    <div className="border-t border-border pt-6">
      <div className="flex items-start gap-4">
        <div
          className={`p-3 rounded-lg transition-colors ${
            enabled
              ? 'bg-accent-bg text-primary'
              : 'bg-gray-100 text-text-tertiary'
          }`}
        >
          {enabled ? <Bell className="w-5 h-5" /> : <BellOff className="w-5 h-5" />}
        </div>
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <label
              htmlFor="notifications"
              className="font-semibold text-text-primary cursor-pointer"
            >
              Update notifications
            </label>
            <SaveStatusIndicator status={status} />
          </div>
          <p className="text-sm text-text-secondary mt-1 mb-3">
            Get notified about new releases via Telegram when minor or major
            versions are available.
          </p>
          <button
            id="notifications"
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={() => handleChange(!enabled)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 ${
              enabled ? 'bg-primary' : 'bg-gray-300'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow-sm ${
                enabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </div>
    </div>
  );
}
