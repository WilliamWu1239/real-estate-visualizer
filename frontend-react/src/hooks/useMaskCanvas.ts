import { useRef, useState, useCallback, useEffect } from 'react';
import type { DrawMode, UndoState } from '../types';

const MAX_UNDO = 20;

export function useMaskCanvas() {
  const imageCanvasRef = useRef<HTMLCanvasElement>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const baseMaskCanvasRef = useRef<HTMLCanvasElement>(null);
  const addMaskCanvasRef = useRef<HTMLCanvasElement>(null);
  const subMaskCanvasRef = useRef<HTMLCanvasElement>(null);
  const finalMaskCanvasRef = useRef<HTMLCanvasElement>(null);

  const [mode, setMode] = useState<DrawMode>('paint');
  const [brushSize, setBrushSize] = useState(28);

  const drawingRef = useRef(false);
  const lastXRef = useRef(0);
  const lastYRef = useRef(0);
  const undoStackRef = useRef<UndoState[]>([]);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const updateFinalMask = useCallback(() => {
    const finalCanvas = finalMaskCanvasRef.current;
    const baseCanvas = baseMaskCanvasRef.current;
    const addCanvas = addMaskCanvasRef.current;
    const subCanvas = subMaskCanvasRef.current;
    const maskCanvas = maskCanvasRef.current;
    if (!finalCanvas || !baseCanvas || !addCanvas || !subCanvas || !maskCanvas) return;

    const finalCtx = finalCanvas.getContext('2d')!;
    const maskCtx = maskCanvas.getContext('2d')!;
    const w = finalCanvas.width;
    const h = finalCanvas.height;

    finalCtx.clearRect(0, 0, w, h);
    finalCtx.globalCompositeOperation = 'source-over';
    finalCtx.drawImage(baseCanvas, 0, 0);
    finalCtx.drawImage(addCanvas, 0, 0);
    finalCtx.globalCompositeOperation = 'destination-out';
    finalCtx.drawImage(subCanvas, 0, 0);
    finalCtx.globalCompositeOperation = 'source-over';

    maskCtx.clearRect(0, 0, w, h);
    maskCtx.drawImage(finalCanvas, 0, 0);
  }, []);

  const resetAllMasks = useCallback(() => {
    const imageCanvas = imageCanvasRef.current;
    if (!imageCanvas) return;
    const w = imageCanvas.width;
    const h = imageCanvas.height;

    [baseMaskCanvasRef, addMaskCanvasRef, subMaskCanvasRef, finalMaskCanvasRef].forEach(ref => {
      const canvas = ref.current;
      if (canvas) canvas.getContext('2d')!.clearRect(0, 0, w, h);
    });

    maskCanvasRef.current?.getContext('2d')!.clearRect(0, 0, w, h);
    updateFinalMask();
  }, [updateFinalMask]);

  const loadImageFromUrl = useCallback((url: string) => {
    const image = new Image();
    image.onload = () => {
      const maxW = 1100, maxH = 800;
      let w = image.width, h = image.height;
      const scale = Math.min(maxW / w, maxH / h, 1);
      w = Math.round(w * scale);
      h = Math.round(h * scale);

      const canvases = [
        imageCanvasRef, maskCanvasRef, overlayCanvasRef,
        baseMaskCanvasRef, addMaskCanvasRef, subMaskCanvasRef, finalMaskCanvasRef
      ];
      canvases.forEach(ref => {
        if (ref.current) { ref.current.width = w; ref.current.height = h; }
      });

      if (maskCanvasRef.current) maskCanvasRef.current.style.opacity = '0.7';
      imageCanvasRef.current?.getContext('2d')!.drawImage(image, 0, 0, w, h);
      resetAllMasks();
      overlayCanvasRef.current?.getContext('2d')!.clearRect(0, 0, w, h);
      undoStackRef.current = [];
      imgRef.current = image;
    };
    image.src = url;
  }, [resetAllMasks]);

  const loadImage = useCallback((file: File) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const maxW = 1100, maxH = 800;
      let w = image.width, h = image.height;
      const scale = Math.min(maxW / w, maxH / h, 1);
      w = Math.round(w * scale);
      h = Math.round(h * scale);

      const canvases = [
        imageCanvasRef, maskCanvasRef, overlayCanvasRef,
        baseMaskCanvasRef, addMaskCanvasRef, subMaskCanvasRef, finalMaskCanvasRef
      ];
      canvases.forEach(ref => {
        if (ref.current) {
          ref.current.width = w;
          ref.current.height = h;
        }
      });

      if (maskCanvasRef.current) maskCanvasRef.current.style.opacity = '0.7';

      imageCanvasRef.current?.getContext('2d')!.drawImage(image, 0, 0, w, h);
      resetAllMasks();
      overlayCanvasRef.current?.getContext('2d')!.clearRect(0, 0, w, h);
      undoStackRef.current = [];
      imgRef.current = image;
    };
    image.src = url;
  }, [resetAllMasks]);

  const getMousePos = useCallback((e: MouseEvent | React.MouseEvent) => {
    const canvas = maskCanvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: Math.round((e.clientX - rect.left) * (canvas.width / rect.width)),
      y: Math.round((e.clientY - rect.top) * (canvas.height / rect.height)),
    };
  }, []);

  const pushUndo = useCallback(() => {
    const addCanvas = addMaskCanvasRef.current;
    const subCanvas = subMaskCanvasRef.current;
    if (!addCanvas || !subCanvas) return;

    const stack = undoStackRef.current;
    if (stack.length >= MAX_UNDO) stack.shift();
    stack.push({
      add: addCanvas.getContext('2d')!.getImageData(0, 0, addCanvas.width, addCanvas.height),
      sub: subCanvas.getContext('2d')!.getImageData(0, 0, subCanvas.width, subCanvas.height),
    });
  }, []);

  const undo = useCallback(() => {
    const stack = undoStackRef.current;
    if (stack.length === 0) return;
    const state = stack.pop()!;
    addMaskCanvasRef.current?.getContext('2d')!.putImageData(state.add, 0, 0);
    subMaskCanvasRef.current?.getContext('2d')!.putImageData(state.sub, 0, 0);
    updateFinalMask();
  }, [updateFinalMask]);

  const drawStroke = useCallback((e: MouseEvent | React.MouseEvent, currentMode: DrawMode, currentBrushSize: number) => {
    if (!drawingRef.current) return;
    const { x, y } = getMousePos(e);

    const targetCtx = (currentMode === 'paint')
      ? addMaskCanvasRef.current?.getContext('2d')
      : subMaskCanvasRef.current?.getContext('2d');
    const oppositeCtx = (currentMode === 'paint')
      ? subMaskCanvasRef.current?.getContext('2d')
      : addMaskCanvasRef.current?.getContext('2d');
    if (!targetCtx || !oppositeCtx) return;

    const applyStroke = (ctx: CanvasRenderingContext2D, composite: string) => {
      ctx.save();
      ctx.globalCompositeOperation = composite as GlobalCompositeOperation;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.lineWidth = currentBrushSize;
      ctx.strokeStyle = 'white';
      ctx.beginPath();
      ctx.moveTo(lastXRef.current, lastYRef.current);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.restore();
    };

    // Draw on the target canvas
    applyStroke(targetCtx, 'source-over');
    // Erase the same region from the opposite canvas so they don't conflict
    applyStroke(oppositeCtx, 'destination-out');

    lastXRef.current = x;
    lastYRef.current = y;
    updateFinalMask();
  }, [getMousePos, updateFinalMask]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    drawingRef.current = true;
    const { x, y } = getMousePos(e);
    lastXRef.current = x;
    lastYRef.current = y;
    drawStroke(e, mode, brushSize);
  }, [getMousePos, drawStroke, mode, brushSize]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    drawStroke(e, mode, brushSize);
  }, [drawStroke, mode, brushSize]);

  const handleMouseUp = useCallback(() => {
    if (drawingRef.current) {
      drawingRef.current = false;
      pushUndo();
      updateFinalMask();
    }
  }, [pushUndo, updateFinalMask]);

  const rebuildBaseMask = useCallback((selectedIds: Set<number>, bitmaps: Map<number, ImageBitmap>) => {
    const baseCanvas = baseMaskCanvasRef.current;
    if (!baseCanvas) return;
    const ctx = baseCanvas.getContext('2d')!;
    ctx.clearRect(0, 0, baseCanvas.width, baseCanvas.height);
    selectedIds.forEach(id => {
      const bmp = bitmaps.get(id);
      if (bmp) ctx.drawImage(bmp, 0, 0, baseCanvas.width, baseCanvas.height);
    });
    updateFinalMask();
  }, [updateFinalMask]);

  const getFinalMaskBlob = useCallback((): Promise<Blob> => {
    const finalCanvas = finalMaskCanvasRef.current!;
    const temp = document.createElement('canvas');
    temp.width = finalCanvas.width;
    temp.height = finalCanvas.height;
    const ctx = temp.getContext('2d')!;
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, temp.width, temp.height);
    ctx.drawImage(finalCanvas, 0, 0);
    return new Promise(resolve => temp.toBlob(resolve as BlobCallback, 'image/png'));
  }, []);

  const getImageBlob = useCallback((): Promise<Blob> => {
    return new Promise(resolve =>
      imageCanvasRef.current!.toBlob(resolve as BlobCallback, 'image/png')
    );
  }, []);

  const getImageDataUrl = useCallback((): string => {
    return imageCanvasRef.current?.toDataURL('image/png') ?? '';
  }, []);

  const clearOverlay = useCallback(() => {
    const overlay = overlayCanvasRef.current;
    if (overlay) overlay.getContext('2d')!.clearRect(0, 0, overlay.width, overlay.height);
  }, []);

  const getOverlayContext = useCallback(() => overlayCanvasRef.current?.getContext('2d') ?? null, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') undo();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [undo]);

  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (drawingRef.current) {
        drawingRef.current = false;
        pushUndo();
        updateFinalMask();
      }
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, [pushUndo, updateFinalMask]);

  return {
    imageCanvasRef, maskCanvasRef, overlayCanvasRef,
    baseMaskCanvasRef, addMaskCanvasRef, subMaskCanvasRef, finalMaskCanvasRef,
    mode, setMode,
    brushSize, setBrushSize,
    imgRef,
    loadImage, loadImageFromUrl, resetAllMasks, rebuildBaseMask,
    handleMouseDown, handleMouseMove, handleMouseUp,
    getFinalMaskBlob, getImageBlob, getImageDataUrl,
    clearOverlay, getOverlayContext,
  };
}
