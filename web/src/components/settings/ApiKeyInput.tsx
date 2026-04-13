import { useState, useEffect, useRef } from 'react';
import { ShieldCheck, Search } from 'lucide-react';
import { SaveStatusIndicator, type SaveStatus } from '../SaveStatusIndicator';
import { useDebounce } from '../../hooks/useDebounce';

type ApiKeyType = 'jules' | 'exa';

type ApiKeyInputProps = {
  type: ApiKeyType;
  initialValue: string;
  onSave: (value: string) => Promise<void>;
};

const CONFIG = {
  jules: {
    icon: ShieldCheck,
    label: 'Jules API Key',
    placeholder: 'Enter Jules API key',
    description: 'Required for coding sessions.',
  },
  exa: {
    icon: Search,
    label: 'Exa API Key (Optional)',
    placeholder: 'Enter Exa API key',
    description: 'Enables researcher logic.',
  },
};

export function ApiKeyInput({ type, initialValue, onSave }: ApiKeyInputProps) {
  const [value, setValue] = useState(initialValue);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const debouncedValue = useDebounce(value, 1000);
  const initialLoadRef = useRef(true);

  useEffect(() => {
    if (initialLoadRef.current) {
      initialLoadRef.current = false;
      return;
    }

    if (debouncedValue === initialValue) return;

    const save = async () => {
      setStatus('saving');
      try {
        await onSave(debouncedValue);
        setStatus('saved');
        setTimeout(() => setStatus('idle'), 3000);
      } catch (_e) {
        console.error(_e);
        setStatus('error');
      }
    };
    save();
  }, [debouncedValue, initialValue, onSave]);

  const config = CONFIG[type];
  const Icon = config.icon;

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <label
          htmlFor={`${type}Key`}
          className="label flex items-center gap-2"
        >
          <Icon className="w-4 h-4 text-primary" />
          {config.label}
        </label>
        <SaveStatusIndicator status={status} />
      </div>
      <input
        type="password"
        id={`${type}Key`}
        className="input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={config.placeholder}
      />
      <p className="text-xs text-text-tertiary ml-1 font-medium">
        {config.description}
      </p>
    </div>
  );
}
