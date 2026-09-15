type Props = {
  onLoadSample?: () => void;
};

export function ApplyFixEmptyState({ onLoadSample }: Props) {
  return (
    <div
      className="rounded-xl border border-dashed border-gray-700 bg-gray-950/50 px-6 py-10 text-center"
      role="status"
    >
      <p className="text-sm font-medium text-gray-300">No preview loaded</p>
      <p className="text-xs text-gray-500 mt-2 max-w-md mx-auto leading-relaxed">
        Paste a certified preview request (JSON) and select{" "}
        <span className="text-gray-400">Load preview</span>. This surface only displays{" "}
        <code className="text-gray-400">ApplyFixViewModel</code> from the server route.
      </p>
      {onLoadSample && (
        <button
          type="button"
          onClick={onLoadSample}
          className="mt-4 min-h-[44px] px-4 py-2 text-sm rounded-lg border border-gray-600 text-gray-300
                     hover:border-cyan-700/50 hover:text-cyan-200
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60"
        >
          Insert sample request shape
        </button>
      )}
    </div>
  );
}
