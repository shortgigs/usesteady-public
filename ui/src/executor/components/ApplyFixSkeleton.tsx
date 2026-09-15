export function ApplyFixSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading preview" className="space-y-6 animate-pulse">
      <div className="h-14 rounded-lg bg-gray-800/60" />
      <div className="space-y-3">
        <div className="h-3 w-24 rounded bg-gray-800/80" />
        <div className="h-4 w-full max-w-xl rounded bg-gray-800/50" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="h-10 rounded bg-gray-800/40" />
          <div className="h-10 rounded bg-gray-800/40" />
        </div>
      </div>
      <div className="space-y-2">
        <div className="h-3 w-20 rounded bg-gray-800/80" />
        <div className="h-32 rounded-lg bg-gray-800/40" />
      </div>
      <div className="space-y-2">
        <div className="h-3 w-28 rounded bg-gray-800/80" />
        <div className="h-20 rounded-lg bg-gray-800/40" />
      </div>
    </div>
  );
}
