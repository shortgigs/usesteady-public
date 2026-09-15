import { ApplyFixPreview } from "../executor/components/ApplyFixPreview.js";
import { PREVIEW_AUTHORITY_BANNER } from "../executor/types.js";

/**
 * Apply Fix preview + mutation authorization + worker chain status (Sprint #23 / #25).
 * @see docs/product/executor-ui-mutation-authorization-contract-v1.md
 * @see docs/product/executor-ui-worker-chain-integration-contract-v1.md
 */
export function ApplyFixPreviewPage() {
  return (
    <div className="min-h-0">
      <p className="sr-only">{PREVIEW_AUTHORITY_BANNER}</p>
      <ApplyFixPreview />
    </div>
  );
}
