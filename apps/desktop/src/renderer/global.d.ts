import type { DesktopApi } from '../shared/types';

declare global {
  interface Window {
    openMagicPointer: DesktopApi;
    webkitSpeechRecognition?: unknown;
    SpeechRecognition?: unknown;
  }
}

declare module '*.svg?raw' {
  const value: string;
  export default value;
}

export {};
