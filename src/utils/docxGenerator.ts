/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  ImageRun,
  AlignmentType,
  BorderStyle,
  WidthType,
  PageBreak,
  Header,
  Footer,
  PageNumber,
  ShadingType,
  VerticalAlign,
  TableLayoutType,
  HorizontalPositionAlign,
  HorizontalPositionRelativeFrom,
  VerticalPositionAlign,
  VerticalPositionRelativeFrom,
  TextWrappingType,
} from 'docx';
import { SpdaReport, PhotoSlot } from '../types/spda';
import { SJC_OFFICIAL_LOGO_DATA_URL } from '../assets/logo';
import { generateSequentialDocxFileName } from './storage';
import { consolidateReportPhotos } from './towerSorter';
import { safeJpegDataUrl, processPhotoForPdf, processHeaderLogo } from './pdfGenerator';

/**
 * Gera a imagem PNG da marca d'água diagonal "SPDA 2026"
 * Exatamente igual ao ReportWatermark do ReportPreview e drawWatermark do PDF
 */
export function generateWatermarkPngDataUrl(text = 'SPDA 2026'): string {
  try {
    if (typeof document === 'undefined') return '';
    const canvas = document.createElement('canvas');
    // Canvas A4 em alta definição (1190 x 1684 px)
    canvas.width = 1190;
    canvas.height = 1684;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    // Centraliza rigorosamente no meio exato da página A4
    ctx.translate(canvas.width / 2, canvas.height / 2);
    // Inclinação diagonal em -38 graus (idêntica ao ReportWatermark: -rotate-[38deg])
    ctx.rotate((-38 * Math.PI) / 180);
    ctx.font = '900 150px Arial, Helvetica, sans-serif';
    // Cor cinza suave transparente (rgba(156, 163, 175, 0.18), idêntico a text-[#9ca3af]/20)
    ctx.fillStyle = 'rgba(156, 163, 175, 0.18)';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.letterSpacing = '10px';
    ctx.fillText(text, 0, 0);
    ctx.restore();

    return canvas.toDataURL('image/png');
  } catch (err) {
    console.warn('Erro ao gerar marca d\'água para Word:', err);
    return '';
  }
}

/**
 * Converte dataURL (base64) em Uint8Array para uso seguro no docx
 */
function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const parts = dataUrl.split(',');
  const base64 = parts.length > 1 ? parts[1] : parts[0];
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// ============================================================================
// CONSTANTES DE LAYOUT & ESTILOS A4 IDÊNTICOS AO PDF
// Largura útil A4 com margens de 20mm = 170mm = 9638 twips
// ============================================================================
const TOTAL_WIDTH_TWIPS = 9638;
const COL_WIDTH_4_TWIPS = Math.floor(TOTAL_WIDTH_TWIPS / 4); // 2409 twips

const NO_BORDER = {
  style: BorderStyle.NONE,
  size: 0,
  color: 'auto',
};

const BORDER_NONE_OBJ = {
  top: NO_BORDER,
  bottom: NO_BORDER,
  left: NO_BORDER,
  right: NO_BORDER,
};

const LIGHT_BORDER = {
  style: BorderStyle.SINGLE,
  size: 1,
  color: 'CBD5E1', // Slate 300
};

const BORDER_LIGHT_OBJ = {
  top: LIGHT_BORDER,
  bottom: LIGHT_BORDER,
  left: LIGHT_BORDER,
  right: LIGHT_BORDER,
};

// Título de Seção Principal (ex: "5) VISTORIA DO SPDA EXISTENTE & PARECER VISUAL")
function createSectionHeader(title: string): Paragraph {
  return new Paragraph({
    spacing: { before: 200, after: 100 },
    children: [
      new TextRun({
        text: title,
        bold: true,
        size: 21, // 10.5pt
        color: '0F172A', // Slate 900
        font: 'Arial',
      }),
    ],
  });
}

// Faixa de Subtítulo Cinza / Divisória (ex: "DADOS DA EDIFICAÇÃO / CLIENTE")
function createSubheaderBanner(title: string, align: (typeof AlignmentType)[keyof typeof AlignmentType] = AlignmentType.LEFT): Table {
  return new Table({
    width: { size: TOTAL_WIDTH_TWIPS, type: WidthType.DXA },
    borders: BORDER_NONE_OBJ,
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: TOTAL_WIDTH_TWIPS, type: WidthType.DXA },
            shading: { fill: 'F1F5F9', type: ShadingType.CLEAR }, // Slate 100
            margins: { top: 60, bottom: 60, left: 120, right: 120 },
            children: [
              new Paragraph({
                alignment: align,
                children: [
                  new TextRun({
                    text: title,
                    bold: true,
                    size: 17, // 8.5pt
                    color: '0F172A',
                    font: 'Arial',
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

// Caixa de Destaque com borda suave e fundo cinza claro (ex: "OBJETO DA INSPEÇÃO")
function createHighlightBox(title: string, bodyText: string): Table {
  return new Table({
    width: { size: TOTAL_WIDTH_TWIPS, type: WidthType.DXA },
    borders: BORDER_LIGHT_OBJ,
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: TOTAL_WIDTH_TWIPS, type: WidthType.DXA },
            shading: { fill: 'F8FAFC', type: ShadingType.CLEAR }, // Slate 50
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [
              new Paragraph({
                spacing: { before: 0, after: 30 },
                children: [
                  new TextRun({
                    text: title,
                    bold: true,
                    size: 17, // 8.5pt
                    color: '0F172A',
                    font: 'Arial',
                  }),
                ],
              }),
              new Paragraph({
                spacing: { before: 0, after: 0 },
                children: [
                  new TextRun({
                    text: bodyText,
                    size: 16, // 8pt
                    color: '334155', // Slate 700
                    font: 'Arial',
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

// Tabela de Dados Estruturados com Linhas Zebradas Suaves
function createZebraTable(rowsData: Array<[string, string]>, labelColWidthTwips = 2800): Table {
  const valColWidthTwips = TOTAL_WIDTH_TWIPS - labelColWidthTwips;

  const tableRows = rowsData.map(([label, val], idx) => {
    const isEven = idx % 2 === 0;
    const bgFill = isEven ? 'FAFAFA' : 'FFFFFF';

    return new TableRow({
      children: [
        new TableCell({
          width: { size: labelColWidthTwips, type: WidthType.DXA },
          shading: { fill: bgFill, type: ShadingType.CLEAR },
          margins: { top: 50, bottom: 50, left: 90, right: 90 },
          borders: {
            top: NO_BORDER,
            left: NO_BORDER,
            right: NO_BORDER,
            bottom: { style: BorderStyle.SINGLE, size: 1, color: 'E2E8F0' },
          },
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: label,
                  bold: true,
                  size: 16, // 8pt
                  color: '1E293B',
                  font: 'Arial',
                }),
              ],
            }),
          ],
        }),
        new TableCell({
          width: { size: valColWidthTwips, type: WidthType.DXA },
          shading: { fill: bgFill, type: ShadingType.CLEAR },
          margins: { top: 50, bottom: 50, left: 90, right: 90 },
          borders: {
            top: NO_BORDER,
            left: NO_BORDER,
            right: NO_BORDER,
            bottom: { style: BorderStyle.SINGLE, size: 1, color: 'E2E8F0' },
          },
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: val || '—',
                  size: 16, // 8pt
                  color: '334155',
                  font: 'Arial',
                }),
              ],
            }),
          ],
        }),
      ],
    });
  });

  return new Table({
    width: { size: TOTAL_WIDTH_TWIPS, type: WidthType.DXA },
    rows: tableRows,
  });
}

/**
 * Cria a grade de fotos rigorosamente alinhada em 4 colunas no Word (.docx),
 * idêntica à visualização do PDF (38.5mm x 48.0mm de proporção fixa, corte CSS object-cover,
 * e círculos de foco vermelhos gravados diretamente nas imagens).
 */
function createPhotoGridTable(
  photos: PhotoSlot[],
  processedJpegs: string[],
  isMultiTower: boolean,
  showMeasurement = false,
  imgHeightPx = 175
): Table {
  const rows: TableRow[] = [];
  const chunkSize = 4;

  for (let i = 0; i < photos.length; i += chunkSize) {
    const photoChunk = photos.slice(i, i + chunkSize);
    const jpegChunk = processedJpegs.slice(i, i + chunkSize);

    const cells: TableCell[] = [];

    for (let c = 0; c < 4; c++) {
      const p = photoChunk[c];
      const jpeg = jpegChunk[c];

      if (p && jpeg) {
        const tName = p.towerName || 'Torre 1';
        const cap = p.caption?.trim() || '';
        const legendText = isMultiTower ? (cap ? `${tName} - ${cap}` : tName) : cap;

        const cellChildren: Paragraph[] = [];

        try {
          const imageBytes = dataUrlToUint8Array(jpeg);
          cellChildren.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 20, after: 20 },
              children: [
                new ImageRun({
                  data: imageBytes,
                  transformation: {
                    width: 140, // 38.5mm proporcional no Word
                    height: imgHeightPx, // 48mm ou ajustado proporcional
                  },
                  type: 'jpg',
                }),
              ],
            })
          );
        } catch (e) {
          console.warn('Erro ao inserir foto no docx:', e);
          cellChildren.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: '[Foto]', size: 14, color: '64748B' })],
            })
          );
        }

        // Legenda técnica da foto
        if (legendText) {
          cellChildren.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 10, after: showMeasurement && p.measurementValue ? 10 : 40 },
              children: [
                new TextRun({
                  text: legendText,
                  bold: true,
                  size: 13, // 6.5pt
                  color: '0F172A',
                  font: 'Arial',
                }),
              ],
            })
          );
        }

        // Medição em Ohms em destaque azul
        if (showMeasurement && p.measurementValue) {
          cellChildren.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 0, after: 40 },
              children: [
                new TextRun({
                  text: `R = ${p.measurementValue} (Conforme)`,
                  bold: true,
                  size: 13, // 6.5pt
                  color: '1D4ED8', // Blue 700
                  font: 'Arial',
                }),
              ],
            })
          );
        }

        cells.push(
          new TableCell({
            width: { size: COL_WIDTH_4_TWIPS, type: WidthType.DXA },
            margins: { top: 30, bottom: 30, left: 30, right: 30 },
            verticalAlign: VerticalAlign.TOP,
            borders: BORDER_NONE_OBJ,
            children: cellChildren,
          })
        );
      } else {
        // Célula vazia para manter proporção de 4 colunas
        cells.push(
          new TableCell({
            width: { size: COL_WIDTH_4_TWIPS, type: WidthType.DXA },
            borders: BORDER_NONE_OBJ,
            children: [new Paragraph({ children: [] })],
          })
        );
      }
    }

    rows.push(new TableRow({ children: cells }));
  }

  return new Table({
    width: { size: TOTAL_WIDTH_TWIPS, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    borders: BORDER_NONE_OBJ,
    rows,
  });
}

/**
 * Função utilitária para dividir arrays em blocos de tamanho fixo
 */
function chunkArray<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

/**
 * Gera o arquivo DOCX 100% fiel ao PDF, editável pelo Word
 */
export async function generateDocxBlob(
  report: SpdaReport,
  onProgress?: (progress: number, message: string) => void
): Promise<{ blob: Blob; fileName: string }> {
  onProgress?.(5, 'Iniciando compilação do laudo em Word (.docx)...');

  const { client, company, conditions, texts } = report;
  const { spdaPhotos, measurementPhotos, quadrosPhotos, localPhotos } = consolidateReportPhotos(report);

  const isMultiTower =
    Boolean(client.quantidadeTorres && client.quantidadeTorres > 1) ||
    Boolean(client.torresNomes && client.torresNomes.length > 1) ||
    Object.keys(report.torresData || {}).length > 1 ||
    new Set([...spdaPhotos, ...measurementPhotos, ...quadrosPhotos].map((p) => p.towerName).filter(Boolean)).size > 1;

  // Processamento paralelo de imagens idêntico ao gerador de PDF
  onProgress?.(15, `Processando ${spdaPhotos.length + measurementPhotos.length + quadrosPhotos.length + localPhotos.length} fotos do laudo...`);

  const [
    localJpegs,
    spdaJpegs,
    measurementJpegs,
    quadrosJpegs,
    equipmentJpeg,
    headerLogoLayout,
    signatureJpeg,
  ] = await Promise.all([
    Promise.all(localPhotos.map((p) => processPhotoForPdf(p, 900, 600, false))),
    Promise.all(spdaPhotos.map((p) => processPhotoForPdf(p, 770, 960, p.hasRedCircleMarker ?? true))),
    Promise.all(measurementPhotos.map((p) => processPhotoForPdf(p, 770, 840, false))),
    Promise.all(quadrosPhotos.map((p) => processPhotoForPdf(p, 770, 840, p.hasRedCircleMarker ?? false))),
    safeJpegDataUrl(report.equipmentPhotoUrl, 600, 400),
    processHeaderLogo(company.logoUrl || SJC_OFFICIAL_LOGO_DATA_URL, 45, 18, 192, 8.5),
    report.digitalSignature?.enabled && report.digitalSignature.imageUrl
      ? safeJpegDataUrl(report.digitalSignature.imageUrl, 500, 200, '#ffffff')
      : Promise.resolve(''),
  ]);

  // Gera a imagem da marca d'água diagonal para o meio da tela em todas as páginas (idêntica ao PDF)
  const watermarkText = company.showWatermark !== false ? (company.watermarkText || 'SPDA 2026') : '';
  const watermarkPng = watermarkText ? generateWatermarkPngDataUrl(watermarkText) : '';

  onProgress?.(70, 'Construindo estrutura de páginas e tabelas em conformidade com a ABNT NBR 5419:2018...');

  const docChildren: Array<Paragraph | Table> = [];

  // =========================================================================
  // PÁGINA 1: CAPA EXECUTIVA (IDÊNTICA AO PDF)
  // =========================================================================
  // Faixa Vermelha Superior
  docChildren.push(
    new Table({
      width: { size: TOTAL_WIDTH_TWIPS, type: WidthType.DXA },
      borders: BORDER_NONE_OBJ,
      rows: [
        new TableRow({
          children: [
            new TableCell({
              width: { size: TOTAL_WIDTH_TWIPS, type: WidthType.DXA },
              shading: { fill: 'F3F4F6', type: ShadingType.CLEAR },
              margins: { top: 60, bottom: 60, left: 100, right: 100 },
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new TextRun({
                      text: 'LAUDO TÉCNICO PERICIAL DE ENGENHARIA ELÉTRICA',
                      bold: true,
                      size: 18, // 9pt
                      color: 'D9383A', // Vermelho oficial
                      font: 'Arial',
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    })
  );

  // Título Principal Centralizado
  docChildren.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 180, after: 40 },
      children: [
        new TextRun({
          text: 'SISTEMA DE PROTEÇÃO CONTRA',
          bold: true,
          size: 30, // 15pt
          color: '0F172A',
          font: 'Arial',
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 40 },
      children: [
        new TextRun({
          text: 'DESCARGAS ATMOSFÉRICAS (SPDA)',
          bold: true,
          size: 30, // 15pt
          color: '0F172A',
          font: 'Arial',
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 140 },
      children: [
        new TextRun({
          text: 'Inspeção Visual, Medições de Continuidade Ôhmica & Avaliação NBR 5419/2018',
          size: 18, // 9pt
          color: '475569',
          font: 'Arial',
        }),
      ],
    })
  );

  // OBJETO DA INSPEÇÃO em Caixa de Destaque
  docChildren.push(createHighlightBox('OBJETO DA INSPEÇÃO:', texts.objeto));

  docChildren.push(new Paragraph({ spacing: { before: 100, after: 0 }, children: [] }));

  // DADOS DA EDIFICAÇÃO / CLIENTE
  docChildren.push(createSubheaderBanner('DADOS DA EDIFICAÇÃO / CLIENTE'));

  const clientInfoRows: Array<[string, string]> = [
    ['CLIENTE:', client.name || '—'],
    ['LOCAL:', client.local || '—'],
    ['MUNICÍPIO / UF:', client.municipio || '—'],
    ['CNPJ:', client.cnpj || '—'],
    ['RAMO DE ATIVIDADE:', client.ramoAtividade || '—'],
    ['PERÍODO DE AVALIAÇÃO:', client.periodoAvaliacao || client.dataEmissaoExtenso || '—'],
    ['GRAU DE EXPOSIÇÃO:', client.exposicaoNivel || 'Baixa exposição a descargas atmosféricas'],
  ];

  docChildren.push(createZebraTable(clientInfoRows, 2700));

  docChildren.push(new Paragraph({ spacing: { before: 100, after: 0 }, children: [] }));

  // DADOS DO RESPONSÁVEL TÉCNICO & EMISSÃO
  docChildren.push(createSubheaderBanner('RESPONSABILIDADE TÉCNICA & REGISTRO PROFISSIONAL'));

  const techInfoRows: Array<[string, string]> = [
    ['RESPONSÁVEL TÉCNICO:', report.digitalSignature?.signerName || client.tecnico || '—'],
    ['QUALIFICAÇÃO PROFISSIONAL:', report.digitalSignature?.signerRole || client.cargo || 'Engenheiro Eletricista'],
    ['REGISTRO CREA / CONFEA:', report.digitalSignature?.signerCrea || client.crea || '—'],
    ['CIDADE & DATA DE EMISSÃO:', `${client.cidadeEmissao}, ${client.dataEmissaoExtenso}`],
  ];

  if (report.digitalSignature?.enabled) {
    techInfoRows.push(['AUTENTICAÇÃO DIGITAL:', 'DOCUMENTO ASSINADO DIGITALMENTE (PÁGINA FINAL)']);
  }

  docChildren.push(createZebraTable(techInfoRows, 3000));

  // Quebra para Página 2
  docChildren.push(new Paragraph({ children: [new PageBreak()] }));

  // =========================================================================
  // PÁGINA 2: INTRODUÇÃO, NORMAS & DICIONÁRIO EM 2 COLUNAS
  // =========================================================================
  docChildren.push(createSectionHeader('1) INTRODUÇÃO'));

  const introParagraphs = [
    `1.1- Este LAUDO tem como objetivo fazer uma avaliação sucinta do SPDA existente na edificação do ${client.name}, verificar o estado de conservação das peças e acessórios e checar a sua conformidade com a norma técnica NBR 5419/2018 da ABNT em vigência. 1.2- Serão apresentadas as sugestões técnicas necessárias para conformidade à norma e apresentados desenhos e/ou detalhes caso seja necessário.`,
    `1.3- A avaliação apresentada neste laudo teve como base as inspeções e medições efetuadas nas instalações e por informações obtidas junto a colaboradores e engenheiros da SJC Engenharia.`,
    `1.4- Segundo a ABNT NBR 5419-1:2018, Proteção contra descargas atmosféricas – Parte 1: Princípios Gerais, item 9.4.1.2, as funções do SPDA externo são:`,
  ];

  introParagraphs.forEach((pText) => {
    docChildren.push(
      new Paragraph({
        spacing: { before: 30, after: 40 },
        children: [new TextRun({ text: pText, size: 16, color: '1E293B', font: 'Arial' })],
      })
    );
  });

  const funcoesSpda = [
    'a) Interceptar uma descarga atmosférica para a estrutura (com um subsistema de captação);',
    'b) Conduzir a corrente da descarga atmosférica seguramente para a terra (com um subsistema de descida);',
    'c) Dispersar esta corrente na terra (com um subsistema de aterramento).',
  ];

  funcoesSpda.forEach((fText) => {
    docChildren.push(
      new Paragraph({
        indent: { left: 240 },
        spacing: { before: 10, after: 20 },
        children: [new TextRun({ text: fText, size: 15, color: '334155', font: 'Arial' })],
      })
    );
  });

  const introEtapas = [
    'As inspeções e levantamentos de informações foram efetuados na seguinte ordem:',
    'a) Análise das informações fornecidas pelos ANEXOS (Projetos e relatórios fornecidos pelo cliente);',
    'b) Relatório de inspeção de SPDA e Caixas de Inspeção de Hastes de Aterramento;',
    'c) Relatório de Inspeção de Medição de Continuidade de Malha de Aterramento;',
    'd) Relatório de Inspeção de Pontos de aterramento e avaliação dos quadros de energia;',
    'e) Avaliação Geral do Sistema de Proteção contra Descargas Atmosféricas e Laudo Técnico Final.',
  ];

  introEtapas.forEach((eText, eIdx) => {
    docChildren.push(
      new Paragraph({
        indent: eIdx > 0 ? { left: 240 } : undefined,
        spacing: { before: eIdx === 0 ? 30 : 10, after: 20 },
        children: [new TextRun({ text: eText, size: 15, color: '334155', font: 'Arial' })],
      })
    );
  });

  // Faixa Divisória: Referências Normativas
  docChildren.push(
    new Paragraph({ spacing: { before: 80, after: 0 }, children: [] }),
    createSubheaderBanner('REFERÊNCIAS NORMATIVAS APLICÁVEIS', AlignmentType.CENTER),
    new Paragraph({
      spacing: { before: 30, after: 20 },
      children: [
        new TextRun({
          text: 'Documentos indispensáveis à aplicação deste documento (edições mais recentes e emendas vigentes):',
          size: 15,
          color: '475569',
          font: 'Arial',
        }),
      ],
    })
  );

  (texts.referenciasNormativas || []).forEach((norma) => {
    docChildren.push(
      new Paragraph({
        indent: { left: 180 },
        spacing: { before: 10, after: 15 },
        children: [
          new TextRun({ text: '• ', bold: true, size: 16, color: 'D9383A', font: 'Arial' }),
          new TextRun({ text: norma, size: 15, color: '1E293B', font: 'Arial' }),
        ],
      })
    );
  });

  // 2) DICIONÁRIO E ABREVIATURAS USADAS NESTE DOCUMENTO (EM 2 COLUNAS)
  docChildren.push(
    new Paragraph({ spacing: { before: 80, after: 0 }, children: [] }),
    createSubheaderBanner('2) DICIONÁRIO E ABREVIATURAS USADAS NESTE DOCUMENTO', AlignmentType.CENTER)
  );

  const dictItems = (texts.dicionario || []).slice(0, 8);
  const dictRows: TableRow[] = [];

  for (let i = 0; i < dictItems.length; i += 2) {
    const leftItem = dictItems[i];
    const rightItem = dictItems[i + 1];

    const isEven = Math.floor(i / 2) % 2 === 0;
    const bgFill = isEven ? 'F8FAFC' : 'FFFFFF';

    dictRows.push(
      new TableRow({
        children: [
          new TableCell({
            width: { size: Math.floor(TOTAL_WIDTH_TWIPS / 2), type: WidthType.DXA },
            shading: { fill: bgFill, type: ShadingType.CLEAR },
            margins: { top: 40, bottom: 40, left: 80, right: 80 },
            borders: BORDER_NONE_OBJ,
            children: [
              new Paragraph({
                children: [
                  new TextRun({ text: `${leftItem.termo}: `, bold: true, size: 14, color: '0F172A', font: 'Arial' }),
                  new TextRun({ text: leftItem.definicao, size: 14, color: '334155', font: 'Arial' }),
                ],
              }),
            ],
          }),
          new TableCell({
            width: { size: Math.floor(TOTAL_WIDTH_TWIPS / 2), type: WidthType.DXA },
            shading: { fill: bgFill, type: ShadingType.CLEAR },
            margins: { top: 40, bottom: 40, left: 80, right: 80 },
            borders: BORDER_NONE_OBJ,
            children: rightItem
              ? [
                  new Paragraph({
                    children: [
                      new TextRun({ text: `${rightItem.termo}: `, bold: true, size: 14, color: '0F172A', font: 'Arial' }),
                      new TextRun({ text: rightItem.definicao, size: 14, color: '334155', font: 'Arial' }),
                    ],
                  }),
                ]
              : [new Paragraph({ children: [] })],
          }),
        ],
      })
    );
  }

  docChildren.push(
    new Table({
      width: { size: TOTAL_WIDTH_TWIPS, type: WidthType.DXA },
      rows: dictRows,
    })
  );

  // Nota CREA
  docChildren.push(
    new Paragraph({ spacing: { before: 80, after: 0 }, children: [] }),
    createHighlightBox(
      'CREA – CONSELHO REGIONAL DE ENGENHARIA E AGRONOMIA',
      'Inspeção realizada por engenheiro legalmente habilitado, com registro ativo e emissão da ART correspondente, assegurando o rigor técnico e legalidade das medições.'
    )
  );

  // Quebra para Página 3
  docChildren.push(new Paragraph({ children: [new PageBreak()] }));

  // =========================================================================
  // PÁGINA 3: CARACTERÍSTICAS DA EDIFICAÇÃO & VISTA AÉREA EM DESTAQUE
  // =========================================================================
  docChildren.push(createSectionHeader('3) CARACTERÍSTICAS DA EDIFICAÇÃO & LOCAL'));

  const rawLocDesc = (client.descricaoBloco || texts.caracteristicasLocal || '').trim();
  if (rawLocDesc && !/^(?:torre\s*\d+|torre\s*\/\s*estrutura|estrutura\s*\/\s*torre)$/i.test(rawLocDesc)) {
    docChildren.push(
      new Paragraph({
        spacing: { before: 20, after: 80 },
        children: [new TextRun({ text: rawLocDesc, size: 16, color: '1E293B', font: 'Arial' })],
      })
    );
  }

  // 3.1) VISTA AÉREA
  docChildren.push(createSubheaderBanner('3.1) VISTA AÉREA DA EDIFICAÇÃO / IMAGEM SATÉLITE'));

  if (localJpegs[0]) {
    try {
      const aereaBytes = dataUrlToUint8Array(localJpegs[0]);
      docChildren.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 80, after: 40 },
          children: [
            new ImageRun({
              data: aereaBytes,
              transformation: { width: 500, height: 260 },
              type: 'jpg',
            }),
          ],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 0, after: 100 },
          children: [
            new TextRun({
              text: localPhotos[0]?.caption || 'Vista aérea da edificação, circunvizinhança e posicionamento geográfico do condomínio.',
              bold: true,
              size: 15,
              color: '334155',
              font: 'Arial',
            }),
          ],
        })
      );
    } catch (e) {
      console.warn('Erro ao inserir foto aérea no docx:', e);
    }
  }

  // PARÂMETROS CONSTRUTIVOS
  docChildren.push(createSubheaderBanner('PARÂMETROS CONSTRUTIVOS & INFRAESTRUTURA DA EDIFICAÇÃO (NBR 5419)'));

  const parametrosRows: Array<[string, string]> = [
    ['Tipologia Construtiva:', 'Alvenaria Convencional / Estrutura em Concreto Armado'],
    ['Topografia & Entorno:', 'Terreno Urbano Plano com Edificações Vizinhas'],
    ['Nível de Proteção Dimensionado:', 'Nível III / IV (NBR 5419-2 - Gerenciamento de Risco)'],
    ['Métodos de Proteção Aplicáveis:', 'Ângulo de Proteção (Franklin) e Condutores em Malha (Faraday)'],
  ];

  docChildren.push(createZebraTable(parametrosRows, 3500));

  // Quebra para Página 4
  docChildren.push(new Paragraph({ children: [new PageBreak()] }));

  // =========================================================================
  // PÁGINA 4: FACHADA PRINCIPAL EM GRANDE DESTAQUE & 4) HISTÓRICO
  // =========================================================================
  docChildren.push(createSubheaderBanner('3.2) FACHADA PRINCIPAL DA EDIFICAÇÃO / CONDOMÍNIO'));

  if (localJpegs[1]) {
    try {
      const fachadaBytes = dataUrlToUint8Array(localJpegs[1]);
      docChildren.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 80, after: 40 },
          children: [
            new ImageRun({
              data: fachadaBytes,
              transformation: { width: 500, height: 260 },
              type: 'jpg',
            }),
          ],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 0, after: 80 },
          children: [
            new TextRun({
              text: localPhotos[1]?.caption || 'Fachada principal da edificação, estrutura predial e acessos vistoriados.',
              bold: true,
              size: 15,
              color: '334155',
              font: 'Arial',
            }),
          ],
        })
      );
    } catch (e) {
      console.warn('Erro ao inserir foto da fachada no docx:', e);
    }
  }

  // 3.3 Foto de Entrada (se existir)
  if (localJpegs[2]) {
    docChildren.push(createSubheaderBanner('3.3) ENTRADA / ACESSO PRINCIPAL'));
    try {
      const entradaBytes = dataUrlToUint8Array(localJpegs[2]);
      docChildren.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 60, after: 30 },
          children: [
            new ImageRun({
              data: entradaBytes,
              transformation: { width: 420, height: 180 },
              type: 'jpg',
            }),
          ],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 0, after: 60 },
          children: [
            new TextRun({
              text: localPhotos[2]?.caption || 'Portaria e acesso principal à edificação.',
              bold: true,
              size: 14,
              color: '334155',
              font: 'Arial',
            }),
          ],
        })
      );
    } catch (e) {
      console.warn('Erro ao inserir foto da portaria:', e);
    }
  }

  // Texto de Ramo de atividade e nível de exposição
  const exposicaoText = `A edificação é de uso ${client.ramoAtividade} com presença de moradores e equipamentos eletrônicos e está localizada numa área de ${client.exposicaoNivel || 'baixa EXPOSIÇÃO'} a descargas atmosféricas e seus efeitos indiretos.`;
  docChildren.push(
    new Paragraph({
      spacing: { before: 40, after: 80 },
      children: [new TextRun({ text: exposicaoText, size: 16, color: '1E293B', font: 'Arial' })],
    })
  );

  // 4) HISTÓRICO DE OCORRÊNCIAS
  docChildren.push(createSectionHeader('4) HISTÓRICO DE OCORRÊNCIAS & DESCARGAS ATMOSFÉRICAS'));

  const hist1 = `4.1- Histórico: Conforme informações obtidas durante a vistoria, ${client.historicoQueimaOcorrencias || texts.historicoItem4_1}`;
  const hist2 = `4.2- A ocorrência de problemas com equipamentos se deve ao fato de descargas nas proximidades gerarem pulsos eletromagnéticos que viajam pela rede elétrica sem blindagem suficiente. Com isso, é indispensável a instalação de supressores de surtos (DPS) coordenados nos quadros de distribuição.`;

  docChildren.push(
    new Paragraph({
      spacing: { before: 20, after: 40 },
      children: [new TextRun({ text: hist1, size: 16, color: '1E293B', font: 'Arial' })],
    }),
    new Paragraph({
      spacing: { before: 20, after: 80 },
      children: [new TextRun({ text: hist2, size: 16, color: '1E293B', font: 'Arial' })],
    })
  );

  // Quebra para Página 5 (Vistoria do SPDA)
  docChildren.push(new Paragraph({ children: [new PageBreak()] }));

  // =========================================================================
  // PÁGINA 5: 5) VISTORIA DO SPDA EXISTENTE & PARECER VISUAL
  // =========================================================================
  docChildren.push(createSectionHeader('5) VISTORIA DO SPDA EXISTENTE & PARECER VISUAL'));

  if (texts.vistoriaSpdaTexto) {
    docChildren.push(
      new Paragraph({
        spacing: { before: 20, after: 60 },
        children: [new TextRun({ text: texts.vistoriaSpdaTexto, size: 16, color: '1E293B', font: 'Arial' })],
      })
    );
  }

  // Divisão das fotos do SPDA em blocos de até 16 fotos por página
  const spdaChunks = chunkArray(spdaPhotos, 16);
  const spdaJpegChunks = chunkArray(spdaJpegs, 16);

  if (spdaPhotos.length === 0) {
    // Sem fotos: Análise Pericial e Avaliação dos 4 Subsistemas
    docChildren.push(createHighlightBox('ANÁLISE PERICIAL DA INSPEÇÃO VISUAL IN LOCO:', texts.vistoriaSpdaAnalise));
    docChildren.push(new Paragraph({ spacing: { before: 80, after: 0 }, children: [] }));
  } else {
    // Primeira página de fotos do SPDA
    docChildren.push(createPhotoGridTable(spdaChunks[0] || [], spdaJpegChunks[0] || [], isMultiTower, false));

    // Páginas de continuação se houver mais de 16 fotos
    for (let pIdx = 1; pIdx < spdaChunks.length; pIdx++) {
      docChildren.push(
        new Paragraph({ children: [new PageBreak()] }),
        createSectionHeader('5) VISTORIA DO SPDA EXISTENTE (CONTINUAÇÃO)'),
        createPhotoGridTable(spdaChunks[pIdx] || [], spdaJpegChunks[pIdx] || [], isMultiTower, false)
      );
    }

    docChildren.push(
      new Paragraph({ spacing: { before: 80, after: 0 }, children: [] }),
      createHighlightBox('ANÁLISE PERICIAL DA INSPEÇÃO VISUAL IN LOCO:', texts.vistoriaSpdaAnalise),
      new Paragraph({ spacing: { before: 80, after: 0 }, children: [] })
    );
  }

  // Tabela dos 4 Subsistemas Vistoriados
  docChildren.push(createSubheaderBanner('AVALIAÇÃO ESTRUTURAL DOS SUBSISTEMAS DO SPDA (NBR 5419)'));

  const subsistemasData = [
    {
      item: 'Subsistema de Captação',
      desc: conditions.subCapitacaoDesc || 'Mastros, pontas captoras Franklin, fitas de alumínio e suportes de fixação.',
      status: conditions.subCapitacaoStatus || (conditions.temPontosACorrigir ? 'REQUER AJUSTES' : 'CONFORME'),
    },
    {
      item: 'Subsistema de Descida',
      desc: conditions.subDescidaDesc || 'Fitas de descida, espaçamento normativo, curvas e fixações mecânicas.',
      status: conditions.subDescidaStatus || (conditions.temPontosACorrigir ? 'REQUER AJUSTES' : 'CONFORME'),
    },
    {
      item: 'Subsistema de Aterramento',
      desc: conditions.subAterramentoDesc || 'Caixas de equalização e inspeção, anel perimetral e hastes cobreadas.',
      status: conditions.subAterramentoStatus || (conditions.caixasInspecaoLimpas ? 'CONFORME' : 'NÃO CONFORME'),
    },
    {
      item: 'Equipotencialização Metálica',
      desc: conditions.subEquipotencializacaoDesc || 'Interligação de massas metálicas da cobertura, rufos e estruturas.',
      status: conditions.subEquipotencializacaoStatus || (conditions.temPontosACorrigir ? 'REQUER AJUSTES' : 'CONFORME'),
    },
  ];

  const subRows = subsistemasData.map((sub, sIdx) => {
    const isEven = sIdx % 2 === 0;
    const isConforme = sub.status === 'CONFORME';
    const isRequer = sub.status === 'REQUER AJUSTES';
    const statusColor = isConforme ? '15803D' : isRequer ? 'B45309' : 'DC2626';

    return new TableRow({
      children: [
        new TableCell({
          width: { size: 3000, type: WidthType.DXA },
          shading: { fill: isEven ? 'FAFAFA' : 'FFFFFF', type: ShadingType.CLEAR },
          margins: { top: 50, bottom: 50, left: 80, right: 80 },
          borders: {
            top: NO_BORDER,
            left: NO_BORDER,
            right: NO_BORDER,
            bottom: { style: BorderStyle.SINGLE, size: 1, color: 'E2E8F0' },
          },
          children: [
            new Paragraph({
              children: [new TextRun({ text: sub.item, bold: true, size: 16, color: '0F172A', font: 'Arial' })],
            }),
          ],
        }),
        new TableCell({
          width: { size: TOTAL_WIDTH_TWIPS - 5200, type: WidthType.DXA },
          shading: { fill: isEven ? 'FAFAFA' : 'FFFFFF', type: ShadingType.CLEAR },
          margins: { top: 50, bottom: 50, left: 80, right: 80 },
          borders: {
            top: NO_BORDER,
            left: NO_BORDER,
            right: NO_BORDER,
            bottom: { style: BorderStyle.SINGLE, size: 1, color: 'E2E8F0' },
          },
          children: [
            new Paragraph({
              children: [new TextRun({ text: sub.desc, size: 15, color: '475569', font: 'Arial' })],
            }),
          ],
        }),
        new TableCell({
          width: { size: 2200, type: WidthType.DXA },
          shading: { fill: isEven ? 'FAFAFA' : 'FFFFFF', type: ShadingType.CLEAR },
          margins: { top: 50, bottom: 50, left: 80, right: 80 },
          borders: {
            top: NO_BORDER,
            left: NO_BORDER,
            right: NO_BORDER,
            bottom: { style: BorderStyle.SINGLE, size: 1, color: 'E2E8F0' },
          },
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: sub.status, bold: true, size: 15, color: statusColor, font: 'Arial' })],
            }),
          ],
        }),
      ],
    });
  });

  docChildren.push(
    new Table({
      width: { size: TOTAL_WIDTH_TWIPS, type: WidthType.DXA },
      rows: subRows,
    })
  );

  // Quebra para Seção 6 (Medições)
  docChildren.push(new Paragraph({ children: [new PageBreak()] }));

  // =========================================================================
  // PÁGINA 6: 6) MEDIÇÕES DE CONTINUIDADE OHMICA DOS CONDUTORES
  // =========================================================================
  docChildren.push(createSectionHeader('6) MEDIÇÕES DE CONTINUIDADE OHMICA DOS CONDUTORES'));

  if (texts.medicoesContinuidadeTexto) {
    docChildren.push(
      new Paragraph({
        spacing: { before: 20, after: 60 },
        children: [new TextRun({ text: texts.medicoesContinuidadeTexto, size: 16, color: '1E293B', font: 'Arial' })],
      })
    );
  }

  // Caixa do Miliohmímetro (Foto + Dados Técnicos)
  const equipSpecsParagraphs = [
    new Paragraph({
      children: [
        new TextRun({
          text: `Miliohmímetro ${texts.equipamentoModelo} - ${texts.equipamentoMarca}`,
          bold: true,
          size: 17,
          color: '0F172A',
          font: 'Arial',
        }),
      ],
    }),
    new Paragraph({
      spacing: { before: 20, after: 20 },
      children: [new TextRun({ text: texts.equipamentoDescricao, size: 15, color: '475569', font: 'Arial' })],
    }),
    new Paragraph({
      spacing: { before: 10, after: 10 },
      children: [
        new TextRun({ text: 'Local: ', bold: true, size: 15, color: '0F172A', font: 'Arial' }),
        new TextRun({ text: texts.medicoesLocal, size: 15, color: '334155', font: 'Arial' }),
      ],
    }),
    new Paragraph({
      spacing: { before: 10, after: 10 },
      children: [
        new TextRun({ text: 'Corrente de Ensaio: ', bold: true, size: 15, color: '0F172A', font: 'Arial' }),
        new TextRun({ text: texts.medicoesCorrenteAplicada, size: 15, color: '334155', font: 'Arial' }),
      ],
    }),
    new Paragraph({
      spacing: { before: 10, after: 0 },
      children: [
        new TextRun({ text: 'Tipo de Corrente: ', bold: true, size: 15, color: '0F172A', font: 'Arial' }),
        new TextRun({ text: texts.medicoesTipoCorrente, size: 15, color: '334155', font: 'Arial' }),
      ],
    }),
  ];

  if (equipmentJpeg) {
    try {
      const eqBytes = dataUrlToUint8Array(equipmentJpeg);
      docChildren.push(
        new Table({
          width: { size: TOTAL_WIDTH_TWIPS, type: WidthType.DXA },
          borders: BORDER_LIGHT_OBJ,
          rows: [
            new TableRow({
              children: [
                new TableCell({
                  width: { size: 3800, type: WidthType.DXA },
                  shading: { fill: 'F8FAFC', type: ShadingType.CLEAR },
                  margins: { top: 60, bottom: 60, left: 60, right: 60 },
                  verticalAlign: VerticalAlign.CENTER,
                  borders: BORDER_NONE_OBJ,
                  children: [
                    new Paragraph({
                      alignment: AlignmentType.CENTER,
                      children: [
                        new ImageRun({
                          data: eqBytes,
                          transformation: { width: 190, height: 135 },
                          type: 'jpg',
                        }),
                      ],
                    }),
                  ],
                }),
                new TableCell({
                  width: { size: TOTAL_WIDTH_TWIPS - 3800, type: WidthType.DXA },
                  shading: { fill: 'F8FAFC', type: ShadingType.CLEAR },
                  margins: { top: 80, bottom: 80, left: 100, right: 100 },
                  borders: BORDER_NONE_OBJ,
                  children: equipSpecsParagraphs,
                }),
              ],
            }),
          ],
        })
      );
    } catch {
      docChildren.push(createHighlightBox('INSTRUMENTO DE MEDIÇÃO:', texts.equipamentoDescricao));
    }
  } else {
    docChildren.push(
      new Table({
        width: { size: TOTAL_WIDTH_TWIPS, type: WidthType.DXA },
        borders: BORDER_LIGHT_OBJ,
        rows: [
          new TableRow({
            children: [
              new TableCell({
                width: { size: TOTAL_WIDTH_TWIPS, type: WidthType.DXA },
                shading: { fill: 'F8FAFC', type: ShadingType.CLEAR },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                children: equipSpecsParagraphs,
              }),
            ],
          }),
        ],
      })
    );
  }

  docChildren.push(new Paragraph({ spacing: { before: 80, after: 0 }, children: [] }));

  // PARÂMETROS NORMATIVOS DE CONTINUIDADE
  docChildren.push(createSubheaderBanner('PARÂMETROS NORMATIVOS DE CONTINUIDADE (ABNT NBR 5419/2018)'));

  const criteriosData = [
    {
      criterio: 'Continuidade de Armaduras e Malhas',
      norma: 'NBR 5419-3:2018 (Item 5.3.5)',
      limite: '≤ 0,200 Ω (200 mΩ)',
      status: conditions.continuidadeAprovada ? 'CONFORME' : 'ATENÇÃO',
    },
    {
      criterio: 'Resistência de Equipotencialização',
      norma: 'NBR 5419-3:2018 (Item 6.2)',
      limite: '≤ 0,200 Ω (200 mΩ)',
      status: 'CONFORME',
    },
    {
      criterio: 'Método de 4 Terminais (Kelvin)',
      norma: 'Injeção de corrente DC contínua',
      limite: 'Min. 1,0 A sob 4 fios',
      status: 'APLICADO',
    },
    {
      criterio: 'Estado Físico das Caixas de Inspeção',
      norma: 'Aterramento & Equalização',
      limite: 'Desobstruídas e secas',
      status: conditions.caixasInspecaoLimpas ? 'CONFORME' : 'LIMPEZA PENDENTE',
    },
  ];

  const critRows = criteriosData.map((crit, cIdx) => {
    const isEven = cIdx % 2 === 0;
    const isGood = crit.status === 'CONFORME' || crit.status === 'APLICADO';
    const statusColor = isGood ? '15803D' : 'DC2626';

    return new TableRow({
      children: [
        new TableCell({
          width: { size: 3600, type: WidthType.DXA },
          shading: { fill: isEven ? 'FAFAFA' : 'FFFFFF', type: ShadingType.CLEAR },
          margins: { top: 40, bottom: 40, left: 80, right: 80 },
          borders: {
            top: NO_BORDER,
            left: NO_BORDER,
            right: NO_BORDER,
            bottom: { style: BorderStyle.SINGLE, size: 1, color: 'E2E8F0' },
          },
          children: [
            new Paragraph({
              children: [new TextRun({ text: crit.criterio, bold: true, size: 14, color: '0F172A', font: 'Arial' })],
            }),
          ],
        }),
        new TableCell({
          width: { size: 2600, type: WidthType.DXA },
          shading: { fill: isEven ? 'FAFAFA' : 'FFFFFF', type: ShadingType.CLEAR },
          margins: { top: 40, bottom: 40, left: 80, right: 80 },
          borders: {
            top: NO_BORDER,
            left: NO_BORDER,
            right: NO_BORDER,
            bottom: { style: BorderStyle.SINGLE, size: 1, color: 'E2E8F0' },
          },
          children: [
            new Paragraph({
              children: [new TextRun({ text: crit.norma, size: 14, color: '475569', font: 'Arial' })],
            }),
          ],
        }),
        new TableCell({
          width: { size: 2000, type: WidthType.DXA },
          shading: { fill: isEven ? 'FAFAFA' : 'FFFFFF', type: ShadingType.CLEAR },
          margins: { top: 40, bottom: 40, left: 80, right: 80 },
          borders: {
            top: NO_BORDER,
            left: NO_BORDER,
            right: NO_BORDER,
            bottom: { style: BorderStyle.SINGLE, size: 1, color: 'E2E8F0' },
          },
          children: [
            new Paragraph({
              children: [new TextRun({ text: crit.limite, bold: true, size: 14, color: '0F172A', font: 'Arial' })],
            }),
          ],
        }),
        new TableCell({
          width: { size: 1438, type: WidthType.DXA },
          shading: { fill: isEven ? 'FAFAFA' : 'FFFFFF', type: ShadingType.CLEAR },
          margins: { top: 40, bottom: 40, left: 80, right: 80 },
          borders: {
            top: NO_BORDER,
            left: NO_BORDER,
            right: NO_BORDER,
            bottom: { style: BorderStyle.SINGLE, size: 1, color: 'E2E8F0' },
          },
          children: [
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [new TextRun({ text: crit.status, bold: true, size: 14, color: statusColor, font: 'Arial' })],
            }),
          ],
        }),
      ],
    });
  });

  docChildren.push(
    new Table({
      width: { size: TOTAL_WIDTH_TWIPS, type: WidthType.DXA },
      rows: critRows,
    })
  );

  docChildren.push(new Paragraph({ spacing: { before: 80, after: 0 }, children: [] }));

  // Grade de Fotos dos Pontos de Medição (até 8 na página principal, continuação se houver mais)
  const measurePage1 = measurementPhotos.slice(0, 8);
  const measureJpegsPage1 = measurementJpegs.slice(0, 8);
  const measureRestantes = measurementPhotos.slice(8);
  const measureJpegsRestantes = measurementJpegs.slice(8);
  const measureContChunks = chunkArray(measureRestantes, 16);
  const measureContJpegChunks = chunkArray(measureJpegsRestantes, 16);

  if (measurePage1.length > 0) {
    docChildren.push(
      createSubheaderBanner('6.1) PONTOS DE MEDIÇÃO DE CONTINUIDADE OBTIDOS'),
      createPhotoGridTable(measurePage1, measureJpegsPage1, isMultiTower, true, 140)
    );

    // Páginas de Continuação de Medições se houver
    for (let cIdx = 0; cIdx < measureContChunks.length; cIdx++) {
      docChildren.push(
        new Paragraph({ children: [new PageBreak()] }),
        createSectionHeader('6.1) PONTOS DE MEDIÇÃO (CONTINUAÇÃO)'),
        createPhotoGridTable(measureContChunks[cIdx] || [], measureContJpegChunks[cIdx] || [], isMultiTower, true, 165)
      );
    }
  } else {
    docChildren.push(
      createSubheaderBanner('METODOLOGIA DE 4 TERMINAIS (KELVIN) E PONTOS DE ENSAIO'),
      createZebraTable([
        ['1. Malha de Captação para Descidas Principais', 'Ensaio a 4 fios com injeção DC contínua [CONFORME]'],
        ['2. Descidas para Caixas de Equalização / BEP', 'Conexões mecânicas ensaiadas sob carga [CONFORME]'],
        ['3. Malha de Aterramento para Estruturas Metálicas', 'Equipotencialização de massas da edificação [CONFORME]'],
      ])
    );
  }

  // Quebra para Seção 7 (Quadros com DPS)
  docChildren.push(new Paragraph({ children: [new PageBreak()] }));

  // =========================================================================
  // PÁGINA 7: 7) ANÁLISE DOS QUADROS DE ENERGIA & PROTEÇÃO CONTRA SURTOS (DPS)
  // =========================================================================
  docChildren.push(createSectionHeader('7) ANÁLISE DOS QUADROS DE ENERGIA & PROTEÇÃO CONTRA SURTOS (DPS)'));

  if (texts.pontosInspecaoAvaliacao) {
    docChildren.push(
      new Paragraph({
        spacing: { before: 20, after: 40 },
        children: [new TextRun({ text: texts.pontosInspecaoAvaliacao, size: 16, color: '1E293B', font: 'Arial' })],
      })
    );
  }

  docChildren.push(createSubheaderBanner('Avaliação dos Dispositivos de Proteção contra Surtos (DPS) - NBR 5410', AlignmentType.CENTER));

  if (texts.analiseQuadrosTexto) {
    docChildren.push(
      new Paragraph({
        spacing: { before: 40, after: 60 },
        children: [new TextRun({ text: texts.analiseQuadrosTexto, size: 15, color: '334155', font: 'Arial' })],
      })
    );
  }

  const quadrosPage1 = quadrosPhotos.slice(0, 16);
  const quadrosJpegsPage1 = quadrosJpegs.slice(0, 16);
  const quadrosRestantes = quadrosPhotos.slice(16);
  const quadrosJpegsRestantes = quadrosJpegs.slice(16);
  const quadrosContChunks = chunkArray(quadrosRestantes, 16);
  const quadrosContJpegChunks = chunkArray(quadrosJpegsRestantes, 16);

  if (quadrosPage1.length > 0) {
    docChildren.push(
      createSubheaderBanner('REGISTROS FOTOGRÁFICOS DOS QUADROS DE ENERGIA'),
      createPhotoGridTable(quadrosPage1, quadrosJpegsPage1, isMultiTower, false, 150)
    );

    // Páginas de continuação dos quadros se houver mais de 16 fotos
    for (let cIdx = 0; cIdx < quadrosContChunks.length; cIdx++) {
      docChildren.push(
        new Paragraph({ children: [new PageBreak()] }),
        createSectionHeader('7) ANÁLISE DOS QUADROS DE ENERGIA (CONTINUAÇÃO)'),
        createPhotoGridTable(quadrosContChunks[cIdx] || [], quadrosContJpegChunks[cIdx] || [], isMultiTower, false, 165)
      );
    }
  } else {
    docChildren.push(
      new Paragraph({
        spacing: { before: 30, after: 30 },
        children: [
          new TextRun({
            text: '(Nenhum registro fotográfico dos quadros de distribuição anexado nesta vistoria).',
            italics: true,
            size: 15,
            color: '64748B',
            font: 'Arial',
          }),
        ],
      })
    );
  }

  // Parecer Técnico dos Quadros
  if (texts.analiseQuadrosConclusao) {
    docChildren.push(
      new Paragraph({ spacing: { before: 80, after: 0 }, children: [] }),
      createHighlightBox('PARECER TÉCNICO SOBRE OS DISPOSITIVOS DPS E BARRAMENTOS:', texts.analiseQuadrosConclusao)
    );
  }

  // Quebra para Página Final (Recomendações, Conclusão & Assinatura)
  docChildren.push(new Paragraph({ children: [new PageBreak()] }));

  // =========================================================================
  // PÁGINA FINAL: RECOMENDAÇÕES PRIORITÁRIAS, CONCLUSÃO & ASSINATURA DIGITAL
  // =========================================================================
  docChildren.push(createSectionHeader('8) CORREÇÕES NECESSÁRIAS PARA PROTEÇÃO DAS EDIFICAÇÕES'));

  docChildren.push(createSubheaderBanner('Recomendações Técnicas Prioritárias (NBR 5419:2018)', AlignmentType.CENTER));

  (texts.recomendacoes || []).forEach((rec, rIdx) => {
    docChildren.push(
      new Paragraph({
        spacing: { before: 20, after: 20 },
        children: [
          new TextRun({
            text: `8.${rIdx + 1}- `,
            bold: true,
            size: 15,
            color: 'DC2626', // Vermelho oficial
            font: 'Arial',
          }),
          new TextRun({
            text: rec,
            size: 15,
            color: 'DC2626',
            font: 'Arial',
          }),
        ],
      })
    );
  });

  if (texts.recomendacoesTextoFinal) {
    docChildren.push(
      new Paragraph({
        spacing: { before: 40, after: 80 },
        children: [
          new TextRun({
            text: texts.recomendacoesTextoFinal,
            bold: true,
            size: 16,
            color: 'DC2626',
            font: 'Arial',
          }),
        ],
      })
    );
  }

  // 9) CONCLUSÃO TÉCNICA FINAL
  docChildren.push(createSectionHeader('9) CONCLUSÃO FINAL DESTE RELATÓRIO TÉCNICO'));

  if (texts.conclusaoFinal) {
    docChildren.push(
      new Paragraph({
        spacing: { before: 20, after: 80 },
        children: [new TextRun({ text: texts.conclusaoFinal, size: 16, color: '1E293B', font: 'Arial' })],
      })
    );
  }

  // DISPOSIÇÕES FINAIS & VALIDADE DA INSPEÇÃO
  docChildren.push(
    createHighlightBox(
      'DISPOSIÇÕES FINAIS & VALIDADE DA INSPEÇÃO:',
      'Este laudo possui validade técnica de 1 (um) ano a partir da data de emissão, ou conforme periodicidade de inspeção estipulada pela NBR 5419-3:2018 (Tabela 6). O responsável técnico declara que todas as medições foram efetuadas conforme os preceitos éticos e regulamentares do CREA.'
    )
  );

  // Cidade e Data
  docChildren.push(
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { before: 60, after: 120 },
      children: [
        new TextRun({
          text: `${client.cidadeEmissao || 'São José dos Campos'}, ${client.dataEmissaoExtenso || 'emissão com ART'}.`,
          bold: true,
          size: 17,
          color: '0F172A',
          font: 'Arial',
        }),
      ],
    })
  );

  // =========================================================================
  // ASSINATURA DIGITAL CENTRALIZADA & SELO DE CERTIFICAÇÃO CREA
  // =========================================================================
  const sig = report.digitalSignature;
  const isSigEnabled = sig?.enabled ?? false;
  const signerName = sig?.signerName || client.tecnico || 'Engenheiro Eletricista Responsável';
  const signerRole = sig?.signerRole || client.cargo || 'Engenheiro Eletricista';
  const signerCrea = sig?.signerCrea || client.crea || 'CREA-SP';
  const signerArt = sig?.signerArt || client.art || '';

  if (isSigEnabled && signatureJpeg) {
    // Imagem da Assinatura Digital
    try {
      const sigBytes = dataUrlToUint8Array(signatureJpeg);
      docChildren.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 40, after: 20 },
          children: [
            new ImageRun({
              data: sigBytes,
              transformation: { width: 175, height: 58 },
              type: 'jpg',
            }),
          ],
        })
      );
    } catch (e) {
      console.warn('Erro ao inserir assinatura no docx:', e);
    }
  } else if (isSigEnabled) {
    // Assinatura digital estilizada em texto
    docChildren.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 60, after: 20 },
        children: [
          new TextRun({
            text: signerName,
            italics: true,
            bold: true,
            size: 24, // 12pt
            color: '1E3A8A', // Blue 900
            font: 'Georgia',
          }),
        ],
      })
    );
  }

  // Linha de Assinatura Centralizada e Dados do Engenheiro
  docChildren.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 20 },
      children: [
        new TextRun({
          text: '________________________________________________',
          bold: true,
          size: 18,
          color: '0F172A',
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 10 },
      children: [
        new TextRun({
          text: signerName,
          bold: true,
          size: 18, // 9pt
          color: '0F172A',
          font: 'Arial',
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 10 },
      children: [
        new TextRun({
          text: signerRole,
          size: 16, // 8pt
          color: '475569',
          font: 'Arial',
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 100 },
      children: [
        new TextRun({
          text: signerArt ? `${signerCrea} | ART: ${signerArt}` : signerCrea,
          bold: true,
          size: 16, // 8pt
          color: '0F172A',
          font: 'Arial',
        }),
      ],
    })
  );

  // Selo de Autenticação Digital e Validação ICP / CREA
  if (isSigEnabled && sig?.showValidationStamp) {
    const certTable = new Table({
      width: { size: 6800, type: WidthType.DXA },
      alignment: AlignmentType.CENTER,
      borders: {
        top: { style: BorderStyle.SINGLE, size: 2, color: '2563EB' },
        bottom: { style: BorderStyle.SINGLE, size: 2, color: '2563EB' },
        left: { style: BorderStyle.SINGLE, size: 2, color: '2563EB' },
        right: { style: BorderStyle.SINGLE, size: 2, color: '2563EB' },
      },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              width: { size: 6800, type: WidthType.DXA },
              shading: { fill: 'F8FAFC', type: ShadingType.CLEAR },
              margins: { top: 80, bottom: 80, left: 120, right: 120 },
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: '✓ CERTIFICAÇÃO DIGITAL - PADRÃO CREA / NBR 5419:2018',
                      bold: true,
                      size: 15,
                      color: '1E3A8A',
                      font: 'Arial',
                    }),
                  ],
                }),
                new Paragraph({
                  spacing: { before: 20, after: 10 },
                  children: [
                    new TextRun({
                      text: `Signatário: ${signerName} (${signerCrea})`,
                      size: 14,
                      color: '334155',
                      font: 'Arial',
                    }),
                  ],
                }),
                new Paragraph({
                  spacing: { before: 0, after: 10 },
                  children: [
                    new TextRun({
                      text: `Data/Hora: ${sig.signedAt || client.dataEmissaoExtenso || 'Registrado com ART'}${signerArt ? ` • ART: ${signerArt}` : ''}`,
                      size: 14,
                      color: '334155',
                      font: 'Arial',
                    }),
                  ],
                }),
                new Paragraph({
                  spacing: { before: 0, after: 0 },
                  children: [
                    new TextRun({
                      text: `Hash SHA-256: ${sig.hashSha256 || 'VALID-SIGNATURE'}`,
                      bold: true,
                      size: 13,
                      color: '64748B',
                      font: 'Courier New',
                    }),
                  ],
                }),
              ],
            }),
          ],
        }),
      ],
    });

    docChildren.push(certTable);
  }

  // =========================================================================
  // CABEÇALHO IDÊNTICO AO PDF:
  // 1. Marca D'água diagonal no meio exato da tela em segundo plano
  // 2. Logo oficial no topo direito (máx 45mm x 18mm), sem textos extras nem bordas
  // =========================================================================
  const headerChildren: Paragraph[] = [];

  // 1. Marca D'água diagonal no meio exato da tela (renderizada em todas as páginas atrás do conteúdo)
  if (watermarkPng) {
    try {
      const wmBytes = dataUrlToUint8Array(watermarkPng);
      headerChildren.push(
        new Paragraph({
          children: [
            new ImageRun({
              data: wmBytes,
              transformation: {
                width: 595, // 210mm a 72 pt = 595 pt
                height: 842, // 297mm a 72 pt = 842 pt
              },
              type: 'png',
              floating: {
                horizontalPosition: {
                  relative: HorizontalPositionRelativeFrom.PAGE,
                  align: HorizontalPositionAlign.CENTER,
                },
                verticalPosition: {
                  relative: VerticalPositionRelativeFrom.PAGE,
                  align: VerticalPositionAlign.CENTER,
                },
                wrap: {
                  type: TextWrappingType.NONE,
                },
                behindDocument: true,
                allowOverlap: true,
              },
            }),
          ],
        })
      );
    } catch (e) {
      console.warn('Erro ao inserir marca d\'água no cabeçalho docx:', e);
    }
  }

  // 2. Logo Oficial no Topo Direito (máx 45mm x 18mm, alinhado à direita, exatamente como no PDF)
  if (headerLogoLayout?.dataUrl) {
    try {
      const logoBytes = dataUrlToUint8Array(headerLogoLayout.dataUrl);
      const renderWidthPx = Math.round(headerLogoLayout.width * 3.78);
      const renderHeightPx = Math.round(headerLogoLayout.height * 3.78);

      headerChildren.push(
        new Paragraph({
          alignment: AlignmentType.RIGHT,
          spacing: { before: 0, after: 80 },
          children: [
            new ImageRun({
              data: logoBytes,
              transformation: {
                width: renderWidthPx,
                height: renderHeightPx,
              },
              type: 'png',
            }),
          ],
        })
      );
    } catch {
      headerChildren.push(
        new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [new TextRun({ text: company.name || 'SJC ENGENHARIA', bold: true, size: 16, color: '0F172A' })],
        })
      );
    }
  } else {
    headerChildren.push(
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [new TextRun({ text: company.name || 'SJC ENGENHARIA', bold: true, size: 16, color: '0F172A' })],
      })
    );
  }

  // =========================================================================
  // RODAPÉ IDÊNTICO AO PDF E PREVIEW:
  // - Linha preta superior (width 170mm)
  // - Linha 1 (centralizada): SJC ENGENHARIA E SOLUÇÕES - CNPJ: ... – FONE: ...
  // - Linha 2 (centralizada): RUA ISAAC NEWTON, 98 JD. ORIENTE – SÃO JOSE DOS CAMPOS - SP
  // - Canto direito da linha 2: Página X de Y
  // =========================================================================
  const footerTable = new Table({
    width: { size: TOTAL_WIDTH_TWIPS, type: WidthType.DXA },
    borders: BORDER_NONE_OBJ,
    rows: [
      // Linha 1 do rodapé com linha preta superior
      new TableRow({
        children: [
          new TableCell({
            columnSpan: 2,
            width: { size: TOTAL_WIDTH_TWIPS, type: WidthType.DXA },
            borders: {
              top: { style: BorderStyle.SINGLE, size: 2, color: '000000' },
              bottom: NO_BORDER,
              left: NO_BORDER,
              right: NO_BORDER,
            },
            margins: { top: 40, bottom: 8, left: 0, right: 0 },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    text: `${company.name || 'SJC ENGENHARIA E SOLUÇÕES'} - CNPJ: ${company.cnpj || '18.472.071/0001-52'} – FONE: ${company.phone || '(12) 98106-3344'}`.toUpperCase(),
                    bold: true,
                    size: 15, // 7.5pt
                    color: '000000',
                    font: 'Arial',
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
      // Linha 2 do rodapé: Endereço centralizado e paginação à direita
      new TableRow({
        children: [
          new TableCell({
            width: { size: 7600, type: WidthType.DXA },
            borders: BORDER_NONE_OBJ,
            margins: { top: 4, bottom: 0, left: 0, right: 0 },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    text: (company.address || 'RUA ISAAC NEWTON, 98 JD. ORIENTE – SÃO JOSE DOS CAMPOS - SP').toUpperCase(),
                    bold: true,
                    size: 15, // 7.5pt
                    color: '000000',
                    font: 'Arial',
                  }),
                ],
              }),
            ],
          }),
          new TableCell({
            width: { size: TOTAL_WIDTH_TWIPS - 7600, type: WidthType.DXA },
            borders: BORDER_NONE_OBJ,
            margins: { top: 4, bottom: 0, left: 0, right: 0 },
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    text: 'Página ',
                    size: 13, // 6.5pt
                    color: '64748B',
                    font: 'Arial',
                  }),
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    size: 13,
                    bold: true,
                    color: '000000',
                    font: 'Arial',
                  }),
                  new TextRun({
                    text: ' de ',
                    size: 13,
                    color: '64748B',
                    font: 'Arial',
                  }),
                  new TextRun({
                    children: [PageNumber.TOTAL_PAGES],
                    size: 13,
                    bold: true,
                    color: '000000',
                    font: 'Arial',
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });

  // Montagem final do Documento Word OpenXML (.docx)
  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: 'Arial',
            size: 16, // 8pt padrão
            color: '1E293B',
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: {
              width: 11906, // A4 = 210mm
              height: 16838, // A4 = 297mm
            },
            margin: {
              top: 1134, // 20mm
              right: 1134, // 20mm
              bottom: 1134, // 20mm
              left: 1134, // 20mm
              header: 480, // ~8.5mm
              footer: 480, // ~8.5mm
            },
          },
        },
        headers: {
          default: new Header({
            children: headerChildren,
          }),
        },
        footers: {
          default: new Footer({
            children: [footerTable],
          }),
        },
        children: docChildren,
      },
    ],
  });

  onProgress?.(95, 'Finalizando empacotamento do documento Word (.docx)...');

  const blob = await Packer.toBlob(doc);
  const now = new Date();
  const fileName = generateSequentialDocxFileName(client.name, now, report.torreAtual);

  onProgress?.(100, 'Arquivo Word (.docx) gerado com sucesso!');

  return { blob, fileName };
}
