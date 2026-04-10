import { CheckCircle2, PartyPopper } from "lucide-react";

export function SuccessScreen() {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="relative mb-8">
        <div className="absolute inset-0 bg-accent-bg rounded-full scale-150 blur-2xl opacity-50 animate-pulse"></div>
        <div className="relative bg-card p-6 rounded-xl border border-border">
          <CheckCircle2 className="w-16 h-16 text-primary" />
        </div>
        <PartyPopper className="absolute -top-4 -right-4 w-8 h-8 text-pink-400 animate-bounce" />
      </div>

      <h2 className="text-3xl font-extrabold text-text-primary tracking-tight mb-3">Configuration Saved!</h2>
      <p className="text-text-secondary text-lg max-w-xs mx-auto mb-10">
        Everything is set up and ready to go. Jules is now powered up.
      </p>

      <div className="bg-card p-6 rounded-xl border border-border w-full max-w-sm">
        <p className="text-text-secondary font-medium">
          Please return to your Telegram bot and send a message to start chatting.
        </p>
      </div>
    </div>
  );
}