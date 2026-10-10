import { useCallback, useState } from "react";

type Props = {
  label: string;
  value: string;
};

export function CopyableId({ label, value }: Props) {
  const [copied, setCopied] = useState(false);

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — fail silent */
    }
  }, [value]);

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2 min-w-0">
      <span className="text-[10px] uppercase tracking-wider text-gray-500 shrink-0">{label}</span>
      <div className="flex items-center gap-2 min-w-0">
        <code className="text-xs font-mono text-gray-300 truncate" title={value}>
          {value}
        </code>
        <button
          type="button"
          onClick={onCopy}
          className="shrink-0 min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 sm:px-2 sm:py-1 sm:min-h-[32px]
                     text-[11px] rounded border border-gray-700 text-gray-400
                     hover:text-cyan-300 hover:border-cyan-700/50
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/60"
          aria-label={`Copy ${label}`}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
