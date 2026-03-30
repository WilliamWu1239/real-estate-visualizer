import { useState } from 'react';
import { useMaskCanvas } from './hooks/useMaskCanvas';
import { useSegmentation } from './hooks/useSegmentation';
import { CanvasPanel } from './components/CanvasPanel';
import { PromptPanel } from './components/PromptPanel';
import { ResultPanel } from './components/ResultPanel';
import type { GenerationParams, GenerationProgress } from './types';

const DEFAULT_PARAMS: GenerationParams = {
  prompt: '',
  negativePrompt: 'blurry, low quality, distorted, watermark, text',
  steps: 35,
  guidance: 7.5,
  strength: 0.65,
  seed: '',
};

const REMOVAL_PROMPT =
  'photorealistic interior, seamless background fill, match surrounding floor walls and surfaces, no objects, clean empty space';

function base64ToObjectUrl(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
}

async function callGenerateApi(
  imageBlob: Blob,
  maskBlob: Blob,
  params: GenerationParams,
  onProgress: (p: GenerationProgress) => void,
): Promise<string> {
  const fd = new FormData();
  fd.append('image', imageBlob, 'image.png');
  fd.append('mask', maskBlob, 'mask.png');
  fd.append('prompt', params.prompt);
  fd.append('negative_prompt', params.negativePrompt);
  fd.append('num_inference_steps', String(params.steps));
  fd.append('guidance_scale', String(params.guidance));
  fd.append('strength', String(params.strength));
  if (params.seed) fd.append('seed', String(params.seed));

  const resp = await fetch('http://localhost:8000/api/edit', { method: 'POST', body: fd });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error || `HTTP ${resp.status}`);
  }

  const reader = resp.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = JSON.parse(line.slice(6)) as {
        step?: number; total?: number; done?: boolean; image?: string; error?: string;
      };
      if (data.error) throw new Error(data.error);
      if (data.done && data.image) return base64ToObjectUrl(data.image);
      if (data.step !== undefined && data.total !== undefined) {
        onProgress({ step: data.step, total: data.total });
      }
    }
  }

  throw new Error('Stream ended without a result');
}

export default function App() {
  const canvasHook = useMaskCanvas();
  const segHook = useSegmentation();

  const [params, setParams] = useState<GenerationParams>(DEFAULT_PARAMS);
  const [sensitivity, setSensitivity] = useState(0.55);
  const [showOverlays, setShowOverlays] = useState(true);
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState<GenerationProgress | null>(null);
  const [resultUrl, setResultUrl] = useState('');
  const [beforeUrl, setBeforeUrl] = useState('');

  const handleParamChange = (partial: Partial<GenerationParams>) => {
    setParams(prev => ({ ...prev, ...partial }));
  };

  async function runGenerate(overrideParams?: Partial<GenerationParams>, statusMsg = 'Generating...') {
    if (!canvasHook.imgRef.current) {
      alert('Please upload an image first.');
      return;
    }
    const mergedParams = { ...params, ...overrideParams };
    setStatus(statusMsg + ' (first run may download the model)');
    setProgress(null);
    setResultUrl('');
    setBeforeUrl(canvasHook.getImageDataUrl());

    try {
      const [maskBlob, imageBlob] = await Promise.all([
        canvasHook.getFinalMaskBlob(),
        canvasHook.getImageBlob(),
      ]);
      const url = await callGenerateApi(imageBlob, maskBlob, mergedParams, setProgress);
      setResultUrl(url);
      setStatus('Done.');
    } catch (e) {
      setStatus('Error: ' + (e as Error).message);
    } finally {
      setProgress(null);
    }
  }

  const handleGenerate = () => runGenerate();

  const handleRemoveObject = () =>
    runGenerate({ prompt: REMOVAL_PROMPT, strength: 0.95 }, 'Removing object...');

  const handleUseAsBase = () => {
    if (!resultUrl) return;
    canvasHook.loadImageFromUrl(resultUrl);
    segHook.reset();
    canvasHook.clearOverlay();
    setResultUrl('');
    setBeforeUrl('');
    setStatus('Result loaded as new base. Continue editing.');
  };

  return (
    <div className="min-h-screen bg-[#0f1115] text-[#e6e6e6] font-sans">
      <header className="px-5 py-6 border-b border-[#232632] bg-[#0b0d11]">
        <h1 className="m-0 mb-1 text-2xl font-semibold">Real-Estate Image Customizer</h1>
        <p className="m-0 text-[#a8acb3]">
          Upload a photo, paint areas to change, describe your modification, and generate a preview.
        </p>
      </header>

      <main className="grid grid-cols-3 gap-4 p-4 max-[1100px]:grid-cols-1">
        <CanvasPanel
          canvasHook={canvasHook}
          segHook={segHook}
          sensitivity={sensitivity}
          setSensitivity={setSensitivity}
          showOverlays={showOverlays}
          setShowOverlays={setShowOverlays}
          onStatus={setStatus}
          onRemoveObject={handleRemoveObject}
        />
        <PromptPanel
          params={params}
          onChange={handleParamChange}
          onGenerate={handleGenerate}
          status={status}
          progress={progress}
        />
        <ResultPanel
          resultUrl={resultUrl}
          beforeUrl={beforeUrl}
          onUseAsBase={handleUseAsBase}
        />
      </main>

      <footer className="px-4 py-4 text-[#9aa0a6] border-t border-[#232632] text-center text-sm">
        For visualization only; consult professionals for feasibility and structural safety.
      </footer>
    </div>
  );
}
