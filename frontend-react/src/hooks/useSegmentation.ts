import { useState, useCallback } from 'react';
import type { Segment } from '../types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

function imageFromBase64(b64: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = 'data:image/png;base64,' + b64;
  });
}

export function useSegmentation() {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bitmaps, setBitmaps] = useState<Map<number, ImageBitmap>>(new Map());
  const [selectedObject, setSelectedObject] = useState<Segment | null>(null);

  const reset = useCallback(() => {
    setSegments([]);
    setSelectedIds(new Set());
    setBitmaps(new Map());
    setSelectedObject(null);
  }, []);

  const fetchSegments = useCallback(async (imageBlob: Blob, sensitivity: number): Promise<string> => {
    const fd = new FormData();
    fd.append('image', imageBlob, 'image.png');
    const url = new URL(`${API_URL}/api/segment`);
    url.searchParams.append('threshold', String(sensitivity));

    const resp = await fetch(url.toString(), { method: 'POST', body: fd });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();

    const newSegments: Segment[] = data.objects || [];
    const newBitmaps = new Map<number, ImageBitmap>();
    for (const obj of newSegments) {
      const img = await imageFromBase64(obj.mask_b64);
      const bmp = await createImageBitmap(img);
      newBitmaps.set(Number(obj.id), bmp);
    }

    setSegments(newSegments);
    setBitmaps(newBitmaps);
    setSelectedIds(new Set());
    setSelectedObject(null);

    return newSegments.length ? 'Segmentation complete. Click objects to select.' : 'No objects found.';
  }, []);

  const toggleSelect = useCallback((obj: Segment) => {
    const id = Number(obj.id);
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        setSelectedObject(null);
      } else {
        next.add(id);
        setSelectedObject(obj);
      }
      return next;
    });
  }, []);

  const renameSegment = useCallback((id: number, newLabel: string) => {
    setSegments(prev => prev.map(s => Number(s.id) === id ? { ...s, label: newLabel } : s));
    setSelectedObject(prev => prev && Number(prev.id) === id ? { ...prev, label: newLabel } : prev);
  }, []);

  const deleteSegment = useCallback((id: number) => {
    setSegments(prev => prev.filter(s => Number(s.id) !== id));
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setBitmaps(prev => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
    setSelectedObject(null);
  }, []);

  return {
    segments, setSegments,
    selectedIds, bitmaps,
    selectedObject, setSelectedObject,
    reset, fetchSegments,
    toggleSelect, renameSegment, deleteSegment,
  };
}
