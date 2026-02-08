export {};

declare global {
  interface Window {
    electronAPI?: {
      onBackendPort: (callback: (port: number) => void) => void;
      platform: NodeJS.Platform;
    };
  }
}
