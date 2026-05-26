export declare const OMP_CHANNELS: {
    readonly Activate: "omp:activate";
    readonly Deactivate: "omp:deactivate";
    readonly Cursor: "omp:cursor";
    readonly SetInteractive: "omp:overlay:set-interactive";
    readonly BuildContext: "omp:context:build";
    readonly Query: "omp:llm:query";
    readonly CreatePlan: "omp:plan:create";
    readonly ExecutePlan: "omp:plan:execute";
    readonly GetSettings: "omp:settings:get";
    readonly SaveSettings: "omp:settings:save";
};
export type OmpChannel = (typeof OMP_CHANNELS)[keyof typeof OMP_CHANNELS];
//# sourceMappingURL=ipc.d.ts.map