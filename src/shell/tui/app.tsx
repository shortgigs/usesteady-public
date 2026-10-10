/**
 * TUI v1 — Ink entry point.
 *
 * Renders the WorkflowView to stderr so it does not collide with
 * the existing stdout output from the CLI loop.
 */

import React           from "react";
import { render }      from "ink";
import { WorkflowView } from "./components/WorkflowView.js";

render(<WorkflowView />, { stdout: process.stderr });
