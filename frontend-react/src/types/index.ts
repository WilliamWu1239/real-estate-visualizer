export interface Segment {
  id: number;
  label: string;
  bbox: [number, number, number, number];
  mask_b64: string;
}

export interface UndoState {
  add: ImageData;
  sub: ImageData;
}

export type DrawMode = 'paint' | 'erase';

export interface GenerationParams {
  prompt: string;
  negativePrompt: string;
  steps: number;
  guidance: number;
  strength: number;
  seed: string;
}

export interface GenerationProgress {
  step: number;
  total: number;
}
