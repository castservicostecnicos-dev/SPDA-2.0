import React, { useState, useRef } from 'react';
import {
  FolderUp,
  Archive,
  Image as ImageIcon,
  Check,
  AlertCircle,
  X,
  Building2,
  RefreshCw,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react';
import { SpdaReport, TowerData } from '../types/spda';
import {
  parsePhotosFromZipBackup,
  parsePhotosFromDirectoryOrFiles,
  ParsedRestoreResult,
} from '../utils/photoDeviceSync';

interface RestorePhotosModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentReport: SpdaReport;
  onApplyRestoredPhotos: (updatedReport: SpdaReport) => void;
}

export const RestorePhotosModal: React.FC<RestorePhotosModalProps> = ({
  isOpen,
  onClose,
  currentReport,
  onApplyRestoredPhotos,
}) => {
  const [loading, setLoading] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [progressPercent, setProgressPercent] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [restoredResult, setRestoredResult] = useState<ParsedRestoreResult | null>(null);

  const zipInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const filesInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleSelectZip = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setErrorMsg(null);
    setLoading(true);
    setProgressPercent(5);
    setProgressMsg('Iniciando leitura do arquivo ZIP...');

    try {
      const result = await parsePhotosFromZipBackup(file, (percent, msg) => {
        setProgressPercent(percent);
        setProgressMsg(msg);
      });
      setRestoredResult(result);
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err?.message || 'Falha ao processar o arquivo ZIP.');
    } finally {
      setLoading(false);
      if (e.target) e.target.value = '';
    }
  };

  const handleSelectFolderOrFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setErrorMsg(null);
    setLoading(true);
    setProgressPercent(5);
    setProgressMsg('Analisando fotos e estrutura de pastas...');

    try {
      const result = await parsePhotosFromDirectoryOrFiles(files, (percent, msg) => {
        setProgressPercent(percent);
        setProgressMsg(msg);
      });
      setRestoredResult(result);
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err?.message || 'Falha ao carregar fotos da pasta.');
    } finally {
      setLoading(false);
      if (e.target) e.target.value = '';
    }
  };

  const handleConfirmApply = () => {
    if (!restoredResult) return;

    const updatedTorresData: Record<string, TowerData> = { ...(currentReport.torresData || {}) };
    const currentTower = currentReport.torreAtual || 'Torre 1';

    // Aplica cada torre restaurada
    Object.entries(restoredResult.torres).forEach(([tNome, data]) => {
      const existing = updatedTorresData[tNome];
      updatedTorresData[tNome] = {
        id: tNome.toLowerCase().replace(/\s+/g, '-'),
        nome: tNome,
        spdaPhotos: [...data.spdaPhotos],
        measurementPhotos: [...data.measurementPhotos],
        quadrosPhotos: [...data.quadrosPhotos],
        localPhotos: [...data.localPhotos],
        equipmentPhotoUrl: existing?.equipmentPhotoUrl || currentReport.equipmentPhotoUrl,
        conditions: existing?.conditions || currentReport.conditions,
      };
    });

    // Se a torre atual foi uma das restauradas, aplica diretamente nos arrays principais
    const activeData = updatedTorresData[currentTower] || Object.values(updatedTorresData)[0];

    const updatedReport: SpdaReport = {
      ...currentReport,
      client: {
        ...currentReport.client,
        name: restoredResult.condoName && !currentReport.client.name ? restoredResult.condoName : currentReport.client.name,
      },
      torresData: updatedTorresData,
      spdaPhotos: activeData ? [...activeData.spdaPhotos] : currentReport.spdaPhotos,
      measurementPhotos: activeData ? [...activeData.measurementPhotos] : currentReport.measurementPhotos,
      quadrosPhotos: activeData ? [...activeData.quadrosPhotos] : currentReport.quadrosPhotos,
      localPhotos: activeData?.localPhotos?.length ? [...activeData.localPhotos] : currentReport.localPhotos,
    };

    onApplyRestoredPhotos(updatedReport);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150">
      <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-xl w-full shadow-2xl flex flex-col max-h-[90vh] overflow-hidden text-white">
        {/* Header do Modal */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/95">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center flex-shrink-0">
              <FolderUp className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white leading-tight">
                Puxar Fotos de Volta do Celular
              </h2>
              <p className="text-xs text-slate-400 leading-tight">
                Recupere as fotos organizadas por torre e seções sem perder nada
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            title="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Inputs ocultos */}
        <input
          ref={zipInputRef}
          type="file"
          accept=".zip"
          onChange={handleSelectZip}
          className="hidden"
        />
        <input
          ref={folderInputRef}
          type="file"
          // @ts-ignore
          webkitdirectory=""
          directory=""
          multiple
          onChange={handleSelectFolderOrFiles}
          className="hidden"
        />
        <input
          ref={filesInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleSelectFolderOrFiles}
          className="hidden"
        />

        {/* Conteúdo */}
        <div className="p-5 overflow-y-auto space-y-4">
          <div className="bg-blue-950/40 border border-blue-800/40 rounded-lg p-3 text-xs text-blue-200">
            Se você salvou as fotos na pasta <strong>Gerador de Laudos</strong> ou baixou o arquivo de backup <strong>ZIP</strong> no seu celular, selecione abaixo para restaurar as fotos automaticamente em cada torre correspondente:
          </div>

          {errorMsg && (
            <div className="bg-rose-950/60 border border-rose-800/80 rounded-lg p-3 text-xs text-rose-200 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {loading ? (
            <div className="bg-slate-800/70 border border-slate-700 rounded-xl p-6 text-center space-y-3">
              <RefreshCw className="w-8 h-8 text-blue-400 animate-spin mx-auto" />
              <div>
                <p className="text-sm font-bold text-white">{progressMsg}</p>
                <div className="w-full bg-slate-700 h-2 rounded-full overflow-hidden mt-3 max-w-xs mx-auto">
                  <div
                    className="bg-blue-500 h-full transition-all duration-300"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            </div>
          ) : restoredResult ? (
            /* Visualização das Fotos Encontradas para Confirmar Restauração */
            <div className="space-y-3">
              <div className="bg-emerald-950/40 border border-emerald-800/60 rounded-xl p-4">
                <div className="flex items-center gap-2 text-emerald-300 font-bold text-sm mb-1">
                  <ShieldCheck className="w-4 h-4" />
                  <span>{restoredResult.totalPhotosCount} fotos identificadas com sucesso!</span>
                </div>
                {restoredResult.condoName && (
                  <p className="text-xs text-emerald-200/80">
                    Condomínio detectado: <strong className="text-white">{restoredResult.condoName}</strong>
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Fotos divididas por torre:
                </h4>
                <div className="grid grid-cols-1 gap-2 max-h-56 overflow-y-auto pr-1">
                  {Object.entries(restoredResult.torres).map(([torreNome, data]) => {
                    const totalTorre =
                      data.spdaPhotos.length +
                      data.measurementPhotos.length +
                      data.quadrosPhotos.length +
                      data.localPhotos.length;

                    return (
                      <div
                        key={torreNome}
                        className="bg-slate-800/60 border border-slate-700/80 rounded-lg p-3 flex items-center justify-between gap-3"
                      >
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg bg-blue-600/30 text-blue-300 flex items-center justify-center font-bold text-xs">
                            <Building2 className="w-4 h-4" />
                          </div>
                          <div>
                            <span className="font-bold text-sm text-white">{torreNome}</span>
                            <div className="flex items-center gap-2 text-[11px] text-slate-400 mt-0.5">
                              <span>SPDA: <strong>{data.spdaPhotos.length}</strong></span>
                              <span>•</span>
                              <span>Medição: <strong>{data.measurementPhotos.length}</strong></span>
                              <span>•</span>
                              <span>Quadros: <strong>{data.quadrosPhotos.length}</strong></span>
                            </div>
                          </div>
                        </div>
                        <span className="text-xs font-bold bg-slate-700 px-2 py-1 rounded text-slate-200">
                          {totalTorre} foto(s)
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="pt-2 flex items-center justify-between gap-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setRestoredResult(null)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-white"
                >
                  Voltar / Escolher outro arquivo
                </button>
                <button
                  type="button"
                  onClick={handleConfirmApply}
                  className="px-4 py-2 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white flex items-center gap-1.5 shadow-md shadow-emerald-950/40 cursor-pointer"
                >
                  <Check className="w-4 h-4" />
                  <span>CARREGAR FOTOS NO LAUDO</span>
                </button>
              </div>
            </div>
          ) : (
            /* Opções para Puxar as Fotos */
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Opção 1: Arquivo ZIP de Backup */}
              <button
                type="button"
                onClick={() => zipInputRef.current?.click()}
                className="p-4 rounded-xl border border-slate-700/80 bg-slate-800/50 hover:bg-slate-800 hover:border-blue-500 transition-all text-left flex flex-col justify-between gap-3 group cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform">
                    <Archive className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white group-hover:text-blue-300 transition-colors">
                      Arquivo ZIP de Fotos
                    </h3>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Selecione o arquivo de backup gerado no celular
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 text-[11px] font-bold text-amber-400 pt-2 border-t border-slate-700/50">
                  <span>Selecionar ZIP</span>
                  <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                </div>
              </button>

              {/* Opção 2: Pasta do Celular */}
              <button
                type="button"
                onClick={() => folderInputRef.current?.click()}
                className="p-4 rounded-xl border border-slate-700/80 bg-slate-800/50 hover:bg-slate-800 hover:border-emerald-500 transition-all text-left flex flex-col justify-between gap-3 group cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform">
                    <FolderUp className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white group-hover:text-emerald-300 transition-colors">
                      Pasta do Celular
                    </h3>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Selecione a pasta Gerador de Laudos
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 text-[11px] font-bold text-emerald-400 pt-2 border-t border-slate-700/50">
                  <span>Selecionar Pasta</span>
                  <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                </div>
              </button>

              {/* Opção 3: Seleção Múltipla de Fotos da Galeria */}
              <button
                type="button"
                onClick={() => filesInputRef.current?.click()}
                className="sm:col-span-2 p-3.5 rounded-xl border border-slate-700/60 bg-slate-800/30 hover:bg-slate-800/60 hover:border-slate-600 transition-all text-left flex items-center justify-between gap-3 group cursor-pointer"
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-blue-500/20 text-blue-400 flex items-center justify-center flex-shrink-0">
                    <ImageIcon className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-slate-200 group-hover:text-white">
                      Selecionar fotos avulsas da galeria
                    </h4>
                    <p className="text-[11px] text-slate-400">
                      O sistema identifica automaticamente pelo nome e distribui nas seções certas
                    </p>
                  </div>
                </div>
                <span className="text-[11px] font-bold text-blue-400">
                  Escolher Fotos
                </span>
              </button>
            </div>
          )}
        </div>

        {/* Rodapé */}
        <div className="px-5 py-3 border-t border-slate-800 bg-slate-900/95 flex items-center justify-between">
          <p className="text-[11px] text-slate-400">
            As fotos puxadas serão salvas no banco de dados interno da plataforma.
          </p>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-200 transition-colors cursor-pointer"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
