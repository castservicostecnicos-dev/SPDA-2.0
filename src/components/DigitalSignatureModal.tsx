/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useState, useEffect } from 'react';
import { DigitalSignatureData, ClientData } from '../types/spda';
import {
  FileSignature,
  PenTool,
  Upload,
  Stamp,
  RotateCcw,
  Check,
  X,
  ShieldCheck,
  RefreshCw,
  Sparkles,
  Lock,
  BookmarkCheck,
  Download,
  Trash2,
} from 'lucide-react';
import {
  generateSignatureHash,
  cleanSignatureImage,
  trimCanvas,
  saveStoredSignature,
  loadStoredSignature,
} from '../utils/signatureUtils';

interface DigitalSignatureModalProps {
  isOpen: boolean;
  onClose: () => void;
  signature?: DigitalSignatureData;
  client: ClientData;
  onSaveSignature: (signature: DigitalSignatureData) => void;
}

export const DigitalSignatureModal: React.FC<DigitalSignatureModalProps> = ({
  isOpen,
  onClose,
  signature,
  client,
  onSaveSignature,
}) => {
  const [activeTab, setActiveTab] = useState<'drawn' | 'upload' | 'stamp'>(
    signature?.type === 'certificate' ? 'stamp' : (signature?.type || 'drawn')
  );
  const [enabled, setEnabled] = useState<boolean>(signature?.enabled ?? true);
  const [showValidationStamp, setShowValidationStamp] = useState<boolean>(
    signature?.showValidationStamp ?? true
  );

  // Professional fields
  const [signerName, setSignerName] = useState<string>(signature?.signerName || client.tecnico || '');
  const [signerRole, setSignerRole] = useState<string>(signature?.signerRole || client.cargo || '');
  const [signerCrea, setSignerCrea] = useState<string>(signature?.signerCrea || client.crea || '');
  const [signerArt, setSignerArt] = useState<string>(signature?.signerArt || client.art || '');
  const [signedAt, setSignedAt] = useState<string>(
    signature?.signedAt ||
      `${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
      })}`
  );
  const [hashSha256, setHashSha256] = useState<string>(
    signature?.hashSha256 || generateSignatureHash(client.tecnico, client.crea, client.art, signedAt)
  );

  // Drawing state
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [strokeColor, setStrokeColor] = useState<string>('#1d4ed8'); // Blue by default, or #0f172a
  const [strokeWidth, setStrokeWidth] = useState<number>(3);
  const [drawnHistory, setDrawnHistory] = useState<ImageData[]>([]);

  // Upload state
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(
    signature?.type === 'upload' ? signature?.imageUrl || null : null
  );
  const [autoCleanBackground, setAutoCleanBackground] = useState<boolean>(true);
  const [isCleaningImage, setIsCleaningImage] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Toast / Status feedback
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [savedDefaultExists, setSavedDefaultExists] = useState<boolean>(false);

  useEffect(() => {
    if (isOpen) {
      const stored = loadStoredSignature();
      setSavedDefaultExists(!!stored?.imageUrl);

      // Sincroniza com dados do cliente se os campos estiverem vazios
      if (!signerName && client.tecnico) setSignerName(client.tecnico);
      if (!signerRole && client.cargo) setSignerRole(client.cargo);
      if (!signerCrea && client.crea) setSignerCrea(client.crea);
      if (!signerArt && client.art) setSignerArt(client.art);

      if (signature?.imageUrl) {
        if (signature.type === 'upload') {
          setUploadedImageUrl(signature.imageUrl);
        }
      }
    }
  }, [isOpen, signature, client]);

  // Redesenha a imagem existente no canvas se for do tipo 'drawn'
  useEffect(() => {
    if (isOpen && activeTab === 'drawn' && signature?.type === 'drawn' && signature.imageUrl) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, (canvas.width - img.width) / 2, (canvas.height - img.height) / 2);
        setHasDrawn(true);
      };
      img.src = signature.imageUrl;
    }
  }, [isOpen, activeTab]);

  if (!isOpen) return null;

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const handleRegenerateHash = () => {
    const newHash = generateSignatureHash(signerName, signerCrea, signerArt, signedAt);
    setHashSha256(newHash);
    showToast('Chave criptográfica de validação gerada com sucesso.');
  };

  const handleUpdateSignedAtToNow = () => {
    const nowStr = `${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString(
      'pt-BR',
      { hour: '2-digit', minute: '2-digit' }
    )}`;
    setSignedAt(nowStr);
    const newHash = generateSignatureHash(signerName, signerCrea, signerArt, nowStr);
    setHashSha256(newHash);
  };

  // Canvas drawing handlers with high-DPI and touch smoothing
  const getCoordinates = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Guarda estado para desfazer
    setDrawnHistory((prev) => [...prev, ctx.getImageData(0, 0, canvas.width, canvas.height)]);

    const { x, y } = getCoordinates(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth * 2; // compensa canvas scaling
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    setIsDrawing(true);
    setHasDrawn(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { x, y } = getCoordinates(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const handlePointerUp = () => {
    if (isDrawing) {
      setIsDrawing(false);
    }
  };

  const handleClearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawn(false);
    setDrawnHistory([]);
  };

  const handleUndoCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas || drawnHistory.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const lastState = drawnHistory[drawnHistory.length - 1];
    ctx.putImageData(lastState, 0, 0);
    setDrawnHistory((prev) => prev.slice(0, -1));
    if (drawnHistory.length <= 1) {
      setHasDrawn(false);
    }
  };

  // Upload handler with automatic background cleaner
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsCleaningImage(true);
    const reader = new FileReader();

    reader.onload = async (evt) => {
      const rawDataUrl = evt.target?.result as string;
      try {
        if (autoCleanBackground) {
          const cleaned = await cleanSignatureImage(rawDataUrl, 215, true);
          setUploadedImageUrl(cleaned);
        } else {
          setUploadedImageUrl(rawDataUrl);
        }
        showToast('Imagem de assinatura carregada.');
      } catch (err) {
        console.warn('Erro ao processar imagem:', err);
        setUploadedImageUrl(rawDataUrl);
      } finally {
        setIsCleaningImage(false);
      }
    };

    reader.readAsDataURL(file);
  };

  // Salvar a assinatura como padrão no navegador
  const handleSaveAsDefault = () => {
    let finalImageUrl: string | undefined = undefined;

    if (activeTab === 'drawn') {
      const canvas = canvasRef.current;
      if (canvas && hasDrawn) {
        const trimmed = trimCanvas(canvas);
        finalImageUrl = trimmed.toDataURL('image/png');
      }
    } else if (activeTab === 'upload') {
      finalImageUrl = uploadedImageUrl || undefined;
    }

    const payload: DigitalSignatureData = {
      enabled,
      type: activeTab,
      imageUrl: finalImageUrl,
      signerName,
      signerRole,
      signerCrea,
      signerArt,
      signedAt,
      hashSha256,
      showValidationStamp,
      certificateAuthority: 'Padrão ICP-Brasil / CREA Confea',
    };

    saveStoredSignature(payload);
    setSavedDefaultExists(true);
    showToast('✓ Assinatura padrão salva neste dispositivo para futuros laudos!');
  };

  // Carregar assinatura padrão previamente salva
  const handleLoadStoredDefault = () => {
    const stored = loadStoredSignature();
    if (!stored) {
      showToast('Nenhuma assinatura padrão encontrada salva.');
      return;
    }

    setEnabled(stored.enabled);
    setActiveTab(stored.type === 'certificate' ? 'stamp' : stored.type);
    setShowValidationStamp(stored.showValidationStamp);
    if (stored.signerName) setSignerName(stored.signerName);
    if (stored.signerRole) setSignerRole(stored.signerRole);
    if (stored.signerCrea) setSignerCrea(stored.signerCrea);
    if (stored.signerArt) setSignerArt(stored.signerArt);

    if (stored.type === 'drawn' && stored.imageUrl) {
      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        const img = new Image();
        img.onload = () => {
          ctx?.clearRect(0, 0, canvas.width, canvas.height);
          ctx?.drawImage(img, (canvas.width - img.width) / 2, (canvas.height - img.height) / 2);
          setHasDrawn(true);
        };
        img.src = stored.imageUrl;
      }
    } else if (stored.type === 'upload' && stored.imageUrl) {
      setUploadedImageUrl(stored.imageUrl);
    }

    showToast('Assinatura padrão carregada com sucesso.');
  };

  // Concluir e aplicar no laudo
  const handleApplySignature = () => {
    let finalImageUrl: string | undefined = undefined;

    if (activeTab === 'drawn') {
      const canvas = canvasRef.current;
      if (canvas && hasDrawn) {
        const trimmed = trimCanvas(canvas);
        finalImageUrl = trimmed.toDataURL('image/png');
      } else if (signature?.type === 'drawn' && signature.imageUrl) {
        finalImageUrl = signature.imageUrl;
      }
    } else if (activeTab === 'upload') {
      finalImageUrl = uploadedImageUrl || undefined;
    }

    const payload: DigitalSignatureData = {
      enabled,
      type: activeTab,
      imageUrl: finalImageUrl,
      signerName: signerName.trim() || client.tecnico,
      signerRole: signerRole.trim() || client.cargo,
      signerCrea: signerCrea.trim() || client.crea,
      signerArt: signerArt.trim() || client.art,
      signedAt,
      hashSha256: hashSha256 || generateSignatureHash(signerName, signerCrea, signerArt, signedAt),
      showValidationStamp,
      certificateAuthority: 'Padrão ICP-Brasil / CREA Confea',
    };

    onSaveSignature(payload);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-5 overflow-y-auto animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full border border-slate-200 overflow-hidden flex flex-col my-auto max-h-[92vh]">
        {/* Header Modal */}
        <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-blue-950 text-white p-4 sm:p-5 flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/20 border border-blue-400/40 flex items-center justify-center text-blue-300 flex-shrink-0">
              <FileSignature className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-bold tracking-tight flex items-center gap-2">
                Assinatura Digital do Responsável Técnico
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-5 text-slate-800 text-sm">
          {/* Toast Notification */}
          {toastMessage && (
            <div className="bg-emerald-50 border border-emerald-300 text-emerald-900 px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 animate-in fade-in shadow-xs">
              <Check className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              <span>{toastMessage}</span>
            </div>
          )}

          {/* Ativação Principal */}
          <div className="flex items-center justify-between p-3.5 bg-slate-50 border border-slate-200 rounded-xl">
            <div className="flex items-center gap-3">
              <div
                className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                  enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'
                }`}
              >
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <span className="font-bold text-slate-900 block text-xs sm:text-sm">
                  Incluir Assinatura Digital no Laudo e no PDF
                </span>
                <span className="text-[11px] text-slate-500">
                  {enabled
                    ? 'Posicionada com destaque sobre o termo de responsabilidade e CREA'
                    : 'Assinatura digital desativada (exibirá apenas a linha pontilhada tradicional)'}
                </span>
              </div>
            </div>

            <label className="relative inline-flex items-center cursor-pointer flex-shrink-0">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-600" />
            </label>
          </div>

          {enabled && (
            <>
              {/* Botões de Seleção do Método de Assinatura */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider">
                  Método de Inserção da Assinatura:
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveTab('drawn')}
                    className={`flex flex-col items-center justify-center p-3 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                      activeTab === 'drawn'
                        ? 'bg-blue-50 border-blue-600 text-blue-900 shadow-xs ring-1 ring-blue-500'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <PenTool className="w-5 h-5 mb-1 text-blue-600" />
                    <span>Desenhar Traço</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab('upload')}
                    className={`flex flex-col items-center justify-center p-3 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                      activeTab === 'upload'
                        ? 'bg-blue-50 border-blue-600 text-blue-900 shadow-xs ring-1 ring-blue-500'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <Upload className="w-5 h-5 mb-1 text-indigo-600" />
                    <span>Carregar Imagem</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab('stamp')}
                    className={`flex flex-col items-center justify-center p-3 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                      activeTab === 'stamp'
                        ? 'bg-blue-50 border-blue-600 text-blue-900 shadow-xs ring-1 ring-blue-500'
                        : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <Stamp className="w-5 h-5 mb-1 text-emerald-600" />
                    <span>Carimbo ICP / CREA</span>
                  </button>
                </div>
              </div>

              {/* CONTEÚDO DA ABA 1: DESENHO EM CANVAS */}
              {activeTab === 'drawn' && (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-600">Cor do Traço:</span>
                      <button
                        type="button"
                        onClick={() => setStrokeColor('#1d4ed8')}
                        className={`w-6 h-6 rounded-full bg-blue-700 border-2 transition-all cursor-pointer ${
                          strokeColor === '#1d4ed8' ? 'border-slate-900 scale-110 shadow-xs' : 'border-transparent'
                        }`}
                        title="Azul Caneta Técnico"
                      />
                      <button
                        type="button"
                        onClick={() => setStrokeColor('#0f172a')}
                        className={`w-6 h-6 rounded-full bg-slate-900 border-2 transition-all cursor-pointer ${
                          strokeColor === '#0f172a' ? 'border-blue-500 scale-110 shadow-xs' : 'border-transparent'
                        }`}
                        title="Preto Oficial"
                      />
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={handleUndoCanvas}
                        disabled={drawnHistory.length === 0}
                        className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-xs font-semibold disabled:opacity-40 cursor-pointer flex items-center gap-1"
                        title="Desfazer último traço"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span>Desfazer</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleClearCanvas}
                        className="px-2 py-1 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded text-xs font-semibold cursor-pointer flex items-center gap-1"
                        title="Limpar quadro"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>Limpar</span>
                      </button>
                    </div>
                  </div>

                  {/* Canvas Pad com suporte touch-none */}
                  <div className="relative border-2 border-dashed border-slate-300 rounded-xl bg-slate-50/60 overflow-hidden shadow-inner flex flex-col items-center justify-center">
                    <canvas
                      ref={canvasRef}
                      width={560}
                      height={180}
                      className="w-full h-44 bg-transparent cursor-crosshair touch-none"
                      onPointerDown={handlePointerDown}
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerUp}
                      onPointerLeave={handlePointerUp}
                    />

                    {/* Guia visual da linha de assinatura */}
                    <div className="absolute bottom-6 left-12 right-12 border-b border-slate-300 pointer-events-none" />
                    <div className="absolute bottom-2 left-0 right-0 text-center pointer-events-none">
                      <span className="text-[10px] text-slate-400 font-sans">
                        Assine acima da linha com o dedo, mouse ou caneta stylus
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* CONTEÚDO DA ABA 2: UPLOAD DE ARQUIVO DE IMAGEM */}
              {activeTab === 'upload' && (
                <div className="space-y-3">
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept="image/png, image/jpeg, image/jpg, image/webp"
                    className="hidden"
                    onChange={handleFileUpload}
                  />

                  {uploadedImageUrl ? (
                    <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                      <div className="h-36 bg-white border border-slate-200 rounded-lg p-2 flex items-center justify-center relative overflow-hidden shadow-inner">
                        <img
                          src={uploadedImageUrl}
                          alt="Assinatura Carregada"
                          className="max-h-full max-w-full object-contain"
                        />
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <label className="flex items-center gap-2 text-xs font-semibold text-slate-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={autoCleanBackground}
                            onChange={(e) => setAutoCleanBackground(e.target.checked)}
                            className="rounded text-blue-600 focus:ring-blue-500"
                          />
                          <span>Remover fundo branco da folha automaticamente</span>
                        </label>

                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="px-2.5 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-lg text-xs font-bold transition-all cursor-pointer"
                          >
                            Trocar Arquivo
                          </button>
                          <button
                            type="button"
                            onClick={() => setUploadedImageUrl(null)}
                            className="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg text-xs font-bold transition-all cursor-pointer"
                          >
                            Remover
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className="border-2 border-dashed border-slate-300 hover:border-blue-500 rounded-xl p-6 text-center cursor-pointer transition-all bg-slate-50/50 hover:bg-blue-50/30 group"
                    >
                      <div className="w-12 h-12 rounded-full bg-blue-100 text-blue-600 mx-auto flex items-center justify-center mb-2 group-hover:scale-105 transition-transform">
                        <Upload className="w-6 h-6" />
                      </div>
                      <span className="block font-bold text-slate-800 text-xs sm:text-sm">
                        Clique para selecionar a imagem da assinatura
                      </span>
                      <span className="block text-[11px] text-slate-500 mt-0.5">
                        Formatos suportados: PNG, JPG ou digitalização com fundo limpo
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* CONTEÚDO DA ABA 3: CARIMBO ELETRÔNICO ICP / CREA */}
              {activeTab === 'stamp' && (
                <div className="p-4 bg-gradient-to-br from-blue-50 to-slate-50 border border-blue-200 rounded-xl space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-blue-600 text-white flex items-center justify-center flex-shrink-0 shadow-sm">
                      <Lock className="w-5 h-5" />
                    </div>
                    <div>
                      <h4 className="font-extrabold text-blue-950 text-sm">
                        Certificação Eletrônica Padronizada CREA / ICP
                      </h4>
                      <p className="text-xs text-blue-800 leading-snug mt-0.5">
                        Gera automaticamente um carimbo digital com chave criptográfica, número de ART e dados do profissional.
                      </p>
                    </div>
                  </div>

                  <div className="bg-white border-2 border-blue-600 rounded-lg p-3 text-center space-y-1 shadow-sm">
                    <p className="text-[11px] font-black text-blue-900 uppercase tracking-wider">
                      ASSINADO DIGITALMENTE
                    </p>
                    <p className="text-sm font-bold text-slate-900">{signerName || client.tecnico}</p>
                    <p className="text-[11px] text-slate-700">{signerRole || client.cargo}</p>
                    <p className="text-[11px] font-mono font-bold text-blue-800">{signerCrea || client.crea}</p>
                    <p className="text-[9px] font-mono text-slate-500 pt-0.5">
                      Hash: {hashSha256.slice(0, 24)}... | {signedAt}
                    </p>
                  </div>
                </div>
              )}

              {/* DADOS DO SIGNATÁRIO E CHAVE CRIPTOGRÁFICA */}
              <div className="pt-2 border-t border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Dados do Signatário Registrados no Laudo:
                  </span>
                  <button
                    type="button"
                    onClick={handleUpdateSignedAtToNow}
                    className="text-[11px] text-blue-600 hover:text-blue-800 font-bold flex items-center gap-1 cursor-pointer"
                    title="Atualiza data e hora para o instante atual"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Atualizar Data/Hora para Agora</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">
                      Nome do Engenheiro / Técnico
                    </label>
                    <input
                      type="text"
                      value={signerName}
                      onChange={(e) => setSignerName(e.target.value)}
                      placeholder="Ex: JÔNATAS PEREIRA PAVANELO"
                      className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">
                      Título / Qualificação
                    </label>
                    <input
                      type="text"
                      value={signerRole}
                      onChange={(e) => setSignerRole(e.target.value)}
                      placeholder="Ex: Engenheiro Eletricista"
                      className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">
                      Registro no CREA / CFT
                    </label>
                    <input
                      type="text"
                      value={signerCrea}
                      onChange={(e) => setSignerCrea(e.target.value)}
                      placeholder="Ex: CREA-SP 5063896203"
                      className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none font-mono"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 mb-1">
                      Número da ART do Laudo
                    </label>
                    <input
                      type="text"
                      value={signerArt}
                      onChange={(e) => setSignerArt(e.target.value)}
                      placeholder="Ex: 28027230230912"
                      className="w-full px-3 py-1.5 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none font-mono"
                    />
                  </div>
                </div>

                {/* Selo de Validação e Código Hash */}
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
                  <label className="flex items-center gap-2 text-xs font-bold text-slate-800 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={showValidationStamp}
                      onChange={(e) => setShowValidationStamp(e.target.checked)}
                      className="rounded text-blue-600 focus:ring-blue-500 w-4 h-4"
                    />
                    <span>Exibir Selo de Autenticidade Digital ao lado da Assinatura</span>
                  </label>

                  <div className="flex items-center justify-between text-[11px] text-slate-600 pt-1 border-t border-slate-200">
                    <div className="flex items-center gap-1 font-mono truncate">
                      <span className="text-slate-400">Hash:</span>
                      <span className="font-bold text-blue-900 truncate">{hashSha256}</span>
                    </div>
                    <button
                      type="button"
                      onClick={handleRegenerateHash}
                      className="text-blue-600 hover:text-blue-800 font-semibold underline text-[10px] ml-2 flex-shrink-0 cursor-pointer"
                    >
                      Recalcular Hash
                    </button>
                  </div>
                </div>

                {/* Salvar ou Carregar Padrão no Navegador */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleSaveAsDefault}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold transition-all cursor-pointer"
                    title="Salva sua assinatura para reutilizar em outros laudos"
                  >
                    <BookmarkCheck className="w-4 h-4 text-emerald-600" />
                    <span>Salvar como Minha Assinatura Padrão</span>
                  </button>

                  {savedDefaultExists && (
                    <button
                      type="button"
                      onClick={handleLoadStoredDefault}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-xs font-bold transition-all cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-blue-600" />
                      <span>Usar Minha Assinatura Salva</span>
                    </button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Action Buttons Footer */}
        <div className="p-4 sm:p-5 bg-slate-50 border-t border-slate-200 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold text-slate-600 hover:text-slate-800 hover:bg-slate-200/60 transition-colors cursor-pointer"
          >
            CANCELAR
          </button>

          <button
            type="button"
            onClick={handleApplySignature}
            className="flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl text-xs sm:text-sm font-extrabold bg-blue-600 hover:bg-blue-500 text-white shadow-md transition-all cursor-pointer"
          >
            <Check className="w-4 h-4" />
            <span>APLICAR AO LAUDO</span>
          </button>
        </div>
      </div>
    </div>
  );
};
