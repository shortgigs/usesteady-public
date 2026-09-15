export function LoadingSpinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 text-gray-400 text-sm">
      <span className="size-4 border-2 border-gray-600 border-t-indigo-400 rounded-full animate-spin" />
      {label}
    </div>
  );
}

export function ErrorMessage({ error }: { error: string }) {
  return (
    <div className="rounded-lg bg-red-950/50 border border-red-800 p-4 text-sm text-red-300">
      {error}
    </div>
  );
}
