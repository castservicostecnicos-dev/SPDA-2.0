import React, { useState, useEffect, useRef } from 'react';
import { Trash2, Upload, Target } from 'lucide-react';
import { PhotoSlot } from '../types/spda';

interface PhotoCardItemProps {
  photo: PhotoSlot;
  index: number;
  type: 'spda' | 'medicao' | 'quadros';
  onUpdateCaption: (index: number, caption: string, type: 'spda' | 'medicao' | 'quadros') => void;
  onUpdateMeasurementValue?: (index: number, val: string) => void;
  onToggleCircle?: (index: number, checked: boolean, type: 'spda' | 'quadros') => void;
  onAdjustCircle?: (photo: PhotoSlot, index: number, type: 'spda' | 'quadros') => void;
  onDirectClickCircle?: (e: React.MouseEvent<HTMLDivElement>, index: number, type: 'spda' | 'quadros') => void;
  onReplacePhoto: (e: React.ChangeEvent<HTMLInputElement>, index: number, type: 'spda' | 'medicao' | 'quadros') => void;
  onDeletePhoto: (index: number, type: 'spda' | 'medicao' | 'quadros') => void;
}

export const DebouncedTextInput: React.FC<{
  initialValue: string;
  onSave: (val: string) => void;
  placeholder?: string;
  className?: string;
}> = ({ initialValue, onSave, placeholder, className }) => {
  const [val, setVal] = useState(initialValue || '');
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setVal(initialValue || '');
  }, [initialValue]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleChange = (newVal: string) => {
    setVal(newVal);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      onSave(newVal);
    }, 400);
  };

  const handleBlur = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (val !== (initialValue || '')) {
      onSave(val);
    }
  };

  return (
    <input
      type="text"
      value={val}
      onChange={(e) => handleChange(e.target.value)}
      onBlur={handleBlur}
      placeholder={placeholder}
      className={className}
    />
  );
};

export const PhotoCardItem = React.memo<PhotoCardItemProps>(
  ({
    photo,
    index,
    type,
    onUpdateCaption,
    onUpdateMeasurementValue,
    onToggleCircle,
    onAdjustCircle,
    onDirectClickCircle,
    onReplacePhoto,
    onDeletePhoto,
  }) => {
    const [caption, setCaption] = useState(photo.caption || '');
    const [measurementValue, setMeasurementValue] = useState(photo.measurementValue || '');

    const captionTimerRef = useRef<NodeJS.Timeout | null>(null);
    const measurementTimerRef = useRef<NodeJS.Timeout | null>(null);
    const replaceInputRef = useRef<HTMLInputElement>(null);

    // Sync if photo changed externally (e.g. tower switch or restore)
    useEffect(() => {
      setCaption(photo.caption || '');
    }, [photo.caption]);

    useEffect(() => {
      setMeasurementValue(photo.measurementValue || '');
    }, [photo.measurementValue]);

    useEffect(() => {
      return () => {
        if (captionTimerRef.current) clearTimeout(captionTimerRef.current);
        if (measurementTimerRef.current) clearTimeout(measurementTimerRef.current);
      };
    }, []);

    const handleCaptionChange = (val: string) => {
      setCaption(val);
      if (captionTimerRef.current) clearTimeout(captionTimerRef.current);
      captionTimerRef.current = setTimeout(() => {
        onUpdateCaption(index, val, type);
      }, 350);
    };

    const handleCaptionBlur = () => {
      if (captionTimerRef.current) clearTimeout(captionTimerRef.current);
      if (caption !== (photo.caption || '')) {
        onUpdateCaption(index, caption, type);
      }
    };

    const handleMeasurementChange = (val: string) => {
      setMeasurementValue(val);
      if (measurementTimerRef.current) clearTimeout(measurementTimerRef.current);
      measurementTimerRef.current = setTimeout(() => {
        onUpdateMeasurementValue?.(index, val);
      }, 350);
    };

    const handleMeasurementBlur = () => {
      if (measurementTimerRef.current) clearTimeout(measurementTimerRef.current);
      if (measurementValue !== (photo.measurementValue || '')) {
        onUpdateMeasurementValue?.(index, measurementValue);
      }
    };

    const hasCircle = type === 'spda' ? (photo.hasRedCircleMarker ?? true) : !!photo.hasRedCircleMarker;
    const circleX = photo.circleX ?? 50;
    const circleY = photo.circleY ?? 50;
    const circleRadius = photo.circleRadius ?? 24;

    const aspectClass = type === 'spda' ? 'aspect-[38.5/48]' : 'aspect-[38.5/42]';

    return (
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex flex-col justify-between space-y-2.5 shadow-2xs hover:border-slate-400 transition-all">
        {/* Imagem com indicador e botão de exclusão */}
        <div
          onClick={(e) => {
            if (hasCircle && (type === 'spda' || type === 'quadros')) {
              onDirectClickCircle?.(e, index, type);
            }
          }}
          className={`relative ${aspectClass} rounded-lg overflow-hidden bg-slate-200 flex items-center justify-center ${
            hasCircle && (type === 'spda' || type === 'quadros') ? 'cursor-crosshair' : ''
          }`}
          title={
            hasCircle && (type === 'spda' || type === 'quadros')
              ? 'Clique para mover o círculo para este ponto da foto'
              : undefined
          }
        >
          <img
            src={photo.url}
            alt={`Foto ${type.toUpperCase()} ${index + 1}`}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover select-none pointer-events-none"
          />

          {/* Círculo vermelho móvel */}
          {hasCircle && (type === 'spda' || type === 'quadros') && (
            <div
              className="absolute pointer-events-none transition-all"
              style={{
                left: `${circleX}%`,
                top: `${circleY}%`,
                width: `${circleRadius * 2.2}%`,
                height: `${circleRadius * 1.8}%`,
                transform: 'translate(-50%, -50%)',
              }}
            >
              <div className="w-full h-full border-2 border-red-600 rounded-full shadow-[0_0_4px_rgba(239,68,68,0.9)] flex items-center justify-center">
                <div className="w-1.5 h-1.5 bg-red-600 rounded-full opacity-80" />
              </div>
            </div>
          )}

          {/* Identificador numérico da foto */}
          <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 bg-black/75 text-white text-[10px] font-bold rounded pointer-events-none">
            #{index + 1}
          </span>

          {/* BOTÃO EXCLUIR SUPERIOR VISÍVEL */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDeletePhoto(index, type);
            }}
            className="absolute top-1.5 right-1.5 p-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-md shadow-md z-10 transition-colors flex items-center justify-center"
            title="EXCLUIR ESTA FOTO"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Formulário do Card */}
        <div className="space-y-1.5">
          {type === 'medicao' ? (
            <>
              <div>
                <label className="block text-[10px] font-bold text-slate-600">
                  LEGENDA (OPCIONAL):
                </label>
                <input
                  type="text"
                  value={caption}
                  onChange={(e) => handleCaptionChange(e.target.value)}
                  onBlur={handleCaptionBlur}
                  placeholder="Legenda (opcional)"
                  className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-[10px] font-bold text-blue-700">
                  VALOR MEDIDO (OPCIONAL):
                </label>
                <input
                  type="text"
                  value={measurementValue}
                  onChange={(e) => handleMeasurementChange(e.target.value)}
                  onBlur={handleMeasurementBlur}
                  placeholder="Ex: 0,18 Ω (opcional)"
                  className="w-full px-2.5 py-1.5 text-xs font-mono font-bold text-blue-800 bg-blue-50/50 border border-blue-200 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="block text-[10px] font-bold text-slate-600">
                  {type === 'quadros' ? 'DESCRIÇÃO DO QUADRO (OPCIONAL):' : 'LEGENDA (OPCIONAL):'}
                </label>
                <input
                  type="text"
                  value={caption}
                  onChange={(e) => handleCaptionChange(e.target.value)}
                  onBlur={handleCaptionBlur}
                  placeholder={type === 'quadros' ? 'Descrição / legenda (opcional)' : 'Legenda (opcional)'}
                  className={`w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-md focus:outline-none focus:ring-1 ${
                    type === 'quadros' ? 'focus:ring-amber-500' : 'focus:ring-red-500'
                  }`}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-1 text-[10px] text-red-700 font-bold cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={hasCircle}
                      onChange={(e) => onToggleCircle?.(index, e.target.checked, type as 'spda' | 'quadros')}
                      className="w-3.5 h-3.5 text-red-600 rounded border-slate-300"
                    />
                    <span>CÍRCULO DE DESTAQUE</span>
                  </label>

                  {hasCircle && (
                    <span className="text-[9px] font-mono text-slate-500">
                      {circleX}%, {circleY}%
                    </span>
                  )}
                </div>

                {hasCircle && (
                  <button
                    type="button"
                    onClick={() => onAdjustCircle?.(photo, index, type as 'spda' | 'quadros')}
                    className="w-full py-1 px-2 text-[10px] font-bold bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-md flex items-center justify-center gap-1 transition-colors cursor-pointer"
                    title="Abrir tela ampliada para mover o círculo"
                  >
                    <Target className="w-3 h-3 text-red-600" />
                    <span>AJUSTAR CÍRCULO</span>
                  </button>
                )}
              </div>
            </>
          )}

          {/* LINHA DE AÇÕES INFERIORES: TROCAR E EXCLUIR */}
          <div className="flex items-center gap-1.5 pt-1 border-t border-slate-200">
            <button
              type="button"
              onClick={() => replaceInputRef.current?.click()}
              className="flex-1 py-1 px-2 text-[10px] font-bold bg-white hover:bg-slate-100 text-slate-700 rounded border border-slate-300 flex items-center justify-center gap-1 cursor-pointer transition-colors"
            >
              <Upload className="w-3 h-3 text-slate-500" />
              <span>TROCAR</span>
            </button>
            <input
              type="file"
              ref={replaceInputRef}
              accept="image/*"
              onChange={(e) => onReplacePhoto(e, index, type)}
              className="hidden"
            />

            <button
              type="button"
              onClick={() => onDeletePhoto(index, type)}
              className="flex-1 py-1 px-2 text-[10px] font-bold bg-rose-50 hover:bg-rose-100 text-rose-700 rounded border border-rose-200 flex items-center justify-center gap-1 transition-colors cursor-pointer"
              title="Excluir esta foto"
            >
              <Trash2 className="w-3 h-3 text-rose-600" />
              <span>EXCLUIR</span>
            </button>
          </div>
        </div>
      </div>
    );
  },
  (prevProps, nextProps) => {
    return (
      prevProps.index === nextProps.index &&
      prevProps.type === nextProps.type &&
      prevProps.photo.id === nextProps.photo.id &&
      prevProps.photo.url === nextProps.photo.url &&
      prevProps.photo.caption === nextProps.photo.caption &&
      prevProps.photo.measurementValue === nextProps.photo.measurementValue &&
      prevProps.photo.hasRedCircleMarker === nextProps.photo.hasRedCircleMarker &&
      prevProps.photo.circleX === nextProps.photo.circleX &&
      prevProps.photo.circleY === nextProps.photo.circleY &&
      prevProps.photo.circleRadius === nextProps.photo.circleRadius &&
      prevProps.photo.diskFileName === nextProps.photo.diskFileName
    );
  }
);

PhotoCardItem.displayName = 'PhotoCardItem';
