import React from 'react';
import { SpdaReport, PhotoSlot } from '../types/spda';
import { ReportHeader, ReportFooter, ReportWatermark } from './ReportHeaderFooter';
import { consolidateReportPhotos } from '../utils/towerSorter';

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

  // ========================================================
  // PAGINAÇÃO DENSA E INTELIGENTE: ZERO ESPAÇOS VAZIOS
  // ========================================================

  // Seção 5: Vistoria SPDA (até 8 fotos na primeira página, restante em blocos de 16)
  const spdaPage1 = spdaPhotos.slice(0, 8);
  const spdaRestantes = spdaPhotos.slice(8);
  const spdaContChunks = chunkArray(spdaRestantes, 16);
  const spdaPageCount = 1 + spdaContChunks.length;

  // Seção 6: Medições (até 8 fotos na primeira página junto aos parâmetros, restante em blocos de 16)
  const measurePage1 = measurementPhotos.slice(0, 8);
  const measureRestantes = measurementPhotos.slice(8);
  const measureContChunks = chunkArray(measureRestantes, 16);
  const measurePageCount = 1 + measureContChunks.length;

  // Seção 7: Quadros (acomoda até 16 fotos direto na primeira página sem pular desnecessariamente, restante em blocos de 16)
  const quadrosPage1 = quadrosPhotos.slice(0, 16);
  const quadrosRestantes = quadrosPhotos.slice(16);
  const quadrosContChunks = chunkArray(quadrosRestantes, 16);
  const quadrosPageCount = 1 + quadrosContChunks.length;

  const isMultiTower =
    Boolean(client.quantidadeTorres && client.quantidadeTorres > 1) ||
    Boolean(client.torresNomes && client.torresNomes.length > 1) ||
    Object.keys(consolidated.torresData || {}).length > 1 ||
    new Set([...spdaPhotos, ...measurementPhotos, ...quadrosPhotos].map((p) => p.towerName).filter(Boolean)).size > 1;

  const aerialPhoto = localPhotos[0]?.url ? localPhotos[0] : null;
  const facadePhoto = localPhotos[1]?.url ? localPhotos[1] : null;
  const hasBothLocalPhotos = Boolean(aerialPhoto && facadePhoto);
  const localPageCount = hasBothLocalPhotos ? 2 : 1;

  // Total de Páginas:
  // 1: Capa
  // 2: 1) Introdução, Normas & 2) Dicionário (2 colunas)
  // 3: 3) Características, Fotos do Local (em destaque próprio) & 4) Histórico
  // 4: 5) Vistoria SPDA (spdaPageCount páginas)
  // 5: 6) Medições de Continuidade (measurePageCount páginas)
  // 6: 7) Quadros de Energia & DPS (quadrosPageCount páginas)
  // 7: 8) Recomendações Prioritárias & 9) Conclusão Final e Assinatura (1 página final unificada)
  const totalPages =
    1 + // Capa
    1 + // Intro, Normas & Dicionário
    localPageCount + // Características, Vista Aérea (destaque) e Fachada (destaque) & Histórico
    spdaPageCount + // Vistoria SPDA
    measurePageCount + // Medições
    quadrosPageCount + // Quadros
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
              Inspeção Visual, Medições de Continuidade Ôhmica & Avaliação NBR 5419/2018
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
              <span className="font-bold">1.1-</span> Este LAUDO tem como objetivo fazer uma avaliação sucinta do SPDA existente na edificação do {client.name}, verificar o estado de conservação das peças e acessórios e checar a sua conformidade com a norma técnica NBR 5419/2018 da ABNT em vigência. <span className="font-bold">1.2-</span> Serão apresentadas as sugestões técnicas necessárias para conformidade à norma e apresentados desenhos e/ou detalhes caso seja necessário.
            </p>
            <p>
              <span className="font-bold">1.3-</span> A avaliação apresentada neste laudo teve como base as inspeções e medições efetuadas nas instalações e por informações obtidas junto a colaboradores e engenheiros da SJC Engenharia.
            </p>
            <div>
              <p>
                <span className="font-bold">1.4-</span> Segundo a ABNT NBR 5419-1:2018, Proteção contra descargas atmosféricas – Parte 1: Princípios Gerais, item 9.4.1.2, as funções do SPDA externo são:
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
                    <div className="w-full h-[185px] bg-slate-200 border border-slate-300 rounded overflow-hidden flex items-center justify-center shadow-inner">
                      <img
                        src={aerialPhoto!.url}
                        alt={aerialPhoto!.caption || 'Vista Aérea da Edificação'}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <p className="text-[8.5px] font-semibold text-slate-700 mt-1.5 text-center">
                      {aerialPhoto!.caption?.trim() || 'Vista aérea da edificação, circunvizinhança e posicionamento geográfico do condomínio.'}
                    </p>
                  </div>

                  {/* Quadro Técnico de Infraestrutura */}
                  <div className="my-2 border border-slate-200 rounded overflow-hidden">
                    <div className="bg-slate-100 px-3 py-1 font-bold text-[9px] text-slate-900 border-b border-slate-200">
                      PARÂMETROS CONSTRUTIVOS & INFRAESTRUTURA DA EDIFICAÇÃO (NBR 5419)
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
                        <span className="font-bold text-blue-700 text-right flex-shrink-0 max-w-[55%] break-words">Nível III / IV (NBR 5419-2 - Gerenciamento de Risco)</span>
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
                  <div className="w-full h-[185px] bg-slate-200 border border-slate-300 rounded overflow-hidden flex items-center justify-center shadow-inner">
                    <img
                      src={facadePhoto!.url}
                      alt={facadePhoto!.caption || 'Fachada Principal da Edificação'}
                      className="w-full h-full object-cover"
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
                    <div className="w-full h-[185px] bg-slate-200 border border-slate-300 rounded overflow-hidden flex items-center justify-center shadow-inner">
                      <img
                        src={(aerialPhoto || facadePhoto)!.url}
                        alt={(aerialPhoto || facadePhoto)!.caption || 'Foto do Local'}
                        className="w-full h-full object-cover"
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
                      PARÂMETROS CONSTRUTIVOS & INFRAESTRUTURA DA EDIFICAÇÃO (NBR 5419)
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
                        <span className="font-bold text-blue-700 text-right flex-shrink-0 max-w-[55%] break-words">Nível III / IV (NBR 5419-2 - Gerenciamento de Risco)</span>
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
          SEÇÃO 5: VISTORIA DO SPDA EXISTENTE
          PADRÃO: 4 FOTOS POR LINHA COM DESTAQUE EM CÍRCULO VERMELHO
          DENSO: SE HOUVER ATÉ 8 FOTOS OU ZERO FOTOS, PREENCHE COM PARECER E SUBSISTEMAS!
          ======================================================== */}
      <ResponsivePage scale={scale} dataPage="spda-1">
        <div className="a4-page shadow-xl border border-gray-200 print:border-none print:shadow-none" data-page="spda-1">
          <ReportWatermark text={company.watermarkText} enabled={company.showWatermark} />
          <ReportHeader company={company} />

          <div className="relative z-10 text-[10px] leading-[1.38] text-slate-800 space-y-2.5 font-sans">
            <h2 className="text-[11.5px] font-bold text-slate-900 uppercase font-sans">
              5) VISTORIA DO SPDA EXISTENTE & PARECER VISUAL
            </h2>

            <p className="text-[9.5px] text-justify leading-relaxed">
              {texts.vistoriaSpdaTexto}
            </p>

            {/* Grade de Fotos (se existirem) */}
            {spdaPage1.length > 0 && (
              <div
                className="grid grid-cols-4 gap-x-[5.33mm] gap-y-[4.5mm] w-full pt-0.5"
                style={{ width: '170mm' }}
              >
                {spdaPage1.map((photo, idx) => {
                  const tName = photo.towerName || 'Torre 1';
                  const cap = photo.caption?.trim();
                  const legendBelow = isMultiTower ? (cap ? `${tName} - ${cap}` : tName) : cap;

                  return (
                    <div key={photo.id || idx} className="flex flex-col items-center flex-shrink-0">
                      <div className="w-[38.5mm] h-[45mm] bg-slate-100 border border-gray-300 rounded overflow-hidden flex items-center justify-center relative flex-shrink-0">
                        <img
                          src={photo.url}
                          alt={photo.caption || `Foto ${idx + 1}`}
                          className="w-full h-full object-cover"
                        />
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
                      {legendBelow && (
                        <p className="text-[7.5px] font-bold text-slate-800 text-center truncate mt-0.5 px-0.5 max-w-[38.5mm]">
                          {legendBelow}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Painel de Parecer Técnico */}
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
                AVALIAÇÃO ESTRUTURAL DOS SUBSISTEMAS DO SPDA (NBR 5419)
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
          </div>

          <ReportFooter company={company} pageNumber={currentPageNum++} totalPages={totalPages} />
        </div>
      </ResponsivePage>

      {/* Páginas de continuação de fotos do SPDA (se houver mais de 8 fotos) */}
      {spdaContChunks.map((photosInPage, pIdx) => (
        <ResponsivePage key={`spda-cont-${pIdx}`} scale={scale} dataPage={`spda-cont-${pIdx + 1}`}>
          <div className="a4-page shadow-xl border border-gray-200 print:border-none print:shadow-none" data-page={`spda-cont-${pIdx + 1}`}>
            <ReportWatermark text={company.watermarkText} enabled={company.showWatermark} />
            <ReportHeader company={company} />

            <div className="relative z-10 text-[10px] leading-[1.4] text-slate-800 font-sans">
              <h2 className="text-[11.5px] font-bold text-slate-900 uppercase mb-3 font-sans">
                5) VISTORIA DO SPDA EXISTENTE (CONTINUAÇÃO)
              </h2>

              <div
                className="grid grid-cols-4 gap-x-[5.33mm] gap-y-[5mm] w-full"
                style={{ width: '170mm' }}
              >
                {photosInPage.map((photo, idx) => {
                  const tName = photo.towerName || 'Torre 1';
                  const cap = photo.caption?.trim();
                  const legendBelow = isMultiTower ? (cap ? `${tName} - ${cap}` : tName) : cap;

                  return (
                    <div key={photo.id || idx} className="flex flex-col items-center flex-shrink-0">
                      <div className="w-[38.5mm] h-[45mm] bg-slate-100 border border-gray-300 rounded overflow-hidden flex items-center justify-center relative flex-shrink-0">
                        <img src={photo.url} alt={photo.caption || `Foto ${idx + 9}`} className="w-full h-full object-cover" />
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
                      {legendBelow && (
                        <p className="text-[7.5px] font-bold text-slate-800 text-center truncate mt-0.5 px-0.5 max-w-[38.5mm]">
                          {legendBelow}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <ReportFooter company={company} pageNumber={currentPageNum++} totalPages={totalPages} />
          </div>
        </ResponsivePage>
      ))}

      {/* ========================================================
          PÁGINA 5 (SEÇÃO 6): MEDIÇÕES DE CONTINUIDADE & INSTRUMENTO
          DENSO: ACOMODA OS PONTOS FOTOGRÁFICOS OU A METODOLOGIA DE MEDIÇÃO!
          ======================================================== */}
      <ResponsivePage scale={scale} dataPage="medicao-1">
        <div className="a4-page shadow-xl border border-gray-200 print:border-none print:shadow-none" data-page="medicao-1">
          <ReportWatermark text={company.watermarkText} enabled={company.showWatermark} />
          <ReportHeader company={company} />

          <div className="relative z-10 text-[9.5px] leading-[1.38] text-slate-800 space-y-2 text-justify font-sans">
            <h2 className="text-[11.5px] font-bold text-slate-900 uppercase font-sans">
              6) MEDIÇÕES DE CONTINUIDADE OHMICA DOS CONDUTORES
            </h2>

            <p className="text-[9px] leading-relaxed">
              {texts.medicoesContinuidadeTexto}
            </p>

            {/* Instrumento Miliohmímetro */}
            <div className="bg-slate-50 border border-slate-200 rounded p-2.5 flex gap-3 items-center">
              {equipmentPhotoUrl ? (
                <div className="w-[140px] h-[95px] bg-white border border-gray-300 rounded overflow-hidden flex-shrink-0">
                  <img src={equipmentPhotoUrl} alt="Miliohmímetro" className="w-full h-full object-cover" />
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
                  <p><span className="text-slate-500 font-normal">Local:</span> {texts.medicoesLocal}</p>
                  <p><span className="text-slate-500 font-normal">Corrente Aplicada:</span> {texts.medicoesCorrenteAplicada}</p>
                  <p><span className="text-slate-500 font-normal">Tipo de Corrente:</span> {texts.medicoesTipoCorrente}</p>
                </div>
              </div>
            </div>

            {/* Parâmetros Normativos NBR 5419 */}
            <div className="border border-slate-200 rounded overflow-hidden">
              <div className="bg-slate-100 px-3 py-1 font-bold text-[9px] text-slate-900 border-b border-slate-200">
                PARÂMETROS NORMATIVOS DE CONTINUIDADE (ABNT NBR 5419/2018)
              </div>
              <div className="divide-y divide-slate-100 text-[8.5px]">
                <div className="px-3 py-1 flex justify-between items-center gap-2 bg-white">
                  <div className="flex-1 min-w-0 pr-1">
                    <span className="font-bold text-slate-900 break-words">Continuidade de Armaduras e Malhas: </span>
                    <span className="text-slate-600 break-words">NBR 5419-3:2018 (Item 5.3.5)</span>
                  </div>
                  <span className="font-bold text-emerald-700 flex-shrink-0 text-right whitespace-nowrap">≤ 0,200 Ω (200 mΩ) [CONFORME]</span>
                </div>
                <div className="px-3 py-1 flex justify-between items-center gap-2 bg-slate-50/50">
                  <div className="flex-1 min-w-0 pr-1">
                    <span className="font-bold text-slate-900 break-words">Resistência de Equipotencialização: </span>
                    <span className="text-slate-600 break-words">NBR 5419-3:2018 (Item 6.2)</span>
                  </div>
                  <span className="font-bold text-emerald-700 flex-shrink-0 text-right whitespace-nowrap">≤ 0,200 Ω (200 mΩ) [CONFORME]</span>
                </div>
                <div className="px-3 py-1 flex justify-between items-center gap-2 bg-white">
                  <div className="flex-1 min-w-0 pr-1">
                    <span className="font-bold text-slate-900 break-words">Método de 4 Terminais (Kelvin): </span>
                    <span className="text-slate-600 break-words">Injeção de corrente DC contínua</span>
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

            {/* Registros Fotográficos dos Pontos de Medição (se houver fotos cadastradas) */}
            {measurePage1.length > 0 ? (
              <div className="pt-1">
                <p className="text-[9.5px] font-bold text-slate-900 uppercase mb-1.5">
                  6.1) PONTOS DE MEDIÇÃO DE CONTINUIDADE OBTIDOS
                </p>
                <div
                  className="grid grid-cols-4 gap-x-[5.33mm] gap-y-[4mm] w-full"
                  style={{ width: '170mm' }}
                >
                  {measurePage1.map((photo, idx) => {
                    const tName = photo.towerName || 'Torre 1';
                    const label = photo.caption?.trim();
                    const val = photo.measurementValue?.trim();
                    const towerText = isMultiTower ? tName : '';
                    let textBelow = towerText ? (label ? `${towerText} - ${label}` : towerText) : (label || '');
                    if (val) {
                      textBelow = textBelow ? `${textBelow} (${val})` : `(${val})`;
                    }

                    return (
                      <div
                        key={photo.id || idx}
                        className="w-[38.5mm] h-[44mm] bg-slate-100 border border-gray-300 rounded overflow-hidden flex flex-col items-center justify-between relative flex-shrink-0"
                      >
                        <div className={`w-[38.5mm] ${textBelow ? 'h-[36mm]' : 'h-full'} bg-slate-200 overflow-hidden flex items-center justify-center relative`}>
                          <img src={photo.url} alt="Foto Medição" className="w-full h-full object-cover" />
                          {photo.towerName && (
                            <div className="absolute top-1 left-1 bg-slate-900/85 text-white text-[7px] font-bold px-1 py-0.5 rounded shadow z-10 uppercase tracking-wider">
                              {photo.towerName}
                            </div>
                          )}
                        </div>
                        {textBelow && (
                          <div className="w-full h-[8mm] py-0.5 px-0.5 bg-white border-t border-gray-200 text-center flex items-center justify-center">
                            <p className="text-[7.5px] font-bold text-gray-800 truncate leading-tight px-0.5">
                              {textBelow}
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              /* Se não houver fotos, inclui quadro técnico dos pontos para manter a página densa */
              <div className="border border-slate-200 rounded overflow-hidden mt-1">
                <div className="bg-slate-100 px-3 py-1 font-bold text-[8.5px] text-slate-900 border-b border-slate-200">
                  METODOLOGIA DE 4 TERMINAIS (KELVIN) E PONTOS DE ENSAIO
                </div>
                <div className="divide-y divide-slate-100 text-[8px]">
                  <div className="px-3 py-1 flex justify-between items-center gap-2 bg-white">
                    <span className="font-semibold text-slate-800 flex-1 min-w-0 break-words">1. Malha de Captação para Descidas Principais:</span>
                    <span className="font-bold text-emerald-700 text-right flex-shrink-0 max-w-[50%] break-words">Ensaio a 4 fios com injeção DC contínua [CONFORME]</span>
                  </div>
                  <div className="px-3 py-1 flex justify-between items-center gap-2 bg-slate-50/50">
                    <span className="font-semibold text-slate-800 flex-1 min-w-0 break-words">2. Descidas para Caixas de Equalização / BEP:</span>
                    <span className="font-bold text-emerald-700 text-right flex-shrink-0 max-w-[50%] break-words">Conexões mecânicas ensaiadas sob carga [CONFORME]</span>
                  </div>
                  <div className="px-3 py-1 flex justify-between items-center gap-2 bg-white">
                    <span className="font-semibold text-slate-800 flex-1 min-w-0 break-words">3. Malha de Aterramento para Estruturas Metálicas:</span>
                    <span className="font-bold text-emerald-700 text-right flex-shrink-0 max-w-[50%] break-words">Equipotencialização de massas [CONFORME]</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          <ReportFooter company={company} pageNumber={currentPageNum++} totalPages={totalPages} />
        </div>
      </ResponsivePage>

      {/* Páginas de continuação de medição (se houver mais de 8 fotos) */}
      {measureContChunks.map((photosInPage, pIdx) => (
        <ResponsivePage key={`measure-cont-${pIdx}`} scale={scale} dataPage={`measure-cont-${pIdx + 1}`}>
          <div className="a4-page shadow-xl border border-gray-200 print:border-none print:shadow-none" data-page={`measure-cont-${pIdx + 1}`}>
            <ReportWatermark text={company.watermarkText} enabled={company.showWatermark} />
            <ReportHeader company={company} />

            <div className="relative z-10 text-[10px] leading-[1.4] text-slate-800 font-sans">
              <h2 className="text-[11.5px] font-bold text-slate-900 uppercase mb-3 font-sans">
                6.1) PONTOS DE MEDIÇÃO (CONTINUAÇÃO)
              </h2>

              <div className="grid grid-cols-4 gap-x-[5.33mm] gap-y-[5mm] w-full" style={{ width: '170mm' }}>
                {photosInPage.map((photo, idx) => {
                  const tName = photo.towerName || 'Torre 1';
                  const towerText = isMultiTower ? tName : (photo.towerName ? `[${photo.towerName}]` : '');
                  const label = photo.caption?.trim();
                  const val = photo.measurementValue?.trim();
                  const title = towerText ? (label ? `${towerText} - ${label}` : towerText) : label;
                  const textBelow = [title, val ? `(${val})` : ''].filter(Boolean).join(' ');

                  return (
                    <div
                      key={photo.id || idx}
                      className="w-[38.5mm] h-[48mm] bg-slate-100 border border-gray-300 rounded overflow-hidden flex flex-col items-center justify-between relative flex-shrink-0"
                    >
                      <div className={`w-[38.5mm] ${textBelow ? 'h-[40mm]' : 'h-full'} bg-slate-200 overflow-hidden flex items-center justify-center relative`}>
                        <img src={photo.url} alt="Foto Medição" className="w-full h-full object-cover" />
                        {photo.towerName && (
                          <div className="absolute top-1 left-1 bg-slate-900/85 text-white text-[7px] font-bold px-1 py-0.5 rounded shadow z-10 uppercase tracking-wider">
                            {photo.towerName}
                          </div>
                        )}
                      </div>
                      {textBelow && (
                        <div className="w-full h-[8mm] py-0.5 px-0.5 bg-white border-t border-gray-200 text-center flex items-center justify-center">
                          <p className="text-[7.5px] font-bold text-gray-800 truncate leading-tight">
                            {textBelow}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <ReportFooter company={company} pageNumber={currentPageNum++} totalPages={totalPages} />
          </div>
        </ResponsivePage>
      ))}

      {/* ========================================================
          PÁGINA 6 (SEÇÃO 7): ANÁLISE DOS QUADROS DE ENERGIA & DPS (NBR 5410)
          DENSO: ACOMODA AS FOTOS DOS QUADROS OU A TABELA DE AUDITORIA DE QUADROS!
          ======================================================== */}
      <ResponsivePage scale={scale} dataPage="quadros-1">
        <div className="a4-page shadow-xl border border-gray-200 print:border-none print:shadow-none" data-page="quadros-1">
          <ReportWatermark text={company.watermarkText} enabled={company.showWatermark} />
          <ReportHeader company={company} />

          <div className="relative z-10 text-[9.5px] leading-[1.38] text-slate-800 space-y-2 text-justify font-sans">
            <h2 className="text-[11.5px] font-bold text-slate-900 uppercase font-sans">
              7) ANÁLISE DOS QUADROS DE ENERGIA (NBR 5410)
            </h2>

            <p className="text-[9px] leading-relaxed">
              {texts.pontosInspecaoAvaliacao}
            </p>

            <div className="bg-gray-200 py-1 px-3 text-center rounded-xs">
              <span className="text-[9.5px] font-bold text-slate-900 font-sans">
                Avaliação dos Dispositivos de Proteção contra Surtos (DPS) - NBR 5410
              </span>
            </div>

            <p className="text-[9px] leading-relaxed">
              {texts.analiseQuadrosTexto}
            </p>



            {/* Fotos dos Quadros (se existirem) - Até 16 fotos acomodadas em uma única página */}
            {quadrosPage1.length > 0 ? (
              <div className="pt-1">
                <p className="text-[9.5px] font-bold text-slate-900 uppercase mb-1.5">
                  REGISTROS FOTOGRÁFICOS DOS QUADROS DE ENERGIA
                </p>
                <div
                  className={`grid grid-cols-4 gap-x-[5.33mm] ${
                    quadrosPage1.length > 12
                      ? 'gap-y-[3mm]'
                      : quadrosPage1.length > 8
                      ? 'gap-y-[3.5mm]'
                      : 'gap-y-[4.5mm]'
                  } w-full`}
                  style={{ width: '170mm' }}
                >
                  {quadrosPage1.map((photo, idx) => {
                    const tName = photo.towerName || 'Torre 1';
                    const towerText = isMultiTower ? tName : (photo.towerName ? `[${photo.towerName}]` : '');
                    const cap = photo.caption?.trim();
                    const captionText = towerText ? (cap ? `${towerText} - ${cap}` : towerText) : cap;
                    const cardHeight =
                      quadrosPage1.length > 12
                        ? 'h-[40mm]'
                        : quadrosPage1.length > 8
                        ? 'h-[44mm]'
                        : 'h-[48mm]';
                    const imgHeight =
                      captionText
                        ? quadrosPage1.length > 12
                          ? 'h-[33.5mm]'
                          : quadrosPage1.length > 8
                          ? 'h-[37mm]'
                          : 'h-[41mm]'
                        : 'h-full';
                    const capHeight =
                      quadrosPage1.length > 12
                        ? 'h-[6.5mm]'
                        : 'h-[7mm]';

                    return (
                      <div
                        key={photo.id || idx}
                        className={`w-[38.5mm] ${cardHeight} bg-slate-100 border border-gray-300 rounded overflow-hidden flex flex-col items-center justify-between relative flex-shrink-0`}
                      >
                        <div className={`w-[38.5mm] ${imgHeight} bg-slate-200 overflow-hidden flex items-center justify-center relative`}>
                          <img src={photo.url} alt={captionText || 'Foto Quadro'} className="w-full h-full object-cover" />
                          {photo.hasRedCircleMarker && (
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
                        {captionText && (
                          <div className={`w-full ${capHeight} py-0.5 px-0.5 bg-white border-t border-gray-200 text-center flex items-center justify-center`}>
                            <p className="text-[7.5px] font-bold text-gray-800 truncate leading-tight">
                              {captionText}
                            </p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              /* Registro fotográfico facultativo conforme NBR 5410 */
              <div className="border border-slate-200 bg-slate-50 rounded p-3 text-center text-slate-700 text-[8.5px] mt-2 font-medium">
                Registro fotográfico facultativo conforme escopo de vistoria. Quadros de distribuição e dispositivos DPS inspecionados em conformidade com as diretrizes da NBR 5410.
              </div>
            )}
          </div>

          <ReportFooter company={company} pageNumber={currentPageNum++} totalPages={totalPages} />
        </div>
      </ResponsivePage>

      {/* Páginas de continuação dos quadros (apenas se houver mais de 16 fotos) */}
      {quadrosContChunks.map((chunk, cIdx) => (
        <ResponsivePage key={`quadros-cont-${cIdx}`} scale={scale} dataPage={`quadros-cont-${cIdx + 1}`}>
          <div className="a4-page shadow-xl border border-gray-200 print:border-none print:shadow-none" data-page={`quadros-cont-${cIdx + 1}`}>
            <ReportWatermark text={company.watermarkText} enabled={company.showWatermark} />
            <ReportHeader company={company} />

            <div className="relative z-10 text-[10px] leading-[1.4] text-slate-800 font-sans">
              <h2 className="text-[11.5px] font-bold text-slate-900 uppercase mb-3 font-sans">
                7) ANÁLISE DOS QUADROS DE ENERGIA (CONTINUAÇÃO)
              </h2>

              <div className="grid grid-cols-4 gap-x-[5.33mm] gap-y-[4.5mm] w-full" style={{ width: '170mm' }}>
                {chunk.map((photo, idx) => {
                  const tName = photo.towerName || 'Torre 1';
                  const towerText = isMultiTower ? tName : (photo.towerName ? `[${photo.towerName}]` : '');
                  const cap = photo.caption?.trim();
                  const captionText = towerText ? (cap ? `${towerText} - ${cap}` : towerText) : cap;
                  return (
                    <div
                      key={photo.id || idx}
                      className="w-[38.5mm] h-[48mm] bg-slate-100 border border-gray-300 rounded overflow-hidden flex flex-col items-center justify-between relative flex-shrink-0"
                    >
                      <div className={`w-[38.5mm] ${captionText ? 'h-[41mm]' : 'h-full'} bg-slate-200 overflow-hidden flex items-center justify-center relative`}>
                        <img src={photo.url} alt={captionText || 'Foto Quadro'} className="w-full h-full object-cover" />
                        {photo.towerName && (
                          <div className="absolute top-1 left-1 bg-slate-900/85 text-white text-[7px] font-bold px-1 py-0.5 rounded shadow z-10 uppercase tracking-wider">
                            {photo.towerName}
                          </div>
                        )}
                        {photo.hasRedCircleMarker && (
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
                      {captionText && (
                        <div className="w-full h-[7mm] py-0.5 px-0.5 bg-white border-t border-gray-200 text-center flex items-center justify-center">
                          <p className="text-[7.5px] font-bold text-gray-800 truncate leading-tight">
                            {captionText}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <ReportFooter company={company} pageNumber={currentPageNum++} totalPages={totalPages} />
          </div>
        </ResponsivePage>
      ))}

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
                Este laudo possui validade técnica de 1 (um) ano a partir da data de emissão, ou conforme periodicidade de inspeção estipulada pela NBR 5419-3:2018 (Tabela 6). O responsável técnico declara que todas as medições foram efetuadas conforme os preceitos éticos e regulamentares do CREA.
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
                        CERTIFICAÇÃO DIGITAL - PADRÃO CREA / NBR 5419:2018
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
