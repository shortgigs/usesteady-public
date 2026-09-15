/** Single-task gate workflow spec for Slice 1 — one approval, one filesystem action. */

export function buildGateWorkflowSpec(workflowName: string): {
  readonly name: string;
  readonly defaultRuntime: "cursor";
  readonly maxRetries: 0;
  readonly tasks: readonly [
    {
      readonly label: string;
      readonly input: string;
      readonly runtime: "cursor";
    },
  ];
} {
  return {
    name: workflowName,
    defaultRuntime: "cursor",
    maxRetries: 0,
    tasks: [
      {
        label: "gate staging dir",
        input: "mkdir integration-v1/staging",
        runtime: "cursor",
      },
    ],
  };
}
