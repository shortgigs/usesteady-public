/**
 * TUI v1 — StepList component.
 *
 * Renders each step with a symbol and colour reflecting its status.
 * The current step (pending + id === currentStepId) gets a directional arrow.
 */
import type { TuiStep } from "../types.js";
type Props = {
    readonly steps: readonly TuiStep[];
    readonly currentStepId: number | undefined;
};
export declare function StepList({ steps, currentStepId }: Props): import("react/jsx-runtime").JSX.Element | null;
export {};
//# sourceMappingURL=StepList.d.ts.map