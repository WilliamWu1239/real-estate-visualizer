import { useEffect, useState } from 'react';
import type { useMaskCanvas } from '../hooks/useMaskCanvas';
import type { useSegmentation } from '../hooks/useSegmentation';
import type { Segment } from '../types';

interface CanvasPanelProps {
  canvasHook: ReturnType<typeof useMaskCanvas>;
  segHook: ReturnType<typeof useSegmentation>;
  sensitivity: number;
  setSensitivity: (v: number) => void;
  showOverlays: boolean;
  setShowOverlays: (v: boolean) => void;
  onStatus: (msg: string) => void;
  onRemoveObject: () => void;
}

export function CanvasPanel({
  canvasHook, segHook, sensitivity, setSensitivity,
  showOverlays, setShowOverlays, onStatus, onRemoveObject,
}: CanvasPanelProps) {
  const {
    imageCanvasRef, maskCanvasRef, overlayCanvasRef,
    baseMaskCanvasRef, addMaskCanvasRef, subMaskCanvasRef, finalMaskCanvasRef,
    mode, setMode, brushSize, setBrushSize,
    imgRef, loadImage, resetAllMasks, rebuildBaseMask,
    handleMouseDown, handleMouseMove, handleMouseUp,
    getImageBlob, clearOverlay, getOverlayContext,
  } = canvasHook;

  const { segments, selectedIds, bitmaps, selectedObject, fetchSegments, toggleSelect, renameSegment, deleteSegment, reset: resetSeg } = segHook;
  const [renameValue, setRenameValue] = useState('');

  // Sync rebuildBaseMask whenever selection changes
  useEffect(() => {
    rebuildBaseMask(selectedIds, bitmaps);
  }, [selectedIds, bitmaps, rebuildBaseMask]);

  // Render segment overlays
  useEffect(() => {
    const overlayCtx = getOverlayContext();
    if (!overlayCtx) return;
    const overlayCanvas = overlayCanvasRef.current;
    if (!overlayCanvas) return;

    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    if (!showOverlays) return;

    const renders = segments.map(async (obj: Segment) => {
      const isSelected = selectedIds.has(Number(obj.id));
      const [x, y, w, h] = obj.bbox;
      overlayCtx.save();
      if (isSelected) {
        const img = new Image();
        await new Promise<void>((res) => {
          img.onload = () => res();
          img.src = 'data:image/png;base64,' + obj.mask_b64;
        });
        overlayCtx.globalAlpha = 0.25;
        overlayCtx.drawImage(img, 0, 0, overlayCanvas.width, overlayCanvas.height);
        overlayCtx.globalAlpha = 1.0;
        overlayCtx.lineWidth = 3;
        overlayCtx.strokeStyle = 'yellow';
        overlayCtx.strokeRect(x, y, w, h);
      } else {
        overlayCtx.lineWidth = 1;
        overlayCtx.strokeStyle = 'rgba(255, 0, 0, 0.4)';
        overlayCtx.strokeRect(x, y, w, h);
      }
      overlayCtx.restore();
    });
    Promise.all(renders);
  }, [segments, selectedIds, showOverlays, getOverlayContext, overlayCanvasRef]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    loadImage(file);
    resetSeg();
    clearOverlay();
  };

  const handleSegment = async () => {
    if (!imgRef.current) { alert('Upload an image first'); return; }
    onStatus('Segmenting objects...');
    try {
      const blob = await getImageBlob();
      const msg = await fetchSegments(blob, sensitivity);
      resetAllMasks();
      onStatus(msg);
    } catch {
      onStatus('Segmentation failed.');
    }
  };

  const handleToggleSelect = (obj: Segment) => {
    toggleSelect(obj);
    onStatus(selectedIds.has(Number(obj.id)) ? `Deselected ${obj.label}` : `Selected ${obj.label}`);
  };

  return (
    <section className="bg-[#151822] border border-[#232632] rounded-2xl p-4 shadow-lg">
      <h2 className="text-lg font-semibold mt-0 mb-3">1) Upload</h2>

      <input
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="mb-3 text-sm text-gray-300 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-[#1b1f2b] file:text-gray-200 file:cursor-pointer hover:file:brightness-110"
      />

      {/* Canvas Stack */}
      <div className="relative inline-block rounded-xl overflow-hidden border border-dashed border-[#2b2f3a] bg-[#0b0d11]">
        <canvas ref={imageCanvasRef} className="block max-w-full h-auto" />
        <canvas
          ref={maskCanvasRef}
          className="absolute left-0 top-0 block max-w-full h-auto"
          style={{ opacity: 0.7 }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
        />
        <canvas
          ref={overlayCanvasRef}
          className="absolute left-0 top-0 block max-w-full h-auto pointer-events-none"
        />
        {/* Hidden mask stack */}
        <canvas ref={baseMaskCanvasRef} className="hidden" />
        <canvas ref={addMaskCanvasRef} className="hidden" />
        <canvas ref={subMaskCanvasRef} className="hidden" />
        <canvas ref={finalMaskCanvasRef} className="hidden" />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap gap-2.5 items-center mt-3">
        <label className="text-sm text-gray-300">
          Brush:
          <input
            type="range" min={5} max={80} value={brushSize}
            onChange={e => setBrushSize(Number(e.target.value))}
            className="ml-2 align-middle w-20"
          />
        </label>

        <button
          onClick={() => setMode('paint')}
          className={`px-3 py-1.5 rounded-lg border cursor-pointer transition-all ${mode === 'paint' ? 'bg-[#5865f2] border-[#5865f2] text-white' : 'bg-[#1b1f2b] border-[#2a2f3a] text-gray-200 hover:brightness-110'}`}
        >
          Paint
        </button>
        <button
          onClick={() => setMode('erase')}
          className={`px-3 py-1.5 rounded-lg border cursor-pointer transition-all ${mode === 'erase' ? 'bg-[#5865f2] border-[#5865f2] text-white' : 'bg-[#1b1f2b] border-[#2a2f3a] text-gray-200 hover:brightness-110'}`}
        >
          Erase
        </button>
        <button
          onClick={() => { resetAllMasks(); resetSeg(); clearOverlay(); }}
          className="px-3 py-1.5 rounded-lg bg-[#1b1f2b] border border-[#2a2f3a] text-gray-200 cursor-pointer hover:brightness-110"
        >
          Clear Mask
        </button>

        <button
          onClick={handleSegment}
          className="px-3 py-1.5 rounded-lg bg-[#1b1f2b] border border-[#2a2f3a] text-gray-200 cursor-pointer hover:brightness-110"
        >
          Select Objects
        </button>

        <label className="text-sm text-gray-300 flex items-center gap-1">
          <input
            type="range" min={0.1} max={0.9} step={0.05} value={sensitivity}
            onChange={e => setSensitivity(Number(e.target.value))}
            className="w-14 align-middle"
          />
          <span className="text-xs">Sens.</span>
        </label>

        <label className="text-sm text-gray-300 flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={showOverlays}
            onChange={e => setShowOverlays(e.target.checked)}
          />
          Show Overlays
        </label>

        <span className="text-xs text-[#9aa0a6]">White = edit region</span>
      </div>

      {/* Object list */}
      {segments.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {segments.map(obj => {
            const isSel = selectedIds.has(Number(obj.id));
            return (
              <button
                key={obj.id}
                onClick={() => handleToggleSelect(obj)}
                className={`px-2.5 py-1 rounded-lg text-sm cursor-pointer transition-all border ${isSel ? 'bg-[#444] border-yellow-400 text-yellow-300' : 'bg-[#1b1f2b] border-[#2a2f3a] text-gray-200 hover:brightness-110'}`}
              >
                {isSel ? '☑ ' : '☐ '}{obj.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Object actions (for selected object) */}
      {selectedObject && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            onClick={onRemoveObject}
            className="px-2.5 py-1 rounded-lg bg-amber-900 border border-amber-700 text-amber-200 text-sm cursor-pointer hover:brightness-110 font-medium"
          >
            Remove Object
          </button>
          <input
            type="text"
            value={renameValue || selectedObject.label}
            onChange={e => setRenameValue(e.target.value)}
            className="bg-[#0f121a] border border-[#2a2f3a] rounded-lg text-gray-200 px-2 py-1 text-sm w-32"
            placeholder="New name"
          />
          <button
            onClick={() => { renameSegment(Number(selectedObject.id), renameValue || selectedObject.label); setRenameValue(''); }}
            className="px-2.5 py-1 rounded-lg bg-[#1b1f2b] border border-[#2a2f3a] text-gray-200 text-sm cursor-pointer hover:brightness-110"
          >
            Rename
          </button>
          <button
            onClick={() => deleteSegment(Number(selectedObject.id))}
            className="px-2.5 py-1 rounded-lg bg-red-900 border border-red-700 text-red-200 text-sm cursor-pointer hover:brightness-110"
          >
            Delete
          </button>
        </div>
      )}
    </section>
  );
}
