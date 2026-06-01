export const OMP_CHANNELS = {
  Activate: 'omp:activate',
  Deactivate: 'omp:deactivate',
  RequestDeactivate: 'omp:deactivate:request',
  RendererReady: 'omp:renderer:ready',
  Cursor: 'omp:cursor',
  GlobalContextMenu: 'omp:global-context-menu',
  GlobalMouseDown: 'omp:global-mouse-down',
  HoldProgress: 'omp:hold:progress',
  SetInteractive: 'omp:overlay:set-interactive',
  RequestWindowContext: 'omp:window-context:request',
  RequestGrounding: 'omp:grounding:request',
  CaptureActivity: 'omp:capture:activity',
  SubmitInstruction: 'omp:agent:submit',
  AgentEvent: 'omp:agent:event',
  ApproveAgentRequest: 'omp:agent:approve',
  CancelRun: 'omp:agent:cancel',
  GetSettings: 'omp:settings:get',
  SaveSettings: 'omp:settings:save',
  GetConversations: 'omp:history:list',
  GetConversation: 'omp:history:get',
  DeleteConversation: 'omp:history:delete',
  FetchVisionModels: 'omp:models:fetch-vision'
} as const;

export type OmpChannel = (typeof OMP_CHANNELS)[keyof typeof OMP_CHANNELS];
