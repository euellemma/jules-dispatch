type StatCardProps = {
  label: string;
  value?: string | number;
};

export function StatCard({ label, value = '—' }: StatCardProps) {
  return (
    <div className="bg-accent-bg/30 rounded-xl p-4 text-center border border-border">
      <div className="text-2xl font-bold text-text-primary">{value}</div>
      <div className="text-xs text-text-tertiary uppercase tracking-wider font-semibold mt-1">
        {label}
      </div>
    </div>
  );
}
