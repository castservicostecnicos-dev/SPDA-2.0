import React, { useState, useEffect } from 'react';
import {
  Folder,
  FolderTree,
  FolderCheck,
  HardDrive,
  CheckCircle2,
  AlertCircle,
  Download,
  RefreshCw,
  X,
  ChevronRight,
  FolderSync,
  Layers,
  Camera,
  FileCheck,
  FileText,
  Clock,
  Sparkles,
  ShieldCheck,
  Check,
  Zap,
} from 'lucide-react';
import { SpdaReport } from '../types/spda';
import { saveReportToStorage } from '../utils/storage';
import {
  ensureRealDocumentFoldersCreated,
  hasDirectoryPickerSupport,
  pickAndConnectDeviceFolder,
  getConnectedDeviceFolderHandle,
  getOrRequestConnectedDeviceFolderHandle,
  reconnectStoredDeviceFolder,
  getStoredDeviceFolderInfo,
  disconnectDeviceFolder,
  downloadAllPhotosAsOrganizedZip,
  inspectReportSyncStatus,
  SyncInspectionResult,
  sanitizeFolderName,
} from '../utils/photoDeviceSync';

interface RealFoldersSyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  report: SpdaReport;
  onSyncComplete?: (syncedCount: number, folderPath: string) => void;
  onReportUpdated?: (updatedReport: SpdaReport) => void;
}

export const RealFoldersSyncModal: React.FC<RealFoldersSyncModalProps> = ({
  isOpen,
  onClose,
  report,
  onSyncComplete,
  onReportUpdated,
}) => {
  const [connectedFolderName, setConnectedFolderName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isInspecting, setIsInspecting] = useState(false);
  const [inspection, setInspection] = useState<SyncInspectionResult | null>(null);
  const [forceFullSync, setForceFullSync] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [progressPct, setProgressPct] = useState(0);
  const [currentFileWriting, setCurrentFileWriting] = useState<string | null>(null);
  const [currentSyncPhase, setCurrentSyncPhase] = useState<'connect' | 'read' | 'diff' | 'write' | 'finalize'>('connect');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successInfo, setSuccessInfo] = useState<{
    path: string;
    count: number;
    newlySynced: number;
    alreadyExisting: number;
    timeFormatted: string;
  } | null>(null);
  const [isDownloadingZip, setIsDownloadingZip] = useState(false);

  const condoName = sanitizeFolderName(report.client?.name);
  const currentTower = report.torreAtual || 'Torre 1';

  // Lista todas as torres cadastradas (incluindo Área Comum sempre presente)
  const configuredTowers =
    report.client?.torresNomes && report.client.torresNomes.length > 0
      ? report.client.torresNomes
      : Array.from({ length: report.client?.quantidadeTorres || 1 }, (_, i) => `Torre ${i + 1}`);
  const torresList = [
    'Área Comum',
    ...configuredTowers.filter((t) => t !== 'Área Comum'),
  ];

  // Contagem de fotos do laudo em andamento
  const countPhotos = () => {
    let total =
      report.spdaPhotos.length +
      report.measurementPhotos.length +
      report.quadrosPhotos.length +
      report.localPhotos.length;

    if (report.torresData) {
      Object.entries(report.torresData).forEach(([tNome, data]) => {
        if (tNome !== currentTower) {
          total +=
            (data.spdaPhotos?.length || 0) +
            (data.measurementPhotos?.length || 0) +
            (data.quadrosPhotos?.length || 0) +
            (data.localPhotos?.length || 0);
        }
      });
    }
    return total;
  };

  const totalPhotosCount = countPhotos();
  const hasFsSupport = hasDirectoryPickerSupport();

  // Executa leitura dinâmica rápida dos arquivos no disco
  const runFastInspection = async () => {
    setIsInspecting(true);
    try {
      const stored = await getStoredDeviceFolderInfo();
      if (stored.folderName) {
        setConnectedFolderName(stored.folderName);
      }
      const res = await inspectReportSyncStatus(report);
      setInspection(res);
      if (res.connectedFolderName) {
        setConnectedFolderName(res.connectedFolderName);
      }
    } catch (err) {
      console.warn('Erro na inspeção rápida:', err);
    } finally {
      setIsInspecting(false);
    }
  };

  // Reativação rápida com 1 clique usando o handle memorizado
  const handleQuickReconnect = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    setProgressMsg('Reativando acesso à pasta memorizada...');
    try {
      const res = await reconnectStoredDeviceFolder();
      if (res.success) {
        if (res.folderName) setConnectedFolderName(res.folderName);
        await runFastInspection();
      } else {
        setErrorMessage(res.error || 'Não foi possível reativar o acesso.');
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Falha ao reativar permissão da pasta.');
    } finally {
      setIsLoading(false);
    }
  };

  // Verifica e inspeciona ao abrir o modal
  useEffect(() => {
    if (!isOpen) return;
    setErrorMessage(null);
    setSuccessInfo(null);
    setProgressPct(0);
    setProgressMsg('');
    setCurrentFileWriting(null);
    setCurrentSyncPhase('connect');
    setForceFullSync(false);
    runFastInspection();
  }, [isOpen, report]);

  if (!isOpen) return null;

  // Executa a sincronização inteligente incremental (apenas arquivos faltantes)
  const handleCreateFoldersAndSync = async (force = false) => {
    setIsLoading(true);
    setErrorMessage(null);
    setSuccessInfo(null);
    setProgressPct(10);
    setCurrentSyncPhase('connect');
    setProgressMsg('Conectando à pasta no disco e verificando permissões...');
    setCurrentFileWriting(null);

    try {
      let handle = await getConnectedDeviceFolderHandle();

      // Se ainda não conectou diretamente, tenta reativar o handle já armazenado no aparelho
      if (!handle) {
        setProgressMsg('Reativando permissão da pasta salva...');
        const reconnectRes = await reconnectStoredDeviceFolder();
        if (reconnectRes.success && reconnectRes.handle) {
          handle = reconnectRes.handle;
          setConnectedFolderName(reconnectRes.folderName || 'Documentos');
        } else {
          // Se não havia pasta salva ou falhou, abre a seleção
          setProgressMsg('Aguardando você selecionar a pasta de Documentos...');
          const pickRes = await pickAndConnectDeviceFolder();
          if (!pickRes.success) {
            throw new Error(pickRes.error || 'Seleção de pasta cancelada.');
          }
          setConnectedFolderName(pickRes.folderName || 'Documentos');
          handle = await getConnectedDeviceFolderHandle();
        }
      }

      setCurrentSyncPhase('read');
      setProgressPct(25);
      setProgressMsg('Leitura dinâmica ultra-rápida dos arquivos já gravados no disco...');

      // Executa a sincronização dinâmica: leitura ultrarrápida e gravação SOMENTE dos faltantes!
      const res = await ensureRealDocumentFoldersCreated(report, {
        forceFull: force,
        onProgress: (pct, msg) => {
          setProgressPct(pct);
          setProgressMsg(msg);

          if (pct < 30) {
            setCurrentSyncPhase('read');
          } else if (pct < 40) {
            setCurrentSyncPhase('diff');
          } else if (pct < 90) {
            setCurrentSyncPhase('write');
            if (msg.includes('>')) {
              setCurrentFileWriting(msg);
            }
          } else {
            setCurrentSyncPhase('finalize');
          }
        },
      });

      if (!res.success) {
        throw new Error(res.error || 'Falha ao sincronizar pastas no disco.');
      }

      setSuccessInfo({
        path: res.folderPath,
        count: res.totalOnDisk,
        newlySynced: res.newlySyncedPhotos,
        alreadyExisting: res.alreadyExistingPhotos,
        timeFormatted: res.lastSyncedFormatted,
      });

      if (res.updatedReport) {
        onReportUpdated?.(res.updatedReport);
        try {
          await saveReportToStorage(res.updatedReport);
        } catch (saveErr) {
          console.warn('Aviso ao salvar laudo com novos timestamps:', saveErr);
        }
      }

      await runFastInspection();
      onSyncComplete?.(res.totalOnDisk, res.folderPath);
    } catch (err: any) {
      console.error(err);
      setErrorMessage(err?.message || 'Erro ao sincronizar pastas físicas no dispositivo.');
    } finally {
      setIsLoading(false);
    }
  };

  // Alternativa via download de ZIP estruturado
  const handleDownloadStructuredZip = async () => {
    setIsDownloadingZip(true);
    setErrorMessage(null);
    setProgressPct(15);
    setCurrentSyncPhase('write');
    setProgressMsg('Empacotando estrutura de pastas para todas as torres...');

    try {
      const res = await downloadAllPhotosAsOrganizedZip(report, (pct, msg) => {
        setProgressPct(pct);
        setProgressMsg(msg);
      });
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const timeFormatted = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
      setSuccessInfo({
        path: `Download concluído: ${res.fileName} (Extraia na pasta de Documentos)`,
        count: res.totalPhotos,
        newlySynced: res.totalPhotos,
        alreadyExisting: 0,
        timeFormatted,
      });
    } catch (err: any) {
      console.error(err);
      setErrorMessage(err?.message || 'Erro ao gerar arquivo de pastas.');
    } finally {
      setIsDownloadingZip(false);
    }
  };

  const handleDisconnect = async () => {
    await disconnectDeviceFolder();
    setConnectedFolderName(null);
    setSuccessInfo(null);
    await runFastInspection();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/85 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full border border-slate-200 overflow-hidden flex flex-col max-h-[94vh]">
        {/* Top Header */}
        <div className="bg-gradient-to-r from-slate-950 via-slate-900 to-blue-950 text-white p-4 sm:p-5 flex items-start justify-between gap-3 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center text-emerald-400 flex-shrink-0 shadow-inner">
              <FolderTree className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black tracking-wide flex items-center gap-2">
                Sincronização de Pastas no Disco
                <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                  Incremental
                </span>
              </h2>
            </div>
          </div>
          {!isLoading && !isDownloadingZip && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* ========================================================
            TELA DE CARREGAMENTO COMPLETA E DEDICADA (QUANDO EM ANDAMENTO)
            Garante visualização dinâmica e completa com etapas reais
            ======================================================== */}
        {isLoading || isDownloadingZip ? (
          <div className="p-6 sm:p-8 flex flex-col items-center justify-center space-y-6 text-center animate-in fade-in duration-300">
            {/* Ícone Animado com Efeito Pulso */}
            <div className="relative flex items-center justify-center">
              <div className="absolute w-24 h-24 rounded-full bg-emerald-400/20 animate-ping" />
              <div className="relative w-20 h-20 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white flex items-center justify-center shadow-lg shadow-emerald-500/30">
                <FolderSync className="w-10 h-10 animate-spin" style={{ animationDuration: '3s' }} />
              </div>
            </div>

            {/* Título e Subtítulo Claros */}
            <div className="space-y-1.5 max-w-md">
              <h3 className="text-lg sm:text-xl font-extrabold text-slate-900 tracking-tight">
                {isDownloadingZip ? 'Preparando Pacote de Pastas...' : 'Sincronizando com as Pastas do Disco'}
              </h3>
            </div>

            {/* Pílulas de Status da Sincronização Dinâmica */}
            <div className="flex flex-wrap items-center justify-center gap-2">
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 border border-slate-200 text-xs font-semibold text-slate-700">
                <Clock className="w-3.5 h-3.5 text-blue-600" />
                <span>Último salvamento: {inspection?.lastSyncedFormatted ? `às ${inspection.lastSyncedFormatted}` : 'Início'}</span>
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-xs font-semibold text-emerald-800">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                <span>{inspection?.alreadySyncedCount || 0} fotos já salvas (intactas)</span>
              </div>
              <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-50 border border-amber-200 text-xs font-semibold text-amber-800">
                <Zap className="w-3.5 h-3.5 text-amber-600" />
                <span>Sincronizando {inspection?.missingCount ?? totalPhotosCount} faltante(s)</span>
              </div>
            </div>

            {/* Barra de Progresso Completa com Contador */}
            <div className="w-full max-w-md space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                <span className="flex items-center gap-1.5 text-slate-900 truncate">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin text-emerald-600 flex-shrink-0" />
                  <span className="truncate">{progressMsg || 'Processando sincronização...'}</span>
                </span>
                <span className="text-emerald-700 text-sm font-black flex-shrink-0 ml-2">{progressPct}%</span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-3.5 p-0.5 border border-slate-200 overflow-hidden shadow-inner">
                <div
                  className="bg-gradient-to-r from-emerald-500 via-teal-500 to-emerald-600 h-2.5 rounded-full transition-all duration-300 shadow-sm"
                  style={{ width: `${Math.max(5, progressPct)}%` }}
                />
              </div>
            </div>

            {/* Checklist de Etapas Dinâmicas em Tempo Real */}
            <div className="w-full max-w-md bg-slate-50 border border-slate-200 rounded-xl p-4 text-left text-xs space-y-2.5 font-medium text-slate-600">
              {/* Etapa 1: Conexão */}
              <div className="flex items-center gap-2">
                {currentSyncPhase !== 'connect' ? (
                  <Check className="w-4 h-4 text-emerald-600 flex-shrink-0 font-bold" />
                ) : (
                  <RefreshCw className="w-4 h-4 text-emerald-600 animate-spin flex-shrink-0" />
                )}
                <span className={currentSyncPhase === 'connect' ? 'text-slate-900 font-bold' : 'text-slate-700'}>
                  Conexão com a pasta do dispositivo (Documentos / LAUDOS SPDA)
                </span>
              </div>

              {/* Etapa 2: Leitura Rápida */}
              <div className="flex items-center gap-2">
                {['diff', 'write', 'finalize'].includes(currentSyncPhase) ? (
                  <Check className="w-4 h-4 text-emerald-600 flex-shrink-0 font-bold" />
                ) : currentSyncPhase === 'read' ? (
                  <RefreshCw className="w-4 h-4 text-emerald-600 animate-spin flex-shrink-0" />
                ) : (
                  <div className="w-4 h-4 rounded-full border border-slate-300 flex-shrink-0" />
                )}
                <span className={currentSyncPhase === 'read' ? 'text-slate-900 font-bold' : currentSyncPhase === 'connect' ? 'text-slate-400' : 'text-slate-700'}>
                  Leitura rápida: {inspection?.alreadySyncedCount || 0} arquivos existentes identificados no disco
                </span>
              </div>

              {/* Etapa 3: Identificação de Alterações */}
              <div className="flex items-center gap-2">
                {['write', 'finalize'].includes(currentSyncPhase) ? (
                  <Check className="w-4 h-4 text-emerald-600 flex-shrink-0 font-bold" />
                ) : currentSyncPhase === 'diff' ? (
                  <RefreshCw className="w-4 h-4 text-emerald-600 animate-spin flex-shrink-0" />
                ) : (
                  <div className="w-4 h-4 rounded-full border border-slate-300 flex-shrink-0" />
                )}
                <span className={currentSyncPhase === 'diff' ? 'text-slate-900 font-bold' : ['connect', 'read'].includes(currentSyncPhase) ? 'text-slate-400' : 'text-slate-700'}>
                  Filtragem delta: identificados {inspection?.missingCount ?? totalPhotosCount} arquivo(s) faltante(s)
                </span>
              </div>

              {/* Etapa 4: Gravação dos Faltantes */}
              <div className="flex items-center gap-2">
                {currentSyncPhase === 'finalize' ? (
                  <Check className="w-4 h-4 text-emerald-600 flex-shrink-0 font-bold" />
                ) : currentSyncPhase === 'write' ? (
                  <RefreshCw className="w-4 h-4 text-emerald-600 animate-spin flex-shrink-0" />
                ) : (
                  <div className="w-4 h-4 rounded-full border border-slate-300 flex-shrink-0" />
                )}
                <span className={currentSyncPhase === 'write' ? 'text-slate-900 font-bold' : currentSyncPhase === 'finalize' ? 'text-slate-700' : 'text-slate-400'}>
                  Gravando apenas arquivos faltantes: {currentFileWriting ? currentFileWriting.slice(0, 42) : 'em andamento...'}
                </span>
              </div>

              {/* Etapa 5: Finalização */}
              <div className="flex items-center gap-2">
                {currentSyncPhase === 'finalize' ? (
                  <Check className="w-4 h-4 text-emerald-600 flex-shrink-0 font-bold" />
                ) : (
                  <div className="w-4 h-4 rounded-full border border-slate-300 flex-shrink-0" />
                )}
                <span className={currentSyncPhase === 'finalize' ? 'text-slate-900 font-bold' : 'text-slate-400'}>
                  Atualizando informações do laudo e índice do condomínio
                </span>
              </div>
            </div>
          </div>
        ) : successInfo ? (
          /* ========================================================
             TELA DE SUCESSO COMPLETA COM RELATÓRIO INCREMENTAL
             ======================================================== */
          <div className="p-6 sm:p-8 space-y-5 text-slate-800 animate-in fade-in duration-200">
            <div className="text-center space-y-2">
              <div className="w-16 h-16 rounded-2xl bg-emerald-100 border border-emerald-300 text-emerald-700 mx-auto flex items-center justify-center shadow-md">
                <CheckCircle2 className="w-10 h-10" />
              </div>
              <h3 className="text-lg sm:text-xl font-extrabold text-emerald-950">
                {successInfo.newlySynced > 0
                  ? `✓ ${successInfo.newlySynced} Novo(s) Arquivo(s) Sincronizado(s)!`
                  : '✓ Todos os Arquivos Já Estão Sincronizados!'}
              </h3>
            </div>

            {/* Grid com os 4 Indicadores de Sucesso */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-center">
                <span className="text-[10px] font-bold text-slate-500 uppercase block">Horário Salvo</span>
                <span className="text-sm font-black text-blue-700 block mt-0.5">Às {successInfo.timeFormatted}</span>
                <span className="text-[10px] text-slate-400">Ponto de corte</span>
              </div>
              <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-center">
                <span className="text-[10px] font-bold text-emerald-800 uppercase block">Novos Gravados</span>
                <span className="text-sm font-black text-emerald-800 block mt-0.5">+{successInfo.newlySynced}</span>
                <span className="text-[10px] text-emerald-600">Fotos faltantes</span>
              </div>
              <div className="bg-teal-50 border border-teal-200 rounded-xl p-3 text-center">
                <span className="text-[10px] font-bold text-teal-800 uppercase block">Preservados</span>
                <span className="text-sm font-black text-teal-800 block mt-0.5">{successInfo.alreadyExisting}</span>
                <span className="text-[10px] text-teal-600">Mantidos sem recriar</span>
              </div>
              <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-3 text-center">
                <span className="text-[10px] font-bold text-indigo-800 uppercase block">Total no Disco</span>
                <span className="text-sm font-black text-indigo-800 block mt-0.5">{successInfo.count}</span>
                <span className="text-[10px] text-indigo-600">Fotos no disco</span>
              </div>
            </div>

            {/* Informações de Pastas */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-xs space-y-2">
              <div className="flex items-center gap-2 text-slate-800 font-bold">
                <FolderCheck className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                <span>Caminho no Dispositivo:</span>
                <span className="font-mono text-emerald-900 bg-white px-2 py-0.5 rounded border border-slate-200 truncate">
                  {successInfo.path}
                </span>
              </div>
              <div className="flex items-center gap-2 text-slate-600 font-medium">
                <FileText className="w-4 h-4 text-indigo-600 flex-shrink-0" />
                <span>Arquivo de resumo:</span>
                <span className="font-mono text-indigo-900 font-bold bg-white px-2 py-0.5 rounded border border-slate-200">
                  INFORMACOES_DO_LAUDO.txt
                </span>
              </div>
            </div>
          </div>
        ) : (
          /* ========================================================
             PAINEL PRINCIPAL DE STATUS E CONFIGURAÇÃO
             ======================================================== */
          <div className="p-4 sm:p-6 overflow-y-auto space-y-4 text-slate-700 text-sm">
            {/* Status do Laudo em Andamento e Leitura Dinâmica do Disco */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
                <span className="text-[11px] font-bold text-slate-500 uppercase flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                  Último Salvamento
                </span>
                <span className="font-extrabold text-slate-900 block text-sm mt-0.5">
                  {isInspecting ? (
                    <span className="text-slate-400 text-xs flex items-center gap-1">
                      <RefreshCw className="w-3 h-3 animate-spin" /> Verificando...
                    </span>
                  ) : inspection?.lastSyncedFormatted ? (
                    <span className="text-blue-700 font-black">Às {inspection.lastSyncedFormatted}</span>
                  ) : (
                    <span className="text-slate-400 font-normal">Nenhum ainda</span>
                  )}
                </span>
                <p className="text-[10px] text-slate-500 mt-0.5">Ponto de referência delta</p>
              </div>

              <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-3">
                <span className="text-[11px] font-bold text-emerald-800 uppercase flex items-center gap-1.5">
                  <FolderCheck className="w-3.5 h-3.5 text-emerald-600" />
                  Já Criados no Disco
                </span>
                <span className="font-extrabold text-emerald-800 block text-sm mt-0.5">
                  {isInspecting ? (
                    <span className="text-emerald-600 text-xs flex items-center gap-1">
                      <RefreshCw className="w-3 h-3 animate-spin" /> Lendo disco...
                    </span>
                  ) : (
                    `${inspection?.alreadySyncedCount ?? 0} foto(s)`
                  )}
                </span>
                <p className="text-[10px] text-emerald-700 mt-0.5">Preservados sem recriação</p>
              </div>

              <div
                className={`border rounded-xl p-3 ${
                  (inspection?.missingCount ?? totalPhotosCount) > 0
                    ? 'bg-amber-50/80 border-amber-300'
                    : 'bg-emerald-50/70 border-emerald-200'
                }`}
              >
                <span
                  className={`text-[11px] font-bold uppercase flex items-center gap-1.5 ${
                    (inspection?.missingCount ?? totalPhotosCount) > 0 ? 'text-amber-800' : 'text-emerald-800'
                  }`}
                >
                  <Zap className="w-3.5 h-3.5" />
                  Arquivos Faltantes
                </span>
                <span
                  className={`font-extrabold block text-sm mt-0.5 ${
                    (inspection?.missingCount ?? totalPhotosCount) > 0 ? 'text-amber-700 font-black' : 'text-emerald-700'
                  }`}
                >
                  {isInspecting ? (
                    <span className="text-slate-400 text-xs flex items-center gap-1">
                      <RefreshCw className="w-3 h-3 animate-spin" /> Calculando...
                    </span>
                  ) : (inspection?.missingCount ?? totalPhotosCount) > 0 ? (
                    `${inspection?.missingCount ?? totalPhotosCount} nova(s) para sincronizar`
                  ) : (
                    '0 pendentes (100% em dia)'
                  )}
                </span>
                <p className="text-[10px] text-slate-500 mt-0.5">
                  {(inspection?.missingCount ?? totalPhotosCount) > 0
                    ? 'Novos arquivos a gravar'
                    : 'Tudo gravado no disco'}
                </p>
              </div>
            </div>

            {/* Detalhamento dos Arquivos Faltantes (se houver) */}
            {inspection && inspection.missingSummary && inspection.missingSummary.length > 0 && (
              <div className="bg-amber-50/90 border border-amber-200 rounded-xl p-3.5 space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-amber-900">
                  <span className="flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4 text-amber-600 flex-shrink-0" />
                    Novos arquivos identificados após o último salvamento:
                  </span>
                  <span className="bg-amber-200/80 text-amber-900 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold">
                    {inspection.missingCount} arquivo(s)
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {inspection.missingSummary.map((sum, sIdx) => (
                    <span
                      key={sIdx}
                      className="text-[11px] font-semibold bg-white border border-amber-300 text-amber-900 px-2.5 py-1 rounded-md shadow-xs"
                    >
                      • {sum}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Mensagem quando todos os arquivos já estão sincronizados */}
            {inspection && inspection.missingCount === 0 && inspection.alreadySyncedCount > 0 && (
              <div className="bg-emerald-50 border border-emerald-300 rounded-xl p-3.5 text-xs text-emerald-900 flex items-center gap-2.5">
                <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
                <div>
                  <strong>Tudo em dia no disco:</strong> Todas as {inspection.alreadySyncedCount} fotos já estão gravadas na pasta <span className="font-mono text-emerald-950 font-bold">Documentos/LAUDOS SPDA/{condoName}</span>. Nenhuma regravação necessária.
                </div>
              </div>
            )}

            {/* Breadcrumb visual da estrutura real de pastas */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  Estrutura de Pastas Criada no Disco do Dispositivo:
                </span>
                <span className="text-[11px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full border border-emerald-300">
                  NBR 5419:2026
                </span>
              </div>

              <div className="bg-white border border-slate-200 rounded-lg p-2.5 font-mono text-xs text-slate-800 space-y-1 overflow-x-auto">
                <div className="flex items-center gap-1.5 font-bold text-blue-700">
                  <Folder className="w-4 h-4 fill-blue-500 text-blue-600" />
                  <span>Documentos/</span>
                </div>
                <div className="flex items-center gap-1.5 pl-4 font-bold text-emerald-700">
                  <span className="text-slate-300">└──</span>
                  <Folder className="w-4 h-4 fill-emerald-500 text-emerald-600" />
                  <span>LAUDOS SPDA/</span>
                </div>
                <div className="flex items-center gap-1.5 pl-8 font-bold text-amber-700">
                  <span className="text-slate-300">└──</span>
                  <Folder className="w-4 h-4 fill-amber-500 text-amber-600" />
                  <span>{condoName}/</span>
                  <span className="text-[10px] font-sans font-normal text-slate-500 ml-1">(com INFORMACOES_DO_LAUDO.txt)</span>
                </div>
                <div className="flex items-center gap-1.5 pl-12 font-bold text-indigo-700">
                  <span className="text-slate-300">└──</span>
                  <Folder className="w-4 h-4 fill-indigo-500 text-indigo-600" />
                  <span>[Torres: {torresList.join(', ')}]/</span>
                </div>
                <div className="pl-16 space-y-0.5 text-[11px] text-slate-600 font-semibold">
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-300">├──</span>
                    <Folder className="w-3.5 h-3.5 text-slate-400" />
                    <span className="text-slate-900 font-bold">spda existente/</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-300">├──</span>
                    <Folder className="w-3.5 h-3.5 text-slate-400" />
                    <span className="text-slate-900 font-bold">quadros/</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-slate-300">└──</span>
                    <Folder className="w-3.5 h-3.5 text-slate-400" />
                    <span className="text-slate-900 font-bold">pontos de inspeção/</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Status da Pasta Conectada / Memorizada */}
            {connectedFolderName && (
              <div
                className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl text-xs border ${
                  inspection?.connected
                    ? 'bg-blue-50/80 border-blue-200 text-blue-900'
                    : 'bg-emerald-50 border-emerald-300 text-emerald-950 shadow-xs'
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      inspection?.connected ? 'bg-blue-200/70 text-blue-800' : 'bg-emerald-200 text-emerald-800'
                    }`}
                  >
                    <FolderCheck className="w-4 h-4" />
                  </div>
                  <div>
                    <span className="block font-bold text-slate-800">
                      Pasta configurada: <span className="font-mono text-emerald-800">{connectedFolderName}</span>
                    </span>
                    <span className="text-[11px] text-slate-600">
                      {inspection?.connected
                        ? '✓ Conexão física ativa e pronta para salvar fotos automaticamente'
                        : 'Permissão pendente de confirmação rápida de 1 clique após recarregar a tela'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-auto">
                  {!inspection?.connected && hasFsSupport && (
                    <button
                      type="button"
                      onClick={handleQuickReconnect}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-xs cursor-pointer flex items-center gap-1.5"
                    >
                      <Zap className="w-3.5 h-3.5" />
                      Reativar Acesso (1 Clique)
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleDisconnect}
                    className="text-slate-500 hover:text-rose-600 text-xs font-semibold underline cursor-pointer px-1 py-1"
                  >
                    Trocar Pasta
                  </button>
                </div>
              </div>
            )}

            {/* Mensagem de Erro (se houver) */}
            {errorMessage && (
              <div className="bg-rose-50 border border-rose-300 rounded-xl p-4 text-rose-950 space-y-1 animate-in fade-in">
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-5 h-5 text-rose-600 flex-shrink-0" />
                  <h4 className="font-bold text-sm text-rose-900">Atenção</h4>
                </div>
                <p className="text-xs text-rose-800">{errorMessage}</p>
              </div>
            )}
          </div>
        )}

        {/* Action Buttons Footer */}
        <div className="p-4 sm:p-5 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading || isDownloadingZip}
            className="px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold text-slate-600 hover:text-slate-800 hover:bg-slate-200/60 transition-colors cursor-pointer disabled:opacity-50"
          >
            {successInfo ? 'CONCLUIR' : 'FECHAR'}
          </button>

          {!successInfo && !isLoading && !isDownloadingZip && (
            <>
              {/* Opção 1: Gravação Incremental Rápida no Disco */}
              {hasFsSupport && (
                <div className="flex flex-col sm:flex-row items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleCreateFoldersAndSync(false)}
                    disabled={isLoading || isDownloadingZip}
                    className={`flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-xs sm:text-sm font-extrabold text-white shadow-md transition-all cursor-pointer disabled:opacity-50 ${
                      (inspection?.missingCount ?? totalPhotosCount) > 0
                        ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500'
                        : 'bg-emerald-700 hover:bg-emerald-600'
                    }`}
                  >
                    {(inspection?.missingCount ?? totalPhotosCount) === 0 && (inspection?.alreadySyncedCount || totalPhotosCount) > 0 ? (
                      <>
                        <Check className="w-4 h-4 text-emerald-200" />
                        <span>✓ TODAS AS {inspection?.alreadySyncedCount || totalPhotosCount} FOTOS JÁ ESTÃO SALVAS</span>
                      </>
                    ) : (
                      <>
                        <HardDrive className="w-4 h-4 text-emerald-200" />
                        <span>
                          {(inspection?.missingCount ?? totalPhotosCount) > 0
                            ? `SALVAR ${(inspection?.missingCount ?? totalPhotosCount)} NOVA(S) FOTO(S) FALTANTE(S)`
                            : `SINCRONIZAR PASTAS (${inspection?.alreadySyncedCount || totalPhotosCount} NO DISCO)`}
                        </span>
                      </>
                    )}
                  </button>

                  {/* Opção de forçar sincronização completa se necessário */}
                  {inspection && inspection.alreadySyncedCount > 0 && (
                    <button
                      type="button"
                      onClick={() => handleCreateFoldersAndSync(true)}
                      disabled={isLoading || isDownloadingZip}
                      className="text-[11px] text-slate-500 hover:text-slate-700 underline font-semibold px-2 py-1 cursor-pointer"
                      title="Sobrescreve e regrava todos os arquivos do laudo do zero"
                    >
                      Forçar regravação completa
                    </button>
                  )}
                </div>
              )}

              {/* Opção 2: Baixar Estrutura Completa em ZIP (Para qualquer dispositivo / celular / fallback) */}
              <button
                type="button"
                onClick={handleDownloadStructuredZip}
                disabled={isLoading || isDownloadingZip}
                className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-extrabold bg-slate-800 hover:bg-slate-700 text-white shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                title="Gera e baixa o arquivo com a estrutura real exata de pastas (LAUDOS SPDA)"
              >
                <Download className="w-4 h-4 text-emerald-400" />
                <span>BAIXAR PASTAS (ZIP / DOCUMENTOS)</span>
              </button>
            </>
          )}

          {successInfo && (
            <button
              type="button"
              onClick={onClose}
              className="flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl text-xs sm:text-sm font-extrabold bg-emerald-600 hover:bg-emerald-500 text-white shadow-md transition-colors cursor-pointer"
            >
              <Check className="w-4 h-4" />
              <span>OK, CONCLUÍDO</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
