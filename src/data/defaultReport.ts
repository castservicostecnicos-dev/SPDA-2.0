import { SpdaReport } from '../types/spda';
import { SJC_OFFICIAL_LOGO_DATA_URL } from '../assets/logo';

/**
 * Cria um laudo limpo, sem carregar o modelo de teste e sem fotos pré-carregadas.
 * Todos os dados do cliente e fotos ficam vazios para o usuário cadastrar novos dados.
 */
export const createBlankSpdaReport = (): SpdaReport => ({
  id: `laudo-spda-${Date.now()}`,
  title: 'Laudo de Inspeção SPDA',
  company: {
    name: 'SJC ENGENHARIA E SOLUÇÕES',
    cnpj: '18.472.071/0001-52',
    phone: '(12) 98106-3344',
    address: 'RUA ISAAC NEWTON, 98 JD. ORIENTE – SÃO JOSE DOS CAMPOS - SP',
    logoUrl: SJC_OFFICIAL_LOGO_DATA_URL,
    showWatermark: true,
    watermarkText: 'SPDA 2026',
  },
  client: {
    name: '',
    local: '',
    municipio: 'SÃO JOSÉ DOS CAMPOS - SP',
    cnpj: '',
    ramoAtividade: 'RESIDENCIAL',
    periodoAvaliacao: new Date().toLocaleDateString('pt-BR'),
    tecnico: 'JÔNATAS PAVANELO',
    cargo: 'Engenheiro Eletricista',
    crea: 'CREA-SP 5063896203',
    art: '',
    dataEmissaoExtenso: new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }),
    cidadeEmissao: 'São José dos Campos',
    descricaoBloco: '',
    exposicaoNivel: 'baixa EXPOSIÇÃO',
    historicoQueimaOcorrencias: '',
  },
  conditions: {
    captorFranklinStatus: 'conforme',
    parafusosStatus: 'conforme',
    emendasStatus: 'conforme',
    massasMetalicasAterrada: true,
    caixasInspecaoLimpas: true,
    continuidadeAprovada: true,
    possuiDpsQuadros: true,
    temPontosACorrigir: false,
    subCapitacaoStatus: 'CONFORME',
    subCapitacaoDesc: 'Mastros, pontas captoras Franklin, fitas condutoras e fixações mecânicas.',
    subDescidaStatus: 'CONFORME',
    subDescidaDesc: 'Fitas de descida, espaçamento normativo, curvas e fixações mecânicas.',
    subAterramentoStatus: 'CONFORME',
    subAterramentoDesc: 'Caixas de equalização e inspeção, anel perimetral de aterramento e hastes cobreadas.',
    subEquipotencializacaoStatus: 'CONFORME',
    subEquipotencializacaoDesc: 'Interligação de massas metálicas da cobertura, rufos e estruturas de concreto armado.',
  },
  texts: {
    objeto: 'SERVIÇOS DE INSPEÇÃO, MEDIÇÃO E ELABORAÇÃO DE LAUDO TÉCNICO QUANTO AO SISTEMA DE PROTEÇÃO CONTRA DESCARGAS ATMOSFÉRICAS SPDA, DE ACORDO COM A NBR 5419-2018.',
    introducaoItem1_1: 'Este LAUDO tem como objetivo fazer uma avaliação sucinta do SPDA existente na edificação, verificar o estado de conservação das peças e acessórios e checar a sua conformidade com a norma técnica NBR5419/2018 da ABNT em vigência.',
    introducaoItem1_2: 'Serão apresentadas as sugestões técnicas necessárias para conformidade á norma e apresentados desenhos e/ou detalhes caso seja necessário.',
    introducaoItem1_3: 'A avaliação apresentada neste laudo teve como base as inspeções e medições efetuadas nas instalações e por informações obtidas junto a colaboradores da SJC Engenharia.',
    introducaoItem1_4: 'Segundo a ABNT NBR 5419-1:2018, Proteção contra descargas atmosféricas –. Parte 1: Princípios Gerais, item 9.4.1.2, as funções do SPDA externo são:\na) Interceptar uma descarga atmosférica para a estrutura (com um subsistema de captação);\nb) Conduzir a corrente da descarga atmosférica seguramente para a terra (com um subsistema de descida);\nc) Dispersar esta corrente na terra (com um subsistema de aterramento)',
    dicionario: [
      { termo: 'EXPOSIÇÃO EXTREMA', definicao: 'Local com muita incidência de Raios e vulnerável aos efeitos secundários dos raios que caiem na vizinhança;' },
      { termo: 'BLINDAGEM ELETROSTÁTICA', definicao: 'Proteção contra as ondas eletromagnéticas provocadas pelos raios que viajam pelo ar;' },
      { termo: 'NBR5419/2018', definicao: 'Norma Brasileira que regulamenta o projeto e instalação de Para-raios;' },
      { termo: 'ABNT', definicao: 'Associação Brasileira de Normas Técnicas;' },
      { termo: 'SPDA', definicao: 'Sistema de Proteção contra Descargas Atmosféricas (Para-raios);' },
      { termo: '“As Built”', definicao: 'Projeto final da instalação com as modificações ocorridas durante a instalação (como executado; como construído);' },
      { termo: 'DPS', definicao: 'Dispositivo de proteção contra surto.' },
      { termo: 'ART', definicao: 'Anotação de Responsabilidade Técnica emitida no CREA, (responsabilidade pela execução);' },
      { termo: 'CREA', definicao: 'Conselho Regional de Engenharia e Agronomia.' },
    ],
    referenciasNormativas: [
      'ABNT NBR 5410, Instalações elétricas de baixa tensão;',
      'ABNT NBR 5419-1, Proteção contra descargas atmosféricas – Parte 1: Princípios Gerais;',
      'ABNT NBR 5419-2, Proteção contra descargas atmosféricas – Parte 2: Gerenciamento de risco;',
      'ABNT NBR 5419-3, Proteção contra descargas atmosféricas – Parte 3: Danos físicos a estruturas e perigos à vida;',
      'ABNT NBR 5419-4, Proteção contra descargas atmosféricas – Parte 4: Sistemas elétricos e eletrônicos internos na estrutura;',
      'ABNT NBR 6323, Galvanização de produtos de aço ou ferro fundido – Especificação;',
      'ABNT NBR 13571, Haste de aterramento acobreado e acessórios;',
      'ABNT NBR IEC 60079-10-1, Atmosferas explosivas – Parte 10-1: Classificação de áreas – Atmosferas explosivas de gás;',
      'ABNT NBR IEC 60079-10-2, Atmosferas explosivas – Parte 10-2: Classificação de áreas – Atmosferas de poeiras combustíveis;',
      'ABNT NBR IEC 60079-14, Atmosferas explosivas – Parte 14: Projeto, seleção e montagem de instalações elétricas;',
    ],
    caracteristicasLocal: '',
    caracteristicasLocalComplemento: '',
    historicoItem4_1: '',
    historicoItem4_2: 'A ocorrência de problemas com equipamentos se deve ao fato de alguma blindagem eletrostática, não absorvendo algumas das interferências eletromagnéticas provenientes dos raios que caiem na vizinhança. Com isso é indispensável à presença de supressores de surtos instalados nos quadros de distribuição na rede elétrica.',
    vistoriaSpdaTexto: 'Durante a inspeção foi realizado uma vistoria completa e testes de continuidade, buscando avaliar as condições de acordo com a norma NBR 5419/2018.',
    vistoriaSpdaAnalise: '',
    medicoesContinuidadeTexto: 'Foram efetuadas medidas de continuidade elétrica e inspeção visual, com o uso do Miliohmímetro HTM-01 MARCA: HI-TECH. Os certificados de calibração estão em anexo.',
    equipamentoModelo: 'HTM-01',
    equipamentoMarca: 'HI-TECH',
    equipamentoDescricao: 'O miliohmímetro é um instrumento portátil, utiliza o método dos 4 terminais (método de Kelvin) para evitar erros na medição provocados pelos cabos de prova e suas resistências de contato.',
    medicoesLocal: '',
    medicoesCorrenteAplicada: '1,2 Amperes',
    medicoesTipoCorrente: 'Corrente DC',
    pontosInspecaoAvaliacao: 'Importante salientar que os pontos de inspeção precisam ser mantidos limpos, sem sujeira e sem umidade. O teste foi realizado em todas as descidas, e comprovou que todos apresentam continuidade adequada para o subsistema de aterramento.',
    analiseQuadrosSubtitulo: 'Avaliação segundo premissas da NBR 5410',
    analiseQuadrosTexto: 'Os Dispositivos de Proteção contra Surtos (DPS) são equipamentos desenvolvidos para detectar a presença de sobretensões transitórias na rede e drená-las para o sistema de aterramento antes que atinjam os equipamentos eletroeletrônicos.',
    analiseQuadrosConclusao: '',
    recomendacoes: [],
    recomendacoesTextoFinal: 'Fazer a correção de todos os itens apontados neste relatório, de forma ao sistema operar em sua perfeita harmonia.',
    conclusaoFinal: 'Conforme descrito no decorrer deste relatório, excluindo-se as observações efetuadas neste documento, podemos concluir que as áreas inspecionadas na relação anexa, estão em condições técnicas adequadas e satisfatórias no que se refere ao Sistema de Proteção Contra Descargas Atmosféricas da norma NBR 5419-2018, quanto aos aspectos de instalação e segurança. Por fim, concluo que as malhas de aterramento e as malhas superiores do sistema de proteção contra descargas atmosféricas em análise atendem aos requisitos dos projetos executivos e normas vigentes citadas no item 01 deste relatório. Este é meu parecer sob a ART em anexo.',
  },

  // 1. SEPARAÇÃO DE FOTOS: SPDA EXISTENTE (Limpo para novas fotos)
  spdaPhotos: [],

  // 2. SEPARAÇÃO DE FOTOS: PONTOS DE INSPEÇÃO E MEDIÇÃO (Limpo para novas fotos)
  measurementPhotos: [],

  // 3. SEPARAÇÃO DE FOTOS: QUADROS DO SPDA COM DPS (Limpo para novas fotos)
  quadrosPhotos: [],

  // Fotos do Condomínio / Local (Limpo para novas fotos)
  localPhotos: [],

  // Equipamento de Medição (Aguardando upload do usuário)
  equipmentPhotoUrl: undefined,

  // Área Comum: entidade permanente tratada como torre, presente em todo laudo
  torreAtual: 'Torre 1',
  torresData: {
    'Área Comum': {
      id: 'area-comum',
      nome: 'Área Comum',
      spdaPhotos: [],
      measurementPhotos: [],
      quadrosPhotos: [],
      localPhotos: [],
    },
  },

  // Assinatura Digital do Responsável Técnico
  digitalSignature: {
    enabled: true,
    type: 'drawn',
    signerName: 'JÔNATAS PEREIRA PAVANELO',
    signerRole: 'Engenheiro Eletricista',
    signerCrea: 'CREA-SP 5063896203',
    signerArt: '',
    signedAt: new Date().toLocaleDateString('pt-BR'),
    hashSha256: 'SPDA-5419-A8F3-7C21-E9D4',
    showValidationStamp: true,
    certificateAuthority: 'Padrão ICP-Brasil / CREA Confea',
  },
});

export const defaultSpdaReport: SpdaReport = createBlankSpdaReport();
