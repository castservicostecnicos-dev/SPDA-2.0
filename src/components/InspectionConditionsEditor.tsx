import React from 'react';
import { InspectionConditions, TechnicalTexts, ClientData, SubsystemStatus } from '../types/spda';
import {
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  ShieldAlert,
  Zap,
  Layers,
  Wrench,
  Plus,
  Trash2,
  AlertCircle,
  FileCheck,
  Sparkles,
} from 'lucide-react';

interface InspectionConditionsEditorProps {
  conditions: InspectionConditions;
  client: ClientData;
  texts: TechnicalTexts;
  onUpdateConditions: (updated: Partial<InspectionConditions>) => void;
  onUpdateClient: (updated: Partial<ClientData>) => void;
  onUpdateTexts: (updated: Partial<TechnicalTexts>) => void;
}

export const InspectionConditionsEditor: React.FC<InspectionConditionsEditorProps> = ({
  conditions,
  client,
  texts,
  onUpdateConditions,
  onUpdateClient,
  onUpdateTexts,
}) => {
  // Pre-defined standard corrective items from the original report
  const defaultRecommendations = [
    'Corrigir para que toda massa metálica da parte superior seja aterrada e equipotencializadas ao sistema.',
    'Manter a limpeza das caixas de inspeção, deixando livre de todo tipo de sujidade, evitando umidade.',
    'Realizar a instalação de DPS nos quadros de distribuição de forma coordenada, intensificando a proteção contra surtos de energias internos da estrutura.',
    'Realizar a troca dos conectores oxidados para maximizar a eficiência do sistema de proteção.',
    'Realizar a instalação do captor de Franklin.',
    'Realizar a troca dos parafusos que fazem a fixação das fitas do sistema, para adequar ao que está definido pela norma.',
    'Corrigir as emendas e curvas das fitas que fazem parte do sistema para adequar ao que está definido pela norma.',
  ];

  const handleToggleTemPontos = (tem: boolean) => {
    onUpdateConditions({
      temPontosACorrigir: tem,
      captorFranklinStatus: tem ? 'incompleto' : 'conforme',
      parafusosStatus: tem ? 'oxidados' : 'conforme',
      possuiDpsQuadros: !tem,
    });

    if (!tem) {
      // If 100% compliant, set conform recommendations or clear
      onUpdateTexts({
        recomendacoes: [
          'Manter inspeções visuais anuais conforme exigido pela ABNT NBR 5419-3:2026.',
          'Manter a limpeza periódica das caixas de inspeção e conexões de aterramento.',
        ],
        recomendacoesTextoFinal:
          'O sistema encontra-se operando em plena conformidade com as normas vigentes.',
        conclusaoFinal:
          'Conforme descrito no decorrer deste relatório, podemos concluir que as áreas inspecionadas encontram-se em condições técnicas plenamente adequadas e satisfatórias no que se refere ao Sistema de Proteção Contra Descargas Atmosféricas segundo a norma NBR 5419:2026. As malhas de aterramento e captores atendem aos projetos executivos e normas vigentes. Este é meu parecer sob a ART em anexo.',
      });
    } else {
      // Restore default recommendations from the standard report
      onUpdateTexts({
        recomendacoes: defaultRecommendations,
        recomendacoesTextoFinal:
          'Fazer a correção de todos os itens apontados neste relatório, de forma ao sistema operar em sua perfeita harmonia.',
        conclusaoFinal:
          'Conforme descrito no decorrer deste relatório, excluindo-se as observações efetuadas neste documento, podemos concluir que as áreas inspecionadas na relação anexa, estão em condições técnicas adequadas e satisfatórias no que se refere ao Sistema de Proteção Contra Descargas Atmosféricas da norma NBR 5419:2026, quanto aos aspectos de instalação e segurança. Por fim, concluo que as malhas de aterramento e as malhas superiores do sistema de proteção contra descargas atmosféricas em análise atendem aos requisitos dos projetos executivos e normas vigentes citadas no item 01 deste relatório. Este é meu parecer sob a ART em anexo.',
      });
    }
  };

  const subsystemItems: Array<{
    key: 'subCapitacao' | 'subDescida' | 'subAterramento' | 'subEquipotencializacao';
    title: string;
    subtitle: string;
    status: SubsystemStatus;
    desc: string;
    defaultDesc: string;
    presets: string[];
    onStatusChange: (status: SubsystemStatus) => void;
    onDescChange: (desc: string) => void;
  }> = [
    {
      key: 'subCapitacao',
      title: 'Subsistema de Captação',
      subtitle: 'Mastros, pontas captoras Franklin, terminais aéreos e fitas condutoras superiores',
      status: conditions.subCapitacaoStatus || (conditions.temPontosACorrigir ? 'REQUER AJUSTES' : 'CONFORME'),
      desc: conditions.subCapitacaoDesc || 'Mastros, pontas captoras Franklin, fitas condutoras e fixações mecânicas.',
      defaultDesc: 'Mastros, pontas captoras Franklin, fitas condutoras e fixações mecânicas.',
      presets: [
        'Captor Franklin incompleto, ausente ou danificado.',
        'Fitas de captação soltas e fixadores mecânicos oxidados.',
        'Terminal aéreo com corrosão severa exigindo substituição.',
      ],
      onStatusChange: (st) => {
        const update: Partial<InspectionConditions> = { subCapitacaoStatus: st };
        if (st !== 'CONFORME') {
          update.temPontosACorrigir = true;
          if (!conditions.subCapitacaoDesc || conditions.subCapitacaoDesc === 'Mastros, pontas captoras Franklin, fitas condutoras e fixações mecânicas.') {
            update.subCapitacaoDesc = 'Captor Franklin incompleto ou ausente, e fixações mecânicas com sinais de oxidação.';
          }
        }
        onUpdateConditions(update);
      },
      onDescChange: (val) => onUpdateConditions({ subCapitacaoDesc: val }),
    },
    {
      key: 'subDescida',
      title: 'Subsistema de Descida',
      subtitle: 'Condutores de descida, fitas de alumínio/cobre, curvas e fixações verticais',
      status: conditions.subDescidaStatus || (conditions.temPontosACorrigir ? 'REQUER AJUSTES' : 'CONFORME'),
      desc: conditions.subDescidaDesc || 'Fitas de descida, espaçamento normativo, curvas e fixações mecânicas.',
      defaultDesc: 'Fitas de descida, espaçamento normativo, curvas e fixações mecânicas.',
      presets: [
        'Fita de descida rompida ou seccionada exigindo emenda normativa.',
        'Curvas com raio inferior ao exigido pela NBR 5419-3 e abraçadeiras soltas.',
        'Falta de tubo de proteção mecânica na base da descida até o solo.',
      ],
      onStatusChange: (st) => {
        const update: Partial<InspectionConditions> = { subDescidaStatus: st };
        if (st !== 'CONFORME') {
          update.temPontosACorrigir = true;
          if (!conditions.subDescidaDesc || conditions.subDescidaDesc === 'Fitas de descida, espaçamento normativo, curvas e fixações mecânicas.') {
            update.subDescidaDesc = 'Curvas inadequadas fora do raio normativo e fixações mecânicas das fitas de descida soltas.';
          }
        }
        onUpdateConditions(update);
      },
      onDescChange: (val) => onUpdateConditions({ subDescidaDesc: val }),
    },
    {
      key: 'subAterramento',
      title: 'Subsistema de Aterramento',
      subtitle: 'Caixas de inspeção, hastes cobreadas, anel perimetral e conexões',
      status: conditions.subAterramentoStatus || (conditions.caixasInspecaoLimpas ? 'CONFORME' : 'NÃO CONFORME'),
      desc: conditions.subAterramentoDesc || 'Caixas de equalização e inspeção, anel perimetral de aterramento e hastes cobreadas.',
      defaultDesc: 'Caixas de equalização e inspeção, anel perimetral de aterramento e hastes cobreadas.',
      presets: [
        'Caixas de inspeção com excesso de terra e sujidade, necessitando de limpeza.',
        'Conexões de aterramento oxidadas e conector split-bolt solto na haste.',
        'Hastes de aterramento inacessíveis ou encobertas por pavimentação.',
      ],
      onStatusChange: (st) => {
        const update: Partial<InspectionConditions> = { subAterramentoStatus: st };
        if (st !== 'CONFORME') {
          update.caixasInspecaoLimpas = false;
          if (!conditions.subAterramentoDesc || conditions.subAterramentoDesc === 'Caixas de equalização e inspeção, anel perimetral de aterramento e hastes cobreadas.') {
            update.subAterramentoDesc = 'Caixas de inspeção com sujidade/terra e conexões oxidadas necessitando de manutenção.';
          }
        } else {
          update.caixasInspecaoLimpas = true;
        }
        onUpdateConditions(update);
      },
      onDescChange: (val) => onUpdateConditions({ subAterramentoDesc: val }),
    },
    {
      key: 'subEquipotencializacao',
      title: 'Equipotencialização Metálica',
      subtitle: 'Interligação de massas metálicas da cobertura, rufos, escadas e estruturas',
      status: conditions.subEquipotencializacaoStatus || (conditions.temPontosACorrigir ? 'REQUER AJUSTES' : 'CONFORME'),
      desc: conditions.subEquipotencializacaoDesc || 'Interligação de massas metálicas da cobertura, rufos e estruturas de concreto armado.',
      defaultDesc: 'Interligação de massas metálicas da cobertura, rufos e estruturas de concreto armado.',
      presets: [
        'Massas metálicas da cobertura e rufos desprovidos de equipotencialização com o SPDA.',
        'Guarda-corpos e estruturas metálicas superiores sem cabo de continuidade.',
        'Tubulações metálicas entrando na edificação sem barramento de equipotencialização.',
      ],
      onStatusChange: (st) => {
        const update: Partial<InspectionConditions> = { subEquipotencializacaoStatus: st };
        if (st !== 'CONFORME') {
          update.temPontosACorrigir = true;
          if (!conditions.subEquipotencializacaoDesc || conditions.subEquipotencializacaoDesc === 'Interligação de massas metálicas da cobertura, rufos e estruturas de concreto armado.') {
            update.subEquipotencializacaoDesc = 'Massas metálicas da cobertura e rufos desprovidos de interligação ao anel de captação do SPDA.';
          }
        }
        onUpdateConditions(update);
      },
      onDescChange: (val) => onUpdateConditions({ subEquipotencializacaoDesc: val }),
    },
  ];

  return (
    <div className="space-y-6">
      {/* 1. SELETOR MESTRE: TEM OU NÃO TEM PONTO PARA CORRIGIR */}
      <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-6">
        <h3 className="text-base font-bold text-slate-900 mb-2">
          Status de Correções do Condomínio (NBR 5419:2026)
        </h3>
        <p className="text-xs text-slate-500 mb-4">
          Defina com 1 clique se o laudo conterá as recomendações corretivas (como no condomínio do modelo) ou se está 100% aprovado.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            onClick={() => handleToggleTemPontos(true)}
            className={`p-4 rounded-xl border text-left transition-all flex items-start gap-3.5 ${
              conditions.temPontosACorrigir
                ? 'border-red-500 bg-red-50/70 shadow-xs ring-1 ring-red-400'
                : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
            }`}
          >
            <div className={`p-2 rounded-lg ${conditions.temPontosACorrigir ? 'bg-red-600 text-white' : 'bg-slate-200 text-slate-600'}`}>
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <p className="font-bold text-sm text-slate-900">
                COM PONTOS A CORRIGIR
              </p>
            </div>
          </button>

          <button
            onClick={() => handleToggleTemPontos(false)}
            className={`p-4 rounded-xl border text-left transition-all flex items-start gap-3.5 ${
              !conditions.temPontosACorrigir
                ? 'border-emerald-500 bg-emerald-50/70 shadow-xs ring-1 ring-emerald-400'
                : 'border-slate-200 bg-slate-50 hover:bg-slate-100'
            }`}
          >
            <div className={`p-2 rounded-lg ${!conditions.temPontosACorrigir ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-600'}`}>
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <p className="font-bold text-sm text-slate-900">
                100% CONFORME
              </p>
            </div>
          </button>
        </div>
      </div>

      {/* 2. AVALIAÇÃO ESTRUTURAL DOS SUBSISTEMAS DO SPDA (NBR 5419) - EDITÁVEL */}
      <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-100 gap-2">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
              <Layers className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <span>Avaliação Estrutural dos Subsistemas (NBR 5419)</span>
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                  Tabela do Laudo & PDF
                </span>
              </h3>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4">
          {subsystemItems.map((sub) => {
            const isConforme = sub.status === 'CONFORME';
            const isNaoConforme = sub.status === 'NÃO CONFORME';
            const isRequer = sub.status === 'REQUER AJUSTES';

            return (
              <div
                key={sub.key}
                className={`p-4 rounded-xl border transition-all space-y-3 ${
                  isNaoConforme
                    ? 'border-red-300 bg-red-50/40'
                    : isRequer
                    ? 'border-amber-300 bg-amber-50/40'
                    : 'border-slate-200 bg-slate-50/60'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-bold text-sm text-slate-900">{sub.title}</h4>
                      <span
                        className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                          isConforme
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                            : isRequer
                            ? 'bg-amber-100 text-amber-800 border border-amber-300'
                            : 'bg-rose-100 text-rose-800 border border-rose-300'
                        }`}
                      >
                        {sub.status}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">{sub.subtitle}</p>
                  </div>

                  {/* 3 Botões de Status */}
                  <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
                    <button
                      type="button"
                      onClick={() => sub.onStatusChange('CONFORME')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                        isConforme
                          ? 'bg-emerald-600 text-white shadow-xs'
                          : 'bg-white text-slate-700 border border-slate-300 hover:bg-emerald-50 hover:text-emerald-700'
                      }`}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span>CONFORME</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => sub.onStatusChange('REQUER AJUSTES')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                        isRequer
                          ? 'bg-amber-600 text-white shadow-xs'
                          : 'bg-white text-slate-700 border border-slate-300 hover:bg-amber-50 hover:text-amber-700'
                      }`}
                    >
                      <AlertTriangle className="w-3.5 h-3.5" />
                      <span>REQUER AJUSTES</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => sub.onStatusChange('NÃO CONFORME')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                        isNaoConforme
                          ? 'bg-rose-600 text-white shadow-xs'
                          : 'bg-white text-slate-700 border border-slate-300 hover:bg-rose-50 hover:text-rose-700'
                      }`}
                    >
                      <ShieldAlert className="w-3.5 h-3.5" />
                      <span>NÃO CONFORME</span>
                    </button>
                  </div>
                </div>

                {/* Campo de Detalhamento / Não Conformidade */}
                <div className="space-y-1.5 pt-1">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                      {isConforme ? (
                        <>
                          <FileCheck className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Texto Descritivo de Conformidade no Laudo:</span>
                        </>
                      ) : (
                        <>
                          <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
                          <span className="text-rose-900 font-extrabold">
                            Registro Detalhado da Não Conformidade / Apontamento (Exibido no Laudo e PDF):
                          </span>
                        </>
                      )}
                    </label>

                    {sub.desc !== sub.defaultDesc && (
                      <button
                        type="button"
                        onClick={() => sub.onDescChange(sub.defaultDesc)}
                        className="text-[11px] text-blue-600 hover:underline cursor-pointer"
                      >
                        Restaurar texto padrão
                      </button>
                    )}
                  </div>

                  <textarea
                    rows={2}
                    value={sub.desc}
                    onChange={(e) => sub.onDescChange(e.target.value)}
                    placeholder="Digite a descrição ou observação técnica detalhada da não conformidade..."
                    className={`w-full p-2.5 text-xs rounded-lg border font-medium focus:outline-none focus:ring-2 transition-all ${
                      isNaoConforme
                        ? 'bg-white border-rose-300 text-rose-950 focus:ring-rose-500'
                        : isRequer
                        ? 'bg-white border-amber-300 text-amber-950 focus:ring-amber-500'
                        : 'bg-white border-slate-300 text-slate-800 focus:ring-blue-500'
                    }`}
                  />

                  {/* Sugestões rápidas de apontamentos para quando não conforme */}
                  {!isConforme && sub.presets.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                      <span className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1">
                        <Sparkles className="w-3 h-3 text-amber-500" />
                        Sugestões rápidas:
                      </span>
                      {sub.presets.map((preset, pIdx) => (
                        <button
                          key={pIdx}
                          type="button"
                          onClick={() => sub.onDescChange(preset)}
                          className="text-[10.5px] px-2 py-0.5 rounded-md bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 transition-colors cursor-pointer"
                          title="Clique para usar esta descrição"
                        >
                          {preset}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 2. ITENS DINÂMICOS ESPECÍFICOS DESTE CONDOMÍNIO */}
      <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-6 space-y-5">
        <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-3 flex items-center gap-2">
          <Wrench className="w-4 h-4 text-blue-600" />
          <span>Configuração Rápida dos Pontos Específicos</span>
        </h3>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Presença de DPS nos Quadros */}
          <div className="bg-slate-50 p-3.5 rounded-lg border border-slate-200 space-y-2">
            <label className="block text-xs font-bold text-slate-800">
              Dispositivos de Proteção contra Surtos (DPS) nos Quadros:
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => onUpdateConditions({ possuiDpsQuadros: false })}
                className={`flex-1 py-1.5 px-2.5 text-xs font-bold rounded border transition-all ${
                  !conditions.possuiDpsQuadros
                    ? 'bg-red-600 text-white border-red-600'
                    : 'bg-white text-slate-700 border-slate-300'
                }`}
              >
                NÃO POSSUEM DPS (PÁG. 10)
              </button>
              <button
                type="button"
                onClick={() => onUpdateConditions({ possuiDpsQuadros: true })}
                className={`flex-1 py-1.5 px-2.5 text-xs font-bold rounded border transition-all ${
                  conditions.possuiDpsQuadros
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-white text-slate-700 border-slate-300'
                }`}
              >
                POSSUEM DPS INSTALADO
              </button>
            </div>
            <p className="text-[11px] text-slate-500">
              {!conditions.possuiDpsQuadros
                ? 'Exibe no laudo: "Foi identificado que os quadros não têm a presença de DPS..."'
                : 'Exibe no laudo que os quadros possuem DPS adequados.'}
            </p>
          </div>

          {/* Histórico de queima de equipamentos */}
          <div className="bg-slate-50 p-3.5 rounded-lg border border-slate-200 space-y-2">
            <label className="block text-xs font-bold text-slate-800">
              Histórico de Queima de Equipamentos (Página 5):
            </label>
            <input
              type="text"
              value={client.historicoQueimaOcorrencias}
              onChange={(e) => onUpdateClient({ historicoQueimaOcorrencias: e.target.value })}
              placeholder="Ex: 2 problemas de queima de equipamentos"
              className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded"
            />
            <p className="text-[11px] text-slate-500">
              Item 4.1: "Assim devido localização do cliente existiram [texto acima]."
            </p>
          </div>
        </div>
      </div>

      {/* 3. LISTA DE RECOMENDAÇÕES CORRETIVAS (PÁGINAS 10 E 11) */}
      <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              8) Recomendações e Correções (Exibidas em Vermelho nas Páginas 10 e 11)
            </h3>
            <p className="text-xs text-slate-500">
              Você pode editar o texto de cada recomendação ou remover itens que já estão adequados no condomínio.
            </p>
          </div>

          <button
            onClick={() =>
              onUpdateTexts({
                recomendacoes: defaultRecommendations,
              })
            }
            className="text-xs text-blue-600 hover:text-blue-800 font-bold uppercase"
          >
            RESTAURAR RECOMENDAÇÕES PADRÃO
          </button>
        </div>

        <div className="space-y-2.5">
          {texts.recomendacoes.map((rec, index) => (
            <div
              key={index}
              className="flex items-start gap-2 bg-red-50/60 p-2.5 rounded-lg border border-red-100"
            >
              <span className="text-xs font-bold text-red-700 min-w-[32px] pt-1">
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
                className="flex-1 p-2 text-xs font-semibold text-red-700 bg-white border border-red-200 rounded focus:outline-none"
              />
              <button
                onClick={() => {
                  const updated = texts.recomendacoes.filter((_, i) => i !== index);
                  onUpdateTexts({ recomendacoes: updated });
                }}
                className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-100 rounded"
                title="Remover esta recomendação"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>

        <div className="pt-2">
          <label className="block text-xs font-bold text-slate-800 mb-1">
            Texto Conclusivo das Recomendações (Página 11 em Vermelho):
          </label>
          <input
            type="text"
            value={texts.recomendacoesTextoFinal}
            onChange={(e) => onUpdateTexts({ recomendacoesTextoFinal: e.target.value })}
            className="w-full p-2 text-xs font-bold text-red-700 bg-slate-50 border border-slate-300 rounded"
          />
        </div>
      </div>
    </div>
  );
};
