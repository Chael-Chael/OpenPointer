import type { DesktopApi } from '../shared/types';

declare global {
  interface Window {
    openMagicPointer: DesktopApi;
    webkitSpeechRecognition?: unknown;
    SpeechRecognition?: unknown;
  }
}

export {};
