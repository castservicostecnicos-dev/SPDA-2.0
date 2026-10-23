export interface CompanyData {
  name: string;
  cnpj: string;
  phone: string;
  address: string;
  logoUrl?: string;
  showWatermark: boolean;
  watermarkText: string;
}

export interface ClientData {
  name: string;
  local: string;
  municipio: string;
  cnpj: string;
  ramoAtividade: string;
  periodoAvaliacao: string;
  tecnico: string;
  cargo: string;
  crea: string;
  art: string;
  dataEmissaoExtenso: string;
  cidadeEmissao: string;
  // Local characteristics
  descricaoBloco: string;
  exposicaoNivel: string;
  historicoQueimaOcorrencias: string;
  // Gerenciamento de Múltiplas Torres
  quantidadeTorres?: number;
  torresNomes?: string[];
}

export interface TowerData {
  id: string; // ex: 'torre-1', 'torre-7'
  nome: string; // ex: 'Torre 1', 'Torre 7'
  spdaPhotos: PhotoSlot[];
  measurementPhotos: PhotoSlot[];
  quadrosPhotos: PhotoSlot[];
  localPhotos: PhotoSlot[];
  equipmentPhotoUrl?: string;
  conditions?: InspectionConditions;
}

export interface PhotoSlot {
  id: string;
  url: string;
  caption: string;
  hasRedCircleMarker?: boolean;
  circleX?: number; // Posição horizontal do círculo (0 a 100%, padrão 50)
  circleY?: number; // Posição vertical do círculo (0 a 100%, padrão 50)
  circleRadius?: number; // Tamanho do raio em % (10 a 40%, padrão 24)
  measurementValue?: string;
  notes?: string;
  towerName?: string; // Nome da torre à qual a foto pertence
  addedAt?: number; // timestamp em ms de quando a foto foi capturada/adicionada
  updatedAt?: number; // timestamp em ms de quando legenda/medição foi alterada
  syncedAt?: number; // timestamp em ms de quando foi gravada no disco
  diskFileName?: string; // Nome exato do arquivo gravado no disco (ex: "foto_01.jpg")
}

export type SubsystemStatus = 'CONFORME' | 'NÃO CONFORME' | 'REQUER AJUSTES';

export interface InspectionConditions {
  // SPDA Existente conditions
  captorFranklinStatus: 'incompleto' | 'conforme';
  parafusosStatus: 'oxidados' | 'conforme';
  emendasStatus: 'inadequadas' | 'conforme';
  massasMetalicasAterrada: boolean;
  
  // Pontos de inspeção
  caixasInspecaoLimpas: boolean;
  continuidadeAprovada: boolean;
  
  // Quadros & DPS
  possuiDpsQuadros: boolean;

  // Status geral
  temPontosACorrigir: boolean;

  // Avaliação Estrutural dos Subsistemas do SPDA (NBR 5419)
  subCapitacaoStatus?: SubsystemStatus;
  subCapitacaoDesc?: string;
  subDescidaStatus?: SubsystemStatus;
  subDescidaDesc?: string;
  subAterramentoStatus?: SubsystemStatus;
  subAterramentoDesc?: string;
  subEquipotencializacaoStatus?: SubsystemStatus;
  subEquipotencializacaoDesc?: string;
}

export interface TechnicalTexts {
  objeto: string;
  introducaoItem1_1: string;
  introducaoItem1_2: string;
  introducaoItem1_3: string;
  introducaoItem1_4: string;
  dicionario: Array<{ termo: string; definicao: string }>;
  referenciasNormativas: string[];
  caracteristicasLocal: string;
  caracteristicasLocalComplemento: string;
  historicoItem4_1: string;
  historicoItem4_2: string;
  vistoriaSpdaTexto: string;
  vistoriaSpdaAnalise: string;
  medicoesContinuidadeTexto: string;
  equipamentoModelo: string;
  equipamentoMarca: string;
  equipamentoDescricao: string;
  medicoesLocal: string;
  medicoesCorrenteAplicada: string;
  medicoesTipoCorrente: string;
  pontosInspecaoAvaliacao: string;
  analiseQuadrosSubtitulo: string;
  analiseQuadrosTexto: string;
  analiseQuadrosConclusao: string;
  recomendacoes: string[];
  recomendacoesTextoFinal: string;
  conclusaoFinal: string;
}

export interface DigitalSignatureData {
  enabled: boolean;                      // Se a assinatura digital está habilitada no documento final
  type: 'drawn' | 'upload' | 'stamp' | 'certificate'; // Tipo de assinatura
  imageUrl?: string;                     // Imagem da assinatura (PNG/JPEG data URL com fundo transparente)
  signerName: string;                    // Nome do Responsável Técnico
  signerRole: string;                    // Título / Cargo profissional
  signerCrea: string;                    // Registro no CREA / CFT
  signerArt?: string;                    // Número da ART / RRT
  signedAt: string;                      // Data e hora da aposição da assinatura
  hashSha256: string;                    // Código de autenticação / Hash criptográfico de validação
  showValidationStamp: boolean;          // Exibir carimbo formal de certificação digital no documento
  certificateAuthority?: string;         // Ex: "ICP-Brasil / Padrão Engenharia CREA"
}

export interface SpdaReport {
  id: string;
  title: string;
  company: CompanyData;
  client: ClientData;
  conditions: InspectionConditions;
  texts: TechnicalTexts;
  
  // 3 Primary Photo Sections as specified by user
  spdaPhotos: PhotoSlot[];          // 16 fotos do SPDA existente
  measurementPhotos: PhotoSlot[];   // 9 fotos de ponto de inspeção e medição
  quadrosPhotos: PhotoSlot[];       // 8 fotos dos quadros do SPDA / quadro com DPS
  
  // Auxiliary photos
  localPhotos: PhotoSlot[];         // 3 fotos: aérea, fachada, entrada
  equipmentPhotoUrl?: string;       // Miliohmímetro HTM-01

  // Gerenciamento e persistência de dados por torre
  torreAtual?: string;               // Ex: 'Torre 1', 'Torre 7'
  torresData?: Record<string, TowerData>; // Dados de fotos e condições de cada torre

  // Assinatura Digital do Responsável Técnico
  digitalSignature?: DigitalSignatureData;

  // Metadados de sincronização incremental no disco do dispositivo
  lastSyncedAt?: number;             // Timestamp da última sincronização
  lastSyncedFormatted?: string;      // Ex: "10:50"
}

