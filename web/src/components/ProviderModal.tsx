import { X, ExternalLink } from "lucide-react";
import type { Preset } from "../types";
import { AI_PROVIDER_PRESETS, type AIPreset } from "@shared/presets";

const PRESET_LIST: (Preset & { signUpUrl: string })[] = AI_PROVIDER_PRESETS
  .filter((p: AIPreset) => p.id !== "custom")
  .map((p: AIPreset) => ({
    id: p.id,
    name: p.name,
    endpoint: p.endpoint,
    sdkType: p.sdkType,
    model: p.model,
    recommended: p.recommended,
    signUpUrl: p.signUpUrl,
  }));

interface Props {
  onSelect: (preset: Preset) => void;
  onClose: () => void;
}

export function ProviderModal({ onSelect, onClose }: Props) {
  return (
    <div className="fixed inset-0 bg-accent-bg/95 backdrop-blur-sm z-[100] overflow-y-auto animate-in fade-in duration-300">
      <div className="max-w-[900px] mx-auto px-6 py-16 relative">
        <button 
          className="fixed top-6 right-6 p-2 bg-transparent border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors z-[110]" 
          onClick={onClose}
          aria-label="Close"
        >
          <X className="w-6 h-6 text-slate-500" />
        </button>

        <div className="text-center mb-10">
          <h2 className="text-2xl font-bold text-slate-900 tracking-tight mb-2">Select AI Provider</h2>
          <p className="text-slate-600 text-sm font-medium">Choose a preset to quickly configure your agent.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {PRESET_LIST.map((p) => (
            <div
              key={p.id}
              className="flex flex-col p-6 bg-transparent border border-slate-300 rounded-lg transition-all relative group"
            >
              <div 
                className="flex-1 cursor-pointer"
                onClick={() => onSelect(p)}
              >
                {p.recommended && (
                  <span className="absolute -top-3 left-4 bg-primary text-white text-[10px] font-black uppercase tracking-wider px-3 py-1.5 rounded shadow-lg z-10 border border-white/10">
                    Recommended
                  </span>
                )}
                
                <div className="font-bold text-slate-900 text-lg group-hover:text-primary transition-colors mb-1">
                  {p.name}
                </div>
                <div className="text-sm text-slate-700 font-medium line-clamp-1 mb-4">{p.model}</div>
              </div>
              
              <div className="mt-2 pt-4 border-t border-slate-200 flex items-center justify-between">
                <button
                  onClick={() => onSelect(p)}
                  className="text-sm font-bold text-primary hover:text-primary-hover hover:underline"
                >
                  Apply Preset
                </button>
                <a
                  href={p.signUpUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-slate-600 hover:text-primary flex items-center gap-1 transition-colors font-medium"
                >
                  Get API Key
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
