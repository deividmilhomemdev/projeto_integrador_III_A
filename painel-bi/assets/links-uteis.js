/*
 * Ouvidoria BI — Links Uteis
 * -------------------------------------------------------------
 * Para incluir, remover ou editar um link, altere somente esta lista.
 * Campos de cada link:
 *   titulo, descricao, url (sempre https://), icone (Font Awesome)
 *   telefone (opcional) -> mostra um botao "Ligar"
 */
window.LINKS_UTEIS = [
  {
    grupo: 'Ouvidoria da Mulher e Câmara Municipal',
    icone: 'fa-landmark',
    links: [
      {
        titulo: 'Aplicativo Ouvidoria da Mulher',
        descricao: 'Aplicativo utilizado pelas psicólogas voluntárias para o registro e acompanhamento dos atendimentos.',
        url: 'https://ouvidoriadamulhergoianiavoluntariado.netlify.app/',
        icone: 'fa-solid fa-mobile-screen-button'
      },
      {
        titulo: 'Câmara Municipal de Goiânia',
        descricao: 'Portal oficial da Câmara Municipal de Goiânia, com notícias, institucional e serviços.',
        url: 'https://www.goiania.go.leg.br/',
        icone: 'fa-solid fa-landmark'
      }
    ]
  },
  {
    grupo: 'Prefeitura de Goiânia',
    icone: 'fa-city',
    links: [
      {
        titulo: 'Núcleo Especializado de Atendimento à Servidora',
        descricao: 'Orientações e contatos voltados a servidoras em casos de assédio, importunação ou violência.',
        url: 'https://www.goiania.go.gov.br/semasdh/nucleo-especializado-de-atendimento-a-servidora/',
        icone: 'fa-solid fa-user-shield'
      },
      {
        titulo: 'Secretaria Municipal de Políticas para as Mulheres, Assistência Social e Direitos Humanos',
        descricao: 'Informações sobre políticas públicas e equipamentos municipais de apoio.',
        url: 'https://www.goiania.go.gov.br/semasdh/sobre-a-secretaria/',
        icone: 'fa-solid fa-people-group'
      },
      {
        titulo: 'Ouvidoria e Atendimento – Prefeitura de Goiânia',
        descricao: 'Canal municipal para registro e encaminhamento de manifestações.',
        url: 'https://www.goiania.go.gov.br/ouvidoria-e-sic/ouvidoria-e-atendimento/',
        icone: 'fa-solid fa-comments'
      },
      {
        titulo: 'Acompanhar Manifestação – Ouvidoria',
        descricao: 'Consulta de protocolos e andamento de demandas registradas na Ouvidoria da Prefeitura.',
        url: 'https://www.goiania.go.gov.br/sing_transparencia/acompanhar-manifestacao-ouvidoria/',
        icone: 'fa-solid fa-magnifying-glass-chart'
      }
    ]
  },
  {
    grupo: 'Governo Federal',
    icone: 'fa-flag',
    links: [
      {
        titulo: 'Ligue 180 – Central de Atendimento à Mulher',
        descricao: 'Orientações, registro de denúncias e informações sobre a rede de proteção, 24 horas por dia.',
        url: 'https://www.gov.br/mulheres/pt-br/ligue180',
        icone: 'fa-solid fa-phone-volume',
        telefone: '180'
      },
      {
        titulo: 'Denunciar e buscar ajuda a vítimas de violência contra mulheres',
        descricao: 'Página de serviço do governo federal com canais e orientações de acolhimento.',
        url: 'https://www.gov.br/pt-br/servicos/denunciar-e-buscar-ajuda-a-vitimas-de-violencia-contra-mulheres',
        icone: 'fa-solid fa-hand-holding-heart'
      }
    ]
  },
  {
    grupo: 'Segurança Pública – Polícia Civil de Goiás',
    icone: 'fa-shield-halved',
    links: [
      {
        titulo: 'Delegacias Especializadas',
        descricao: 'Consulta das unidades especializadas da Polícia Civil de Goiás.',
        url: 'https://goias.gov.br/policiacivil/delegacias-especializadas/',
        icone: 'fa-solid fa-building-shield'
      },
      {
        titulo: 'Delegacia de Polícia 24h',
        descricao: 'Informações de plantão, incluindo a Delegacia Estadual de Atendimento Especializado à Mulher (DEAEM).',
        url: 'https://goias.gov.br/policiacivil/delegacia-de-policia-24hs/',
        icone: 'fa-solid fa-clock'
      },
      {
        titulo: 'DEAEM Goiânia no Instagram (@deaem_go)',
        descricao: 'Canal informativo da unidade especializada em atendimento à mulher em Goiânia.',
        url: 'https://www.instagram.com/deaem_go/',
        icone: 'fa-brands fa-instagram'
      }
    ]
  }
];
