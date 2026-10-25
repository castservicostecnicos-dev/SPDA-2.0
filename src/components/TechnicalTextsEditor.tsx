import React, { useState } from 'react';
import { TechnicalTexts } from '../types/spda';
import {
  FileText,
  RotateCcw,
  Download,
  Upload,
  Plus,
  Trash2,
  Check,
  AlertTriangle,
} from 'lucide-react';

interface TechnicalTextsEditorProps {
  texts: TechnicalTexts;
  onUpdateTexts: (updated: Partial<TechnicalTexts>) => void;
  onResetToDefault: () => void;
}

export const TechnicalTextsEditor: React.FC<TechnicalTextsEditorProps> = ({
  texts,
  onUpdateTexts,
  onResetToDefault,
}) => {
  const [activeTab, setActiveTab] = useState<'geral' | 'vistoria' | 'medicoes' | 'quadros' | 'recomendacoes' | 'conclusao'>('geral');
  const [newRecomendacao, setNewRecomendacao] = useState('');
  const [importSuccess, setImportSuccess] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  // Add recommendation
  const handleAddRecomendacao = () => {
    if (!newRecomendacao.trim()) return;
    onUpdateTexts({
      recomendacoes: [...texts.recomendacoes, newRecomendacao.trim()],
    });
    setNewRecomendacao('');
  };

  // Remove recommendation
  const handleRemoveRecomendacao = (index: number) => {
    onUpdateTexts({
      recomendacoes: texts.recomendacoes.filter((_, idx) => idx !== index),
    });
  };

  // Export current technical texts as JSON
  const handleExportJson = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(texts, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', 'textos_tecnicos_spda_modelo.json');
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  // Import JSON model
  const handleImportJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target?.result as string);
        if (parsed && typeof parsed === 'object') {
          onUpdateTexts(parsed);
          setImportSuccess(true);
          setImportError(null);
          setTimeout(() => setImportSuccess(false), 3000);
        }
      } catch {
        setImportError('Erro ao carregar arquivo de modelo. Verifique o formato JSON.');
        setTimeout(() => setImportError(null), 4000);
      }
    };
    reader.readAsText(file);
    if (e.target) e.target.value = '';
  };

  return (
    <div className="space-y-6">
      {/* Top action bar: Import/Export/Reset */}
      <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-800">
              Textos Técnicos Pré-Formatados (NBR 5419:2026)
            </h3>
            <p className="text-xs text-slate-500">
              Você pode personalizar qualquer redação técnica, exportar seu padrão ou importar novos modelos.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {importSuccess && (
            <span className="flex items-center gap-1 text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-1 rounded">
              <Check className="w-3.5 h-3.5" /> Modelo importado!
            </span>
          )}
          {importError && (
            <span className="flex items-center gap-1 text-xs font-semibold text-rose-600 bg-rose-50 px-2 py-1 rounded">
              {importError}
            </span>
          )}

          <label className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg cursor-pointer transition-colors">
            <Upload className="w-3.5 h-3.5" />
            IMPORTAR MODELO
            <input type="file" accept=".json" onChange={handleImportJson} className="hidden" />
          </label>

          <button
            onClick={handleExportJson}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-lg transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            EXPORTAR MODELO
          </button>

          <button
            onClick={onResetToDefault}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-bold rounded-lg transition-colors"
            title="Restaura os textos originais do modelo da SJC Engenharia"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            RESTAURAR PADRÃO
          </button>
        </div>
      </div>

      {/* Internal Subtabs */}
      <div className="flex border-b border-slate-200 overflow-x-auto text-xs font-semibold space-x-1">
        {[
          { id: 'geral', label: '1) OBJETO & INTRODUÇÃO' },
          { id: 'vistoria', label: '5) VISTORIA DO SPDA' },
          { id: 'medicoes', label: '6) MEDIÇÕES & INSTRUMENTO' },
          { id: 'quadros', label: '7) QUADROS & DPS' },
          { id: 'recomendacoes', label: '8) RECOMENDAÇÕES' },
          { id: 'conclusao', label: '9) CONCLUSÃO & PARECER' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-4 py-2.5 whitespace-nowrap border-b-2 transition-all ${
              activeTab === tab.id
                ? 'border-blue-600 text-blue-600 font-bold bg-white'
                : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Contents */}
      <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-6 space-y-5">
        {activeTab === 'geral' && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-800 mb-1">
                OBJETO DO LAUDO (Exibido na Capa)
              </label>
              <textarea
                rows={2}
                value={texts.objeto}
                onChange={(e) => onUpdateTexts({ objeto: e.target.value })}
                className="w-full p-3 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase font-medium"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-800 mb-1">
                1.1 - Objetivo do Laudo
              </label>
              <textarea
                rows={3}
                value={texts.introducaoItem1_1}
                onChange={(e) => onUpdateTexts({ introducaoItem1_1: e.target.value })}
                className="w-full p-3 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-800 mb-1">
                1.2 - Sugestões Técnicas
              </label>
              <textarea
                rows={2}
                value={texts.introducaoItem1_2}
                onChange={(e) => onUpdateTexts({ introducaoItem1_2: e.target.value })}
                className="w-full p-3 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-800 mb-1">
                3.1 - Descrição das Características do Local (Página 4)
              </label>
              <textarea
                rows={3}
                value={texts.caracteristicasLocal}
                onChange={(e) => onUpdateTexts({ caracteristicasLocal: e.target.value })}
                className="w-full p-3 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-800 mb-1">
                4) Histórico de Problemas & Supressores de Surtos (Página 5)
              </label>
              <textarea
                rows={3}
                value={texts.historicoItem4_2}
                onChange={(e) => onUpdateTexts({ historicoItem4_2: e.target.value })}
                className="w-full p-3 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        )}

        {activeTab === 'vistoria' && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-800 mb-1">
                Texto de Abertura da Vistoria do SPDA Existente (Página 6)
              </label>
              <textarea
                rows={2}
                value={texts.vistoriaSpdaTexto}
                onChange={(e) => onUpdateTexts({ vistoriaSpdaTexto: e.target.value })}
                className="w-full p-3 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-800 mb-1">
                Parecer Técnico Detalhado da Vistoria Visual (Página 7)
              </label>
              <textarea
                rows={6}
                value={texts.vistoriaSpdaAnalise}
                onChange={(e) => onUpdateTexts({ vistoriaSpdaAnalise: e.target.value })}
                className="w-full p-3 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 leading-relaxed"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Menciona o estado do Captor de Franklin, emendas, oxidação de parafusos, fixadores e conexões.
              </p>
            </div>
          </div>
        )}

        {activeTab === 'medicoes' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  Modelo do Instrumento
                </label>
                <input
                  type="text"
                  value={texts.equipamentoModelo}
                  onChange={(e) => onUpdateTexts({ equipamentoModelo: e.target.value })}
                  className="w-full p-2.5 text-xs bg-slate-50 border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  Marca do Instrumento
                </label>
                <input
                  type="text"
                  value={texts.equipamentoMarca}
                  onChange={(e) => onUpdateTexts({ equipamentoMarca: e.target.value })}
                  className="w-full p-2.5 text-xs bg-slate-50 border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  Local das Medições
                </label>
                <input
                  type="text"
                  value={texts.medicoesLocal}
                  onChange={(e) => onUpdateTexts({ medicoesLocal: e.target.value })}
                  className="w-full p-2.5 text-xs bg-slate-50 border border-slate-300 rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  Corrente Aplicada
                </label>
                <input
                  type="text"
                  value={texts.medicoesCorrenteAplicada}
                  onChange={(e) => onUpdateTexts({ medicoesCorrenteAplicada: e.target.value })}
                  className="w-full p-2.5 text-xs bg-slate-50 border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-800 mb-1">
                Descrição do Método de Ensaio (Método dos 4 Terminais / Kelvin)
              </label>
              <textarea
                rows={3}
                value={texts.equipamentoDescricao}
                onChange={(e) => onUpdateTexts({ equipamentoDescricao: e.target.value })}
                className="w-full p-3 text-xs bg-slate-50 border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-800 mb-1">
                Avaliação dos Pontos de Inspeção e Continuidade (Página 9)
              </label>
              <textarea
                rows={4}
                value={texts.pontosInspecaoAvaliacao}
                onChange={(e) => onUpdateTexts({ pontosInspecaoAvaliacao: e.target.value })}
                className="w-full p-3 text-xs bg-slate-50 border border-slate-300 rounded-lg"
              />
            </div>
          </div>
        )}

        {activeTab === 'quadros' && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-800 mb-1">
                Subtítulo Normativo dos Quadros
              </label>
              <input
                type="text"
                value={texts.analiseQuadrosSubtitulo}
                onChange={(e) => onUpdateTexts({ analiseQuadrosSubtitulo: e.target.value })}
                className="w-full p-2.5 text-xs bg-slate-50 border border-slate-300 rounded-lg font-bold"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-800 mb-1">
                Definição Técnica do DPS segundo NBR 5410 (Página 9)
              </label>
              <textarea
                rows={3}
                value={texts.analiseQuadrosTexto}
                onChange={(e) => onUpdateTexts({ analiseQuadrosTexto: e.target.value })}
                className="w-full p-3 text-xs bg-slate-50 border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-800 mb-1">
                Constatação e Parecer dos Quadros de Energia (Página 10)
              </label>
              <textarea
                rows={3}
                value={texts.analiseQuadrosConclusao}
                onChange={(e) => onUpdateTexts({ analiseQuadrosConclusao: e.target.value })}
                className="w-full p-3 text-xs bg-slate-50 border border-slate-300 rounded-lg"
              />
            </div>
          </div>
        )}

        {activeTab === 'recomendacoes' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-xs font-bold text-slate-800">
                  Lista de Recomendações Técnicas (Exibidas em Vermelho nas Páginas 10 e 11)
                </h4>
                <p className="text-[11px] text-slate-500">
                  Itens numerados como 8.1, 8.2... com as correções obrigatórias para adequação à NBR 5419.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              {texts.recomendacoes.map((rec, index) => (
                <div
                  key={index}
                  className="flex items-start gap-2 bg-rose-50/50 p-2.5 rounded-lg border border-rose-100"
                >
                  <span className="text-xs font-bold text-rose-700 min-w-[32px] pt-1">
                    8.{index + 1}-
                  </span>
                  <textarea
                    rows={2}
                    value={rec}
                    onChange={(e) => {
                      const updated = [...texts.recomendacoes];
                      updated[index] = e.target.value;
                      onUpdateTexts({ recomendacoes: updated });
                    }}
                    className="flex-1 p-2 text-xs text-rose-800 font-medium bg-white border border-rose-200 rounded focus:outline-none focus:ring-1 focus:ring-rose-500"
                  />
                  <button
                    onClick={() => handleRemoveRecomendacao(index)}
                    className="p-1.5 text-rose-500 hover:text-rose-700 hover:bg-rose-100 rounded"
                    title="Remover recomendação"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            {/* Adicionar nova recomendação */}
            <div className="flex gap-2 pt-2">
              <input
                type="text"
                value={newRecomendacao}
                onChange={(e) => setNewRecomendacao(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddRecomendacao()}
                placeholder="Digitar nova recomendação corretiva..."
                className="flex-1 px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-none"
              />
              <button
                onClick={handleAddRecomendacao}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-lg flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                ADICIONAR
              </button>
            </div>

            <div className="pt-2">
              <label className="block text-xs font-bold text-slate-800 mb-1">
                Frase Conclusiva das Recomendações
              </label>
              <input
                type="text"
                value={texts.recomendacoesTextoFinal}
                onChange={(e) => onUpdateTexts({ recomendacoesTextoFinal: e.target.value })}
                className="w-full p-2.5 text-xs text-rose-700 font-bold bg-slate-50 border border-slate-300 rounded-lg"
              />
            </div>
          </div>
        )}

        {activeTab === 'conclusao' && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-800 mb-1">
                9) CONCLUSÃO FINAL DESTE RELATÓRIO (Página 11)
              </label>
              <textarea
                rows={6}
                value={texts.conclusaoFinal}
                onChange={(e) => onUpdateTexts({ conclusaoFinal: e.target.value })}
                className="w-full p-3 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 leading-relaxed"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Declaração formal do parecer do Engenheiro Eletricista com remissão ao cumprimento normativo e à ART.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
