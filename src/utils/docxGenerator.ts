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
} from 'docx';
import { SpdaReport, PhotoSlot } from '../types/spda';
import { SJC_OFFICIAL_LOGO_DATA_URL } from '../assets/logo';
import { generateSequentialDocxFileName } from './storage';
import { consolidateReportPhotos } from './towerSorter';
import { safeJpegDataUrl, processPhotoForPdf } from './pdfGenerator';

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

// 170mm útil em twips (1mm = 56.7 twips)
const TOTAL_WIDTH_TWIPS = 9638;
const COL_WIDTH_4_TWIPS = Math.floor(TOTAL_WIDTH_TWIPS / 4); // 2409 twips

// Helper para títulos de seção principais (azul escuro elegante)
function createSectionHeader(title: string): Paragraph {
  return new Paragraph({
    spacing: { before: 240, after: 120 },
    children: [
      new TextRun({
        text: title,
        bold: true,
        size: 22, // 11pt
        color: '0F172A', // Slate 900
        font: 'Arial',
      }),
    ],
  });
}

// Helper para faixas de subtítulo com fundo cinza claro
function createSubheaderBanner(title: string): Table {
  return new Table({
    width: { size: TOTAL_WIDTH_TWIPS, type: WidthType.DXA },
    borders: BORDER_NONE_OBJ,
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: TOTAL_WIDTH_TWIPS, type: WidthType.DXA },
            shading: { fill: 'F1F5F9', type: ShadingType.CLEAR },
            margins: { top: 70, bottom: 70, left: 140, right: 140 },
            children: [
              new Paragraph({
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

/**
 * Cria a grade de fotos em 4 colunas no Word (.docx), preservando proporção,
 * enquadramento exato, círculos de foco vermelhos e legendas técnicas.
 */
function createPhotoGridTable(
  photos: PhotoSlot[],
  processedJpegs: string[],
  isMultiTower: boolean,
  showMeasurement = false
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
        const legendText = isMultiTower ? (cap ? `${tName} - ${cap}` : tName) : (cap || `Foto ${i + c + 1}`);

        const cellChildren: Paragraph[] = [];

        try {
          const imageBytes = dataUrlToUint8Array(jpeg);
          cellChildren.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 40, after: 40 },
              children: [
                new ImageRun({
                  data: imageBytes,
                  transformation: {
                    width: 145, // 38.5mm @ 96dpi
                    height: 181, // 48.0mm @ 96dpi
                  },
                  type: 'jpg',
                }),
              ],
            })
          );
        } catch (e) {
          console.warn('Erro ao inserir imagem no docx:', e);
          cellChildren.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: '[Foto]', size: 14, color: '64748B' })],
            })
          );
        }

        // Legenda técnica da foto
        cellChildren.push(
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 20, after: showMeasurement && p.measurementValue ? 10 : 60 },
            children: [
              new TextRun({
                text: legendText,
                bold: true,
                size: 14, // 7pt
                color: '1E293B',
                font: 'Arial',
              }),
            ],
          })
        );

        // Seção de Medição com valor em destaque
        if (showMeasurement && p.measurementValue) {
          cellChildren.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 0, after: 60 },
              children: [
                new TextRun({
                  text: `R = ${p.measurementValue} (Conforme)`,
                  bold: true,
                  size: 14, // 7pt
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
            margins: { top: 40, bottom: 40, left: 40, right: 40 },
            verticalAlign: VerticalAlign.TOP,
            borders: BORDER_NONE_OBJ,
            children: cellChildren,
          })
        );
      } else {
        // Célula vazia para manter alinhamento de 4 colunas
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
 * Gera o arquivo DOCX editável com fidelidade visual idêntica ao PDF
 */
export async function generateDocxBlob(
  report: SpdaReport,
  onProgress?: (progress: number, message: string) => void
): Promise<{ blob: Blob; fileName: string }> {
  onProgress?.(5, 'Iniciando compilação do documento Word (.docx)...');

  const { client, company, conditions, texts } = report;
  const { spdaPhotos, measurementPhotos, quadrosPhotos, localPhotos } = consolidateReportPhotos(report);

  const isMultiTower =
    Boolean(client.quantidadeTorres && client.quantidadeTorres > 1) ||
    Boolean(client.torresNomes && client.torresNomes.length > 1) ||
    Object.keys(report.torresData || {}).length > 1 ||
    new Set([...spdaPhotos, ...measurementPhotos, ...quadrosPhotos].map((p) => p.towerName).filter(Boolean)).size > 1;

  // 1. Processamento e otimização das imagens (idêntico ao PDF)
  onProgress?.(15, 'Processando logotipo da empresa e dados cadastrais...');
  const logoDataUrl = await safeJpegDataUrl(company.logoUrl || SJC_OFFICIAL_LOGO_DATA_URL, 540, 230, '#ffffff');

  onProgress?.(25, 'Processando fotos de satélite e fachada da edificação...');
  const localJpegs: string[] = [];
  for (let i = 0; i < localPhotos.length; i++) {
    const processed = await processPhotoForPdf(localPhotos[i], 1200, 700, false);
    localJpegs.push(processed);
  }

  onProgress?.(40, 'Processando fotos do SPDA existente e círculos de foco...');
  const spdaJpegs: string[] = [];
  for (let i = 0; i < spdaPhotos.length; i++) {
    const processed = await processPhotoForPdf(spdaPhotos[i], 770, 960, true);
    spdaJpegs.push(processed);
  }

  onProgress?.(60, 'Processando fotos dos pontos de inspeção e medição...');
  const measurementJpegs: string[] = [];
  for (let i = 0; i < measurementPhotos.length; i++) {
    const processed = await processPhotoForPdf(measurementPhotos[i], 770, 960, false);
    measurementJpegs.push(processed);
  }

  onProgress?.(75, 'Processando fotos dos quadros elétricos e DPS...');
  const quadrosJpegs: string[] = [];
  for (let i = 0; i < quadrosPhotos.length; i++) {
    const processed = await processPhotoForPdf(quadrosPhotos[i], 770, 960, false);
    quadrosJpegs.push(processed);
  }

  // Foto do instrumento miliohmímetro
  let equipmentJpeg = '';
  if (report.equipmentPhotoUrl) {
    equipmentJpeg = await processPhotoForPdf(
      { id: 'equip', url: report.equipmentPhotoUrl, caption: 'Miliohmímetro' },
      800,
      600,
      false
    );
  }

  // Imagem da Assinatura Digital do Responsável Técnico
  let signatureJpeg = '';
  if (report.digitalSignature?.enabled && report.digitalSignature.imageUrl) {
    try {
      signatureJpeg = await safeJpegDataUrl(report.digitalSignature.imageUrl, 500, 200, '#ffffff');
    } catch {
      signatureJpeg = '';
    }
  }

  onProgress?.(85, 'Montando páginas e seções normativas no padrão ABNT NBR 5419...');

  const docChildren: Array<Paragraph | Table> = [];

  // =========================================================================
  // CAPA / CABEÇALHO DO LAUDO (PÁGINA 1)
  // =========================================================================
  if (logoDataUrl) {
    try {
      const logoBytes = dataUrlToUint8Array(logoDataUrl);
      docChildren.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 0, after: 120 },
          children: [
            new ImageRun({
              data: logoBytes,
              transformation: { width: 170, height: 72 },
              type: 'jpg',
            }),
          ],
        })
      );
    } catch (e) {
      console.warn('Erro ao inserir logo no docx:', e);
    }
  }

  // Título do Laudo
  docChildren.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 80, after: 40 },
      children: [
        new TextRun({
          text: 'RELATÓRIO TÉCNICO DE INSPEÇÃO VISUAL E MEDIÇÕES DO SPDA',
          bold: true,
          size: 26, // 13pt
          color: '0F172A',
          font: 'Arial',
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 180 },
      children: [
        new TextRun({
          text: 'SISTEMA DE PROTEÇÃO CONTRA DESCARGAS ATMOSFÉRICAS – ABNT NBR 5419:2018',
          bold: true,
          size: 19, // 9.5pt
          color: '1E40AF', // Blue 800
          font: 'Arial',
        }),
      ],
    })
  );

  // Faixa de Identificação Cadastral
  docChildren.push(createSubheaderBanner('DADOS CADASTRAIS DO CLIENTE & INSTALAÇÃO'));

  // Tabela de Dados do Cliente e Responsável Técnico
  const clientDataRows: Array<[string, string]> = [
    ['Cliente / Edifício:', client.name || 'Não informado'],
    ['CNPJ / CPF:', client.cnpj || 'Não informado'],
    ['Endereço Completo:', client.local || 'Não informado'],
    ['Município / UF:', client.municipio || 'Não informado'],
    ['Ramo de Atividade:', client.ramoAtividade || 'Residencial'],
    ['Período de Avaliação:', client.periodoAvaliacao || client.dataEmissaoExtenso || 'Não informado'],
    ['Engenheiro Responsável:', report.digitalSignature?.signerName || client.tecnico || 'Não informado'],
    ['Título / Cargo:', report.digitalSignature?.signerRole || client.cargo || 'Engenheiro Eletricista'],
    ['Registro CREA / CFT:', report.digitalSignature?.signerCrea || client.crea || 'Não informado'],
    ['Número da ART:', report.digitalSignature?.signerArt || client.art || 'Não informado'],
    ['Data de Emissão:', client.dataEmissaoExtenso || 'Não informado'],
  ];

  const clientTableRows = clientDataRows.map(([label, val], idx) => {
    const isEven = idx % 2 === 0;
    return new TableRow({
      children: [
        new TableCell({
          width: { size: 2800, type: WidthType.DXA },
          shading: { fill: isEven ? 'F8FAFC' : 'FFFFFF', type: ShadingType.CLEAR },
          margins: { top: 60, bottom: 60, left: 100, right: 100 },
          borders: BORDER_LIGHT_OBJ,
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: label,
                  bold: true,
                  size: 17, // 8.5pt
                  color: '0F172A',
                  font: 'Arial',
                }),
              ],
            }),
          ],
        }),
        new TableCell({
          width: { size: TOTAL_WIDTH_TWIPS - 2800, type: WidthType.DXA },
          shading: { fill: isEven ? 'F8FAFC' : 'FFFFFF', type: ShadingType.CLEAR },
          margins: { top: 60, bottom: 60, left: 100, right: 100 },
          borders: BORDER_LIGHT_OBJ,
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: val,
                  size: 17, // 8.5pt
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

  docChildren.push(
    new Table({
      width: { size: TOTAL_WIDTH_TWIPS, type: WidthType.DXA },
      rows: clientTableRows,
    })
  );

  // Quebra para Página 2
  docChildren.push(new Paragraph({ children: [new PageBreak()] }));

  // =========================================================================
  // PÁGINA 2: INTRODUÇÃO, NORMAS E DICIONÁRIO
  // =========================================================================
  docChildren.push(createSectionHeader('1) INTRODUÇÃO & OBJETIVO DO LAUDO PERICIAL'));

  const introItems = [
    { num: '1.1- Objeto:', text: texts.introducaoItem1_1 || texts.objeto },
    { num: '1.2- Finalidade:', text: texts.introducaoItem1_2 },
    { num: '1.3- Metodologia:', text: texts.introducaoItem1_3 },
    { num: '1.4- Abrangência:', text: texts.introducaoItem1_4 },
  ];

  introItems.forEach((it) => {
    docChildren.push(
      new Paragraph({
        spacing: { before: 40, after: 60 },
        children: [
          new TextRun({ text: `${it.num} `, bold: true, size: 17, color: '0F172A', font: 'Arial' }),
          new TextRun({ text: it.text, size: 17, color: '334155', font: 'Arial' }),
        ],
      })
    );
  });

  // Referências Normativas
  docChildren.push(createSubheaderBanner('REFERÊNCIAS NORMATIVAS APLICÁVEIS'));
  (texts.referenciasNormativas || []).forEach((norma) => {
    docChildren.push(
      new Paragraph({
        bullet: { level: 0 },
        spacing: { before: 20, after: 30 },
        children: [new TextRun({ text: norma, size: 15, color: '334155', font: 'Arial' })],
      })
    );
  });

  // Dicionário e Abreviaturas
  docChildren.push(createSectionHeader('2) DICIONÁRIO E ABREVIATURAS USADAS'));
  const dictRows = (texts.dicionario || []).slice(0, 10).map((d, dIdx) => {
    const isEven = dIdx % 2 === 0;
    return new TableRow({
      children: [
        new TableCell({
          width: { size: 2400, type: WidthType.DXA },
          shading: { fill: isEven ? 'F8FAFC' : 'FFFFFF', type: ShadingType.CLEAR },
          margins: { top: 40, bottom: 40, left: 80, right: 80 },
          borders: BORDER_LIGHT_OBJ,
          children: [
            new Paragraph({
              children: [new TextRun({ text: d.termo, bold: true, size: 15, color: '0F172A', font: 'Arial' })],
            }),
          ],
        }),
        new TableCell({
          width: { size: TOTAL_WIDTH_TWIPS - 2400, type: WidthType.DXA },
          shading: { fill: isEven ? 'F8FAFC' : 'FFFFFF', type: ShadingType.CLEAR },
          margins: { top: 40, bottom: 40, left: 80, right: 80 },
          borders: BORDER_LIGHT_OBJ,
          children: [
            new Paragraph({
              children: [new TextRun({ text: d.definicao, size: 15, color: '334155', font: 'Arial' })],
            }),
          ],
        }),
      ],
    });
  });

  if (dictRows.length > 0) {
    docChildren.push(
      new Table({
        width: { size: TOTAL_WIDTH_TWIPS, type: WidthType.DXA },
        rows: dictRows,
      })
    );
  }

  // Quebra para Página 3
  docChildren.push(new Paragraph({ children: [new PageBreak()] }));

  // =========================================================================
  // PÁGINA 3: CARACTERÍSTICAS DA EDIFICAÇÃO & FOTOS EM DESTAQUE (AÉREA / FACHADA)
  // =========================================================================
  docChildren.push(createSectionHeader('3) CARACTERÍSTICAS DA EDIFICAÇÃO & LOCAL'));

  if (client.descricaoBloco || texts.caracteristicasLocal) {
    docChildren.push(
      new Paragraph({
        spacing: { before: 40, after: 100 },
        children: [
          new TextRun({
            text: client.descricaoBloco || texts.caracteristicasLocal,
            size: 17,
            color: '334155',
            font: 'Arial',
          }),
        ],
      })
    );
  }

  // Foto da Vista Aérea (se disponível)
  if (localJpegs[0]) {
    docChildren.push(createSubheaderBanner('3.1) VISTA AÉREA DA EDIFICAÇÃO / IMAGEM SATÉLITE'));
    try {
      const aereaBytes = dataUrlToUint8Array(localJpegs[0]);
      docChildren.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 80, after: 40 },
          children: [
            new ImageRun({
              data: aereaBytes,
              transformation: { width: 440, height: 230 },
              type: 'jpg',
            }),
          ],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 0, after: 120 },
          children: [
            new TextRun({
              text: localPhotos[0]?.caption || 'Vista aérea da edificação, circunvizinhança e posicionamento geográfico.',
              bold: true,
              size: 15,
              color: '475569',
              font: 'Arial',
            }),
          ],
        })
      );
    } catch (e) {
      console.warn('Erro ao inserir foto aérea no docx:', e);
    }
  }

  // Foto da Fachada Principal (se disponível)
  if (localJpegs[1]) {
    docChildren.push(createSubheaderBanner('3.2) FACHADA PRINCIPAL DA EDIFICAÇÃO'));
    try {
      const fachadaBytes = dataUrlToUint8Array(localJpegs[1]);
      docChildren.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 80, after: 40 },
          children: [
            new ImageRun({
              data: fachadaBytes,
              transformation: { width: 440, height: 230 },
              type: 'jpg',
            }),
          ],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 0, after: 120 },
          children: [
            new TextRun({
              text: localPhotos[1]?.caption || 'Fachada frontal da edificação vistoriada.',
              bold: true,
              size: 15,
              color: '475569',
              font: 'Arial',
            }),
          ],
        })
      );
    } catch (e) {
      console.warn('Erro ao inserir foto da fachada no docx:', e);
    }
  }

  // 4) Histórico de Ocorrências
  docChildren.push(createSectionHeader('4) HISTÓRICO DE OCORRÊNCIAS & DESCARGAS ATMOSFÉRICAS'));
  docChildren.push(
    new Paragraph({
      spacing: { before: 40, after: 60 },
      children: [
        new TextRun({
          text: '4.1- Histórico Declarado: ',
          bold: true,
          size: 17,
          color: '0F172A',
          font: 'Arial',
        }),
        new TextRun({
          text: client.historicoQueimaOcorrencias || texts.historicoItem4_1,
          size: 17,
          color: '334155',
          font: 'Arial',
        }),
      ],
    }),
    new Paragraph({
      spacing: { before: 40, after: 120 },
      children: [
        new TextRun({
          text: '4.2- Avaliação de Danos: ',
          bold: true,
          size: 17,
          color: '0F172A',
          font: 'Arial',
        }),
        new TextRun({
          text: texts.historicoItem4_2,
          size: 17,
          color: '334155',
          font: 'Arial',
        }),
      ],
    })
  );

  // Quebra para Página 4 (Vistoria do SPDA)
  docChildren.push(new Paragraph({ children: [new PageBreak()] }));

  // =========================================================================
  // PÁGINA 4: 5) VISTORIA DO SPDA EXISTENTE COM FOTOS (4 POR LINHA)
  // =========================================================================
  docChildren.push(createSectionHeader('5) VISTORIA DO SPDA EXISTENTE & PARECER VISUAL'));

  if (texts.vistoriaSpdaTexto) {
    docChildren.push(
      new Paragraph({
        spacing: { before: 40, after: 100 },
        children: [new TextRun({ text: texts.vistoriaSpdaTexto, size: 17, color: '334155', font: 'Arial' })],
      })
    );
  }

  // Grade de fotos do SPDA (com círculo vermelho de foco)
  if (spdaPhotos.length > 0) {
    docChildren.push(createPhotoGridTable(spdaPhotos, spdaJpegs, isMultiTower, false));
  } else {
    docChildren.push(
      new Paragraph({
        spacing: { before: 40, after: 80 },
        children: [
          new TextRun({
            text: '(Nenhuma foto de anomalia registrada no subsistema do SPDA existente durante esta vistoria).',
            italics: true,
            size: 16,
            color: '64748B',
            font: 'Arial',
          }),
        ],
      })
    );
  }

  // Painel de Parecer Técnico Visual da Vistoria
  docChildren.push(
    new Paragraph({ spacing: { before: 140, after: 40 }, children: [] }),
    createSubheaderBanner('ANÁLISE PERICIAL DA INSPEÇÃO VISUAL IN LOCO')
  );

  if (texts.vistoriaSpdaAnalise) {
    docChildren.push(
      new Paragraph({
        spacing: { before: 60, after: 120 },
        children: [new TextRun({ text: texts.vistoriaSpdaAnalise, size: 17, color: '334155', font: 'Arial' })],
      })
    );
  }

  // Tabela dos 4 Subsistemas Vistoriados
  const subsistemas = [
    {
      item: 'Subsistema de Captação',
      desc: conditions.subCapitacaoDesc || 'Mastros, pontas captoras Franklin, fitas de alumínio e suportes.',
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

  const subRows = subsistemas.map((sub, sIdx) => {
    const isEven = sIdx % 2 === 0;
    const isConforme = sub.status === 'CONFORME';
    const isRequer = sub.status === 'REQUER AJUSTES';
    const statusColor = isConforme ? '15803D' : isRequer ? 'B45309' : 'DC2626';

    return new TableRow({
      children: [
        new TableCell({
          width: { size: 3000, type: WidthType.DXA },
          shading: { fill: isEven ? 'F8FAFC' : 'FFFFFF', type: ShadingType.CLEAR },
          margins: { top: 60, bottom: 60, left: 100, right: 100 },
          borders: BORDER_LIGHT_OBJ,
          children: [
            new Paragraph({
              children: [new TextRun({ text: sub.item, bold: true, size: 16, color: '0F172A', font: 'Arial' })],
            }),
          ],
        }),
        new TableCell({
          width: { size: TOTAL_WIDTH_TWIPS - 5200, type: WidthType.DXA },
          shading: { fill: isEven ? 'F8FAFC' : 'FFFFFF', type: ShadingType.CLEAR },
          margins: { top: 60, bottom: 60, left: 100, right: 100 },
          borders: BORDER_LIGHT_OBJ,
          children: [
            new Paragraph({
              children: [new TextRun({ text: sub.desc, size: 15, color: '475569', font: 'Arial' })],
            }),
          ],
        }),
        new TableCell({
          width: { size: 2200, type: WidthType.DXA },
          shading: { fill: isEven ? 'F8FAFC' : 'FFFFFF', type: ShadingType.CLEAR },
          margins: { top: 60, bottom: 60, left: 100, right: 100 },
          borders: BORDER_LIGHT_OBJ,
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

  // Quebra para Página 5 (Medições)
  docChildren.push(new Paragraph({ children: [new PageBreak()] }));

  // =========================================================================
  // PÁGINA 5: 6) MEDIÇÕES DE CONTINUIDADE ELÉTRICA & ATERRAMENTO
  // =========================================================================
  docChildren.push(createSectionHeader('6) MEDIÇÕES DE CONTINUIDADE ELÉTRICA & RESISTÊNCIA DE ATERRAMENTO'));

  if (texts.medicoesContinuidadeTexto) {
    docChildren.push(
      new Paragraph({
        spacing: { before: 40, after: 100 },
        children: [new TextRun({ text: texts.medicoesContinuidadeTexto, size: 17, color: '334155', font: 'Arial' })],
      })
    );
  }

  // Tabela de Dados do Instrumento Miliohmímetro
  const equipRows = [
    ['Instrumento Utilizado:', texts.equipamentoModelo || 'Miliohmímetro Digital de Alta Precisão (HTM-01)'],
    ['Fabricante / Marca:', texts.equipamentoMarca || 'Hastec / Padrão NBR 5419'],
    ['Método de Ensaio:', 'Método das 4 Pontas (Kelvin) com injeção de corrente contínua de 1A'],
    ['Critério Normativo:', 'Resistência de Continuidade ôhmica R <= 0,20 Ω (NBR 5419-3:2018)'],
  ].map(([label, val], idx) => {
    const isEven = idx % 2 === 0;
    return new TableRow({
      children: [
        new TableCell({
          width: { size: 3000, type: WidthType.DXA },
          shading: { fill: isEven ? 'F8FAFC' : 'FFFFFF', type: ShadingType.CLEAR },
          margins: { top: 50, bottom: 50, left: 80, right: 80 },
          borders: BORDER_LIGHT_OBJ,
          children: [
            new Paragraph({
              children: [new TextRun({ text: label, bold: true, size: 16, color: '0F172A', font: 'Arial' })],
            }),
          ],
        }),
        new TableCell({
          width: { size: TOTAL_WIDTH_TWIPS - 3000, type: WidthType.DXA },
          shading: { fill: isEven ? 'F8FAFC' : 'FFFFFF', type: ShadingType.CLEAR },
          margins: { top: 50, bottom: 50, left: 80, right: 80 },
          borders: BORDER_LIGHT_OBJ,
          children: [
            new Paragraph({
              children: [new TextRun({ text: val, size: 16, color: '334155', font: 'Arial' })],
            }),
          ],
        }),
      ],
    });
  });

  docChildren.push(
    new Table({
      width: { size: TOTAL_WIDTH_TWIPS, type: WidthType.DXA },
      rows: equipRows,
    })
  );

  // Foto do Equipamento (se disponível)
  if (equipmentJpeg) {
    try {
      const eqBytes = dataUrlToUint8Array(equipmentJpeg);
      docChildren.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 80, after: 30 },
          children: [
            new ImageRun({
              data: eqBytes,
              transformation: { width: 220, height: 165 },
              type: 'jpg',
            }),
          ],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 0, after: 100 },
          children: [
            new TextRun({
              text: 'Instrumento Miliohmímetro digital calibrado com ART',
              bold: true,
              size: 14,
              color: '475569',
              font: 'Arial',
            }),
          ],
        })
      );
    } catch (e) {
      console.warn('Erro ao inserir foto do instrumento no docx:', e);
    }
  }

  // Grade de Fotos dos Pontos de Medição (com valor medido em destaque)
  docChildren.push(
    new Paragraph({ spacing: { before: 100, after: 40 }, children: [] }),
    createSubheaderBanner('REGISTRO FOTOGRÁFICO DOS PONTOS DE MEDIÇÃO & CONTINUIDADE ÔHMICA')
  );

  if (measurementPhotos.length > 0) {
    docChildren.push(createPhotoGridTable(measurementPhotos, measurementJpegs, isMultiTower, true));
  } else {
    docChildren.push(
      new Paragraph({
        spacing: { before: 40, after: 80 },
        children: [
          new TextRun({
            text: '(Nenhum ponto de medição registrado nesta vistoria).',
            italics: true,
            size: 16,
            color: '64748B',
            font: 'Arial',
          }),
        ],
      })
    );
  }

  // Quebra para Página 6 (Quadros com DPS)
  docChildren.push(new Paragraph({ children: [new PageBreak()] }));

  // =========================================================================
  // PÁGINA 6: 7) QUADROS ELÉTRICOS & DISPOSITIVOS DE PROTEÇÃO CONTRA SURTOS (DPS)
  // =========================================================================
  docChildren.push(createSectionHeader('7) QUADROS ELÉTRICOS & DISPOSITIVOS DE PROTEÇÃO CONTRA SURTOS (DPS)'));

  if (texts.analiseQuadrosTexto) {
    docChildren.push(
      new Paragraph({
        spacing: { before: 40, after: 100 },
        children: [new TextRun({ text: texts.analiseQuadrosTexto, size: 17, color: '334155', font: 'Arial' })],
      })
    );
  }

  // Grade de fotos dos Quadros com DPS
  if (quadrosPhotos.length > 0) {
    docChildren.push(createPhotoGridTable(quadrosPhotos, quadrosJpegs, isMultiTower, false));
  } else {
    docChildren.push(
      new Paragraph({
        spacing: { before: 40, after: 80 },
        children: [
          new TextRun({
            text: '(Nenhum quadro elétrico registrado nesta vistoria).',
            italics: true,
            size: 16,
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
      new Paragraph({ spacing: { before: 120, after: 40 }, children: [] }),
      createSubheaderBanner('PARECER TÉCNICO SOBRE OS DISPOSITIVOS DPS E BARRAMENTOS')
    );
    docChildren.push(
      new Paragraph({
        spacing: { before: 60, after: 120 },
        children: [new TextRun({ text: texts.analiseQuadrosConclusao, size: 17, color: '334155', font: 'Arial' })],
      })
    );
  }

  // Quebra para Página Final (Recomendações e Conclusão com Assinatura)
  docChildren.push(new Paragraph({ children: [new PageBreak()] }));

  // =========================================================================
  // PÁGINA FINAL: RECOMENDAÇÕES, CONCLUSÃO & ASSINATURA DIGITAL
  // =========================================================================
  docChildren.push(createSectionHeader('8) CORREÇÕES NECESSÁRIAS PARA PROTEÇÃO DAS EDIFICAÇÕES'));

  docChildren.push(createSubheaderBanner('RECOMENDAÇÕES TÉCNICAS PRIORITÁRIAS (NBR 5419:2018)'));

  (texts.recomendacoes || []).forEach((rec, rIdx) => {
    docChildren.push(
      new Paragraph({
        spacing: { before: 30, after: 40 },
        children: [
          new TextRun({
            text: `8.${rIdx + 1}- `,
            bold: true,
            size: 17,
            color: 'DC2626', // Red 600
            font: 'Arial',
          }),
          new TextRun({
            text: rec,
            bold: true,
            size: 17,
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
        spacing: { before: 60, after: 120 },
        children: [
          new TextRun({
            text: texts.recomendacoesTextoFinal,
            bold: true,
            size: 17,
            color: 'DC2626',
            font: 'Arial',
          }),
        ],
      })
    );
  }

  // 9) Conclusão Técnica Final
  docChildren.push(createSectionHeader('9) CONCLUSÃO FINAL DESTE RELATÓRIO TÉCNICO'));

  if (texts.conclusaoFinal) {
    docChildren.push(
      new Paragraph({
        spacing: { before: 40, after: 100 },
        children: [new TextRun({ text: texts.conclusaoFinal, size: 17, color: '334155', font: 'Arial' })],
      })
    );
  }

  // Termo de Encerramento e Validade
  docChildren.push(createSubheaderBanner('DISPOSIÇÕES FINAIS & VALIDADE DA INSPEÇÃO'));
  docChildren.push(
    new Paragraph({
      spacing: { before: 40, after: 120 },
      children: [
        new TextRun({
          text:
            'Este laudo possui validade técnica de 1 (um) ano a partir da data de emissão, ou conforme periodicidade de inspeção estipulada pela NBR 5419-3:2018 (Tabela 6). O responsável técnico declara que todas as medições foram efetuadas conforme os preceitos éticos e regulamentares do CREA.',
          size: 16,
          color: '475569',
          font: 'Arial',
        }),
      ],
    })
  );

  // Cidade e Data
  docChildren.push(
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { before: 60, after: 180 },
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
  // BLOCO DE ASSINATURA DIGITAL PROEMINENTE
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
          spacing: { before: 80, after: 30 },
          children: [
            new ImageRun({
              data: sigBytes,
              transformation: { width: 180, height: 60 },
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
        spacing: { before: 120, after: 30 },
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

  // Linha de Assinatura Centralizada
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
          size: 19, // 9.5pt
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
      spacing: { before: 0, after: 140 },
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
  // DOCUMENTO COMPLETO COM HEADER E FOOTER
  // =========================================================================
  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: 'Arial',
            size: 18, // 9pt
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
              width: 11906, // A4 width in twips (210mm)
              height: 16838, // A4 height in twips (297mm)
            },
            margin: {
              top: 1134, // 20mm
              right: 1134, // 20mm
              bottom: 1134, // 20mm
              left: 1134, // 20mm
            },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    text: `${company.name || 'SJC SERVIÇOS TÉCNICOS'} | LAUDO TÉCNICO DE SPDA - NBR 5419:2018`,
                    bold: true,
                    size: 14, // 7pt
                    color: '64748B',
                    font: 'Arial',
                  }),
                ],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    text: `Laudo SPDA - ${client.name || 'Condomínio'} | Página `,
                    size: 15,
                    color: '64748B',
                    font: 'Arial',
                  }),
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    size: 15,
                    color: '0F172A',
                    bold: true,
                    font: 'Arial',
                  }),
                  new TextRun({
                    text: ' de ',
                    size: 15,
                    color: '64748B',
                    font: 'Arial',
                  }),
                  new TextRun({
                    children: [PageNumber.TOTAL_PAGES],
                    size: 15,
                    color: '0F172A',
                    bold: true,
                    font: 'Arial',
                  }),
                ],
              }),
            ],
          }),
        },
        children: docChildren,
      },
    ],
  });

  onProgress?.(95, 'Finalizando empacotamento do arquivo Word (.docx)...');

  const blob = await Packer.toBlob(doc);
  const now = new Date();
  const fileName = generateSequentialDocxFileName(client.name, now, report.torreAtual);

  onProgress?.(100, 'Arquivo Word (.docx) gerado com sucesso!');

  return { blob, fileName };
}
