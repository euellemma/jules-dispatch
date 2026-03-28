import { CheckCircle2, PartyPopper } from "lucide-react";

export function SuccessScreen() {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center animate-in fade-in zoom-in-95 duration-500">
      <div className="relative mb-8">
        <div className="absolute inset-0 bg-primary/10 rounded-full scale-150 blur-2xl opacity-50 animate-pulse"></div>
        <div className="relative bg-transparent p-6 rounded-lg border border-primary/20">
          <CheckCircle2 className="w-16 h-16 text-primary" />
        </div>
        <PartyPopper className="absolute -top-4 -right-4 w-8 h-8 text-amber-400 animate-bounce" />
      </div>

      <h2 className="text-3xl font-extrabold text-slate-900 tracking-tight mb-3">Configuration Saved!</h2>
      <p className="text-slate-500 text-lg max-w-xs mx-auto mb-10">
        Everything is set up and ready to go. Jules is now powered up.
      </p>
      
      <div className="bg-transparent p-6 rounded-lg border border-slate-200 w-full max-w-sm">
        <p className="text-slate-600 font-medium mb-4">
          Please return to your Telegram bot and send a message to start chatting.
        </p>
        <div className="inline-flex items-center gap-2 px-4 py-2 bg-transparent rounded-lg border border-slate-200 text-xs font-bold text-slate-400">
          <span className="w-2 h-2 bg-primary/30 rounded-full animate-pulse"></span>
          Tip: You can now close this tab.
        </div>
      </div>
    </div>
  );
}
