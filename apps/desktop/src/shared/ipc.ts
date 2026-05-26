export const OMP_CHANNELS = {
  Activate: 'omp:activate',
  Deactivate: 'omp:deactivate',
  RequestDeactivate: 'omp:deactivate:request',
  RendererReady: 'omp:renderer:ready',
  Cursor: 'omp:cursor',
  SetInteractive: 'omp:overlay:set-interactive',
  BuildContext: 'omp:context:build',
  Query: 'omp:llm:query',
  CreatePlan: 'omp:plan:create',
  ExecutePlan: 'omp:plan:execute',
  GetSettings: 'omp:settings:get',
  SaveSettings: 'omp:settings:save'
} as const;

export type OmpChannel = (typeof OMP_CHANNELS)[keyof typeof OMP_CHANNELS];
