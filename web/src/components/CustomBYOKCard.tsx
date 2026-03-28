import React, { useState, useEffect } from "react";
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
  const [endpoint, setEndpoint] = useState(initialConfig?.endpoint || "");
  const [model, setModel] = useState(initialConfig?.model || "");
  const [apiKey, setApiKey] = useState(initialConfig?.apiKey || "");
  const [sdkType, setSdkType] = useState<
    "openai" | "anthropic" | "google" | "openai-compatible"
  >(initialConfig?.sdkType || "openai-compatible");

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

  useEffect(() => {
    if (initialConfig) {
      setEndpoint(initialConfig.endpoint);
      setModel(initialConfig.model);
      setApiKey(initialConfig.apiKey);
      setSdkType(initialConfig.sdkType);
    }
  }, [initialConfig]);

  // Reset status if form changes
  useEffect(() => {
    setStatus("idle");
    setErrorMessage(null);
  }, [endpoint, model, apiKey, sdkType]);

  const handleSaveFlow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid || isSaving) return;

    setIsSaving(true);
    setErrorMessage(null);

    // 1. Test Connection
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

      // 2. Save Configuration
      setStatus("saving");
      await onSave(config);
      setStatus("success");
      // Success screen is usually handled by App.tsx viewState change,
      // but we set success status here for completeness.
    } catch (err) {
      setStatus("error");
      setErrorMessage(
        err instanceof Error ? err.message : "An unexpected error occurred.",
      );
      setIsSaving(false);
    }
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 space-y-2">
      <button
        className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-500 hover:text-slate-900"
        onClick={onCancel}
        aria-label="Go back"
      >
        <ArrowLeft className="w-6 h-6" />
      </button>

      <div className="space-y-6">
        <button
          type="button"
          className="w-full flex items-center gap-4 p-4 bg-transparent border border-slate-300 rounded-lg text-left hover:border-primary transition-all group"
          onClick={onOpenPresets}
        >
          <div className="bg-primary/10 text-primary p-2.5 rounded-lg group-hover:bg-primary/20 transition-colors">
            <Layers className="w-5 h-5" />
          </div>
          <div className="flex-1">
            <div className="font-bold text-slate-900">Select providers</div>
            <div className="text-xs text-slate-700 font-medium">
              Choose from Google, Anthropic, and more
            </div>
          </div>
          <ChevronRight className="w-5 h-5 text-slate-400 group-hover:text-primary transition-colors" />
        </button>

        <form
          onSubmit={handleSaveFlow}
          className="space-y-5 bg-transparent p-6 rounded-lg border border-slate-200"
        >
          <div className="space-y-2">
            <label
              htmlFor="endpoint"
              className="text-sm font-bold text-slate-800 flex items-center gap-2"
            >
              <Globe className="w-4 h-4 text-primary" />
              Base URL (Endpoint)
            </label>
            <input
              type="url"
              id="endpoint"
              className="w-full px-4 py-3 bg-transparent border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all placeholder:text-slate-500 text-sm"
              value={endpoint}
              onChange={(e) => setEndpoint(e.target.value)}
              placeholder="https://api.example.com/v1"
              required
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label
                htmlFor="sdkType"
                className="text-sm font-bold text-slate-800 flex items-center gap-2"
              >
                <Layers className="w-4 h-4 text-primary" />
                SDK Type
              </label>
              <select
                id="sdkType"
                className="w-full px-4 py-3 bg-transparent border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all text-sm appearance-none cursor-pointer"
                value={sdkType}
                onChange={(e) => setSdkType(e.target.value as any)}
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
                className="text-sm font-bold text-slate-800 flex items-center gap-2"
              >
                <Cpu className="w-4 h-4 text-primary" />
                Model Name
              </label>
              <input
                type="text"
                id="model"
                className="w-full px-4 py-3 bg-transparent border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all placeholder:text-slate-500 text-sm"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="gpt-4o"
                required
              />
            </div>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="apiKey"
              className="text-sm font-bold text-slate-800 flex items-center gap-2"
            >
              <Key className="w-4 h-4 text-primary" />
              API Key
            </label>
            <div className="relative group">
              <input
                type={showApiKey ? "text" : "password"}
                id="apiKey"
                className="w-full px-4 py-3 pr-12 bg-transparent border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all placeholder:text-slate-500 text-sm"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="••••••••••••••••"
                required
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-primary transition-colors"
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
            <div className="flex items-start gap-3 p-4 bg-rose-50/50 border border-rose-100 rounded-lg text-rose-700 text-sm animate-in fade-in zoom-in-95 duration-200">
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <p>{errorMessage}</p>
            </div>
          )}

          <div className="pt-4">
            <button
              type="submit"
              className={`w-full flex items-center justify-center gap-2 py-4 rounded-lg font-black transition-all active:scale-[0.98] ${
                !isFormValid || isSaving
                  ? "bg-slate-300 cursor-not-allowed opacity-50 text-white"
                  : "bg-yellow-400 hover:bg-yellow-500 text-black shadow-xl shadow-yellow-400/20"
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
