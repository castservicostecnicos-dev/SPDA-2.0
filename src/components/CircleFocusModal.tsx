import React, { useState, useRef, useEffect } from 'react';
import { PhotoSlot } from '../types/spda';
import { Move, Check, RotateCcw, X, ZoomIn, Target } from 'lucide-react';

interface CircleFocusModalProps {
  photo: PhotoSlot;
  photoIndex: number;
  isOpen: boolean;
  type?: 'spda' | 'quadros' | 'medicao';
  onClose: () => void;
  onSave: (updated: Partial<PhotoSlot>) => void;
}

export const CircleFocusModal: React.FC<CircleFocusModalProps> = ({
  photo,
  photoIndex,
  isOpen,
  type = 'spda',
  onClose,
  onSave,
}) => {
  const [posX, setPosX] = useState<number>(photo.circleX ?? 50);
  const [posY, setPosY] = useState<number>(photo.circleY ?? 50);
  const [radius, setRadius] = useState<number>(photo.circleRadius ?? 24);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPosX(photo.circleX ?? 50);
    setPosY(photo.circleY ?? 50);
    setRadius(photo.circleRadius ?? 24);
  }, [photo, isOpen]);

  if (!isOpen) return null;

  // Handle clicking or dragging on the image area to place the circle
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
    updateCoordsFromEvent(e);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    e.preventDefault();
    updateCoordsFromEvent(e);
  };

  const handlePointerUp = () => {
    setIsDragging(false);
  };

  const updateCoordsFromEvent = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const clientX = e.clientX;
    const clientY = e.clientY;

    const rawX = ((clientX - rect.left) / rect.width) * 100;
    const rawY = ((clientY - rect.top) / rect.height) * 100;

    // Clamp between 5% and 95%
    const clampedX = Math.round(Math.max(5, Math.min(95, rawX)));
    const clampedY = Math.round(Math.max(5, Math.min(95, rawY)));

    setPosX(clampedX);
    setPosY(clampedY);
  };

  const handleSaveAndClose = () => {
    onSave({
      hasRedCircleMarker: true,
      circleX: posX,
      circleY: posY,
      circleRadius: radius,
    });
    onClose();
  };

  const handleResetCenter = () => {
    setPosX(50);
    setPosY(50);
    setRadius(24);
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 overflow-y-auto"
      onPointerUp={handlePointerUp}
    >
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden flex flex-col border border-slate-300 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="bg-slate-900 text-white px-5 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-red-600 flex items-center justify-center text-white">
              <Target className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-sm tracking-wide uppercase">
                POSICIONAR CÍRCULO DE DESTAQUE (FOTO #{photoIndex + 1})
              </h3>
              <p className="text-[11px] text-slate-300">
                Arraste ou toque na foto para focar o ponto com inconformidade ou atenção
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            title="FECHAR"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Interactive Image Area */}
        <div className="p-4 sm:p-6 flex flex-col items-center justify-center bg-slate-100">
          <div className="w-full flex justify-between items-center mb-2 px-1 text-xs">
            <span className="font-semibold text-slate-700 flex items-center gap-1.5">
              <Move className="w-3.5 h-3.5 text-red-600" />
              <span>CLIQUE OU ARRASTE SOBRE O DEFEITO DA FOTO:</span>
            </span>
            <span className="font-mono text-slate-600 bg-white px-2 py-0.5 rounded border border-slate-300 text-[11px]">
              X: {posX}% | Y: {posY}%
            </span>
          </div>

          {/* Draggable container with EXACT document aspect ratio */}
          <div
            ref={containerRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            className={`relative max-w-full h-[52vh] rounded-xl overflow-hidden shadow-lg border-2 border-slate-300 bg-slate-900 cursor-crosshair select-none touch-none ${
              type === 'quadros' ? 'aspect-[38.5/42]' : 'aspect-[38.5/48]'
            }`}
          >
            <img
              src={photo.url}
              alt={photo.caption || 'Foto em edição'}
              className="w-full h-full object-cover pointer-events-none select-none block"
              draggable={false}
            />

            {/* Red highlight circle (strictly bounded inside container by overflow-hidden) */}
            <div
              className="absolute pointer-events-none transition-transform"
              style={{
                left: `${posX}%`,
                top: `${posY}%`,
                transform: 'translate(-50%, -50%)',
                width: `${radius * 2.2}%`,
                height: `${radius * 1.8}%`,
              }}
            >
              <div className="w-full h-full border-2 border-red-600 rounded-full shadow-[0_0_6px_rgba(239,68,68,0.9)] flex items-center justify-center">
                <div className="w-1.5 h-1.5 bg-red-600 rounded-full opacity-80" />
              </div>
            </div>

            {/* Target overlay guide on drag */}
            {isDragging && (
              <div
                className="absolute w-6 h-6 border-2 border-white rounded-full pointer-events-none -translate-x-1/2 -translate-y-1/2 shadow-md"
                style={{ left: `${posX}%`, top: `${posY}%` }}
              />
            )}
          </div>

          <p className="text-[11px] text-slate-500 mt-2 text-center">
            {photo.caption ? `"${photo.caption}"` : 'Foto da inspeção'} — Posicione o círculo sobre parafusos oxidados, falta de DPS, captores, etc.
          </p>
        </div>

        {/* Size and Quick presets controls */}
        <div className="p-4 sm:p-5 bg-white border-t border-slate-200 space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
            <div className="w-full sm:w-1/2 space-y-1">
              <div className="flex justify-between text-xs font-bold text-slate-700">
                <span>TAMANHO DO CÍRCULO:</span>
                <span className="text-red-600 font-mono">{radius}%</span>
              </div>
              <input
                type="range"
                min={12}
                max={40}
                value={radius}
                onChange={(e) => setRadius(Number(e.target.value))}
                className="w-full accent-red-600 cursor-pointer"
              />
              <div className="flex justify-between text-[10px] text-slate-400">
                <span>PEQUENO (12%)</span>
                <span>MÉDIO (24%)</span>
                <span>GRANDE (40%)</span>
              </div>
            </div>

            {/* Quick buttons */}
            <div className="w-full sm:w-auto flex flex-wrap gap-1.5 justify-end">
              <button
                type="button"
                onClick={() => setRadius(16)}
                className={`px-2.5 py-1 text-xs font-bold rounded border transition-colors ${
                  radius === 16 ? 'bg-red-50 text-red-700 border-red-300' : 'bg-slate-50 text-slate-700 border-slate-200'
                }`}
              >
                PEQUENO
              </button>
              <button
                type="button"
                onClick={() => setRadius(24)}
                className={`px-2.5 py-1 text-xs font-bold rounded border transition-colors ${
                  radius === 24 ? 'bg-red-50 text-red-700 border-red-300' : 'bg-slate-50 text-slate-700 border-slate-200'
                }`}
              >
                MÉDIO
              </button>
              <button
                type="button"
                onClick={() => setRadius(34)}
                className={`px-2.5 py-1 text-xs font-bold rounded border transition-colors ${
                  radius === 34 ? 'bg-red-50 text-red-700 border-red-300' : 'bg-slate-50 text-slate-700 border-slate-200'
                }`}
              >
                GRANDE
              </button>
              <button
                type="button"
                onClick={handleResetCenter}
                className="px-2.5 py-1 text-xs font-bold rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 transition-colors flex items-center gap-1"
                title="Centralizar círculo"
              >
                <RotateCcw className="w-3 h-3" />
                CENTRALIZAR
              </button>
            </div>
          </div>

          {/* Action buttons in UPPERCASE */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 transition-colors"
            >
              CANCELAR
            </button>
            <button
              type="button"
              onClick={handleSaveAndClose}
              className="px-5 py-2 text-xs font-bold rounded-lg bg-red-600 hover:bg-red-700 text-white shadow-sm flex items-center gap-1.5 transition-colors"
            >
              <Check className="w-4 h-4" />
              SALVAR POSIÇÃO
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
