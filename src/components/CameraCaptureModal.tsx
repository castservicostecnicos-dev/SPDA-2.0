/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Camera,
  X,
  Zap,
  Gauge,
  Layers,
  Building,
  Check,
  SwitchCamera,
  Flashlight,
  FlashlightOff,
  Grid,
  ShieldAlert,
  FolderCheck,
  HardDrive,
  Loader2,
} from 'lucide-react';
import { PhotoSlot } from '../types/spda';
import {
  getSectionSubfolderName,
  saveBatchPhotosToDisk,
  getConnectedDeviceFolderHandle,
  pickAndConnectDeviceFolder,
  getStoredDeviceFolderInfo,
  reconnectStoredDeviceFolder,
  BatchPhotoSaveItem,
} from '../utils/photoDeviceSync';
import { optimizeImageFileToBlob } from '../utils/imageOptimizer';
import { saveFieldPhoto, markPhotoAsSynced } from '../db/spdaDatabase';

interface CameraCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  condominioNome?: string;
  torreAtual: string;
  activeSection: 'spda' | 'medicao' | 'quadros' | 'local';
  onChangeSection?: (sec: 'spda' | 'medicao' | 'quadros' | 'local') => void;
  onPhotoCaptured: (photoSlot: PhotoSlot, section: 'spda' | 'medicao' | 'quadros' | 'local') => void;
  onPhotosSavedToDisk?: (savedItems: BatchPhotoSaveItem[]) => void;
  torresList?: string[];
  onChangeTower?: (torre: string) => void;
  getSectionPhotoCount?: (sec: 'spda' | 'medicao' | 'quadros' | 'local', torre?: string) => number;
}

export const CameraCaptureModal: React.FC<CameraCaptureModalProps> = ({
  isOpen,
  onClose,
  condominioNome,
  torreAtual,
  activeSection: initialSection,
  onChangeSection,
  onPhotoCaptured,
  onPhotosSavedToDisk,
  torresList = [],
  onChangeTower,
  getSectionPhotoCount,
}) => {
  const [currentSection, setCurrentSection] = useState<'spda' | 'medicao' | 'quadros' | 'local'>(initialSection);
  const [currentTower, setCurrentTower] = useState<string>(torreAtual);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [hasTorch, setHasTorch] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [isCapturing, setIsCapturing] = useState(false);
  const [flashAnimation, setFlashAnimation] = useState(false);
  const [tapRipple, setTapRipple] = useState<{ x: number; y: number } | null>(null);
  const [capturedThumbnails, setCapturedThumbnails] = useState<{ id: string; url: string; section: string }[]>([]);
  const [sessionCount, setSessionCount] = useState(0);
  const [lastFeedback, setLastFeedback] = useState<string | null>(null);

  // Estado do salvamento final na pasta ao clicar em Concluir
  const [isSavingToFolder, setIsSavingToFolder] = useState(false);
  const [savingProgressMessage, setSavingProgressMessage] = useState('');
  const [folderMissingPrompt, setFolderMissingPrompt] = useState(false);

  // Rastreamento das fotos capturadas durante esta sessão
  const sessionCapturedItemsRef = useRef<BatchPhotoSaveItem[]>([]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const nativeCameraInputRef = useRef<HTMLInputElement>(null);

  // Sincroniza seção e torre se mudarem pelas props
  useEffect(() => {
    setCurrentSection(initialSection);
  }, [initialSection]);

  useEffect(() => {
    setCurrentTower(torreAtual);
  }, [torreAtual]);

  useEffect(() => {
    if (isOpen) {
      sessionCapturedItemsRef.current = [];
      setCapturedThumbnails([]);
      setSessionCount(0);
      setFolderMissingPrompt(false);
      setIsSavingToFolder(false);
    }
  }, [isOpen]);

  // Inicia ou reinicia o stream de vídeo da câmera
  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      return;
    }

    let active = true;

    async function initCamera() {
      setCameraError(null);
      stopCamera();

      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error('Acesso direto à câmera não suportado neste navegador. Utilize o botão da câmera nativa.');
        }

        const constraints: MediaStreamConstraints = {
          audio: false,
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 1920, min: 1280 },
            height: { ideal: 1080, min: 720 },
          },
        };

        const mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
        if (!active) {
          mediaStream.getTracks().forEach((t) => t.stop());
          return;
        }

        setStream(mediaStream);

        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
          videoRef.current.play().catch(() => {});
        }

        const videoTrack = mediaStream.getVideoTracks()[0];
        if (videoTrack) {
          const capabilities = (videoTrack.getCapabilities ? videoTrack.getCapabilities() : {}) as any;
          setHasTorch(Boolean(capabilities?.torch));
        }
      } catch (err: any) {
        if (!active) return;
        console.warn('Erro ao acessar câmera:', err);
        setCameraError(
          err?.name === 'NotAllowedError'
            ? 'Permissão de câmera negada. Conceda acesso à câmera nas configurações do navegador ou use o botão de Câmera Nativa abaixo.'
            : 'Não foi possível iniciar a câmera diretamente no navegador. Você pode usar a Câmera Nativa do Celular.'
        );
      }
    }

    initCamera();

    return () => {
      active = false;
      stopCamera();
    };
  }, [isOpen, facingMode]);

  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      setStream(null);
    }
    setTorchOn(false);
  };

  const handleToggleTorch = async () => {
    if (!stream) return;
    const track = stream.getVideoTracks()[0];
    if (track) {
      try {
        const nextState = !torchOn;
        await (track as any).applyConstraints({
          advanced: [{ torch: nextState }],
        });
        setTorchOn(nextState);
      } catch (err) {
        console.warn('Falha ao alternar lanterna:', err);
      }
    }
  };

  const handleSwitchCamera = () => {
    setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'));
  };

  // Processa e registra a foto tirada de forma rápida, eficiente e sem crash
  const registerCapturedPhoto = async (
    rawSource: Blob | File | HTMLCanvasElement,
    section: 'spda' | 'medicao' | 'quadros' | 'local',
    tower: string
  ) => {
    // 1. Otimiza foto diretamente para Blob binário e DataURL
    const optimized = await optimizeImageFileToBlob(
      rawSource instanceof HTMLCanvasElement ? rawSource.toDataURL('image/jpeg', 0.85) : rawSource,
      1280,
      1280,
      0.8
    );

    const existingCount = getSectionPhotoCount ? getSectionPhotoCount(section, tower) : sessionCount;
    const photoIndex = existingCount;
    const padIndex = String(photoIndex + 1).padStart(2, '0');
    const diskFileName = `foto_${padIndex}.jpg`;

    const newId = `cam-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const photoSlot: PhotoSlot = {
      id: newId,
      url: optimized.dataUrl,
      caption: '',
      hasRedCircleMarker: section === 'spda',
      circleX: 50,
      circleY: 50,
      circleRadius: 24,
      measurementValue: '',
      towerName: tower,
      addedAt: Date.now(),
      diskFileName,
    };

    // 2. Salva AUTOMATICAMENTE no banco de dados local para fotos realizadas em campo (sempre seguro)
    saveFieldPhoto({
      id: newId,
      reportId: 'current',
      condoName: condominioNome || 'Condomínio',
      towerName: tower,
      section,
      photoIndex,
      blob: optimized.blob,
      dataUrl: optimized.dataUrl,
      diskFileName,
      hasRedCircleMarker: section === 'spda',
      circleX: 50,
      circleY: 50,
      circleRadius: 24,
    }).catch((err) => console.warn('Erro ao salvar foto no banco offline:', err));

    // 3. Adiciona na lista de fotos desta sessão para gravação na pasta ao clicar em "Concluir"
    sessionCapturedItemsRef.current.push({
      photo: photoSlot,
      section,
      towerName: tower,
      photoIndex,
    });

    // 4. Notifica o estado principal da aplicação
    onPhotoCaptured(photoSlot, section);

    setCapturedThumbnails((prev) => [
      { id: newId, url: optimized.dataUrl, section: getSectionSubfolderName(section) },
      ...prev.slice(0, 7),
    ]);

    const newCount = sessionCount + 1;
    setSessionCount(newCount);
    setLastFeedback(`✓ Foto ${padIndex} salva no banco (${tower} > ${getSectionSubfolderName(section)})!`);
    setTimeout(() => setLastFeedback(null), 3000);
  };

  // Disparo da foto pelo componente de câmera do app
  const handleCapturePhoto = async () => {
    if (!videoRef.current || isCapturing) return;

    setIsCapturing(true);
    setFlashAnimation(true);
    setTimeout(() => setFlashAnimation(false), 200);

    try {
      const video = videoRef.current;
      const canvas = document.createElement('canvas');
      const width = video.videoWidth || 1280;
      const height = video.videoHeight || 720;
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Não foi possível processar o quadro da câmera.');

      if (facingMode === 'user') {
        ctx.translate(width, 0);
        ctx.scale(-1, 1);
      }

      ctx.drawImage(video, 0, 0, width, height);

      await registerCapturedPhoto(canvas, currentSection, currentTower);
    } catch (err: any) {
      console.error('Erro ao capturar foto:', err);
      alert('Erro ao tirar a foto. Tente novamente ou use a câmera nativa.');
    } finally {
      setIsCapturing(false);
    }
  };

  // Disparo ao tocar em qualquer ponto do visor da câmera
  const handleViewfinderClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isCapturing || cameraError) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setTapRipple({ x, y });
    setTimeout(() => setTapRipple(null), 500);

    handleCapturePhoto();
  };

  // Disparo pela câmera nativa do celular
  const handleNativeCameraCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      await registerCapturedPhoto(file, currentSection, currentTower);
    } catch (err) {
      console.error('Erro ao ler foto da câmera nativa:', err);
      alert('Erro ao processar foto da câmera nativa.');
    }

    if (e.target) e.target.value = '';
  };

  // =========================================================================
  // SALVAMENTO NA PASTA ESCOLHIDA AO CLICAR EM "CONCLUIR"
  // =========================================================================
  const handleConcluir = async () => {
    const itemsToSave = sessionCapturedItemsRef.current;

    // Se nenhuma foto foi tirada nesta sessão, apenas fecha
    if (itemsToSave.length === 0) {
      onClose();
      return;
    }

    // Tenta obter o handle ou reativar a pasta conectada anteriormente em 1 clique
    let handle = await getConnectedDeviceFolderHandle();
    if (!handle) {
      const stored = await getStoredDeviceFolderInfo();
      if (stored.hasStoredHandle) {
        const reconnected = await reconnectStoredDeviceFolder();
        if (reconnected.success && reconnected.handle) {
          handle = reconnected.handle;
        }
      }
    }

    if (!handle) {
      // Pasta física não conectada: pergunta se deseja conectar agora
      setFolderMissingPrompt(true);
      return;
    }

    // Inicia gravação das fotos do lote na pasta escolhida
    await executeSaveToDisk(itemsToSave);
  };

  const executeSaveToDisk = async (items: BatchPhotoSaveItem[]) => {
    setIsSavingToFolder(true);
    setSavingProgressMessage(`Gravando ${items.length} foto(s) na pasta escolhida...`);

    try {
      const res = await saveBatchPhotosToDisk(items, condominioNome, (saved, total, msg) => {
        setSavingProgressMessage(`${msg} (${saved}/${total})`);
      });

      if (res.success) {
        // Atualiza a marcação no banco de dados
        await Promise.all(
          items.map((it) => markPhotoAsSynced(it.photo.id, it.photo.diskFileName))
        );

        // Notifica o componente pai para atualizar syncedAt e diskFileName nas fotos e persistir no laudo
        onPhotosSavedToDisk?.(items);

        setSavingProgressMessage(`✓ ${res.savedCount} foto(s) salvas com sucesso na pasta e no banco!`);
        setTimeout(() => {
          setIsSavingToFolder(false);
          onClose();
        }, 1200);
      } else {
        alert(res.error || 'Aviso: fotos foram salvas no banco de dados offline. Para salvar no disco, conecte a pasta.');
        setIsSavingToFolder(false);
        onClose();
      }
    } catch (err: any) {
      console.error('Erro ao salvar fotos na pasta:', err);
      alert('Fotos salvas no banco offline. Falha ao gravar no disco: ' + (err?.message || ''));
      setIsSavingToFolder(false);
      onClose();
    }
  };

  const handleConnectFolderAndSave = async () => {
    setFolderMissingPrompt(false);
    const res = await pickAndConnectDeviceFolder();
    if (res.success) {
      await executeSaveToDisk(sessionCapturedItemsRef.current);
    } else {
      alert('Pasta não conectada. As fotos permanecem salvas com segurança no banco de dados do app!');
      onClose();
    }
  };

  const handleFinishWithoutDisk = () => {
    setFolderMissingPrompt(false);
    onClose();
  };

  const handleSelectSection = (sec: 'spda' | 'medicao' | 'quadros' | 'local') => {
    setCurrentSection(sec);
    onChangeSection?.(sec);
  };

  const handleSelectTower = (t: string) => {
    setCurrentTower(t);
    onChangeTower?.(t);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col justify-between overflow-hidden select-none animate-in fade-in duration-200">
      {/* Input oculto para disparo da câmera nativa do Android/iOS */}
      <input
        type="file"
        ref={nativeCameraInputRef}
        accept="image/*"
        capture="environment"
        onChange={handleNativeCameraCapture}
        className="hidden"
      />

      {/* FLASH VISUAL AO DISPARAR */}
      {flashAnimation && (
        <div className="absolute inset-0 bg-white z-50 pointer-events-none opacity-80 transition-opacity duration-150" />
      )}

      {/* OVERLAY DE SALVAMENTO NA PASTA ESCOLHIDA */}
      {isSavingToFolder && (
        <div className="absolute inset-0 z-50 bg-slate-950/90 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-white space-y-4">
          <div className="w-16 h-16 rounded-2xl bg-emerald-600/20 text-emerald-400 border border-emerald-500/40 flex items-center justify-center animate-pulse">
            <HardDrive className="w-8 h-8 animate-bounce" />
          </div>
          <div className="text-center space-y-1">
            <h3 className="text-base font-bold text-white">Salvando na pasta escolhida</h3>
            <p className="text-xs text-slate-300 font-mono max-w-sm">{savingProgressMessage}</p>
          </div>
          <div className="flex items-center gap-2 text-xs text-emerald-400 font-semibold">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Organizando em Documentos/LAUDOS SPDA/{condominioNome || 'Condomínio'}...</span>
          </div>
        </div>
      )}

      {/* PROMPT: PASTA FÍSICA NÃO CONECTADA */}
      {folderMissingPrompt && (
        <div className="absolute inset-0 z-50 bg-slate-950/95 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-white space-y-4">
          <div className="w-14 h-14 rounded-2xl bg-amber-500/20 text-amber-400 border border-amber-500/40 flex items-center justify-center">
            <FolderCheck className="w-7 h-7" />
          </div>
          <div className="text-center space-y-2 max-w-sm">
            <h3 className="text-base font-bold text-white">Salvar Fotos na Pasta do Aparelho?</h3>
            <p className="text-xs text-slate-300 leading-relaxed">
              As <strong>{sessionCapturedItemsRef.current.length} foto(s)</strong> tiradas já estão salvas no <strong>banco de dados offline</strong>.
              Deseja escolher a pasta do celular agora para salvá-las também nas pastas físicas (spda existente, quadros, medições)?
            </p>
          </div>
          <div className="flex flex-col w-full max-w-xs gap-2 pt-2">
            <button
              type="button"
              onClick={handleConnectFolderAndSave}
              className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-500 font-extrabold text-xs uppercase tracking-wider rounded-xl shadow-lg flex items-center justify-center gap-2 cursor-pointer"
            >
              <HardDrive className="w-4 h-4" />
              <span>Escolher Pasta e Salvar Agora</span>
            </button>
            <button
              type="button"
              onClick={handleFinishWithoutDisk}
              className="w-full py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs rounded-xl cursor-pointer"
            >
              Concluir (Manter Salvo no Banco)
            </button>
          </div>
        </div>
      )}

      {/* CABEÇALHO SUPERIOR DA CÂMERA */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative z-30 bg-gradient-to-b from-black/90 via-black/60 to-transparent p-3 sm:p-4 text-white space-y-2 select-none"
      >
        <div className="flex items-center justify-between gap-2">
          {/* Indicador de Destino */}
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping inline-block" />
            <div>
              <div className="flex items-center gap-1.5 font-bold text-xs sm:text-sm">
                <span className="text-amber-400">{currentTower}</span>
                <span className="text-slate-400">/</span>
                <span className="text-emerald-300 uppercase">{getSectionSubfolderName(currentSection)}</span>
              </div>
              <p className="text-[10px] text-slate-300 font-mono truncate max-w-[210px] sm:max-w-xs">
                Documentos/LAUDOS SPDA/{condominioNome || 'Condomínio'}
              </p>
            </div>
          </div>

          {/* Botões de controle */}
          <div className="flex items-center gap-1.5">
            {hasTorch && (
              <button
                type="button"
                onClick={handleToggleTorch}
                className={`p-2 rounded-full border transition-colors cursor-pointer ${
                  torchOn
                    ? 'bg-amber-400 text-black border-amber-300'
                    : 'bg-black/40 text-white border-white/20 hover:bg-black/60'
                }`}
                title={torchOn ? 'Desligar Lanterna' : 'Ligar Lanterna'}
              >
                {torchOn ? <Flashlight className="w-4 h-4" /> : <FlashlightOff className="w-4 h-4" />}
              </button>
            )}

            <button
              type="button"
              onClick={() => setShowGrid((prev) => !prev)}
              className={`p-2 rounded-full border transition-colors cursor-pointer ${
                showGrid
                  ? 'bg-blue-600 text-white border-blue-400'
                  : 'bg-black/40 text-slate-300 border-white/20'
              }`}
              title="Linhas de Grade"
            >
              <Grid className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={handleSwitchCamera}
              className="p-2 rounded-full bg-black/40 text-white border border-white/20 hover:bg-black/60 transition-colors cursor-pointer"
              title="Inverter Câmera (Traseira / Frontal)"
            >
              <SwitchCamera className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={handleConcluir}
              className="p-2 rounded-full bg-rose-600/90 text-white border border-rose-400 hover:bg-rose-600 transition-colors cursor-pointer ml-1"
              title="Fechar Câmera e Salvar"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* SELETOR RÁPIDO DE SEÇÃO E TORRE */}
        <div className="flex items-center justify-between gap-2 overflow-x-auto pb-1 text-xs no-scrollbar">
          <div className="flex items-center gap-1 bg-black/40 p-1 rounded-lg border border-white/10">
            <button
              type="button"
              onClick={() => handleSelectSection('spda')}
              className={`px-2.5 py-1 rounded text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-all ${
                currentSection === 'spda'
                  ? 'bg-red-600 text-white shadow-sm'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Zap className="w-3 h-3" />
              <span>SPDA</span>
            </button>
            <button
              type="button"
              onClick={() => handleSelectSection('medicao')}
              className={`px-2.5 py-1 rounded text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-all ${
                currentSection === 'medicao'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Gauge className="w-3 h-3" />
              <span>Medições</span>
            </button>
            <button
              type="button"
              onClick={() => handleSelectSection('quadros')}
              className={`px-2.5 py-1 rounded text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-all ${
                currentSection === 'quadros'
                  ? 'bg-amber-600 text-white shadow-sm'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Layers className="w-3 h-3" />
              <span>Quadros</span>
            </button>
            {(currentTower === 'Torre 1' || currentTower === (torresList[0] || 'Torre 1') || torresList.length <= 1) && (
              <button
                type="button"
                onClick={() => handleSelectSection('local')}
                className={`px-2.5 py-1 rounded text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-all ${
                  currentSection === 'local'
                    ? 'bg-purple-600 text-white shadow-sm'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <Building className="w-3 h-3" />
                <span>Fachada/Aérea</span>
              </button>
            )}
          </div>

          {torresList.length > 1 && (
            <div className="flex items-center gap-1 bg-black/40 p-1 rounded-lg border border-white/10 flex-shrink-0">
              <span className="text-[10px] text-slate-400 pl-1 font-semibold">Torre:</span>
              {torresList.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => handleSelectTower(t)}
                  className={`px-2 py-0.5 rounded text-[10px] font-bold cursor-pointer transition-colors ${
                    currentTower === t
                      ? 'bg-amber-500 text-slate-950 font-extrabold'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* VISOR CENTRAL DA CÂMERA */}
      <div
        onClick={handleViewfinderClick}
        className="relative flex-1 bg-black flex items-center justify-center overflow-hidden cursor-pointer select-none"
        title="Toque em qualquer ponto da tela para tirar a foto"
      >
        {cameraError ? (
          <div className="p-6 text-center max-w-sm space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="w-14 h-14 rounded-2xl bg-amber-500/20 text-amber-400 border border-amber-500/40 flex items-center justify-center mx-auto">
              <ShieldAlert className="w-7 h-7" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white mb-1">Câmera no Celular</h3>
              <p className="text-xs text-slate-300 leading-relaxed">{cameraError}</p>
            </div>
            <button
              type="button"
              onClick={() => nativeCameraInputRef.current?.click()}
              className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-sm rounded-xl shadow-lg flex items-center justify-center gap-2 cursor-pointer"
            >
              <Camera className="w-5 h-5" />
              <span>ABRIR CÂMERA NATIVA DO CELULAR</span>
            </button>
          </div>
        ) : (
          <>
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className="w-full h-full object-cover pointer-events-none"
            />

            <div className="absolute top-3 inset-x-0 flex justify-center pointer-events-none z-20">
              <span className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-black/60 backdrop-blur-xs border border-white/20 text-white text-[11px] font-bold shadow-lg animate-pulse">
                <span>👆</span> Toque em qualquer ponto da tela para fotografar
              </span>
            </div>

            {tapRipple && (
              <div
                className="absolute pointer-events-none z-30 -translate-x-1/2 -translate-y-1/2"
                style={{ left: `${tapRipple.x}px`, top: `${tapRipple.y}px` }}
              >
                <div className="w-16 h-16 rounded-full border-2 border-emerald-400 bg-emerald-400/20 animate-ping" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-3 h-3 rounded-full bg-emerald-400 shadow-[0_0_10px_#34d399]" />
                </div>
              </div>
            )}

            {showGrid && (
              <div className="absolute inset-0 pointer-events-none grid grid-cols-3 grid-rows-3 border border-white/20">
                <div className="border-r border-b border-white/20" />
                <div className="border-r border-b border-white/20" />
                <div className="border-b border-white/20" />
                <div className="border-r border-b border-white/20" />
                <div className="border-r border-b border-white/20 flex items-center justify-center">
                  <div className="w-8 h-8 rounded-full border border-white/40 flex items-center justify-center">
                    <div className="w-1 h-1 bg-emerald-400 rounded-full" />
                  </div>
                </div>
                <div className="border-b border-white/20" />
                <div className="border-r border-b border-white/20" />
                <div className="border-r border-b border-white/20" />
                <div />
              </div>
            )}

            {lastFeedback && (
              <div className="absolute bottom-4 bg-emerald-950/90 border border-emerald-400 text-emerald-200 px-3.5 py-1.5 rounded-full text-xs font-bold shadow-lg flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2 z-20">
                <Check className="w-4 h-4 text-emerald-400" />
                <span>{lastFeedback}</span>
              </div>
            )}
          </>
        )}
      </div>

      {/* BARRA INFERIOR DE DISPARO E HISTÓRICO DA SESSÃO */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative z-30 bg-gradient-to-t from-black via-black/90 to-transparent p-4 sm:p-5 text-white space-y-3"
      >
        {capturedThumbnails.length > 0 && (
          <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex-shrink-0">
              Registradas ({sessionCount}):
            </span>
            {capturedThumbnails.map((thumb) => (
              <div
                key={thumb.id}
                className="w-11 h-11 rounded-lg overflow-hidden border border-white/40 flex-shrink-0 bg-slate-800 shadow relative"
              >
                <img src={thumb.url} alt="Captura" className="w-full h-full object-cover" />
                <span className="absolute bottom-0 inset-x-0 bg-black/70 text-[8px] font-bold text-center text-white truncate">
                  {thumb.section}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => nativeCameraInputRef.current?.click()}
            className="flex flex-col items-center justify-center gap-1 p-2.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/20 text-white transition-colors cursor-pointer min-w-[70px]"
            title="Usar o aplicativo de câmera nativa do aparelho"
          >
            <Camera className="w-5 h-5 text-emerald-400" />
            <span className="text-[9px] font-bold leading-tight">Câmera Nativa</span>
          </button>

          <button
            type="button"
            onClick={handleCapturePhoto}
            disabled={!!cameraError || isCapturing}
            className="w-18 h-18 sm:w-20 sm:h-20 rounded-full border-4 border-white bg-white/20 hover:bg-white/30 active:scale-95 transition-all flex items-center justify-center p-1.5 shadow-[0_0_20px_rgba(255,255,255,0.4)] cursor-pointer disabled:opacity-50 disabled:pointer-events-none"
            title="Tirar foto agora"
          >
            <div className="w-full h-full rounded-full bg-white shadow-inner flex items-center justify-center">
              <div className="w-4 h-4 rounded-full bg-emerald-600" />
            </div>
          </button>

          {/* BOTÃO CONCLUIR - SALVA AS FOTOS NA PASTA ESCOLHIDA */}
          <button
            type="button"
            onClick={handleConcluir}
            className="flex flex-col items-center justify-center gap-1 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 font-extrabold text-white shadow-md transition-colors cursor-pointer min-w-[75px]"
            title="Concluir sessão e salvar fotos na pasta escolhida"
          >
            <Check className="w-5 h-5" />
            <span className="text-[10px] uppercase font-black tracking-wide">CONCLUIR</span>
          </button>
        </div>
      </div>
    </div>
  );
};
