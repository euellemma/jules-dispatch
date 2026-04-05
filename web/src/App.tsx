import { useState, useEffect, startTransition, useRef } from "react";
import {
  Settings,
  Search,
  ShieldCheck,
  ChevronRight,
  Loader2,
  CheckCircle2,
  AlertCircle,
  Bell,
  BellOff,
} from "lucide-react";
import { CustomBYOKCard } from "./components/CustomBYOKCard";
import { ProviderModal } from "./components/ProviderModal";
import { SuccessScreen } from "./components/SuccessScreen";
import {
  fetchConfig,
  saveConfig,
  saveJulesKey,
  saveExaKey,
  saveNotificationPreference,
} from "./api";
import { useDebounce } from "./hooks/useDebounce";
import type { SettingsData, ProviderConfig, Preset } from "./types";
import "./index.css";

type ViewState = "entry" | "provider-setup" | "provider-modal" | "success";

type AppStatus =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: SettingsData; token: string };

function App() {
  const [appStatus, setAppStatus] = useState<AppStatus>({ status: "loading" });
  const [viewState, setViewState] = useState<ViewState>("entry");
  const [previousViewState, setPreviousViewState] =
    useState<ViewState>("entry");

  // Local state for Entry Screen
  const [julesKey, setJulesKey] = useState("");
  const [exaKey, setExaKey] = useState("");
  const [julesSaveStatus, setJulesSaveStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [exaSaveStatus, setExaSaveStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [notificationSaveStatus, setNotificationSaveStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");

  const debouncedJulesKey = useDebounce(julesKey, 1000);
  const debouncedExaKey = useDebounce(exaKey, 1000);

  const initialLoadRef = useRef(true);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const tokenParam = urlParams.get("token");

    if (!tokenParam) {
      if (window.location.hostname === "localhost") {
        startTransition(() => {
          setAppStatus({
            status: "ready",
            data: {
              telegramChatId: "dev",
              config: null,
              julesApiKey: "",
              exaApiKey: "",
            },
            token: "dev",
          });
        });
        return;
      }
      startTransition(() => {
        setAppStatus({
          status: "error",
          message:
            "No token provided. Please open the settings link from Telegram using /connect command.",
        });
      });
      return;
    }

    fetchConfig(tokenParam)
      .then((data) => {
        if (!data) {
          setAppStatus({
            status: "error",
            message: "Failed to load settings — no data returned.",
          });
        } else {
          setAppStatus({ status: "ready", data, token: tokenParam });
          setJulesKey(data.julesApiKey || "");
          setExaKey(data.exaApiKey || "");
          setNotificationsEnabled(data.updateNotificationsEnabled ?? false);
          setTimeout(() => {
            initialLoadRef.current = false;
          }, 100);
        }
      })
      .catch((err) => {
        setAppStatus({
          status: "error",
          message:
            err instanceof Error ? err.message : "Failed to load settings",
        });
      });
  }, []);

  // Debounced Save for Jules
  useEffect(() => {
    if (initialLoadRef.current || appStatus.status !== "ready") return;
    if (debouncedJulesKey === (appStatus.data.julesApiKey || "")) return;

    const save = async () => {
      setJulesSaveStatus("saving");
      try {
        await saveJulesKey(appStatus.token, debouncedJulesKey);
        setJulesSaveStatus("saved");
        setTimeout(() => setJulesSaveStatus("idle"), 3000);
      } catch (_e) {
        console.error(_e);
        setJulesSaveStatus("error");
      }
    };
    save();
  }, [debouncedJulesKey, appStatus]);

  // Debounced Save for Exa
  useEffect(() => {
    if (initialLoadRef.current || appStatus.status !== "ready") return;
    if (debouncedExaKey === (appStatus.data.exaApiKey || "")) return;

    const save = async () => {
      setExaSaveStatus("saving");
      try {
        await saveExaKey(appStatus.token, debouncedExaKey);
        setExaSaveStatus("saved");
        setTimeout(() => setExaSaveStatus("idle"), 3000);
      } catch (_e) {
        console.error(_e);
        setExaSaveStatus("error");
      }
    };
    save();
  }, [debouncedExaKey, appStatus]);

  // Save Notification Preference
  const handleNotificationChange = async (enabled: boolean) => {
    if (appStatus.status !== "ready") return;
    setNotificationsEnabled(enabled);
    setNotificationSaveStatus("saving");
    try {
      await saveNotificationPreference(appStatus.token, enabled);
      setNotificationSaveStatus("saved");
      setTimeout(() => setNotificationSaveStatus("idle"), 3000);
    } catch (_e) {
      console.error(_e);
      setNotificationSaveStatus("error");
    }
  };

  const handleProviderSave = async (config: ProviderConfig) => {
    if (appStatus.status !== "ready") return;
    try {
      await saveConfig(appStatus.token, config);
      setViewState("success");
    } catch (error) {
      console.error("Save failed:", error);
      throw error;
    }
  };

  const handlePresetSelect = (preset: Preset) => {
    if (appStatus.status !== "ready") return;

    setAppStatus((prev) => {
      if (prev.status !== "ready") return prev;
      return {
        ...prev,
        data: {
          ...prev.data,
          config: {
            endpoint: preset.endpoint,
            model: preset.model,
            sdkType: preset.sdkType,
            apiKey: prev.data.config?.apiKey || "",
          },
        },
      };
    });
    setViewState("provider-setup");
  };

  if (appStatus.status === "loading") {
    return (
      <div className="min-h-screen bg-accent-bg flex flex-col items-center justify-center p-6 text-center">
        <Loader2 className="w-10 h-10 text-primary animate-spin mb-4" />
        <p className="text-slate-600 font-medium">Loading settings...</p>
      </div>
    );
  }

  if (appStatus.status === "error") {
    return (
      <div className="min-h-screen bg-accent-bg flex flex-col items-center justify-center p-6 text-center">
        <div className="bg-white p-8 rounded-lg shadow-sm border border-slate-200 max-w-md w-full">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-slate-900 mb-2">
            Unable to Load Settings
          </h2>
          <p className="text-slate-600">{appStatus.message}</p>
        </div>
      </div>
    );
  }

  const { data, token } = appStatus;

  const renderContent = () => {
    switch (viewState) {
      case "entry":
        return (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="border-b border-slate-200 pb-4">
              <h1 className="text-3xl font-extrabold text-slate-900 tracking-tight">
                Settings
              </h1>
              <p className="text-slate-500 mt-1">
                Configure your Jules AI experience.
              </p>
            </div>

            <div className="space-y-6">
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label
                    htmlFor="julesKey"
                    className="text-sm font-bold text-slate-800 flex items-center gap-2"
                  >
                    <ShieldCheck className="w-4 h-4 text-primary" />
                    Jules API Key
                  </label>
                  <SaveStatusIndicator status={julesSaveStatus} />
                </div>
                <input
                  type="password"
                  id="julesKey"
                  className="w-full px-4 py-3 bg-transparent border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all placeholder:text-slate-500"
                  value={julesKey}
                  onChange={(e) => setJulesKey(e.target.value)}
                  placeholder="Enter Jules API key"
                />
                <p className="text-xs text-slate-600 ml-1 font-medium">
                  Required for coding sessions.
                </p>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label
                    htmlFor="exaKey"
                    className="text-sm font-bold text-slate-800 flex items-center gap-2"
                  >
                    <Search className="w-4 h-4 text-primary" />
                    Exa API Key (Optional)
                  </label>
                  <SaveStatusIndicator status={exaSaveStatus} />
                </div>
                <input
                  type="password"
                  id="exaKey"
                  className="w-full px-4 py-3 bg-transparent border border-slate-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-primary outline-none transition-all placeholder:text-slate-500"
                  value={exaKey}
                  onChange={(e) => setExaKey(e.target.value)}
                  placeholder="Enter Exa API key"
                />
                <p className="text-xs text-slate-600 ml-1 font-medium">
                  Enables researcher logic.
                </p>
              </div>

              <button
                className="w-full flex items-center gap-4 p-5 bg-transparent border border-slate-300 rounded-lg text-left hover:border-primary transition-all group"
                onClick={() => setViewState("provider-setup")}
              >
                <div className="bg-primary/10 text-primary p-3 rounded-lg group-hover:bg-primary/20 transition-colors">
                  <Settings className="w-6 h-6" />
                </div>
                <div className="flex-1">
                  <div className="font-bold text-slate-900">Setup provider</div>
                  <div className="text-sm text-slate-700 font-medium">
                    Configure your LLM model and endpoint
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-slate-400 group-hover:text-primary transition-colors" />
              </button>

              <div className="border-t border-slate-200 pt-6">
                <div className="flex items-start gap-4">
                  <div
                    className={`p-3 rounded-lg ${notificationsEnabled ? "bg-primary/10 text-primary" : "bg-slate-100 text-slate-500"}`}
                  >
                    {notificationsEnabled ? (
                      <Bell className="w-5 h-5" />
                    ) : (
                      <BellOff className="w-5 h-5" />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <label
                        htmlFor="notifications"
                        className="font-bold text-slate-900 cursor-pointer"
                      >
                        Update notifications
                      </label>
                      <SaveStatusIndicator status={notificationSaveStatus} />
                    </div>
                    <p className="text-sm text-slate-600 mt-1 mb-3">
                      Get notified about new releases via Telegram when minor or
                      major versions are available.
                    </p>
                    <button
                      id="notifications"
                      type="button"
                      role="switch"
                      aria-checked={notificationsEnabled}
                      onClick={() =>
                        handleNotificationChange(!notificationsEnabled)
                      }
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 ${
                        notificationsEnabled ? "bg-primary" : "bg-slate-300"
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          notificationsEnabled
                            ? "translate-x-6"
                            : "translate-x-1"
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );

      case "provider-setup":
        return (
          <CustomBYOKCard
            initialConfig={data.config}
            token={token}
            onSave={handleProviderSave}
            onCancel={() => setViewState("entry")}
            onOpenPresets={() => {
              setPreviousViewState("provider-setup");
              setViewState("provider-modal");
            }}
          />
        );

      case "provider-modal":
        return (
          <ProviderModal
            onSelect={handlePresetSelect}
            onClose={() => setViewState(previousViewState)}
          />
        );

      case "success":
        return <SuccessScreen />;
    }
  };

  return (
    <div className="min-h-screen bg-transparent font-sans">
      <main className="max-w-[600px] mx-auto py-12 px-6">
        <div className="bg-transparent rounded-3xl p-0">{renderContent()}</div>
      </main>
    </div>
  );
}

function SaveStatusIndicator({
  status,
}: {
  status: "idle" | "saving" | "saved" | "error";
}) {
  if (status === "idle") return null;

  return (
    <span
      className={`flex items-center gap-1.5 text-xs font-semibold ${
        status === "saving"
          ? "text-slate-600 italic"
          : status === "saved"
            ? "text-emerald-600"
            : "text-rose-600"
      }`}
    >
      {status === "saving" && <Loader2 className="w-3 h-3 animate-spin" />}
      {status === "saved" && <CheckCircle2 className="w-3 h-3" />}
      {status === "error" && <AlertCircle className="w-3 h-3" />}
      {status === "saving" && "Saving..."}
      {status === "saved" && "Saved"}
      {status === "error" && "Error saving"}
    </span>
  );
}

export default App;
