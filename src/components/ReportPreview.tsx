import React from 'react';
import { SpdaReport, PhotoSlot } from '../types/spda';
import { ReportHeader, ReportFooter, ReportWatermark } from './ReportHeaderFooter';
import {
  consolidateReportPhotos,
  getTowerInspectionGroups,
  analyzeTowerNonConformities,
  TowerInspectionGroup,
  exportNonConformitiesToExcelCsv,
  isDpsMissingCaption,
  isEquipotentialMissingCaption,
} from '../utils/towerSorter';
import { FileSpreadsheet, Download, CheckCircle2, AlertTriangle, ShieldCheck } from 'lucide-react';

interface ReportPreviewProps {
  report: SpdaReport;
  containerId?: string;
}

function chunkArray<T>(array: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    result.push(array.slice(i, i + size));
  }
  return result;
}

interface ResponsivePageProps {
  scale: number;
  dataPage: string;
  children: React.ReactNode;
}

const ResponsivePage: React.FC<ResponsivePageProps> = ({ scale, dataPage, children }) => {
  if (scale >= 0.98) {
    return (
      <div className="a4-page-wrapper w-full flex justify-center" data-page={dataPage}>
        {children}
      </div>
    );
  }

  // Escala precisa preservando dimensões exatas em milímetros sem cortar conteúdo
  const pageHeightPx = 1122.5 * scale;

  return (
    <div
      className="a4-page-wrapper w-full flex justify-center"
      data-page={dataPage}
      style={{
        height: `${pageHeightPx + 16}px`,
        marginBottom: '12px',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          transform: `scale(${scale})`,
          transformOrigin: 'top center',
          width: '210mm',
          height: '297mm',
        }}
      >
        {children}
      </div>
    </div>
  );
};

export const ReportPreview: React.FC<ReportPreviewProps> = ({ report, containerId = 'printable-report' }) => {
  // Organiza e consolida automaticamente as fotos de todas as torres do menor para o maior (1, 2, 4, 5... ou A, B, C...)
  const consolidated = React.useMemo(() => consolidateReportPhotos(report), [report]);
  const { company, client, texts, conditions, spdaPhotos, measurementPhotos, quadrosPhotos, localPhotos, equipmentPhotoUrl } = consolidated;

  const [scale, setScale] = React.useState<number>(1);

  React.useEffect(() => {
    const updateScale = () => {
      if (typeof window !== 'undefined') {
        const winWidth = window.innerWidth;
        if (winWidth < 820) {
          const available = Math.max(280, winWidth - 32);
          setScale(Math.min(1, available / 794));
        } else {
          setScale(1);
        }
      }
    };
    updateScale();
    window.addEventListener('resize', updateScale);
    return () => window.removeEventListener('resize', updateScale);
  }, []);

interface TowerSectionBlock {
  type: 'medicao' | 'spda' | 'quadros';
  number: string;
  title: string;
  photos: PhotoSlot[];
  towerName?: string;
  isNewTower?: boolean;
}

interface TowerInspectionPage {
  towerName: string;
  isAreaComum: boolean;
  pageIndexInTower: number;
  totalTowerPages: number;
  blocks: TowerSectionBlock[];
}

function paginateTowerGroups(groups: TowerInspectionGroup[]): TowerInspectionPage[] {
  const allPages: TowerInspectionPage[] = [];
  const MAX_PER_PAGE = 20; // 5 linhas de 4 fotos por página A4 (até 20 fotos por página)

  let currentBlocks: TowerSectionBlock[] = [];
  let countInPage = 0;
  let currentPageTowerName = groups[0]?.towerName || 'Torre 1';
  let currentPageIsAreaComum = groups[0]?.isAreaComum || false;

  groups.forEach((group) => {
    if (group.totalPhotos === 0 && groups.length > 1) return;

    const sections: Array<{
      type: 'medicao' | 'spda' | 'quadros';
      number: string;
      title: string;
      photos: PhotoSlot[];
    }> = [
      {
        type: 'medicao',
        number: '1',
        title: 'PONTOS DE ENSAIO & CONTINUIDADE ÔHMICA (MILIOHMÍMETRO)',
        photos: group.measurementPhotos,
      },
      {
        type: 'spda',
        number: '2',
        title: 'VISTORIA DO SPDA EXISTENTE & CAPTORES',
        photos: group.spdaPhotos,
      },
      {
        type: 'quadros',
        number: '3',
        title: 'ANÁLISE DOS QUADROS DE ENERGIA & PROTEÇÃO CONTRA SURTOS (DPS)',
        photos: group.quadrosPhotos,
      },
    ];

    let isFirstBlockOfThisTower = true;

    sections.forEach((sec) => {
      if (sec.photos.length === 0) return;

      let remaining = [...sec.photos];
      while (remaining.length > 0) {
        const spaceLeft = MAX_PER_PAGE - countInPage;
        // Se a página já possui fotos e não cabe pelo menos 1 linha de 4 fotos, inicia nova página
        if (spaceLeft < 4 && countInPage > 0) {
          allPages.push({
            towerName: currentPageTowerName,
            isAreaComum: currentPageIsAreaComum,
            pageIndexInTower: allPages.length + 1,
            totalTowerPages: 0,
            blocks: currentBlocks,
          });
          currentBlocks = [];
          countInPage = 0;
          currentPageTowerName = group.towerName;
          currentPageIsAreaComum = group.isAreaComum;
        }

        const takeCount = Math.min(remaining.length, MAX_PER_PAGE - countInPage);
        const slice = remaining.slice(0, takeCount);
        remaining = remaining.slice(takeCount);

        currentBlocks.push({
          type: sec.type,
          number: sec.number,
          title: sec.title,
          photos: slice,
          towerName: group.towerName,
          isNewTower: isFirstBlockOfThisTower,
        });

        isFirstBlockOfThisTower = false;
        countInPage += slice.length;

        if (countInPage >= MAX_PER_PAGE) {
          allPages.push({
            towerName: currentPageTowerName,
            isAreaComum: currentPageIsAreaComum,
            pageIndexInTower: allPages.length + 1,
            totalTowerPages: 0,
            blocks: currentBlocks,
          });
          currentBlocks = [];
          countInPage = 0;
          currentPageTowerName = group.towerName;
          currentPageIsAreaComum = group.isAreaComum;
        }
      }
    });
  });

  if (currentBlocks.length > 0) {
    allPages.push({
      towerName: currentPageTowerName,
      isAreaComum: currentPageIsAreaComum,
      pageIndexInTower: allPages.length + 1,
      totalTowerPages: 0,
      blocks: currentBlocks,
    });
  }

  allPages.forEach((p, idx) => {
    p.pageIndexInTower = idx + 1;
    p.totalTowerPages = allPages.length;
  });

  return allPages;
}

  // ========================================================
  // PAGINAÇÃO ESTRUTURADA POR TORRE + QUADRO RESUMO EXECUTIVO
  // ========================================================
  const isMultiTower =
    Boolean(client.quantidadeTorres && client.quantidadeTorres > 1) ||
    Boolean(client.torresNomes && client.torresNomes.length > 1) ||
    Object.keys(consolidated.torresData || {}).length > 1;

  const towerGroups = React.useMemo(() => getTowerInspectionGroups(consolidated), [consolidated]);
  const nonComplianceSummary = React.useMemo(() => analyzeTowerNonConformities(consolidated), [consolidated]);
  const allTowerPages = React.useMemo(() => paginateTowerGroups(towerGroups), [towerGroups]);

  const aerialPhoto = localPhotos[0]?.url ? localPhotos[0] : null;
  const facadePhoto = localPhotos[1]?.url ? localPhotos[1] : null;
  const hasBothLocalPhotos = Boolean(aerialPhoto && facadePhoto);
  const localPageCount = hasBothLocalPhotos ? 2 : 1;

  // Total de Páginas:
  // 1: Capa
  // 2: 1) Introdução, Normas & 2) Dicionário (2 colunas)
  // 3: 3) Características, Fotos do Local (em destaque próprio) & 4) Histórico
  // 4: 5) Instrumento de Medição Miliohmímetro & Metodologia
  // 5+: Relatório de Vistoria e Ensaios por Torre (allTowerPages.length)
  // Penúltima: 6) Quadro Resumo de Adequações por Torre (Não Conformidades NBR 5419:2026)
  // Última: 7) Recomendações Prioritárias + Conclusão Final & Assinatura
  const totalPages =
    1 + // Capa
    1 + // Intro, Normas & Dicionário
    localPageCount + // Características, Vista Aérea e Fachada & Histórico
    1 + // Instrumento de Medição Miliohmímetro
    allTowerPages.length + // Páginas de todas as torres agrupadas
    1 + // Quadro Resumo de Adequações por Torre
    1; // Recomendações Prioritárias + Conclusão Final & Assinatura

  let currentPageNum = 1;

  return (
    <div id={containerId} className="flex flex-col items-center gap-6 print:gap-0 bg-transparent w-full max-w-full overflow-x-hidden">
      {/* ========================================================
          PÁGINA 1: CAPA EXECUTIVA (COMPACTA, DENSA E COMPLETA)
          ======================================================== */}
      <ResponsivePage scale={scale} dataPage="1">
        <div className="a4-page shadow-xl border border-gray-200 print:border-none print:shadow-none" data-page="1">
          <ReportWatermark text={company.watermarkText} enabled={company.showWatermark} />
          <ReportHeader company={company} />

          <div className="relative z-10 flex flex-col font-sans">
            {/* Tag Superior */}
            <div className="bg-gray-100 rounded-sm py-1.5 px-3 text-center mb-3">
              <span className="text-[10px] font-black text-[#d9383a] uppercase tracking-wider">
                LAUDO TÉCNICO PERICIAL DE ENGENHARIA ELÉTRICA
              </span>
            </div>

            {/* Título Principal */}
            <h1 className="text-[17px] font-black text-center text-slate-900 uppercase tracking-tight leading-snug mb-1">
              SISTEMA DE PROTEÇÃO CONTRA DESCARGAS ATMOSFÉRICAS (SPDA)
            </h1>
            <p className="text-[10px] font-medium text-slate-600 text-center mb-3.5">
              Inspeção Visual, Medições de Continuidade Ôhmica & Avaliação NBR 5419:2026
            </p>

            {/* Objeto Box */}
            <div className="bg-slate-50 border border-slate-200 rounded p-2.5 mb-3 text-justify">
              <p className="text-[10px] font-black text-slate-900 uppercase mb-0.5">OBJETO DA INSPEÇÃO:</p>
              <p className="text-[9.5px] text-slate-700 leading-snug">{texts.objeto}</p>
            </div>

            {/* Dados do Cliente */}
            <div className="border border-slate-200 rounded overflow-hidden mb-3">
              <div className="bg-slate-100 px-3 py-1 font-bold text-[10px] text-slate-900 border-b border-slate-200">
                DADOS DA EDIFICAÇÃO / CLIENTE
              </div>
              <div className="text-[9.5px] divide-y divide-slate-100">
                <div className="flex px-3 py-1 bg-white items-baseline gap-2">
                  <span className="w-40 font-bold text-slate-800 flex-shrink-0">CLIENTE:</span>
                  <span className="flex-1 min-w-0 font-semibold text-slate-700 break-words">{client.name || '—'}</span>
                </div>
                <div className="flex px-3 py-1 bg-slate-50/50 items-baseline gap-2">
                  <span className="w-40 font-bold text-slate-800 flex-shrink-0">LOCAL:</span>
                  <span className="flex-1 min-w-0 font-semibold text-slate-700 break-words">{client.local || '—'}</span>
                </div>
                <div className="flex px-3 py-1 bg-white items-baseline gap-2">
                  <span className="w-40 font-bold text-slate-800 flex-shrink-0">MUNICÍPIO / UF:</span>
                  <span className="flex-1 min-w-0 font-semibold text-slate-700 break-words">{client.municipio || '—'}</span>
                </div>
                <div className="flex px-3 py-1 bg-slate-50/50 items-baseline gap-2">
                  <span className="w-40 font-bold text-slate-800 flex-shrink-0">CNPJ:</span>
                  <span className="flex-1 min-w-0 font-semibold text-slate-700 break-words">{client.cnpj || '—'}</span>
                </div>
                <div className="flex px-3 py-1 bg-white items-baseline gap-2">
                  <span className="w-40 font-bold text-slate-800 flex-shrink-0">RAMO DE ATIVIDADE:</span>
                  <span className="flex-1 min-w-0 font-semibold text-slate-700 break-words">{client.ramoAtividade || '—'}</span>
                </div>
                <div className="flex px-3 py-1 bg-slate-50/50 items-baseline gap-2">
                  <span className="w-40 font-bold text-slate-800 flex-shrink-0">PERÍODO DE AVALIAÇÃO:</span>
                  <span className="flex-1 min-w-0 font-semibold text-slate-700 break-words">{client.periodoAvaliacao || '—'}</span>
                </div>
                <div className="flex px-3 py-1 bg-white items-baseline gap-2">
                  <span className="w-40 font-bold text-slate-800 flex-shrink-0">GRAU DE EXPOSIÇÃO:</span>
                  <span className="flex-1 min-w-0 font-semibold text-slate-700 break-words">{client.exposicaoNivel || 'Baixa exposição a descargas atmosféricas'}</span>
                </div>
              </div>
            </div>

            {/* Responsabilidade Técnica */}
            <div className="border border-slate-200 rounded overflow-hidden mb-3">
              <div className="bg-slate-100 px-3 py-1 font-bold text-[10px] text-slate-900 border-b border-slate-200">
                RESPONSABILIDADE TÉCNICA & REGISTRO PROFISSIONAL
              </div>
              <div className="text-[9.5px] divide-y divide-slate-100">
                <div className="flex px-3 py-1 bg-white items-baseline gap-2">
                  <span className="w-48 font-bold text-slate-800 flex-shrink-0">RESPONSÁVEL TÉCNICO:</span>
                  <span className="flex-1 min-w-0 font-semibold text-slate-700 break-words">{client.tecnico || '—'}</span>
                </div>
                <div className="flex px-3 py-1 bg-slate-50/50 items-baseline gap-2">
                  <span className="w-48 font-bold text-slate-800 flex-shrink-0">QUALIFICAÇÃO PROFISSIONAL:</span>
                  <span className="flex-1 min-w-0 font-semibold text-slate-700 break-words">{client.cargo || '—'}</span>
                </div>
                <div className="flex px-3 py-1 bg-white items-baseline gap-2">
                  <span className="w-48 font-bold text-slate-800 flex-shrink-0">REGISTRO CREA / CONFEA:</span>
                  <span className="flex-1 min-w-0 font-semibold text-slate-700 break-words">{client.crea || '—'}</span>
                </div>
                <div className="flex px-3 py-1 bg-slate-50/50 items-baseline gap-2">
                  <span className="w-48 font-bold text-slate-800 flex-shrink-0">CIDADE & DATA DE EMISSÃO:</span>
                  <span className="flex-1 min-w-0 font-semibold text-slate-700 break-words">{client.cidadeEmissao}, {client.dataEmissaoExtenso}</span>
                </div>
                {report.digitalSignature?.enabled && (
                  <div className="flex px-3 py-1 bg-blue-50/70 items-baseline gap-2 text-blue-900">
                    <span className="w-48 font-bold flex-shrink-0">AUTENTICAÇÃO DIGITAL:</span>
                    <span className="flex-1 min-w-0 font-bold text-blue-800 text-[8.5px] break-words">
                      DOCUMENTO ASSINADO DIGITALMENTE (PÁGINA FINAL)
                    </span>
                  </div>
                )}
              </div>
            </div>

          </div>

          <ReportFooter company={company} pageNumber={currentPageNum++} totalPages={totalPages} />
        </div>
      </ResponsivePage>

      {/* ========================================================
          PÁGINA 2: 1) INTRODUÇÃO, REFERÊNCIAS NORMATIVAS & 2) DICIONÁRIO
          UNIFICADOS: PÁGINA 100% DENSA E COMPLETA SEM VAZIOS
          ======================================================== */}
      <ResponsivePage scale={scale} dataPage="2">
        <div className="a4-page shadow-xl border border-gray-200 print:border-none print:shadow-none" data-page="2">
          <ReportWatermark text={company.watermarkText} enabled={company.showWatermark} />
          <ReportHeader company={company} />

          <div className="relative z-10 text-[9.5px] leading-[1.38] text-slate-800 space-y-2 text-justify font-sans">
            <h2 className="text-[11.5px] font-bold text-slate-900 mb-1 font-sans">1) INTRODUÇÃO</h2>
            <p>
              <span className="font-bold">1.1-</span> Este LAUDO tem como objetivo fazer uma avaliação sucinta do SPDA existente na edificação do {client.name}, verificar o estado de conservação das peças e acessórios e checar a sua conformidade com a norma técnica NBR 5419:2026 da ABNT em vigência. <span className="font-bold">1.2-</span> Serão apresentadas as sugestões técnicas necessárias para conformidade à norma e apresentados desenhos e/ou detalhes caso seja necessário.
            </p>
            <p>
              <span className="font-bold">1.3-</span> A avaliação apresentada neste laudo teve como base as inspeções e medições efetuadas nas instalações e por informações obtidas junto a colaboradores e engenheiros da SJC Engenharia.
            </p>
            <div>
              <p>
                <span className="font-bold">1.4-</span> Segundo a ABNT NBR 5419-1:2026, Proteção contra descargas atmosféricas – Parte 1: Princípios Gerais, item 9.4.1.2, as funções do SPDA externo são:
              </p>
              <div className="pl-3 mt-0.5 space-y-0.5 text-[9px]">
                <p>a) Interceptar uma descarga atmosférica para a estrutura (com um subsistema de captação);</p>
                <p>b) Conduzir a corrente da descarga atmosférica seguramente para a terra (com um subsistema de descida);</p>
                <p>c) Dispersar esta corrente na terra (com um subsistema de aterramento).</p>
              </div>
            </div>

            <div>
              <p className="font-semibold text-slate-900">Ordem dos levantamentos periciais efetuados:</p>
              <div className="pl-3 mt-0.5 space-y-0.5 text-[9px]">
                <p>a) Análise das informações fornecidas pelos ANEXOS (Projetos e relatórios fornecidos pelo cliente);</p>
                <p>b) Relatório de inspeção de SPDA e Caixas de Inspeção de Hastes de Aterramento;</p>
                <p>c) Relatório de Inspeção de Medição de Continuidade de Malha de Aterramento;</p>
                <p>d) Relatório de Inspeção de Pontos de aterramento e avaliação dos quadros de energia;</p>
                <p>e) Avaliação Geral do Sistema de Proteção contra Descargas Atmosféricas e Laudo Técnico Final.</p>
              </div>
            </div>

            {/* Referências Normativas */}
            <div className="pt-1">
              <div className="bg-slate-100 rounded-sm py-1 px-3 text-center mb-1.5">
                <span className="text-[10px] font-bold text-slate-900 uppercase">
                  REFERÊNCIAS NORMATIVAS APLICÁVEIS
                </span>
              </div>

              <p className="text-[9px] mb-1.5 leading-snug">
                Os documentos relacionados a seguir são indispensáveis à aplicação deste documento (edições mais recentes e emendas vigentes):
              </p>

              <div className="grid grid-cols-2 gap-1 text-[8.5px] bg-slate-50 border border-slate-200 rounded p-1.5">
                {texts.referenciasNormativas.map((norma, nIdx) => (
                  <div key={nIdx} className="flex items-start gap-1 min-w-0">
                    <span className="text-red-600 font-bold flex-shrink-0">•</span>
                    <span className="text-slate-700 leading-tight min-w-0 flex-1 break-words">{norma}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* 2) Dicionário e Abreviaturas em Grade de 2 Colunas */}
            <div className="pt-1">
              <div className="bg-slate-100 rounded-sm py-1 px-3 text-center mb-1.5">
                <span className="text-[10px] font-bold text-slate-900 uppercase">
                  2) DICIONÁRIO E ABREVIATURAS USADAS NESTE DOCUMENTO
                </span>
              </div>

              <div className="grid grid-cols-2 gap-1.5 text-[8.5px]">
                {texts.dicionario.slice(0, 8).map((d, dIdx) => (
                  <div key={dIdx} className="bg-white border border-slate-200 rounded px-2 py-1 leading-snug min-w-0 break-words">
                    <span className="font-bold text-slate-900">{d.termo}: </span>
                    <span className="text-slate-600">{d.definicao}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Nota de Habilitação CREA */}
            <div className="bg-blue-50/60 border border-blue-200 rounded px-2.5 py-1.5 mt-1">
              <p className="text-[8.5px] font-bold text-blue-900 uppercase mb-0.5">
                CREA – CONSELHO REGIONAL DE ENGENHARIA E AGRONOMIA
              </p>
              <p className="text-[8px] text-blue-800 leading-tight break-words">
                Inspeção realizada por engenheiro legalmente habilitado, com registro ativo e emissão da ART correspondente, assegurando o rigor técnico e legalidade das medições.
              </p>
            </div>
          </div>

          <ReportFooter company={company} pageNumber={currentPageNum++} totalPages={totalPages} />
        </div>
      </ResponsivePage>

      {/* ========================================================
          PÁGINA 3: 3) CARACTERÍSTICAS DA EDIFICAÇÃO & VISTA AÉREA (EM DESTAQUE)
          ======================================================== */}
      {/* ========================================================
          PÁGINA 3: 3) CARACTERÍSTICAS DA EDIFICAÇÃO & VISTA AÉREA (EM DESTAQUE)
          ======================================================== */}
      {hasBothLocalPhotos ? (
        <>
          {/* PÁGINA 3: CARACTERÍSTICAS & SESSÃO DE VISTA AÉREA EM DESTAQUE */}
          <ResponsivePage scale={scale} dataPage="3">
            <div className="a4-page shadow-xl border border-gray-200 print:border-none print:shadow-none" data-page="3">
              <ReportWatermark text={company.watermarkText} enabled={company.showWatermark} />
              <ReportHeader company={company} />

              <div className="relative z-10 text-[9.5px] leading-[1.38] text-slate-800 space-y-2.5 text-justify font-sans">
                <div>
                  <h2 className="text-[11.5px] font-bold text-slate-900 uppercase mb-1 font-sans">
                    3) CARACTERÍSTICAS DA EDIFICAÇÃO & LOCAL
                  </h2>
                  {(() => {
                    const desc = (client.descricaoBloco || texts.caracteristicasLocal || '').trim();
                    if (!desc || /^(?:torre\s*\d+|torre\s*\/\s*estrutura|estrutura\s*\/\s*torre)$/i.test(desc)) return null;
                    return (
                      <p className="text-[9.5px] leading-relaxed mb-2 break-words">
                        {desc}
                      </p>
                    );
                  })()}

                  {/* SESSÃO 3.1: VISTA AÉREA EM GRANDE DESTAQUE */}
                  <div className="my-2 border border-slate-200 rounded-lg overflow-hidden bg-slate-50 p-2.5">
                    <h3 className="text-[10px] font-bold text-slate-900 uppercase mb-1.5 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-blue-600 inline-block"></span>
                      3.1) VISTA AÉREA DA EDIFICAÇÃO / IMAGEM SATÉLITE
                    </h3>
                    <div className="w-full flex items-center justify-center py-0.5">
                      <img
                        src={aerialPhoto!.url}
                        alt={aerialPhoto!.caption || 'Vista Aérea da Edificação'}
                        loading="lazy"
                        decoding="async"
                        className="max-w-full max-h-[220px] w-auto h-auto object-contain rounded border border-slate-300 shadow-xs"
                      />
                    </div>
                    <p className="text-[8.5px] font-semibold text-slate-700 mt-1.5 text-center">
                      {aerialPhoto!.caption?.trim() || 'Vista aérea da edificação, circunvizinhança e posicionamento geográfico do condomínio.'}
                    </p>
                  </div>

                  {/* Quadro Técnico de Infraestrutura */}
                  <div className="my-2 border border-slate-200 rounded overflow-hidden">
                    <div className="bg-slate-100 px-3 py-1 font-bold text-[9px] text-slate-900 border-b border-slate-200">
                      PARÂMETROS CONSTRUTIVOS & INFRAESTRUTURA DA EDIFICAÇÃO (NBR 5419:2026)
                    </div>
                    <div className="divide-y divide-slate-100 text-[8.5px]">
                      <div className="px-3 py-1 flex justify-between items-center gap-2 bg-white">
                        <span className="font-semibold text-slate-800 flex-1 min-w-0 break-words">Tipologia Construtiva:</span>
                        <span className="text-slate-600 text-right flex-shrink-0 max-w-[55%] break-words">Alvenaria Convencional / Estrutura em Concreto Armado</span>
                      </div>
                      <div className="px-3 py-1 flex justify-between items-center gap-2 bg-slate-50/50">
                        <span className="font-semibold text-slate-800 flex-1 min-w-0 break-words">Topografia & Entorno:</span>
                        <span className="text-slate-600 text-right flex-shrink-0 max-w-[55%] break-words">Terreno Urbano Plano com Edificações Vizinhas</span>
                      </div>
                      <div className="px-3 py-1 flex justify-between items-center gap-2 bg-white">
                        <span className="font-semibold text-slate-800 flex-1 min-w-0 break-words">Nível de Proteção Dimensionado:</span>
                        <span className="font-bold text-blue-700 text-right flex-shrink-0 max-w-[55%] break-words">Nível III / IV (NBR 5419-2:2026 - Gerenciamento de Risco)</span>
                      </div>
                      <div className="px-3 py-1 flex justify-between items-center gap-2 bg-slate-50/50">
                        <span className="font-semibold text-slate-800 flex-1 min-w-0 break-words">Métodos de Proteção Aplicáveis:</span>
                        <span className="text-slate-600 text-right flex-shrink-0 max-w-[55%] break-words">Ângulo de Proteção (Franklin) e Condutores em Malha (Faraday)</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <ReportFooter company={company} pageNumber={currentPageNum++} totalPages={totalPages} />
            </div>
          </ResponsivePage>

          {/* PÁGINA 4: SESSÃO DE FACHADA PRINCIPAL EM DESTAQUE & HISTÓRICO */}
          <ResponsivePage scale={scale} dataPage="4">
            <div className="a4-page shadow-xl border border-gray-200 print:border-none print:shadow-none" data-page="4">
              <ReportWatermark text={company.watermarkText} enabled={company.showWatermark} />
              <ReportHeader company={company} />

              <div className="relative z-10 text-[9.5px] leading-[1.38] text-slate-800 space-y-2.5 text-justify font-sans">
                {/* SESSÃO 3.2: FACHADA EM GRANDE DESTAQUE */}
                <div className="my-1 border border-slate-200 rounded-lg overflow-hidden bg-slate-50 p-2.5">
                  <h3 className="text-[10px] font-bold text-slate-900 uppercase mb-1.5 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-600 inline-block"></span>
                    3.2) FACHADA PRINCIPAL DA EDIFICAÇÃO / CONDOMÍNIO
                  </h3>
                  <div className="w-full flex items-center justify-center py-0.5">
                    <img
                      src={facadePhoto!.url}
                      alt={facadePhoto!.caption || 'Fachada Principal da Edificação'}
                      loading="lazy"
                      decoding="async"
                      className="max-w-full max-h-[220px] w-auto h-auto object-contain rounded border border-slate-300 shadow-xs"
                    />
                  </div>
                  <p className="text-[8.5px] font-semibold text-slate-700 mt-1.5 text-center">
                    {facadePhoto!.caption?.trim() || 'Fachada principal da edificação, estrutura predial e acessos vistoriados.'}
                  </p>
                </div>

                <p className="text-[9px] leading-relaxed pt-1 break-words">
                  A edificação é de uso <span className="font-bold">{client.ramoAtividade}</span> com presença de ocupantes e equipamentos eletroeletrônicos e está localizada numa área de <span className="font-bold">{client.exposicaoNivel || 'baixa EXPOSIÇÃO'}</span> a descargas atmosféricas e seus efeitos indiretos.
                </p>

                {/* 4) Histórico de Problemas */}
                <div className="border-t border-slate-200 pt-2">
                  <h2 className="text-[11.5px] font-bold text-slate-900 uppercase mb-1 font-sans">
                    4) HISTÓRICO DE PROBLEMAS & OCORRÊNCIAS
                  </h2>
                  <div className="space-y-1.5 text-[9px] leading-relaxed">
                    <p className="break-words">
                      <span className="font-bold">4.1-</span> Devido à localização e infraestrutura da edificação, constata-se: {client.historicoQueimaOcorrencias || '2 problemas de queima de equipamentos eletroeletrônicos'}.
                    </p>
                    <p className="break-words">
                      <span className="font-bold">4.2-</span> A ocorrência de problemas com equipamentos se deve ao fato de descargas nas proximidades gerarem pulsos eletromagnéticos que viajam pela rede elétrica sem blindagem suficiente. Com isso, é indispensável a instalação de supressores de surtos (DPS) coordenados nos quadros de distribuição.
                    </p>
                  </div>
                </div>
              </div>

              <ReportFooter company={company} pageNumber={currentPageNum++} totalPages={totalPages} />
            </div>
          </ResponsivePage>
        </>
      ) : (
        /* Caso com 1 ou 0 fotos: Página 3 unificada elegante sem vazios */
        <ResponsivePage scale={scale} dataPage="3">
          <div className="a4-page shadow-xl border border-gray-200 print:border-none print:shadow-none" data-page="3">
            <ReportWatermark text={company.watermarkText} enabled={company.showWatermark} />
            <ReportHeader company={company} />

            <div className="relative z-10 text-[9.5px] leading-[1.38] text-slate-800 space-y-2 text-justify font-sans">
              <div>
                <h2 className="text-[11.5px] font-bold text-slate-900 uppercase mb-1 font-sans">
                  3) CARACTERÍSTICAS DA EDIFICAÇÃO & LOCAL
                </h2>
                {(() => {
                  const desc = (client.descricaoBloco || texts.caracteristicasLocal || '').trim();
                  if (!desc || /^(?:torre\s*\d+|torre\s*\/\s*estrutura|estrutura\s*\/\s*torre)$/i.test(desc)) return null;
                  return (
                    <p className="text-[9.5px] leading-relaxed mb-2 break-words">
                      {desc}
                    </p>
                  );
                })()}

                {(aerialPhoto || facadePhoto) ? (
                  <div className="my-2 border border-slate-200 rounded-lg overflow-hidden bg-slate-50 p-2.5">
                    <h3 className="text-[10px] font-bold text-slate-900 uppercase mb-1.5 flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full inline-block ${aerialPhoto ? 'bg-blue-600' : 'bg-emerald-600'}`} />
                      {aerialPhoto ? '3.1) VISTA AÉREA DA EDIFICAÇÃO / IMAGEM SATÉLITE' : '3.1) FACHADA PRINCIPAL DA EDIFICAÇÃO / CONDOMÍNIO'}
                    </h3>
                    <div className="w-full flex items-center justify-center py-0.5">
                      <img
                        src={(aerialPhoto || facadePhoto)!.url}
                        alt={(aerialPhoto || facadePhoto)!.caption || 'Foto do Local'}
                        loading="lazy"
                        decoding="async"
                        className="max-w-full max-h-[220px] w-auto h-auto object-contain rounded border border-slate-300 shadow-xs"
                      />
                    </div>
                    {((aerialPhoto || facadePhoto)!.caption?.trim()) && (
                      <p className="text-[8.5px] font-semibold text-slate-700 mt-1.5 text-center">
                        {(aerialPhoto || facadePhoto)!.caption.trim()}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="my-2 border border-slate-200 rounded overflow-hidden">
                    <div className="bg-slate-100 px-3 py-1 font-bold text-[9px] text-slate-900 border-b border-slate-200">
                      PARÂMETROS CONSTRUTIVOS & INFRAESTRUTURA DA EDIFICAÇÃO (NBR 5419:2026)
                    </div>
                    <div className="divide-y divide-slate-100 text-[8.5px]">
                      <div className="px-3 py-1 flex justify-between items-center gap-2 bg-white">
                        <span className="font-semibold text-slate-800 flex-1 min-w-0 break-words">Tipologia Construtiva:</span>
                        <span className="text-slate-600 text-right flex-shrink-0 max-w-[55%] break-words">Alvenaria Convencional / Estrutura em Concreto Armado</span>
                      </div>
                      <div className="px-3 py-1 flex justify-between items-center gap-2 bg-slate-50/50">
                        <span className="font-semibold text-slate-800 flex-1 min-w-0 break-words">Topografia & Entorno:</span>
                        <span className="text-slate-600 text-right flex-shrink-0 max-w-[55%] break-words">Terreno Urbano Plano com Edificações Vizinhas</span>
                      </div>
                      <div className="px-3 py-1 flex justify-between items-center gap-2 bg-white">
                        <span className="font-semibold text-slate-800 flex-1 min-w-0 break-words">Nível de Proteção Dimensionado:</span>
                        <span className="font-bold text-blue-700 text-right flex-shrink-0 max-w-[55%] break-words">Nível III / IV (NBR 5419-2:2026 - Gerenciamento de Risco)</span>
                      </div>
                      <div className="px-3 py-1 flex justify-between items-center gap-2 bg-slate-50/50">
                        <span className="font-semibold text-slate-800 flex-1 min-w-0 break-words">Métodos de Proteção Aplicáveis:</span>
                        <span className="text-slate-600 text-right flex-shrink-0 max-w-[55%] break-words">Ângulo de Proteção (Franklin) e Condutores em Malha (Faraday)</span>
                      </div>
                    </div>
                  </div>
                )}

                <p className="text-[9px] leading-relaxed pt-1 break-words">
                  A edificação é de uso <span className="font-bold">{client.ramoAtividade}</span> com presença de ocupantes e equipamentos eletroeletrônicos e está localizada numa área de <span className="font-bold">{client.exposicaoNivel || 'baixa EXPOSIÇÃO'}</span> a descargas atmosféricas e seus efeitos indiretos.
                </p>
              </div>

              {/* 4) Histórico de Problemas */}
              <div className="border-t border-slate-200 pt-2">
                <h2 className="text-[11.5px] font-bold text-slate-900 uppercase mb-1 font-sans">
                  4) HISTÓRICO DE PROBLEMAS & OCORRÊNCIAS
                </h2>
                <div className="space-y-1.5 text-[9px] leading-relaxed">
                  <p className="break-words">
                    <span className="font-bold">4.1-</span> Devido à localização e infraestrutura da edificação, constata-se: {client.historicoQueimaOcorrencias || '2 problemas de queima de equipamentos eletroeletrônicos'}.
                  </p>
                  <p className="break-words">
                    <span className="font-bold">4.2-</span> A ocorrência de problemas com equipamentos se deve ao fato de descargas nas proximidades gerarem pulsos eletromagnéticos que viajam pela rede elétrica sem blindagem suficiente. Com isso, é indispensável a instalação de supressores de surtos (DPS) coordenados nos quadros de distribuição.
                  </p>
                </div>
              </div>
            </div>

            <ReportFooter company={company} pageNumber={currentPageNum++} totalPages={totalPages} />
          </div>
        </ResponsivePage>
      )}

      {/* ========================================================
          PÁGINA: INSTRUMENTAÇÃO TÉCNICA E PARÂMETROS NORMATIVOS (NBR 5419:2026 / NBR 5410)
          ======================================================== */}
      <ResponsivePage scale={scale} dataPage="instrumentacao">
        <div className="a4-page shadow-xl border border-gray-200 print:border-none print:shadow-none" data-page="instrumentacao">
          <ReportWatermark text={company.watermarkText} enabled={company.showWatermark} />
          <ReportHeader company={company} />

          <div className="relative z-10 text-[9.5px] leading-[1.38] text-slate-800 space-y-2 text-justify font-sans">
            <h2 className="text-[11.5px] font-bold text-slate-900 uppercase font-sans">
              5) INSTRUMENTAÇÃO TÉCNICA E CRITÉRIOS DE INSPEÇÃO
            </h2>

            <p className="text-[9px] leading-relaxed">
              {texts.medicoesContinuidadeTexto}
            </p>

            {/* Instrumento Miliohmímetro */}
            <div className="bg-slate-50 border border-slate-200 rounded p-2.5 flex gap-3 items-center">
              {equipmentPhotoUrl ? (
                <div className="w-[140px] h-[95px] bg-white border border-gray-300 rounded overflow-hidden flex items-center justify-center p-1 flex-shrink-0">
                  <img
                    src={equipmentPhotoUrl}
                    alt="Miliohmímetro"
                    loading="lazy"
                    decoding="async"
                    className="max-w-full max-h-full object-contain"
                  />
                </div>
              ) : null}
              <div className="flex-1 space-y-0.5">
                <p className="text-[9.5px] font-bold text-slate-900">
                  Miliohmímetro {texts.equipamentoModelo} - Marca: {texts.equipamentoMarca}
                </p>
                <p className="text-[8.5px] text-slate-600 leading-snug">
                  {texts.equipamentoDescricao}
                </p>
                <div className="pt-0.5 text-[8.5px] font-semibold text-slate-800 space-y-0.2">
                  <p><span className="text-slate-500 font-normal">Local de Aplicação:</span> {texts.medicoesLocal}</p>
                  <p><span className="text-slate-500 font-normal">Corrente Injetada de Ensaio:</span> {texts.medicoesCorrenteAplicada}</p>
                  <p><span className="text-slate-500 font-normal">Tipo de Corrente:</span> {texts.medicoesTipoCorrente}</p>
                </div>
              </div>
            </div>

            {/* Parâmetros Normativos NBR 5419 */}
            <div className="border border-slate-200 rounded overflow-hidden">
              <div className="bg-slate-100 px-3 py-1 font-bold text-[9px] text-slate-900 border-b border-slate-200">
                PARÂMETROS NORMATIVOS DE CONTINUIDADE (ABNT NBR 5419:2026)
              </div>
              <div className="divide-y divide-slate-100 text-[8.5px]">
                <div className="px-3 py-1 flex justify-between items-center gap-2 bg-white">
                  <div className="flex-1 min-w-0 pr-1">
                    <span className="font-bold text-slate-900 break-words">Continuidade de Armaduras e Malhas: </span>
                    <span className="text-slate-600 break-words">NBR 5419-3:2026 (Item 5.3.5)</span>
                  </div>
                  <span className="font-bold text-emerald-700 flex-shrink-0 text-right whitespace-nowrap">≤ 0,200 Ω (200 mΩ) [CONFORME]</span>
                </div>
                <div className="px-3 py-1 flex justify-between items-center gap-2 bg-slate-50/50">
                  <div className="flex-1 min-w-0 pr-1">
                    <span className="font-bold text-slate-900 break-words">Resistência de Equipotencialização: </span>
                    <span className="text-slate-600 break-words">NBR 5419-3:2026 (Item 6.2)</span>
                  </div>
                  <span className="font-bold text-emerald-700 flex-shrink-0 text-right whitespace-nowrap">≤ 0,200 Ω (200 mΩ) [CONFORME]</span>
                </div>
                <div className="px-3 py-1 flex justify-between items-center gap-2 bg-white">
                  <div className="flex-1 min-w-0 pr-1">
                    <span className="font-bold text-slate-900 break-words">Método de 4 Terminais (Kelvin): </span>
                    <span className="text-slate-600 break-words">Injeção de corrente DC contínua eliminando resistência das pontas de prova</span>
                  </div>
                  <span className="font-bold text-emerald-700 flex-shrink-0 text-right whitespace-nowrap">APLICADO</span>
                </div>
                <div className="px-3 py-1 flex justify-between items-center gap-2 bg-slate-50/50">
                  <div className="flex-1 min-w-0 pr-1">
                    <span className="font-bold text-slate-900 break-words">Estado das Caixas de Inspeção: </span>
                    <span className="text-slate-600 break-words">Aterramento & Equalização</span>
                  </div>
                  <span className={`font-bold flex-shrink-0 text-right whitespace-nowrap ${conditions.caixasInspecaoLimpas ? 'text-emerald-700' : 'text-amber-700'}`}>
                    {conditions.caixasInspecaoLimpas ? 'CONFORME' : 'LIMPEZA PENDENTE'}
                  </span>
                </div>
              </div>
            </div>

            {/* Painel de Parecer Técnico Geral */}
            <div className="bg-slate-50 border border-slate-200 rounded p-2.5 text-justify">
              <p className="text-[9.5px] font-bold text-slate-900 uppercase mb-0.5">
                ANÁLISE PERICIAL DA INSPEÇÃO VISUAL IN LOCO:
              </p>
              <p className="text-[9px] text-slate-700 leading-relaxed">
                {texts.vistoriaSpdaAnalise}
              </p>
            </div>

            {/* Tabela dos 4 Subsistemas Vistoriados */}
            <div className="border border-slate-200 rounded overflow-hidden">
              <div className="bg-slate-100 px-3 py-1 font-bold text-[9px] text-slate-900 border-b border-slate-200">
                AVALIAÇÃO ESTRUTURAL DOS SUBSISTEMAS DO SPDA (NBR 5419:2026)
              </div>
              <div className="divide-y divide-slate-100 text-[8.5px]">
                {[
                  {
                    item: 'Subsistema de Captação',
                    desc: conditions.subCapitacaoDesc || 'Mastros, pontas captoras Franklin, fitas condutoras e fixações mecânicas.',
                    status: conditions.subCapitacaoStatus || (conditions.temPontosACorrigir ? 'REQUER AJUSTES' : 'CONFORME'),
                  },
                  {
                    item: 'Subsistema de Descida',
                    desc: conditions.subDescidaDesc || 'Fitas de descida, espaçamento normativo, curvas e fixações mecânicas.',
                    status: conditions.subDescidaStatus || (conditions.temPontosACorrigir ? 'REQUER AJUSTES' : 'CONFORME'),
                  },
                  {
                    item: 'Subsistema de Aterramento',
                    desc: conditions.subAterramentoDesc || 'Caixas de equalização e inspeção, anel perimetral de aterramento e hastes cobreadas.',
                    status: conditions.subAterramentoStatus || (conditions.caixasInspecaoLimpas ? 'CONFORME' : 'NÃO CONFORME'),
                  },
                  {
                    item: 'Equipotencialização Metálica',
                    desc: conditions.subEquipotencializacaoDesc || 'Interligação de massas metálicas da cobertura, rufos e estruturas de concreto armado.',
                    status: conditions.subEquipotencializacaoStatus || (conditions.temPontosACorrigir ? 'REQUER AJUSTES' : 'CONFORME'),
                  },
                ].map((sub, sIdx) => {
                  const isConforme = sub.status === 'CONFORME';
                  const isRequer = sub.status === 'REQUER AJUSTES';
                  const badgeClass = isConforme
                    ? 'bg-green-100 text-green-700'
                    : isRequer
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-red-100 text-red-700';

                  return (
                    <div
                      key={sIdx}
                      className={`p-1.5 px-3 flex justify-between items-center gap-2 ${
                        sIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'
                      }`}
                    >
                      <div className="flex-1 min-w-0 pr-1">
                        <p className="font-bold text-slate-900 break-words">{sub.item}</p>
                        <p className="text-slate-600 text-[8px] break-words">{sub.desc}</p>
                      </div>
                      <span className={`font-bold px-2 py-0.5 rounded text-[8px] flex-shrink-0 text-right whitespace-nowrap ${badgeClass}`}>
                        {sub.status}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Diretriz NBR 5410 de DPS */}
            <div className="bg-amber-50 border border-amber-200 rounded p-2 text-justify">
              <p className="text-[8.5px] font-bold text-amber-950 uppercase mb-0.5">
                PROTEÇÃO CONTRA SURTOS EM QUADROS ELÉTRICOS (ABNT NBR 5410 / NBR 5419-4):
              </p>
              <p className="text-[8px] text-amber-900 leading-snug">
                Conforme preconizado nas normas técnicas vigentes, todos os quadros de distribuição de energia (QGBTs, quadros parciais e de comando) devem possuir Dispositivos de Proteção contra Surtos (DPS) coordenados tipo 1 e tipo 2 instalados e em pleno funcionamento. A ausência ou dano do DPS constitui grave não conformidade normativa.
              </p>
            </div>
          </div>

          <ReportFooter company={company} pageNumber={currentPageNum++} totalPages={totalPages} />
        </div>
      </ResponsivePage>

      {/* ========================================================
          VISTORIAS E ENSAIOS TÉCNICOS INDIVIDUALIZADOS POR TORRE
          FORMATO REQUISITADO:
          Torre 1: Pontos de Inspeção (Miliohmímetro) -> SPDA Existente -> Quadros & DPS
          Torre 2: Pontos de Inspeção (Miliohmímetro) -> SPDA Existente -> Quadros & DPS
          ... Cada torre tratada como um laudo completo individualizado!
          ======================================================== */}
      {allTowerPages.map((page, pIdx) => (
        <ResponsivePage key={`tower-page-${page.towerName}-${pIdx}`} scale={scale} dataPage={`tower-${page.towerName}-${pIdx + 1}`}>
          <div className="a4-page shadow-xl border border-gray-200 print:border-none print:shadow-none" data-page={`tower-${page.towerName}-${pIdx + 1}`}>
            <ReportWatermark text={company.watermarkText} enabled={company.showWatermark} />
            <ReportHeader company={company} />

            <div className="relative z-10 text-[9.5px] leading-[1.38] text-slate-800 space-y-2.5 font-sans">
              {/* Banner da Torre */}
              <div className="bg-slate-900 text-white px-3 py-1.5 rounded-sm flex items-center justify-between shadow-xs">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-amber-400" />
                  <h2 className="text-[11px] font-black uppercase tracking-wider">
                    {page.isAreaComum ? 'VISTORIA TÉCNICA: ÁREA COMUM / EXTERNA' : `VISTORIA & ENSAIOS TÉCNICOS: ${page.towerName.toUpperCase()}`}
                  </h2>
                </div>
                <div className="text-[8px] font-semibold text-slate-300">
                  {page.totalTowerPages > 1 ? `Página ${page.pageIndexInTower} de ${page.totalTowerPages}` : 'Relatório por Torre'}
                </div>
              </div>

              {/* Blocos de seções dentro desta página da torre */}
              {page.blocks.map((block, bIdx) => {
                const totalPhotosInBlock = block.photos.length;
                return (
                  <div key={bIdx} className="space-y-1.5 pt-0.5">
                    {/* Se este bloco for o início de uma nova torre no meio da página, desenha o banner da torre */}
                    {block.isNewTower && bIdx > 0 && (
                      <div className="bg-slate-900 text-white px-3 py-1 rounded-sm flex items-center justify-between shadow-xs mt-3 mb-1">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-amber-400" />
                          <h2 className="text-[10px] font-black uppercase tracking-wider">
                            VISTORIA & ENSAIOS TÉCNICOS: {(block.towerName || page.towerName).toUpperCase()}
                          </h2>
                        </div>
                      </div>
                    )}

                    {/* Título da subseção */}
                    <div className="flex items-center justify-between border-b border-slate-300 pb-0.5">
                      <div className="flex items-center gap-1.5">
                        <span className="w-4 h-4 rounded bg-slate-800 text-white text-[8px] font-bold flex items-center justify-center">
                          {block.number}
                        </span>
                        <h3 className="text-[10px] font-bold text-slate-900 uppercase">
                          {block.title}
                        </h3>
                      </div>
                      <span className="text-[8px] text-slate-500 font-medium">
                        {totalPhotosInBlock} {totalPhotosInBlock === 1 ? 'registro' : 'registros'}
                      </span>
                    </div>

                    {/* Grade de fotos (4 colunas) */}
                    {totalPhotosInBlock > 0 ? (
                      <div
                        className="grid grid-cols-4 gap-x-[5.33mm] gap-y-[2mm] w-full"
                        style={{ width: '170mm' }}
                      >
                        {block.photos.map((photo, phIdx) => {
                          const cap = photo.caption?.trim() || '';
                          const isDpsFlag = isDpsMissingCaption(cap);
                          const isEquipFlag = isEquipotentialMissingCaption(cap);
                          const val = photo.measurementValue?.trim();
                          let labelText = cap;
                          if (val) {
                            labelText = labelText ? `${labelText} (${val})` : `(${val})`;
                          }

                          return (
                            <div
                              key={photo.id || phIdx}
                              className="flex flex-col items-center flex-shrink-0"
                            >
                              <div className="w-[38.5mm] h-[34.5mm] bg-slate-100 border border-gray-300 rounded overflow-hidden flex items-center justify-center relative flex-shrink-0 shadow-2xs">
                                <img
                                  src={photo.url}
                                  alt={cap || `Foto ${phIdx + 1}`}
                                  loading="lazy"
                                  decoding="async"
                                  className="w-full h-full object-cover"
                                />

                                {/* Badge de Alerta Não Conformidade quando identificado */}
                                {isDpsFlag && (
                                  <div className="absolute top-1 right-1 bg-red-600 text-white text-[6.5px] font-black px-1 py-0.2 rounded shadow z-10 tracking-wider">
                                    FALTA DPS
                                  </div>
                                )}
                                {isEquipFlag && !isDpsFlag && (
                                  <div className="absolute top-1 right-1 bg-amber-600 text-white text-[6.5px] font-black px-1 py-0.2 rounded shadow z-10 tracking-wider">
                                    EQUIPOTENCIALIZAR
                                  </div>
                                )}

                                {/* Marcador de Foco Circular Vermelho */}
                                {(photo.hasRedCircleMarker ?? true) && (
                                  <div
                                    className="absolute pointer-events-none"
                                    style={{
                                      left: `${photo.circleX ?? 50}%`,
                                      top: `${photo.circleY ?? 50}%`,
                                      width: `${(photo.circleRadius ?? 24) * 2.2}%`,
                                      height: `${(photo.circleRadius ?? 24) * 1.8}%`,
                                      transform: 'translate(-50%, -50%)',
                                    }}
                                    aria-hidden="true"
                                  >
                                    <div className="w-full h-full border-2 border-red-600 rounded-full shadow-[0_0_4px_rgba(239,68,68,0.9)] flex items-center justify-center">
                                      <div className="w-1.5 h-1.5 bg-red-600 rounded-full opacity-80" />
                                    </div>
                                  </div>
                                )}
                              </div>

                              {labelText && (
                                <p
                                  className={`text-[7.5px] font-bold text-center truncate mt-0.5 px-0.5 max-w-[38.5mm] leading-tight ${
                                    isDpsFlag ? 'text-red-700' : isEquipFlag ? 'text-amber-700' : 'text-slate-800'
                                  }`}
                                  title={labelText}
                                >
                                  {labelText}
                                </p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="border border-slate-200 bg-slate-50/70 rounded p-2 text-center text-slate-600 text-[8px] italic">
                        Nenhum registro fotográfico nesta seção para esta torre. Ensaio ou inspeção em conformidade técnica.
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <ReportFooter company={company} pageNumber={currentPageNum++} totalPages={totalPages} />
          </div>
        </ResponsivePage>
      ))}

      {/* ========================================================
          PÁGINA EXECUTIVA: QUADRO RESUMO DE ADEQUAÇÕES POR TORRE
          CONTABILIZAÇÃO AUTOMÁTICA DE NÃO CONFORMIDADES:
          - Pontos a equipotencializar
          - Quadros que precisam de DPS
          - Outras não conformidades
          - Totais gerais do condomínio + exportação para Excel
          ======================================================== */}
      <ResponsivePage scale={scale} dataPage="resumo-nao-conformidades">
        <div className="a4-page shadow-xl border border-gray-200 print:border-none print:shadow-none" data-page="resumo-nao-conformidades">
          <ReportWatermark text={company.watermarkText} enabled={company.showWatermark} />
          <ReportHeader company={company} />

          <div className="relative z-10 text-[9.5px] leading-[1.38] text-slate-800 space-y-2.5 font-sans">
            <div>
              <div className="flex items-center justify-between border-b border-slate-300 pb-1 mb-1">
                <h2 className="text-[11.5px] font-bold text-slate-900 uppercase font-sans">
                  6) QUADRO RESUMO DE ADEQUAÇÕES POR TORRE (NÃO CONFORMIDADES NBR 5419:2026)
                </h2>
                <button
                  type="button"
                  onClick={() => exportNonConformitiesToExcelCsv(consolidated)}
                  className="print:hidden text-[8px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white px-2 py-0.5 rounded shadow flex items-center gap-1 transition-colors cursor-pointer"
                  title="Baixar planilha Excel com o resumo quantitativo"
                >
                  <FileSpreadsheet className="w-3 h-3" />
                  EXPORTAR EXCEL (.CSV)
                </button>
              </div>
              <p className="text-[8.5px] text-slate-600 leading-snug text-justify">
                Quadro quantitativo consolidado das não conformidades identificadas nas vistorias individuais de cada torre e área comum. A leitura analítica dos pontos críticos fundamenta as correções prioritárias obrigatórias perante as normas ABNT NBR 5419:2026 e ABNT NBR 5410.
              </p>
            </div>

            {/* TABELA CONSOLIDADA DE NÃO CONFORMIDADES POR TORRE */}
            <div className="border-2 border-slate-900 rounded overflow-hidden shadow-xs">
              <table className="w-full text-left border-collapse text-[8.5px]">
                <thead>
                  <tr className="bg-slate-900 text-white text-[8.5px] font-bold uppercase tracking-wider">
                    <th className="py-1.5 px-3 border-r border-slate-700">Torre / Bloco</th>
                    <th className="py-1.5 px-2 text-center border-r border-slate-700">
                      Pontos a Equipotencializar
                    </th>
                    <th className="py-1.5 px-2 text-center border-r border-slate-700">
                      Quadros sem DPS (Instalar)
                    </th>
                    <th className="py-1.5 px-2 text-center border-r border-slate-700">
                      Outras Adequações
                    </th>
                    <th className="py-1.5 px-2 text-center bg-slate-950 font-black">
                      Total por Torre
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {nonComplianceSummary.rows.map((row, rIdx) => {
                    const hasIssues = row.total > 0;
                    return (
                      <tr
                        key={rIdx}
                        className={
                          rIdx % 2 === 0
                            ? 'bg-white hover:bg-slate-50'
                            : 'bg-slate-50/70 hover:bg-slate-100'
                        }
                      >
                        <td className="py-1 px-3 font-bold text-slate-900 border-r border-slate-200">
                          {row.towerName}
                        </td>
                        <td
                          className={`py-1 px-2 text-center font-bold border-r border-slate-200 ${
                            row.pointsNeedingEquipotentialization > 0
                              ? 'text-amber-700 bg-amber-50/60 font-black'
                              : 'text-slate-500 font-normal'
                          }`}
                        >
                          {row.pointsNeedingEquipotentialization}
                        </td>
                        <td
                          className={`py-1 px-2 text-center font-bold border-r border-slate-200 ${
                            row.panelsNeedingDps > 0
                              ? 'text-red-700 bg-red-50/60 font-black'
                              : 'text-slate-500 font-normal'
                          }`}
                        >
                          {row.panelsNeedingDps}
                        </td>
                        <td className="py-1 px-2 text-center text-slate-600 border-r border-slate-200">
                          {row.otherNonCompliances}
                        </td>
                        <td
                          className={`py-1 px-2 text-center font-black ${
                            hasIssues ? 'text-red-800 bg-red-100/50' : 'text-emerald-700'
                          }`}
                        >
                          {row.total}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-900 text-white font-black text-[9px] border-t-2 border-slate-950">
                    <td className="py-2 px-3 uppercase tracking-wider">
                      TOTAL GERAL DO CONDOMÍNIO
                    </td>
                    <td className="py-2 px-2 text-center font-black text-amber-300">
                      {nonComplianceSummary.totalEquipotentialization}
                    </td>
                    <td className="py-2 px-2 text-center font-black text-red-300">
                      {nonComplianceSummary.totalDpsMissing}
                    </td>
                    <td className="py-2 px-2 text-center font-bold text-slate-200">
                      {nonComplianceSummary.totalOther}
                    </td>
                    <td className="py-2 px-2 text-center font-black text-amber-400 bg-black text-[9.5px]">
                      {nonComplianceSummary.grandTotal}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* LISTA DETALHADA DE ITENS A CORRIGIR POR TORRE */}
            <div className="space-y-1.5 pt-1">
              <p className="text-[9.5px] font-bold text-slate-900 uppercase">
                DETALHAMENTO DAS NÃO CONFORMIDADES IDENTIFICADAS POR TORRE:
              </p>
              {nonComplianceSummary.rows.some((r) => r.items.length > 0) ? (
                <div className="grid grid-cols-2 gap-2 text-[8px]">
                  {nonComplianceSummary.rows
                    .filter((r) => r.items.length > 0)
                    .map((r, idx) => (
                      <div
                        key={idx}
                        className="border border-slate-200 bg-slate-50/80 rounded p-2 space-y-1"
                      >
                        <div className="flex items-center justify-between border-b border-slate-200 pb-0.5">
                          <span className="font-bold text-slate-900 uppercase">{r.towerName}</span>
                          <span className="text-[7px] font-black px-1.5 py-0.2 rounded bg-red-100 text-red-700">
                            {r.total} {r.total === 1 ? 'item' : 'itens'}
                          </span>
                        </div>
                        <ul className="space-y-0.8 text-slate-700 leading-snug">
                          {r.items.map((item, iIdx) => (
                            <li key={iIdx} className="flex items-start gap-1">
                              <span
                                className={`text-[7px] font-bold px-1 rounded flex-shrink-0 ${
                                  item.type === 'dps'
                                    ? 'bg-red-200 text-red-900'
                                    : item.type === 'equipotential'
                                    ? 'bg-amber-200 text-amber-900'
                                    : 'bg-slate-200 text-slate-800'
                                }`}
                              >
                                {item.type === 'dps'
                                  ? 'DPS'
                                  : item.type === 'equipotential'
                                  ? 'EQUIPOTENCIAL'
                                  : 'OUTRO'}
                              </span>
                              <span className="break-words font-medium">{item.caption}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                </div>
              ) : (
                <div className="border border-emerald-200 bg-emerald-50 rounded p-3 text-center text-emerald-800 text-[9px] font-bold">
                  ✓ Nenhuma não conformidade crítica com falta de DPS ou equipotencialização foi apontada nas legendas das fotos desta vistoria.
                </div>
              )}
            </div>

            {/* Parecer de Ação Corretiva Imediata */}
            <div className="bg-red-50 border border-red-200 rounded p-2 text-justify">
              <p className="text-[8.5px] font-bold text-red-950 uppercase mb-0.5">
                PARECER TÉCNICO SOBRE AS ADEQUAÇÕES APONTADAS:
              </p>
              <p className="text-[8px] text-red-900 leading-relaxed">
                Todas as irregularidades listadas acima devem ser sanadas prioritariamente por equipe de engenharia e eletricistas qualificados. A falta de equipotencialização compromete o escoamento seguro de descargas elétricas e eleva riscos de centelhamentos perigosos (NBR 5419-3:2026), enquanto a ausência de DPS deixa os circuitos de baixa tensão e as edificações expostos a queimas catastróficas por sobretensões transitórias (NBR 5410).
              </p>
            </div>
          </div>

          <ReportFooter company={company} pageNumber={currentPageNum++} totalPages={totalPages} />
        </div>
      </ResponsivePage>


      {/* ========================================================
          PÁGINA FINAL UNIFICADA: 8) RECOMENDAÇÕES PRIORITÁRIAS,
          9) CONCLUSÃO TÉCNICA FINAL, FECHAMENTO & ASSINATURA DO CREA
          100% DENSO, COESO E COMPLETO! ZERO ESPAÇO VAZIO!
          ======================================================== */}
      <ResponsivePage scale={scale} dataPage="final">
        <div className="a4-page shadow-xl border border-gray-200 print:border-none print:shadow-none" data-page="final">
          <ReportWatermark text={company.watermarkText} enabled={company.showWatermark} />
          <ReportHeader company={company} />

          <div className="relative z-10 text-[9.5px] leading-[1.38] text-slate-800 space-y-2.5 font-sans">
            {/* 8) Recomendações Prioritárias */}
            <div>
              <h2 className="text-[11.5px] font-bold text-slate-900 uppercase mb-1 font-sans">
                8) CORREÇÕES NECESSÁRIAS PARA PROTEÇÃO DAS EDIFICAÇÕES
              </h2>
              <div className="bg-gray-200 py-0.8 px-3 text-center rounded-xs mb-1.5">
                <span className="text-[9.5px] font-bold text-slate-900 font-sans">Recomendações Técnicas Prioritárias</span>
              </div>

              <div className="space-y-1 text-[9px] text-[#dc2626] font-medium text-justify font-sans">
                {texts.recomendacoes.map((rec, idx) => (
                  <p key={idx} className="leading-snug break-words">
                    <span className="font-bold">8.{idx + 1}- </span>
                    {rec}
                  </p>
                ))}
              </div>

              <p className="font-bold text-[#dc2626] leading-snug text-[9px] mt-1.5 break-words">
                {texts.recomendacoesTextoFinal}
              </p>
            </div>

            {/* 9) Conclusão Técnica Final */}
            <div className="border-t border-slate-200 pt-2">
              <h2 className="text-[11.5px] font-bold text-slate-900 uppercase mb-1 font-sans">
                9) CONCLUSÃO FINAL DESTE RELATÓRIO TÉCNICO
              </h2>
              <p className="text-[9px] text-justify leading-relaxed break-words">
                {texts.conclusaoFinal}
              </p>
            </div>

            {/* Termo de Encerramento e ART */}
            <div className="bg-slate-50 border border-slate-200 rounded p-2 text-justify">
              <p className="text-[9px] font-bold text-slate-900 uppercase mb-0.5">
                DISPOSIÇÕES FINAIS & VALIDADE DA INSPEÇÃO:
              </p>
              <p className="text-[8.5px] text-slate-600 leading-snug break-words">
                Este laudo possui validade técnica de 1 (um) ano a partir da data de emissão, ou conforme periodicidade de inspeção estipulada pela NBR 5419-3:2026 (Tabela 6). O responsável técnico declara que todas as medições foram efetuadas conforme os preceitos éticos e regulamentares do CREA.
              </p>
            </div>

            {/* Cidade e Data */}
            <div className="pt-0.5 flex justify-between items-center gap-2 text-[9px] font-bold text-slate-800 border-b border-slate-100 pb-1">
              <span className="flex-1 min-w-0 break-words">{client.cidadeEmissao}, {client.dataEmissaoExtenso}.</span>
              <span className="text-[8px] font-normal text-slate-500 flex-shrink-0 text-right">Documento técnico pericial registrado com ART</span>
            </div>

            {/* Assinatura Centralizada do Responsável Técnico com Carimbo */}
            {report.digitalSignature?.enabled ? (
              <div className="pt-2 flex flex-col items-center justify-center text-center">
                {/* Imagem Proeminente da Assinatura Digital (se desenhada ou carregada) */}
                {report.digitalSignature.imageUrl ? (
                  <div className="h-16 flex items-end justify-center mb-1 max-w-[260px]">
                    <img
                      src={report.digitalSignature.imageUrl}
                      alt="Assinatura Digital"
                      loading="lazy"
                      decoding="async"
                      className="max-h-16 max-w-full object-contain filter drop-shadow-2xs"
                    />
                  </div>
                ) : (
                  <div className="h-12 flex items-center justify-center text-blue-900 font-serif italic text-xl font-bold tracking-wider select-none">
                    {report.digitalSignature.signerName || client.tecnico}
                  </div>
                )}

                {/* Linha de Assinatura */}
                <div className="w-80 border-t-2 border-slate-900 mb-1" />
                <p className="text-[10.5px] font-bold text-slate-900">
                  {report.digitalSignature.signerName || client.tecnico}
                </p>
                <p className="text-[9px] text-slate-700">
                  {report.digitalSignature.signerRole || client.cargo}
                </p>
                <p className="text-[9px] font-bold text-slate-900">
                  {report.digitalSignature.signerCrea || client.crea}
                  {(report.digitalSignature.signerArt || client.art) && ` | ART: ${report.digitalSignature.signerArt || client.art}`}
                </p>

                {/* Selo Proeminente de Autenticação Digital e Validação ICP / CREA */}
                {report.digitalSignature.showValidationStamp && (
                  <div className="mt-2.5 w-full max-w-[420px] bg-gradient-to-r from-blue-50/90 via-slate-50 to-indigo-50/90 border-2 border-blue-600/70 rounded-md p-2 text-left shadow-2xs">
                    <div className="flex items-center justify-between border-b border-blue-200 pb-1 mb-1">
                      <span className="font-black text-blue-950 uppercase tracking-wider text-[8px] flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                        CERTIFICAÇÃO DIGITAL - PADRÃO CREA / NBR 5419:2026
                      </span>
                      <span className="text-emerald-800 font-extrabold bg-emerald-100 border border-emerald-300 px-1.5 py-0.2 rounded text-[7px] uppercase">
                        ✓ Autenticado
                      </span>
                    </div>
                    <div className="text-[7.5px] leading-tight space-y-0.5 text-slate-700">
                      <p>
                        <span className="font-semibold text-slate-500">Signatário: </span>
                        <strong className="text-slate-900">{report.digitalSignature.signerName || client.tecnico}</strong> ({report.digitalSignature.signerCrea || client.crea})
                      </p>
                      <p>
                        <span className="font-semibold text-slate-500">Data e Hora: </span>
                        <span>{report.digitalSignature.signedAt || client.dataEmissaoExtenso}</span>
                        {(report.digitalSignature.signerArt || client.art) && <span> • ART: {report.digitalSignature.signerArt || client.art}</span>}
                      </p>
                      <p className="font-mono text-slate-500 text-[6.5px] truncate pt-0.5">
                        Hash SHA-256: {report.digitalSignature.hashSha256}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="pt-3 flex flex-col items-center justify-center text-center">
                <div className="w-72 border-t border-slate-900 mb-1" />
                <p className="text-[10.5px] font-bold text-slate-900">{client.tecnico}</p>
                <p className="text-[9px] text-slate-700">{client.cargo}</p>
                <p className="text-[9px] font-bold text-slate-900">{client.crea}</p>
              </div>
            )}
          </div>

          <ReportFooter company={company} pageNumber={currentPageNum++} totalPages={totalPages} />
        </div>
      </ResponsivePage>
    </div>
  );
};
