export type VoiceState = 'idle' | 'listening' | 'transcribing' | 'resolving' | 'responding' | 'error';

export function nextVoiceState(state: VoiceState, event: 'listen' | 'audio' | 'transcribed' | 'resolved' | 'done' | 'fail' | 'cancel'): VoiceState {
  if (event === 'cancel') return 'idle';
  if (event === 'fail') return 'error';
  switch (state) {
    case 'idle':
      return event === 'listen' ? 'listening' : state;
    case 'listening':
      return event === 'audio' ? 'transcribing' : state;
    case 'transcribing':
      return event === 'transcribed' ? 'resolving' : state;
    case 'resolving':
      return event === 'resolved' ? 'responding' : state;
    case 'responding':
      return event === 'done' ? 'idle' : state;
    case 'error':
      return event === 'done' ? 'idle' : state;
  }
}
