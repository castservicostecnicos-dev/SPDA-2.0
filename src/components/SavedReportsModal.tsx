import React, { useState, useEffect } from 'react';
import {
  FolderOpen,
  Save,
  Trash2,
  X,
  FileText,
  Clock,
  Image as ImageIcon,
  Check,
  AlertCircle,
  Download,
  Upload,
  Sparkles,
  Info,
  ShieldCheck,
  Loader2,
  FileSpreadsheet,
} from 'lucide-react';
import { SpdaReport } from '../types/spda';
import {
  SavedReportMeta,
  getSavedReportsList,
  saveNamedReport,
  loadSavedReportById,
  deleteSavedReportById,
  generateSequentialReportTitle,
} from '../utils/storage';
import { purgeOrphanPhotosAndTowers, countOrphanPhotos } from '../utils/towerSorter';
import { importReportFile } from '../utils/documentImporter';

interface SavedReportsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentReport: SpdaReport;
  onLoadReport: (report: SpdaReport) => void;
  onReportDeleted?: (deletedId: string) => void;
  onReportSaved?: (savedReport: SpdaReport) => void;
}

export const SavedReportsModal: React.FC<SavedReportsModalProps> = ({
  isOpen,
  onClose,
  currentReport,
  onLoadReport,
  onReportDeleted,
  onReportSaved,
}) => {
  const [reportsList, setReportsList] = useState<SavedReportMeta[]>([]);
  const [customTitle, setCustomTitle] = useState('');
  const [feedback, setFeedback] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingId, setIsLoadingId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importStatusText, setImportStatusText] = useState('');

  useEffect(() => {
    if (isOpen) {
      loadList();
      const defaultName = currentReport.title && !currentReport.title.startsWith('Laudo de Inspeção SPDA')
        ? currentReport.title
        : generateSequentialReportTitle(currentReport.client?.name);
      setCustomTitle(defaultName);
      setFeedback(null);
      setDeleteConfirmId(null);
    }
  }, [isOpen, currentReport]);

  const loadList = async () => {
    const list = await getSavedReportsList();
    setReportsList(list);
  };

  // Atualiza o laudo em andamento no mesmo arquivo, sem duplicar
  const handleSaveCurrent = async (forceNew = false) => {
    try {
      setIsSaving(true);
      const titleToSave = customTitle.trim() || currentReport.title || generateSequentialReportTitle(currentReport.client?.name);
      const reportId = forceNew ? `laudo-spda-${Date.now()}` : (currentReport.id || `laudo-spda-${Date.now()}`);
      const reportToSave: SpdaReport = {
        ...currentReport,
        id: reportId,
        title: titleToSave,
      };
      const result = await saveNamedReport(reportToSave, { forceNew, customTitle: titleToSave });
      await loadList();
      if (onReportSaved) {
        onReportSaved(result.updatedReport);
      }
      setFeedback({
        message: forceNew
          ? `Nova cópia do laudo salva como "${titleToSave}"!`
          : `✓ Laudo "${titleToSave}" atualizado com sucesso!`,
        type: 'success',
      });
      setTimeout(() => setFeedback(null), 4500);
    } catch (e) {
      console.error(e);
      setFeedback({ message: 'Erro ao salvar laudo.', type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleLoad = async (meta: SavedReportMeta) => {
    try {
      setIsLoadingId(meta.id);
      const loaded = await loadSavedReportById(meta.id);
      if (loaded) {
        // Limpa fotos órfãs e torres apagadas automaticamente ao abrir
        const sanitized = purgeOrphanPhotosAndTowers(loaded);
        onLoadReport(sanitized);
        onClose();
      } else {
        setFeedback({ message: 'Não foi possível carregar o laudo selecionado.', type: 'error' });
      }
    } catch (e) {
      console.error(e);
      setFeedback({ message: 'Erro ao abrir laudo.', type: 'error' });
    } finally {
      setIsLoadingId(null);
    }
  };

  // Limpeza explícita e manual de fotos órfãs no laudo atual
  const handlePurgeCurrentReportOrphans = async () => {
    try {
      const orphanCount = countOrphanPhotos(currentReport);
      const sanitized = purgeOrphanPhotosAndTowers(currentReport);
      const result = await saveNamedReport(sanitized, { forceNew: false });
      onLoadReport(result.updatedReport);
      await loadList();
      if (orphanCount > 0) {
        setFeedback({
          message: `🧹 Limpeza concluída: ${orphanCount} foto(s) de torre(s) apagada(s) foram removidas do laudo com sucesso!`,
          type: 'success',
        });
      } else {
        setFeedback({
          message: '✓ Tudo limpo! Não há fotos órfãs. Todas as fotos registradas pertencem às torres ativas deste laudo.',
          type: 'success',
        });
      }
      setTimeout(() => setFeedback(null), 5000);
    } catch (err) {
      console.error(err);
      setFeedback({ message: 'Erro ao limpar fotos órfãs.', type: 'error' });
    }
  };

  const handleDelete = async (id: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      setIsDeleting(true);
      await deleteSavedReportById(id);
      await loadList();
      setDeleteConfirmId(null);
      setFeedback({ message: `Laudo "${name}" excluído com sucesso!`, type: 'success' });
      setTimeout(() => setFeedback(null), 3000);
      onReportDeleted?.(id);
    } catch (err) {
      console.error(err);
      setFeedback({ message: 'Erro ao excluir o laudo.', type: 'error' });
    } finally {
      setIsDeleting(false);
    }
  };

  // Exporta o laudo ativo atual como arquivo JSON de backup
  const handleExportBackup = () => {
    try {
      const sanitized = purgeOrphanPhotosAndTowers(currentReport);
      const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(sanitized, null, 2));
      const downloadAnchor = document.createElement('a');
      const safeName = (sanitized.client?.name || 'laudo_spda').replace(/[^a-zA-Z0-9_-]/g, '_');
      downloadAnchor.setAttribute('href', dataStr);
      downloadAnchor.setAttribute('download', `backup_${safeName}_${Date.now()}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      setFeedback({ message: '✓ Backup completo (.json) exportado com sucesso!', type: 'success' });
      setTimeout(() => setFeedback(null), 3500);
    } catch {
      setFeedback({ message: 'Erro ao exportar arquivo de backup.', type: 'error' });
    }
  };

  // Importa qualquer arquivo de laudo (PDF, Word .docx/.doc ou JSON de backup)
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsImporting(true);
      setImportStatusText(`Analisando "${file.name}"... Extraindo textos, dados do cliente e fotos.`);
      const result = await importReportFile(file);

      if (!result.success || !result.report) {
        setFeedback({
          message: result.error || 'Não foi possível importar este arquivo. Verifique se o arquivo não está corrompido.',
          type: 'error',
        });
        return;
      }

      const imported = purgeOrphanPhotosAndTowers(result.report);
      const titleToSave = imported.title || `Laudo - ${imported.client?.name || file.name.replace(/\.[^/.]+$/, '')}`;
      imported.title = titleToSave;

      const savedResult = await saveNamedReport(imported, { forceNew: true, customTitle: titleToSave });
      await loadList();
      onLoadReport(savedResult.updatedReport);

      const info = result.extractedInfo;
      const details = [
        info.clientName ? `Cliente: ${info.clientName}` : '',
        info.photosCount > 0 ? `${info.photosCount} fotos extraídas` : '',
        info.towersDetected?.length ? `${info.towersDetected.length} torre(s)` : '',
      ].filter(Boolean).join(' | ');

      setFeedback({
        message: `✓ Arquivo "${file.name}" importado com sucesso para edição! ${details ? `(${details})` : ''}`,
        type: 'success',
      });

      setTimeout(() => {
        onClose();
      }, 1600);
    } catch (err: any) {
      console.error('Erro na importação:', err);
      setFeedback({
        message: `Erro ao importar arquivo: ${err?.message || 'Falha ao processar documento.'}`,
        type: 'error',
      });
    } finally {
      setIsImporting(false);
      setImportStatusText('');
      if (e.target) e.target.value = '';
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-xl max-w-2xl w-full shadow-2xl flex flex-col max-h-[90vh] overflow-hidden text-white">
        {/* Header do Modal */}
        <div className="px-5 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/90">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600/20 text-blue-400 border border-blue-500/30 flex items-center justify-center">
              <FolderOpen className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white leading-tight">Salvar & Gerenciar Laudos</h2>
              <p className="text-xs text-slate-400 leading-tight">
                Salve o laudo atual para continuar editando depois ou abra um laudo anterior
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Feedback visual */}
        {feedback && (
          <div
            className={`mx-5 mt-4 p-3 rounded-lg text-xs font-semibold flex items-center gap-2 ${
              feedback.type === 'success'
                ? 'bg-emerald-950/60 border border-emerald-800 text-emerald-300'
                : 'bg-rose-950/60 border border-rose-800 text-rose-300'
            }`}
          >
            {feedback.type === 'success' ? <Check className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
            <span>{feedback.message}</span>
          </div>
        )}

        <div className="p-5 overflow-y-auto space-y-5">
          {/* Caixa para Salvar Laudo Atual */}
          <div className="bg-slate-800/60 border border-slate-700/80 rounded-lg p-3.5 space-y-2.5">
            <h3 className="text-xs font-bold uppercase tracking-wide text-slate-300 flex items-center gap-1.5">
              <Save className="w-4 h-4 text-emerald-400" />
              Salvar laudo atual para editar depois
            </h3>
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="flex-1 flex gap-1.5 items-center">
                <input
                  type="text"
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  placeholder="Nome sequencial do laudo"
                  className="flex-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-hidden focus:border-blue-500"
                />
                <button
                  type="button"
                  onClick={() => setCustomTitle(generateSequentialReportTitle(currentReport.client?.name))}
                  className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 rounded-lg transition-colors flex-shrink-0"
                  title="Atualizar carimbo temporal para o segundo atual"
                >
                  <Clock className="w-4 h-4 text-amber-400" />
                </button>
              </div>
              <button
                onClick={() => handleSaveCurrent(false)}
                disabled={isSaving}
                className="flex items-center justify-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold transition-all shadow-xs whitespace-nowrap cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{isSaving ? 'SALVANDO...' : 'ATUALIZAR LAUDO'}</span>
              </button>
            </div>
            <p className="text-[11px] text-slate-400">
              Atualiza o laudo em andamento sem gerar arquivos duplicados. O mesmo arquivo é mantido e salvo com todas as fotos e medições consolidadas.
            </p>
          </div>

          {/* Deteção e Limpeza de Fotos Órfãs */}
          {(() => {
            const detectedOrphans = countOrphanPhotos(currentReport);
            return (
              <div className={`p-3 rounded-lg border text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 ${
                detectedOrphans > 0
                  ? 'bg-amber-950/40 border-amber-500/60 text-amber-200'
                  : 'bg-slate-800/40 border-slate-700/60 text-slate-300'
              }`}>
                <div className="flex items-center gap-2">
                  <Sparkles className={`w-4 h-4 flex-shrink-0 ${detectedOrphans > 0 ? 'text-amber-400' : 'text-blue-400'}`} />
                  <div>
                    <span className="font-bold">
                      {detectedOrphans > 0
                        ? `Atenção: ${detectedOrphans} foto(s) de torre(s) apagada(s) detectada(s)!`
                        : 'Fotos de Torres: Nenhuma foto órfã detectada'}
                    </span>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      {detectedOrphans > 0
                        ? 'Exclua permanentemente fotos que ficaram órfãs antes de gerar o PDF ou DOCX.'
                        : 'Todas as fotos registradas pertencem às torres ativas cadastradas.'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handlePurgeCurrentReportOrphans}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer flex-shrink-0 ${
                    detectedOrphans > 0
                      ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-md font-extrabold'
                      : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
                  }`}
                  title="Remove fotos vinculadas a torres inexistentes ou apagadas"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{detectedOrphans > 0 ? `LIMPAR ${detectedOrphans} FOTO(S) ÓRFÃS` : 'VERIFICAR / LIMPAR FOTOS'}</span>
                </button>
              </div>
            );
          })()}

          {/* Feedback de Importação em andamento */}
          {isImporting && (
            <div className="bg-blue-950/70 border border-blue-500 rounded-lg p-3 text-xs text-blue-200 flex items-center gap-2.5 animate-pulse">
              <Loader2 className="w-5 h-5 text-blue-400 animate-spin flex-shrink-0" />
              <div>
                <p className="font-bold text-white">Importando e processando documento...</p>
                <p className="text-[11px] text-blue-300">{importStatusText || 'Extraindo textos, fotos e estrutura do laudo.'}</p>
              </div>
            </div>
          )}

          {/* Guia informativo sobre formato de arquivos */}
          <div className="bg-slate-800/50 border border-slate-700/80 rounded-lg p-3 text-xs space-y-1.5 text-slate-300">
            <div className="flex items-center gap-1.5 font-bold text-blue-300">
              <Info className="w-4 h-4 text-blue-400 flex-shrink-0" />
              <span>Como abrir ou importar um laudo para edição:</span>
            </div>
            <ul className="text-[11px] text-slate-400 space-y-1 pl-5 list-disc">
              <li>
                <strong className="text-slate-200">Reabrir laudo salvo no celular/computador:</strong> Não precisa carregar arquivo! Basta localizar o laudo na lista abaixo e clicar em <strong className="text-blue-300">EDITAR</strong>.
              </li>
              <li>
                <strong className="text-slate-200">Importar PDF ou Word (.docx / .doc):</strong> Você pode fazer o upload de um laudo antigo ou modelo em PDF ou DOCX. O sistema extrai automaticamente o nome do cliente, CNPJ, endereço, responsável técnico, CREA/ART, fotos e legendas para você editar livremente.
              </li>
              <li>
                <strong className="text-slate-200">Backup Completo (.json):</strong> Arquivo de restauração com dados e fotos na íntegra.
              </li>
            </ul>
          </div>

          {/* Lista de Laudos Salvos */}
          <div className="space-y-2.5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-300 flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-blue-400" />
                Laudos salvos ({reportsList.length})
              </h3>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={handleExportBackup}
                  className="flex items-center gap-1 text-[11px] font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 px-2 py-1 rounded cursor-pointer transition-colors"
                  title="Baixar arquivo de backup (.json) com todas as fotos em alta resolução"
                >
                  <Download className="w-3 h-3 text-blue-400" />
                  <span>Exportar Backup (.json)</span>
                </button>
                <label
                  className={`flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded cursor-pointer transition-all border shadow-xs ${
                    isImporting
                      ? 'bg-blue-950 text-blue-300 border-blue-600 opacity-70 cursor-not-allowed'
                      : 'bg-blue-600/30 hover:bg-blue-600 text-blue-200 hover:text-white border-blue-500/50'
                  }`}
                  title="Upload de Laudo em PDF, Word (.docx/.doc) ou JSON para servir como modelo ou edição"
                >
                  {isImporting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-300" />
                  ) : (
                    <Upload className="w-3.5 h-3.5 text-cyan-300" />
                  )}
                  <span>{isImporting ? 'IMPORTANDO...' : 'Importar PDF / DOCX / JSON'}</span>
                  <input
                    type="file"
                    accept=".pdf,.docx,.doc,.json,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,application/json"
                    onChange={handleImportFile}
                    disabled={isImporting}
                    className="hidden"
                  />
                </label>
              </div>
            </div>

            {reportsList.length === 0 ? (
              <div className="bg-slate-800/30 border border-dashed border-slate-700 rounded-lg p-6 text-center space-y-1">
                <p className="text-xs font-medium text-slate-400">Nenhum laudo salvo nesta lista ainda.</p>
                <p className="text-[11px] text-slate-500">
                  Clique no botão &ldquo;SALVAR LAUDO&rdquo; acima para salvar o laudo atual e editá-lo futuramente quando quiser.
                </p>
              </div>
            ) : (
              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {reportsList.map((item) => (
                  <div
                    key={item.id}
                    onClick={() => handleLoad(item)}
                    className="p-3 bg-slate-800/50 hover:bg-slate-800 border border-slate-700/70 hover:border-blue-500/60 rounded-lg cursor-pointer transition-all flex items-center justify-between gap-3 group"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs text-white group-hover:text-blue-300 transition-colors truncate">
                          {item.title}
                        </span>
                        {item.id === currentReport.id && (
                          <span className="text-[9px] bg-blue-500/20 text-blue-300 border border-blue-500/30 px-1.5 py-0.2 rounded font-bold">
                            ATUAL
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-400">
                        <span className="truncate max-w-[200px]">
                          Cliente: <strong className="text-slate-300 font-medium">{item.clientName}</strong>
                        </span>
                        <span className="flex items-center gap-1 text-slate-500">
                          <ImageIcon className="w-3 h-3" /> {item.photoCount} foto(s)
                        </span>
                        <span className="flex items-center gap-1 text-slate-500">
                          <Clock className="w-3 h-3 text-amber-400" />
                          {new Date(item.updatedAt).toLocaleDateString('pt-BR')} às {new Date(item.updatedAt).toLocaleTimeString('pt-BR')}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {deleteConfirmId === item.id ? (
                        <div
                          className="flex items-center gap-1.5 bg-rose-950/95 border border-rose-500/80 px-2.5 py-1 rounded-lg shadow-md"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span className="text-[11px] font-bold text-rose-200 whitespace-nowrap">Excluir?</span>
                          <button
                            type="button"
                            onClick={(e) => handleDelete(item.id, item.title, e)}
                            disabled={isDeleting}
                            className="px-2 py-0.5 bg-rose-600 hover:bg-rose-500 text-white rounded text-[10px] font-bold shadow-xs transition-colors cursor-pointer"
                          >
                            {isDeleting ? '...' : 'SIM'}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteConfirmId(null);
                            }}
                            disabled={isDeleting}
                            className="px-2 py-0.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded text-[10px] font-semibold transition-colors cursor-pointer"
                          >
                            NÃO
                          </button>
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleLoad(item);
                            }}
                            disabled={isLoadingId === item.id}
                            className="px-2.5 py-1 text-xs font-semibold bg-blue-600/30 hover:bg-blue-600 text-blue-300 hover:text-white border border-blue-500/40 rounded transition-colors cursor-pointer"
                          >
                            {isLoadingId === item.id ? 'ABRINDO...' : 'EDITAR'}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setDeleteConfirmId(item.id);
                            }}
                            className="flex items-center gap-1 px-2 py-1 text-xs font-semibold bg-rose-950/40 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-800/60 hover:border-rose-500 rounded transition-colors cursor-pointer"
                            title="Excluir este laudo salvo"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>EXCLUIR</span>
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Rodapé do Modal */}
        <div className="px-5 py-3 border-t border-slate-800 bg-slate-900/95 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
          >
            FECHAR
          </button>
        </div>
      </div>
    </div>
  );
};
