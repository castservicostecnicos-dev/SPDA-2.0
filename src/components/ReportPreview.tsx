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
  rowsInPage: number;
}

function paginateTowerGroups(groups: TowerInspectionGroup[], hasSection5AtTop = true): TowerInspectionPage[] {
  const allPages: TowerInspectionPage[] = [];
  const MAX_ROWS_PER_PAGE = 5; // Limite de 5 linhas por página
  const MAX_PAGE_CONTENT_MM = 248; // Limite vertical seguro preenchendo a página ao máximo sem sobrepor o rodapé
  const ROW_HEIGHT_MM = 54.0;     // Altura de 1 linha de 4 fotos 3:4 vertical (48mm foto + legenda e espaçamento vertical)
  const TOWER_HEADER_MM = 8.0;
  const SUBSECTION_HEADER_MM = 6.0;
  const SECTION5_HEIGHT_MM = 120.0;

  let currentBlocks: TowerSectionBlock[] = [];
  let rowsInPage = 0;
  let currentHeightMm = TOWER_HEADER_MM + (hasSection5AtTop ? SECTION5_HEIGHT_MM : 0);
  let currentPageTowerName = groups[0]?.towerName || 'Torre 1';
  let currentPageIsAreaComum = groups[0]?.isAreaComum || false;

  const closeCurrentPage = () => {
    if (currentBlocks.length > 0) {
      allPages.push({
        towerName: currentPageTowerName,
        isAreaComum: currentPageIsAreaComum,
        pageIndexInTower: allPages.length + 1,
        totalTowerPages: 0,
        blocks: currentBlocks,
        rowsInPage,
      });
      currentBlocks = [];
      rowsInPage = 0;
      currentHeightMm = TOWER_HEADER_MM;
    }
  };

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

      // Divide as fotos da subseção em linhas de até 4 fotos
      const rows: PhotoSlot[][] = [];
      for (let i = 0; i < sec.photos.length; i += 4) {
        rows.push(sec.photos.slice(i, i + 4));
      }

      rows.forEach((rowPhotos) => {
        const isNewTowerOnCurrentPage = isFirstBlockOfThisTower && currentBlocks.length > 0;
        const isNewSubOnCurrentPage = currentBlocks.length === 0 || currentBlocks[currentBlocks.length - 1].title !== sec.title;

        let neededHeight = ROW_HEIGHT_MM;
        if (isNewTowerOnCurrentPage) {
          neededHeight += TOWER_HEADER_MM + SUBSECTION_HEADER_MM;
        } else if (isNewSubOnCurrentPage) {
          neededHeight += SUBSECTION_HEADER_MM;
        }

        const maxRowsAllowed = allPages.length === 0 && hasSection5AtTop ? 2 : MAX_ROWS_PER_PAGE;
        if (rowsInPage >= maxRowsAllowed || (rowsInPage > 0 && currentHeightMm + neededHeight > MAX_PAGE_CONTENT_MM)) {
          closeCurrentPage();
          currentPageTowerName = group.towerName;
          currentPageIsAreaComum = group.isAreaComum;
        }

        // Adiciona ao bloco existente da mesma subseção ou cria novo bloco
        const lastBlock = currentBlocks[currentBlocks.length - 1];
        if (lastBlock && lastBlock.title === sec.title && lastBlock.towerName === group.towerName) {
          lastBlock.photos.push(...rowPhotos);
        } else {
          currentBlocks.push({
            type: sec.type,
            number: sec.number,
            title: sec.title,
            photos: [...rowPhotos],
            towerName: group.towerName,
            isNewTower: isFirstBlockOfThisTower && currentBlocks.length > 0,
          });
        }

        isFirstBlockOfThisTower = false;
        rowsInPage++;
        currentHeightMm += neededHeight;
      });
    });
  });

  closeCurrentPage();

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

  const aerialPhoto = localPhotos[0]?.url ? localPhotos[0] : null;
  const facadePhoto = localPhotos[1]?.url ? localPhotos[1] : null;
  const hasTwoLocalPhotos = Boolean(aerialPhoto && facadePhoto);

  const towerGroups = React.useMemo(() => getTowerInspectionGroups(consolidated), [consolidated]);
  const nonComplianceSummary = React.useMemo(() => analyzeTowerNonConformities(consolidated), [consolidated]);
  const allTowerPages = React.useMemo(() => paginateTowerGroups(towerGroups, true), [towerGroups]);

  // Seção 7 (Recomendações) e 8 (Conclusão & Assinatura) continuam na última página de fotos se houver espaço (≤ 2 linhas de fotos em página dedicada)
  const canFitFinalOnLastPage =
    allTowerPages.length > 1 &&
    allTowerPages[allTowerPages.length - 1].rowsInPage <= 2;

  // Total de Páginas: Capa (1), Seções 1-2 (2), Seções 3-4 (3), Seção 5 + Torre Page 0 (4), Torre Pages 1..N, Final se não couber
  const totalPages =
    allTowerPages.length === 0
      ? 4 // Capa, Seções 1-2, Seções 3-4, Seção 5 + Seções 7-8
      : 3 + allTowerPages.length + (canFitFinalOnLastPage ? 0 : 1);

  let currentPageNum = 1;

  const renderFinalSections = () => (
    <div className="relative z-10 text-[9px] leading-[1.35] text-slate-800 space-y-1.5 font-sans pt-0.5">
      {/* 7) Recomendações Prioritárias */}
      <div>
        <h2 className="text-[11px] font-bold text-slate-900 uppercase mb-0.5 font-sans">
          7) CORREÇÕES NECESSÁRIAS PARA PROTEÇÃO DAS EDIFICAÇÕES
        </h2>
        <div className="bg-gray-200 py-0.5 px-3 text-center rounded-xs mb-1">
          <span className="text-[8.5px] font-bold text-slate-900 font-sans">Recomendações Técnicas Prioritárias</span>
        </div>

        <div className="space-y-0.5 text-[8.5px] text-[#dc2626] font-medium text-justify font-sans">
          {texts.recomendacoes.map((rec, idx) => (
            <p key={idx} className="leading-tight break-words">
              <span className="font-bold">7.{idx + 1}- </span>
              {rec}
            </p>
          ))}
        </div>

        <p className="font-bold text-[#dc2626] leading-tight text-[8.5px] mt-1 break-words">
          {texts.recomendacoesTextoFinal}
        </p>
      </div>

      {/* 8) Conclusão Técnica Final */}
      <div className="border-t border-slate-200 pt-1">
        <h2 className="text-[11px] font-bold text-slate-900 uppercase mb-0.5 font-sans">
          8) CONCLUSÃO FINAL DESTE RELATÓRIO TÉCNICO
        </h2>
        <p className="text-[8.5px] text-justify leading-relaxed break-words">
          {texts.conclusaoFinal}
        </p>
      </div>

      {/* Termo de Encerramento e ART */}
      <div className="bg-slate-50 border border-slate-200 rounded p-1.5 text-justify">
        <p className="text-[8.5px] font-bold text-slate-900 uppercase mb-0.5">
          DISPOSIÇÕES FINAIS & VALIDADE DA INSPEÇÃO:
        </p>
        <p className="text-[8px] text-slate-600 leading-tight break-words">
          Este laudo possui validade técnica de 1 (um) ano a partir da data de emissão, ou conforme periodicidade de inspeção estipulada pela NBR 5419-3:2026 (Tabela 6). O responsável técnico declara que todas as medições foram efetuadas conforme os preceitos éticos e regulamentares do CREA.
        </p>
      </div>

      {/* Cidade e Data */}
      <div className="pt-0.5 flex justify-between items-center gap-2 text-[8.5px] font-bold text-slate-800 border-b border-slate-100 pb-0.5">
        <span className="flex-1 min-w-0 break-words">{client.cidadeEmissao}, {client.dataEmissaoExtenso}.</span>
        <span className="text-[7.5px] font-normal text-slate-500 flex-shrink-0 text-right">Documento técnico pericial registrado com ART</span>
      </div>

      {/* Assinatura Centralizada do Responsável Técnico com Carimbo */}
      {report.digitalSignature?.enabled ? (
        <div className="pt-1.5 flex flex-col items-center justify-center text-center">
          {/* Imagem Proeminente da Assinatura Digital (se desenhada ou carregada) */}
          {report.digitalSignature.imageUrl ? (
            <div className="h-14 flex items-end justify-center mb-1 max-w-[240px]">
              <img
                src={report.digitalSignature.imageUrl}
                alt="Assinatura Digital"
                loading="lazy"
                decoding="async"
                className="max-h-14 max-w-full object-contain filter drop-shadow-2xs"
              />
            </div>
          ) : (
            <div className="h-10 flex items-center justify-center text-blue-900 font-serif italic text-lg font-bold tracking-wider select-none">
              {report.digitalSignature.signerName || client.tecnico}
            </div>
          )}

          {/* Linha de Assinatura */}
          <div className="w-80 border-t-2 border-slate-900 mb-1" />
          <p className="text-[10px] font-bold text-slate-900">
            {report.digitalSignature.signerName || client.tecnico}
          </p>
          <p className="text-[8.5px] text-slate-700">
            {report.digitalSignature.signerRole || client.cargo}
          </p>
          <p className="text-[8.5px] font-bold text-slate-900">
            {report.digitalSignature.signerCrea || client.crea}
            {(report.digitalSignature.signerArt || client.art) && ` | ART: ${report.digitalSignature.signerArt || client.art}`}
          </p>

          {/* Selo Proeminente de Autenticação Digital e Validação ICP / CREA */}
          {report.digitalSignature.showValidationStamp && (
            <div className="mt-1.5 w-full max-w-[420px] bg-gradient-to-r from-blue-50/90 via-slate-50 to-indigo-50/90 border-2 border-blue-600/70 rounded-md p-1.5 text-left shadow-2xs">
              <div className="flex items-center justify-between border-b border-blue-200 pb-0.5 mb-0.5">
                <span className="font-black text-blue-950 uppercase tracking-wider text-[7.5px] flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                  CERTIFICAÇÃO DIGITAL - PADRÃO CREA / NBR 5419:2026
                </span>
                <span className="text-emerald-800 font-extrabold bg-emerald-100 border border-emerald-300 px-1 py-0.2 rounded text-[6.5px] uppercase">
                  ✓ Autenticado
                </span>
              </div>
              <div className="text-[7px] leading-tight space-y-0.5 text-slate-700">
                <p>
                  <span className="font-semibold text-slate-500">Signatário: </span>
                  <strong className="text-slate-900">{report.digitalSignature.signerName || client.tecnico}</strong> ({report.digitalSignature.signerCrea || client.crea})
                </p>
                <p>
                  <span className="font-semibold text-slate-500">Data e Hora: </span>
                  <span>{report.digitalSignature.signedAt || client.dataEmissaoExtenso}</span>
                  {(report.digitalSignature.signerArt || client.art) && <span> • ART: {report.digitalSignature.signerArt || client.art}</span>}
                </p>
                <p className="font-mono text-slate-500 text-[6px] truncate pt-0.5">
                  Hash SHA-256: {report.digitalSignature.hashSha256}
                </p>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="pt-2 flex flex-col items-center justify-center text-center">
          <div className="w-64 border-t border-slate-900 mb-1" />
          <p className="text-[10px] font-bold text-slate-900">{client.tecnico}</p>
          <p className="text-[8.5px] text-slate-700">{client.cargo}</p>
          <p className="text-[8.5px] font-bold text-slate-900">{client.crea}</p>
        </div>
      )}
    </div>
  );

  const renderSection5 = () => (
    <div className="space-y-1.5 text-justify">
      <h2 className="text-[11px] font-bold text-slate-900 uppercase mb-0.5 font-sans">
        5) INSTRUMENTAÇÃO TÉCNICA E CRITÉRIOS DE INSPEÇÃO
      </h2>

      <p className="text-[8.5px] leading-relaxed mb-1">
        {texts.medicoesContinuidadeTexto}
      </p>

      {/* Instrumento Miliohmímetro */}
      <div className="bg-slate-50 border border-slate-200 rounded p-2 flex gap-3 items-center mb-1">
        {equipmentPhotoUrl ? (
          <div className="w-[125px] h-[75px] bg-white border border-gray-300 rounded overflow-hidden flex items-center justify-center p-1 flex-shrink-0">
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
          <p className="text-[9px] font-bold text-slate-900">
            Miliohmímetro {texts.equipamentoModelo} - Marca: {texts.equipamentoMarca}
          </p>
          <p className="text-[8px] text-slate-600 leading-snug">
            {texts.equipamentoDescricao}
          </p>
          <div className="pt-0.5 text-[8px] font-semibold text-slate-800 space-y-0.2">
            <p><span className="text-slate-500 font-normal">Local de Aplicação:</span> {texts.medicoesLocal}</p>
            <p><span className="text-slate-500 font-normal">Corrente Injetada de Ensaio:</span> {texts.medicoesCorrenteAplicada}</p>
            <p><span className="text-slate-500 font-normal">Tipo de Corrente:</span> {texts.medicoesTipoCorrente}</p>
          </div>
        </div>
      </div>

      {/* Parâmetros Normativos NBR 5419 */}
      <div className="border border-slate-200 rounded overflow-hidden mb-1">
        <div className="bg-slate-100 px-3 py-0.8 font-bold text-[8.5px] text-slate-900 border-b border-slate-200">
          PARÂMETROS NORMATIVOS DE CONTINUIDADE (ABNT NBR 5419:2026)
        </div>
        <div className="divide-y divide-slate-100 text-[8px]">
          <div className="px-3 py-0.8 flex justify-between items-center gap-2 bg-white">
            <div className="flex-1 min-w-0 pr-1">
              <span className="font-bold text-slate-900 break-words">Continuidade de Armaduras e Malhas: </span>
              <span className="text-slate-600 break-words">NBR 5419-3:2026 (Item 5.3.5)</span>
            </div>
            <span className="font-bold text-emerald-700 flex-shrink-0 text-right whitespace-nowrap">≤ 0,200 Ω (200 mΩ) [CONFORME]</span>
          </div>
          <div className="px-3 py-0.8 flex justify-between items-center gap-2 bg-slate-50/50">
            <div className="flex-1 min-w-0 pr-1">
              <span className="font-bold text-slate-900 break-words">Resistência de Equipotencialização: </span>
              <span className="text-slate-600 break-words">NBR 5419-3:2026 (Item 6.2)</span>
            </div>
            <span className="font-bold text-emerald-700 flex-shrink-0 text-right whitespace-nowrap">≤ 0,200 Ω (200 mΩ) [CONFORME]</span>
          </div>
          <div className="px-3 py-0.8 flex justify-between items-center gap-2 bg-white">
            <div className="flex-1 min-w-0 pr-1">
              <span className="font-bold text-slate-900 break-words">Método de 4 Terminais (Kelvin): </span>
              <span className="text-slate-600 break-words">Injeção de corrente DC contínua eliminando resistência das pontas</span>
            </div>
            <span className="font-bold text-emerald-700 flex-shrink-0 text-right whitespace-nowrap">APLICADO</span>
          </div>
          <div className="px-3 py-0.8 flex justify-between items-center gap-2 bg-slate-50/50">
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

      {/* Tabela dos 4 Subsistemas Vistoriados */}
      <div className="border border-slate-200 rounded overflow-hidden mb-1">
        <div className="bg-slate-100 px-3 py-0.8 font-bold text-[8.5px] text-slate-900 border-b border-slate-200">
          AVALIAÇÃO ESTRUTURAL DOS SUBSISTEMAS DO SPDA (NBR 5419:2026)
        </div>
        <div className="divide-y divide-slate-100 text-[8px]">
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
                className={`p-0.8 px-3 flex justify-between items-center gap-2 ${
                  sIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'
                }`}
              >
                <div className="flex-1 min-w-0 pr-1">
                  <p className="font-bold text-slate-900 break-words">{sub.item}</p>
                  <p className="text-slate-600 text-[7.5px] break-words">{sub.desc}</p>
                </div>
                <span className={`font-bold px-2 py-0.5 rounded text-[7.5px] flex-shrink-0 text-right whitespace-nowrap ${badgeClass}`}>
                  {sub.status}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Diretriz NBR 5410 de DPS */}
      <div className="bg-amber-50 border border-amber-200 rounded p-1.5 text-justify">
        <p className="text-[8px] font-bold text-amber-950 uppercase mb-0.5">
          PROTEÇÃO CONTRA SURTOS EM QUADROS ELÉTRICOS (ABNT NBR 5410 / NBR 5419-4):
        </p>
        <p className="text-[7.5px] text-amber-900 leading-snug">
          Conforme preconizado nas normas técnicas vigentes, todos os quadros de distribuição de energia (QGBTs, quadros parciais e de comando) devem possuir Dispositivos de Proteção contra Surtos (DPS) coordenados tipo 1 e tipo 2 instalados e em pleno funcionamento. A ausência ou dano do DPS constitui grave não conformidade normativa.
        </p>
      </div>
    </div>
  );

  const renderTowerPageBlocks = (page: TowerInspectionPage) => (
    <div className="space-y-1.5 font-sans">
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

      {/* Blocos de seções */}
      {page.blocks.map((block, bIdx) => {
        const totalPhotosInBlock = block.photos.length;
        return (
          <div key={bIdx} className="space-y-1 pt-0.5">
            {block.isNewTower && bIdx > 0 && (
              <div className="bg-slate-900 text-white px-3 py-1 rounded-sm flex items-center justify-between shadow-xs mt-2 mb-1">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-amber-400" />
                  <h2 className="text-[10px] font-black uppercase tracking-wider">
                    VISTORIA & ENSAIOS TÉCNICOS: {(block.towerName || page.towerName).toUpperCase()}
                  </h2>
                </div>
              </div>
            )}

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

            {totalPhotosInBlock > 0 ? (
              <div
                className="grid grid-cols-4 gap-x-[2.0mm] gap-y-[4.0mm] w-full"
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
                      style={{ width: '42.5mm' }}
                    >
                      <div className="w-[36mm] h-[48mm] bg-slate-100 border border-gray-300 rounded overflow-hidden flex items-center justify-center relative flex-shrink-0 shadow-2xs">
                        <img
                          src={photo.url}
                          alt={cap || `Foto ${phIdx + 1}`}
                          loading="lazy"
                          decoding="async"
                          className="w-full h-full object-cover"
                        />

                        {isDpsFlag && (
                          <div className="absolute top-1 right-1 bg-red-600 text-white text-[5.5px] font-black px-1 py-0.2 rounded shadow z-10 tracking-wider">
                            FALTA DPS
                          </div>
                        )}
                        {isEquipFlag && !isDpsFlag && (
                          <div className="absolute top-1 right-1 bg-amber-600 text-white text-[5.5px] font-black px-1 py-0.2 rounded shadow z-10 tracking-wider">
                            EQUIPOT.
                          </div>
                        )}

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
                          className={`text-[7.5px] font-bold text-center truncate mt-0.5 px-0.5 max-w-[41mm] leading-tight ${
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
  );

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
          PÁGINA 3: 3) CARACTERÍSTICAS DA EDIFICAÇÃO & LOCAL,
          VISTA AÉREA, FACHADA PRINCIPAL, PARÂMETROS CONSTRUTIVOS
          & 4) HISTÓRICO DE PROBLEMAS & OCORRÊNCIAS
          INÍCIO EM NOVA PÁGINA CONFORME SOLICITADO
          ======================================================== */}
      <ResponsivePage scale={scale} dataPage="3">
        <div className="a4-page shadow-xl border border-gray-200 print:border-none print:shadow-none" data-page="3">
          <ReportWatermark text={company.watermarkText} enabled={company.showWatermark} />
          <ReportHeader company={company} />

          <div className="relative z-10 text-[9px] leading-[1.35] text-slate-800 space-y-1.5 text-justify font-sans">
            <h2 className="text-[11px] font-bold text-slate-900 uppercase mb-0.5 font-sans">
              3) CARACTERÍSTICAS DA EDIFICAÇÃO & LOCAL
            </h2>
            {(() => {
              const desc = (client.descricaoBloco || texts.caracteristicasLocal || '').trim();
              if (!desc || /^(?:torre\s*\d+|torre\s*\/\s*estrutura|estrutura\s*\/\s*torre)$/i.test(desc)) return null;
              return (
                <p className="text-[8.5px] leading-relaxed mb-1 break-words">
                  {desc}
                </p>
              );
            })()}

            {/* 3.1) VISTA AÉREA DA EDIFICAÇÃO / SATÉLITE - OCUPANDO A LARGURA TOTAL DA PÁGINA */}
            {aerialPhoto ? (
              <div className="border border-slate-200 rounded-lg overflow-hidden bg-slate-50 p-2">
                <div className="flex items-center justify-between pb-1 mb-1 border-b border-slate-200">
                  <h3 className="text-[9.5px] font-bold text-slate-900 uppercase flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-blue-600 inline-block" />
                    3.1) VISTA AÉREA DA EDIFICAÇÃO / SATÉLITE
                  </h3>
                  <span className="text-[7.5px] font-semibold text-slate-500 uppercase">
                    Posicionamento & Circunvizinhança
                  </span>
                </div>
                <div className="w-full flex items-center justify-center py-0.5">
                  <img
                    src={aerialPhoto.url}
                    alt={aerialPhoto.caption || 'Vista Aérea da Edificação'}
                    loading="lazy"
                    decoding="async"
                    className="w-full max-h-[64mm] h-auto object-contain rounded border border-slate-300 shadow-xs"
                  />
                </div>
                <p className="text-[8px] font-bold text-slate-700 mt-1 text-center">
                  {aerialPhoto.caption?.trim() || 'Vista aérea da circunvizinhança e posicionamento geográfico da edificação.'}
                </p>
              </div>
            ) : null}

            {/* 3.2) FACHADA PRINCIPAL DA EDIFICAÇÃO - OCUPANDO A LARGURA TOTAL DA PÁGINA */}
            {facadePhoto ? (
              <div className="border border-slate-200 rounded-lg overflow-hidden bg-slate-50 p-2">
                <div className="flex items-center justify-between pb-1 mb-1 border-b border-slate-200">
                  <h3 className="text-[9.5px] font-bold text-slate-900 uppercase flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-600 inline-block" />
                    {aerialPhoto ? '3.2) FACHADA PRINCIPAL DA EDIFICAÇÃO' : '3.1) FACHADA PRINCIPAL DA EDIFICAÇÃO'}
                  </h3>
                  <span className="text-[7.5px] font-semibold text-slate-500 uppercase">
                    Acessos & Estrutura Predial
                  </span>
                </div>
                <div className="w-full flex items-center justify-center py-0.5">
                  <img
                    src={facadePhoto.url}
                    alt={facadePhoto.caption || 'Fachada Principal'}
                    loading="lazy"
                    decoding="async"
                    className="w-full max-h-[64mm] h-auto object-contain rounded border border-slate-300 shadow-xs"
                  />
                </div>
                <p className="text-[8px] font-bold text-slate-700 mt-1 text-center">
                  {facadePhoto.caption?.trim() || 'Fachada principal da edificação e acessos vistoriados.'}
                </p>
              </div>
            ) : null}

            {/* Quadro Técnico de Infraestrutura */}
            <div className="border border-slate-200 rounded overflow-hidden">
              <div className="bg-slate-100 px-3 py-1 font-bold text-[8.5px] text-slate-900 border-b border-slate-200">
                PARÂMETROS CONSTRUTIVOS & INFRAESTRUTURA DA EDIFICAÇÃO (NBR 5419:2026)
              </div>
              <div className="divide-y divide-slate-100 text-[8px]">
                <div className="px-3 py-0.8 flex justify-between items-center gap-2 bg-white">
                  <span className="font-semibold text-slate-800 flex-1 min-w-0 break-words">Tipologia Construtiva:</span>
                  <span className="text-slate-600 text-right flex-shrink-0 max-w-[55%] break-words">Alvenaria Convencional / Estrutura em Concreto Armado</span>
                </div>
                <div className="px-3 py-0.8 flex justify-between items-center gap-2 bg-slate-50/50">
                  <span className="font-semibold text-slate-800 flex-1 min-w-0 break-words">Topografia & Entorno:</span>
                  <span className="text-slate-600 text-right flex-shrink-0 max-w-[55%] break-words">Terreno Urbano Plano com Edificações Vizinhas</span>
                </div>
                <div className="px-3 py-0.8 flex justify-between items-center gap-2 bg-white">
                  <span className="font-semibold text-slate-800 flex-1 min-w-0 break-words">Nível de Proteção Dimensionado:</span>
                  <span className="font-bold text-blue-700 text-right flex-shrink-0 max-w-[55%] break-words">Nível III / IV (NBR 5419-2:2026 - Gerenciamento de Risco)</span>
                </div>
                <div className="px-3 py-0.8 flex justify-between items-center gap-2 bg-slate-50/50">
                  <span className="font-semibold text-slate-800 flex-1 min-w-0 break-words">Métodos de Proteção Aplicáveis:</span>
                  <span className="text-slate-600 text-right flex-shrink-0 max-w-[55%] break-words">Ângulo de Proteção (Franklin) e Condutores em Malha (Faraday)</span>
                </div>
              </div>
            </div>

            <p className="text-[8.5px] leading-relaxed break-words">
              A edificação é de uso <span className="font-bold">{client.ramoAtividade}</span> com presença de ocupantes e equipamentos eletroeletrônicos e está localizada numa área de <span className="font-bold">{client.exposicaoNivel || 'baixa EXPOSIÇÃO'}</span> a descargas atmosféricas e seus efeitos indiretos.
            </p>

            {/* 4) Histórico de Problemas */}
            <div className="border-t border-slate-200 pt-1">
              <h2 className="text-[11px] font-bold text-slate-900 uppercase mb-0.5 font-sans">
                4) HISTÓRICO DE PROBLEMAS & OCORRÊNCIAS
              </h2>
              <div className="space-y-1 text-[8.5px] leading-relaxed">
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

      {/* ========================================================
          PÁGINA 4: 5) INSTRUMENTAÇÃO TÉCNICA E CRITÉRIOS DE INSPEÇÃO
          SEGUIDA DIRETAMENTE DE 6) VISTORIAS E ENSAIOS TÉCNICOS (TORRE 1)
          FLUXO CONTÍNUO: ZERO ESPAÇO VAZIO
          ======================================================== */}
      <ResponsivePage scale={scale} dataPage="4">
        <div className="a4-page shadow-xl border border-gray-200 print:border-none print:shadow-none" data-page="4">
          <ReportWatermark text={company.watermarkText} enabled={company.showWatermark} />
          <ReportHeader company={company} />

          <div className="relative z-10 text-[9px] leading-[1.35] text-slate-800 space-y-2 font-sans">
            {/* Seção 5 */}
            {renderSection5()}

            {/* Continuação direta da Seção 6 logo abaixo de Seção 5 */}
            {allTowerPages.length > 0 ? (
              <div className="mt-2 border-t-2 border-slate-300 pt-2">
                {renderTowerPageBlocks(allTowerPages[0])}
              </div>
            ) : (
              <div className="mt-2 border-t-2 border-slate-300 pt-2">
                {renderFinalSections()}
              </div>
            )}
          </div>

          <ReportFooter company={company} pageNumber={currentPageNum++} totalPages={totalPages} />
        </div>
      </ResponsivePage>

      {/* ========================================================
          PÁGINA 5 EM DIANTE: CONTINUAÇÃO DAS VISTORIAS POR TORRE
          ======================================================== */}
      {allTowerPages.slice(1).map((page, pIdx) => {
        const isLastTowerPage = pIdx === allTowerPages.length - 2;
        const shouldRenderFinalHere = canFitFinalOnLastPage && isLastTowerPage;

        return (
          <ResponsivePage key={`tower-page-${page.towerName}-${pIdx + 1}`} scale={scale} dataPage={`tower-${page.towerName}-${pIdx + 2}`}>
            <div className="a4-page shadow-xl border border-gray-200 print:border-none print:shadow-none" data-page={`tower-${page.towerName}-${pIdx + 2}`}>
              <ReportWatermark text={company.watermarkText} enabled={company.showWatermark} />
              <ReportHeader company={company} />

              <div className="relative z-10 text-[9.5px] leading-[1.38] text-slate-800 space-y-2 font-sans">
                {renderTowerPageBlocks(page)}

                {/* Seção 7 e 8 na mesma página em fluxo contínuo quando houver espaço */}
                {shouldRenderFinalHere && (
                  <div className="mt-2 border-t-2 border-slate-300 pt-2">
                    {renderFinalSections()}
                  </div>
                )}
              </div>

              <ReportFooter company={company} pageNumber={currentPageNum++} totalPages={totalPages} />
            </div>
          </ResponsivePage>
        );
      })}



      {/* ========================================================
          PÁGINA FINAL STANDALONE: 7) RECOMENDAÇÕES PRIORITÁRIAS,
          8) CONCLUSÃO TÉCNICA FINAL, FECHAMENTO & ASSINATURA DO CREA
          APENAS SE A ÚLTIMA PÁGINA DE FOTOS NÃO COUBER AS SEÇÕES
          ======================================================== */}
      {!canFitFinalOnLastPage && (
        <ResponsivePage scale={scale} dataPage="final">
          <div className="a4-page shadow-xl border border-gray-200 print:border-none print:shadow-none" data-page="final">
            <ReportWatermark text={company.watermarkText} enabled={company.showWatermark} />
            <ReportHeader company={company} />
            {renderFinalSections()}
            <ReportFooter company={company} pageNumber={currentPageNum++} totalPages={totalPages} />
          </div>
        </ResponsivePage>
      )}
    </div>
  );
};
