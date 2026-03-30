import { useState } from 'react';

interface ResultPanelProps {
  resultUrl: string;
  beforeUrl: string;
  onUseAsBase: () => void;
}

export function ResultPanel({ resultUrl, beforeUrl, onUseAsBase }: ResultPanelProps) {
  const [sliderPos, setSliderPos] = useState(50);
  const showSlider = !!(beforeUrl && resultUrl);

  const handleDownload = () => {
    const a = document.createElement('a');
    a.href = resultUrl;
    a.download = 'result.png';
    a.click();
  };

  return (
    <section className="bg-[#151822] border border-[#232632] rounded-2xl p-4 shadow-lg">
      <h2 className="text-lg font-semibold mt-0 mb-3">3) Result</h2>

      <div className="min-h-[200px] flex items-center justify-center bg-[#0b0d11] border border-dashed border-[#2b2f3a] rounded-xl p-2 mb-3 overflow-hidden">
        {showSlider ? (
          <div className="relative w-full select-none" style={{ cursor: 'col-resize' }}>
            {/* Before (base layer) */}
            <img src={beforeUrl} alt="Before" className="block w-full rounded-lg" draggable={false} />

            {/* After (clipped overlay) */}
            <div
              className="absolute inset-0 overflow-hidden rounded-lg"
              style={{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }}
            >
              <img src={resultUrl} alt="After" className="block w-full" draggable={false} />
            </div>

            {/* Divider line */}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-white shadow-[0_0_6px_rgba(0,0,0,0.8)] pointer-events-none"
              style={{ left: `${sliderPos}%` }}
            >
              {/* Handle */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-7 h-7 rounded-full bg-white shadow-md flex items-center justify-center">
                <span className="text-[#0f1115] text-xs font-bold select-none">⇔</span>
              </div>
            </div>

            {/* Labels */}
            <span className="absolute top-2 left-2 text-xs bg-black/60 text-white px-1.5 py-0.5 rounded pointer-events-none">Before</span>
            <span className="absolute top-2 right-2 text-xs bg-black/60 text-white px-1.5 py-0.5 rounded pointer-events-none">After</span>

            {/* Invisible range input for drag interaction */}
            <input
              type="range" min={0} max={100} value={sliderPos}
              onChange={e => setSliderPos(Number(e.target.value))}
              className="absolute inset-0 w-full h-full opacity-0 cursor-col-resize"
            />
          </div>
        ) : resultUrl ? (
          <img src={resultUrl} alt="Generated result" className="max-w-full rounded-lg" />
        ) : (
          <p className="text-sm text-gray-500">Result will appear here</p>
        )}
      </div>

      <div className="flex gap-2 flex-wrap">
        <button
          onClick={handleDownload}
          disabled={!resultUrl}
          className="px-3 py-2 rounded-lg bg-[#1b1f2b] border border-[#2a2f3a] text-gray-200 cursor-pointer hover:brightness-110 active:translate-y-px disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Download PNG
        </button>
        <button
          onClick={onUseAsBase}
          disabled={!resultUrl}
          className="px-3 py-2 rounded-lg bg-[#5865f2] border border-[#5865f2] text-white font-medium cursor-pointer hover:brightness-110 active:translate-y-px disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Use as Base →
        </button>
      </div>
    </section>
  );
}
