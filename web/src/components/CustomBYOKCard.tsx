import React, { useState } from "react";
import {
  ArrowLeft,
  Layers,
  Globe,
  Cpu,
  Key,
  Eye,
  EyeOff,
  Loader2,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
} from "lucide-react";
import type { ProviderConfig } from "../types";
import { testConnection } from "../api";

interface Props {
  initialConfig: ProviderConfig | null;
  token: string;
  onSave: (config: ProviderConfig) => Promise<void>;
  onCancel: () => void;
  onOpenPresets: () => void;
}

export function CustomBYOKCard({
  initialConfig,
  token,
  onSave,
  onCancel,
  onOpenPresets,
}: Props) {
  const [endpoint, setEndpoint] = useState(initialConfig?.endpoint ?? "");
  const [model, setModel] = useState(initialConfig?.model ?? "");
  const [apiKey, setApiKey] = useState(initialConfig?.apiKey ?? "");
  const [sdkType, setSdkType] = useState<
    "openai" | "anthropic" | "google" | "openai-compatible"
  >(initialConfig?.sdkType ?? "openai-compatible");

  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<
    "idle" | "testing" | "saving" | "success" | "error"
  >("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showApiKey, setShowApiKey] = useState(false);

  const isValidUrl = (url: string) => {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  };

  const isFormValid =
    endpoint && isValidUrl(endpoint) && model && apiKey.trim().length >= 1;

  const handleResetStatus = () => {
    setStatus("idle");
    setErrorMessage(null);
  };

  const handleFieldChange = () => {
    handleResetStatus();
  };

  const handleSaveFlow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid || isSaving) return;

    setIsSaving(true);
    setErrorMessage(null);

    setStatus("testing");
    try {
      const config = { endpoint, model, apiKey, sdkType };
      const testResult = await testConnection(token, config);

      if (!testResult.success) {
        setStatus("error");
        setErrorMessage(
          testResult.error ||
            "Connection test failed. Please check your credentials.",
        );
        setIsSaving(false);
        return;
      }

      setStatus("saving");
      await onSave(config);
      setStatus("success");
    } catch (err) {
      setStatus("error");
      setErrorMessage(
        err instanceof Error ? err.message : "An unexpected error occurred.",
      );
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-2">
      <button
        className="p-2 hover:bg-gray-100 rounded-full transition-colors text-text-tertiary hover:text-text-primary"
        onClick={onCancel}
        aria-label="Go back"
      >
        <ArrowLeft className="w-6 h-6" />
      </button>

      <div className="space-y-6">
        <button
          type="button"
          className="w-full flex items-center gap-4 p-4 card card-hover text-left"
          onClick={onOpenPresets}
        >
          <div className="bg-accent-bg text-primary p-2.5 rounded-lg">
            <Layers className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <div className="font-semibold text-text-primary">Select providers</div>
            <div className="text-xs text-text-secondary font-medium">
              Choose from Google, Anthropic, and more
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-text-tertiary" />
        </button>

        <form
          onSubmit={handleSaveFlow}
          className="space-y-5 bg-card p-6 rounded-xl border border-border"
        >
          <div className="space-y-2">
            <label
              htmlFor="endpoint"
              className="label flex items-center gap-2"
            >
              <Globe className="w-4 h-4 text-primary" />
              Base URL (Endpoint)
            </label>
            <input
              type="url"
              id="endpoint"
              className="input"
              value={endpoint}
              onChange={(e) => { setEndpoint(e.target.value); handleFieldChange(); }}
              placeholder="https://api.example.com/v1"
              required
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label
                htmlFor="sdkType"
                className="label flex items-center gap-2"
              >
                <Layers className="w-4 h-4 text-primary" />
                SDK Type
              </label>
              <select
                id="sdkType"
                className="input appearance-none cursor-pointer"
                value={sdkType}
                onChange={(e) => { setSdkType(e.target.value as "openai" | "anthropic" | "google" | "openai-compatible"); handleFieldChange(); }}
              >
                <option value="openai-compatible">OpenAI-Compatible</option>
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="google">Google AI (Studio)</option>
              </select>
            </div>

            <div className="space-y-2">
              <label
                htmlFor="model"
                className="label flex items-center gap-2"
              >
                <Cpu className="w-4 h-4 text-primary" />
                Model Name
              </label>
              <input
                type="text"
                id="model"
                className="input"
                value={model}
                onChange={(e) => { setModel(e.target.value); handleFieldChange(); }}
                placeholder="gpt-4o"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="apiKey"
              className="label flex items-center gap-2"
            >
              <Key className="w-4 h-4 text-primary" />
              API Key
            </label>
            <div className="relative group">
              <input
                type={showApiKey ? "text" : "password"}
                id="apiKey"
                className="input pr-12"
                value={apiKey}
                onChange={(e) => { setApiKey(e.target.value); handleFieldChange(); }}
                placeholder="••••••••••••••••"
                required
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-text-tertiary hover:text-primary transition-colors"
                onClick={() => setShowApiKey(!showApiKey)}
              >
                {showApiKey ? (
                  <EyeOff className="w-4 h-4" />
                ) : (
                  <Eye className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          {errorMessage && (
            <div className="flex items-start gap-3 p-4 bg-red-50/50 border border-red-100 rounded-lg text-red-700 text-sm">
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <p>{errorMessage}</p>
            </div>
          )}

          <div className="pt-4">
            <button
              type="submit"
              className={`w-full flex items-center justify-center gap-2 py-4 rounded-lg font-bold transition-all active:scale-[0.98] ${
                !isFormValid || isSaving
                  ? "bg-gray-200 text-text-tertiary cursor-not-allowed"
                  : "bg-primary hover:bg-primary-hover text-white shadow-lg"
              }`}
              disabled={isSaving || !isFormValid}
            >
              {status === "testing" && (
                <Loader2 className="w-5 h-5 animate-spin" />
              )}
              {status === "saving" && (
                <Loader2 className="w-5 h-5 animate-spin" />
              )}
              {status === "success" && <CheckCircle2 className="w-5 h-5" />}

              <span>
                {status === "testing"
                  ? "Testing Connection..."
                  : status === "saving"
                    ? "Saving..."
                    : status === "success"
                      ? "Saved!"
                      : "Save & Finish"}
              </span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}