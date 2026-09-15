/**
 * Phase 11A-Web → Workspace Shell Baseline S1:
 * App root with routing mounted inside the professional workspace chassis.
 *
 * Navigation has moved from the old thin top-bar (NavBar) to the persistent
 * left sidebar (AppShell → Sidebar). All routes are unchanged.
 */

import { BrowserRouter, Routes, Route, useParams } from "react-router-dom";
import { lazy, Suspense, type ComponentType } from "react";
import { AppShell } from "./components/shell/AppShell.js";
import { WorkflowPage } from "./pages/WorkflowPage.js";
import { HistoryPage }  from "./pages/HistoryPage.js";
import { RunDetailPage } from "./pages/RunDetailPage.js";
import { ExecutionPanel } from "./components/execution/ExecutionPanel.js";
import { ApplyFixPreviewPage } from "./pages/ApplyFixPreviewPage.js";
import { ExecutionsDashboardPage } from "./pages/ExecutionsDashboardPage.js";
import { DecisionHistoryPage } from "./pages/DecisionHistoryPage.js";
import { WorkflowHealthPage } from "./pages/WorkflowHealthPage.js";
import { ReplayInspectionPage } from "./pages/ReplayInspectionPage.js";
import { ReplaySandboxPage } from "./pages/ReplaySandboxPage.js";
import { ReplayExecutionHistoryPage } from "./pages/ReplayExecutionHistoryPage.js";
import { ExecutionTimelineTrustPage } from "./pages/ExecutionTimelineTrustPage.js";
import { CorrelatedTrustPage } from "./pages/CorrelatedTrustPage.js";
import { ExecutionDiagnosticsPage } from "./pages/ExecutionDiagnosticsPage.js";
import { ExecutionGovernancePage } from "./pages/ExecutionGovernancePage.js";
import { GovernedPortalPage } from "./pages/GovernedPortalPage.js";

// AdminPage is GITIGNORED. It is only loaded when VITE_ADMIN=1 is set in a
// local .env.local file (which is also gitignored). In all other builds —
// including the npm publish build — this import never runs and the file is
// never bundled into ui/dist/.
//
// The module path is typed as `string` (not a literal) so the TypeScript
// compiler treats this as a runtime dynamic import and skips module
// resolution. Required because AdminPage.tsx has no committed counterpart
// for `tsc` to type-check against.
const ADMIN_ENABLED = import.meta.env.VITE_ADMIN === "1";
const ADMIN_MODULE_PATH: string = "./pages/AdminPage.js";
const AdminPage = ADMIN_ENABLED
  ? lazy(() =>
      import(ADMIN_MODULE_PATH).then(
        (m: { AdminPage: ComponentType }) => ({ default: m.AdminPage }),
      ),
    )
  : null;

function ExecutionPanelPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  return <ExecutionPanel sessionId={sessionId} />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AppShell>
        <Routes>
          <Route path="/"                          element={<WorkflowPage />} />
          <Route path="/history"                   element={<HistoryPage />}  />
          <Route path="/history/:workflowRunId"     element={<RunDetailPage />} />
          <Route path="/execution/:sessionId"      element={<ExecutionPanelPage />} />
          <Route path="/apply-fix"                 element={<ApplyFixPreviewPage />} />
          <Route path="/dashboard/executions"     element={<ExecutionsDashboardPage />} />
          <Route
            path="/dashboard/executions/:job_id/history"
            element={<DecisionHistoryPage />}
          />
          <Route
            path="/dashboard/executions/health"
            element={<WorkflowHealthPage />}
          />
          <Route
            path="/dashboard/executions/diagnostics"
            element={<ExecutionDiagnosticsPage />}
          />
          <Route
            path="/dashboard/executions/governance"
            element={<ExecutionGovernancePage />}
          />
          <Route path="/governed" element={<GovernedPortalPage />} />
          <Route
            path="/dashboard/executions/:job_id/inspect"
            element={<ReplayInspectionPage />}
          />
          <Route
            path="/dashboard/executions/:job_id/replay-sandbox"
            element={<ReplaySandboxPage />}
          />
          <Route
            path="/dashboard/executions/:job_id/replay-execution-history"
            element={<ReplayExecutionHistoryPage />}
          />
          <Route
            path="/dashboard/executions/:job_id/timeline"
            element={<ExecutionTimelineTrustPage />}
          />
          <Route
            path="/dashboard/executions/:job_id/correlation"
            element={<CorrelatedTrustPage />}
          />
          {ADMIN_ENABLED && AdminPage && (
            <Route path="/admin" element={
              <Suspense fallback={null}><AdminPage /></Suspense>
            } />
          )}
        </Routes>
      </AppShell>
    </BrowserRouter>
  );
}
