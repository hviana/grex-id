/** Human.js facade types consumed by FacialBiometricsSubform. */

export type HumanFace = { faceScore?: number; embedding?: ArrayLike<number> };
export type HumanResult = { face: HumanFace[] };

export type HumanInstance = {
  load: () => Promise<void>;
  warmup: () => Promise<void>;
  detect: (input: HTMLVideoElement | HTMLCanvasElement) => Promise<HumanResult>;
};

declare global {
  interface Window {
    Human?: {
      Human: { new (config?: Record<string, unknown>): HumanInstance };
    };
    __humanScriptPromise?: Promise<void>;
  }
}
