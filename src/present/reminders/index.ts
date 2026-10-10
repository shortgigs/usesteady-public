/**
 * Reminder presentation module — Phase 5, Present Layer.
 *
 * Public exports for the reminder presentation slice.
 *
 * Usage:
 *   import { presentReminder, renderReminder } from "./reminders/index.js";
 *
 *   const presentation = presentReminder(rawInput);
 *   if (presentation) {
 *     const rendered = renderReminder(presentation);
 *     // render rendered.headline, rendered.body, rendered.prompt, rendered.actions_label
 *   }
 *
 * extractReminderCandidate is NOT exported here.
 * It is exported directly from reminder-presenter.ts for testing purposes only.
 */

// Types
export type {
  ReminderPresentationState,
  ReminderConfidence,
  PresentAction,
  ReminderPresentation,
} from "./reminder-types.js";

// RenderedReminder output type
export type { RenderedReminder } from "./reminder-renderer.js";

// Presenter (raw input → structured presentation)
export { presentReminder } from "./reminder-presenter.js";

// Renderer (structured presentation → display strings)
export { renderReminder } from "./reminder-renderer.js";
