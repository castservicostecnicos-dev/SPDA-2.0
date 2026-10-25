import React, { useState } from 'react';
import {
  Download,
  X,
  ExternalLink,
  Printer,
  CheckCircle2,
  FileText,
  ShieldCheck,
  Share2,
  Copy,
  Check,
} from 'lucide-react';

interface PdfDownloadModalProps {
  isOpen: boolean;
  onClose: () => void;
  pdfUrl: string;
  fileName: string;
  onPrint: () => void;
  onExportDocx?: () => void;
  isGeneratingDocx?: boolean;
}

export const PdfDownloadModal: React.FC<PdfDownloadModalProps> = ({
  isOpen,
  onClose,
  pdfUrl,
  fileName,
  onPrint,
  onExportDocx,
  isGeneratingDocx,
}) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const handleDownload = () => {
    const a = document.createElement('a');
    a.href = pdfUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleOpenNewTab = () => {
    window.open(pdfUrl, '_blank');
  };

  const handleCopyName = () => {
    navigator.clipboard?.writeText(fileName);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleShare = async () => {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: 'Laudo Técnico de SPDA',
          text: `Laudo Técnico de SPDA: ${fileName}`,
          url: pdfUrl,
        });
      } catch {
        handleDownload();
      }
    } else {
      handleDownload();
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center z-50 p-4 animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden border border-slate-200 text-slate-800">
        {/* Cabeçalho */}
        <div className="p-4 sm:p-5 bg-gradient-to-r from-slate-900 via-blue-950 to-slate-900 text-white flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center flex-shrink-0">
              <CheckCircle2 className="w-6 h-6 text-emerald-400" />
            </div>
            <div>
              <h3 className="font-bold text-base sm:text-lg leading-tight text-white">
                Laudo Gerado com Sucesso!
              </h3>
              <p className="text-xs text-blue-200">
                Documento técnico conforme ABNT NBR 5419:2026
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
            title="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Informação Simplificada com o Nome do Laudo */}
        <div className="p-5 space-y-4">
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-blue-600" />
                Nome do Laudo:
              </span>
              <button
                type="button"
                onClick={handleCopyName}
                className="text-[11px] font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1 cursor-pointer"
                title="Copiar nome do arquivo"
              >
                {copied ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-600" />
                    <span className="text-emerald-700">Copiado!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    <span>Copiar Nome</span>
                  </>
                )}
              </button>
            </div>

            <div className="bg-white border border-slate-300 rounded-lg p-3 font-mono text-xs sm:text-sm font-bold text-slate-900 break-all select-all shadow-inner">
              {fileName}
            </div>

            <div className="flex items-center gap-1.5 text-[11px] text-emerald-700 pt-1">
              <ShieldCheck className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              <span>Arquivo PDF compilado, estruturado e pronto para envio ao cliente.</span>
            </div>
          </div>

          {/* Botões de Ação Principais e Diretos */}
          <div className="space-y-2.5">
            <button
              type="button"
              onClick={handleDownload}
              className="w-full py-3 px-4 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-extrabold text-sm rounded-xl shadow-md flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <Download className="w-5 h-5" />
              <span>BAIXAR ARQUIVO PDF AGORA</span>
            </button>

            {onExportDocx && (
              <button
                type="button"
                onClick={onExportDocx}
                disabled={isGeneratingDocx}
                className="w-full py-2.5 px-4 bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border border-indigo-300 font-bold text-xs sm:text-sm rounded-xl shadow-xs flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
                title="Baixar arquivo editável no Microsoft Word (.docx)"
              >
                <FileText className="w-4 h-4 text-indigo-600" />
                <span>{isGeneratingDocx ? 'GERANDO ARQUIVO WORD...' : 'BAIXAR TAMBÉM EM WORD (.DOCX EDITÁVEL)'}</span>
              </button>
            )}

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={handleOpenNewTab}
                className="py-2.5 px-3 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 border border-slate-300 transition-colors cursor-pointer"
              >
                <ExternalLink className="w-4 h-4 text-slate-600" />
                <span>Abrir no Navegador</span>
              </button>

              <button
                type="button"
                onClick={handleShare}
                className="py-2.5 px-3 bg-blue-50 hover:bg-blue-100 text-blue-800 font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 border border-blue-200 transition-colors cursor-pointer"
              >
                <Share2 className="w-4 h-4 text-blue-600" />
                <span>Compartilhar</span>
              </button>
            </div>

            <button
              type="button"
              onClick={onPrint}
              className="w-full py-2 px-3 text-slate-600 hover:text-slate-900 hover:bg-slate-100 font-semibold text-xs rounded-lg flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>Imprimir / Salvar via Caixa de Impressão A4</span>
            </button>
          </div>
        </div>

        {/* Rodapé simples */}
        <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs rounded-lg uppercase cursor-pointer"
          >
            FECHAR
          </button>
        </div>
      </div>
    </div>
  );
};
