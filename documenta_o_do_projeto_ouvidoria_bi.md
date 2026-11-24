# 📊 Ouvidoria BI — Portal Gerencial e Dashboard Web

Documentação técnica e arquitetural do **Portal Gerencial Web (Dashboard BI)** desenvolvido como projeto de extensão acadêmica para apoiar a coordenação da **Ouvidoria da Mulher**. O sistema transforma os registros alimentados diariamente no aplicativo principal (Flutter) em indicadores visuais, relatórios analíticos e planilhas exportáveis para tomada de decisão orientada a dados (*Data-Driven*).

---

## 🎯 1. Visão Geral e Objetivo

O aplicativo da Ouvidoria já realiza a captação e o registro estruturado de atendimentos psicológicos, cadastro de voluntárias, acompanhamento de assistidas e gestão de materiais informativos. 

O objetivo deste portal web é oferecer à coordenação um ambiente exclusivo de **Business Intelligence (BI)** acessível via navegador (desktop e mobile), mantendo **custo zero de infraestrutura** e alta velocidade de carregamento.

---

## 🛠️ 2. Arquitetura e Stack Tecnológica

Para garantir leveza, fácil manutenção e compatibilidade direta com hospedagens estáticas gratuitas, o portal é construído como uma **Single Page Application (SPA)** baseada em tecnologias web nativas (sem necessidade de servidor back-end dedicado):

* **Estrutura:** HTML5 Semântico.
* **Estilização:** [Tailwind CSS](https://tailwindcss.com/) (via CDN) com paleta institucional customizada (`#6A1B9A`).
* **Lógica e Interatividade:** JavaScript Puro (Vanilla JS) com gerenciamento de estado de abas, modais de *drill-down* e geração nativa de arquivos CSV.
* **Visualização de Dados:** [Chart.js](https://www.chartjs.org/) (gráfico híbrido de barras + linha com eventos interativos de clique).
* **Iconografia:** Font Awesome 6.

---

## ✨ 3. Funcionalidades Implementadas (MVP)

O painel é segmentado em quatro módulos principais e conta com recursos transversais de análise:

### 🔹 Recursos Globais
* **Barra de Segmentadores:** Filtros no cabeçalho para refinar a visualização por **Período (Mês)** e **Voluntária** (expansível para Assistida).
* **Exportação para Planilha (CSV):** Conversor nativo em JavaScript com suporte a codificação UTF-8 (BOM) para abrir acentuações corretamente no Excel, disponível nas tabelas principais e nos modais de detalhamento.

### 🔹 Aba 1: Resumo Geral (Painel Principal)
* **Cartões de KPI:** Volume de atendimentos, voluntárias ativas, assistidas atendidas e conversão consolidada em horas doadas (base de ~60 minutos por sessão).
* **Gráfico Interativo (Evolução Mensal):** Comparativo mensal entre volume de atendimentos (barras) e horas totais (linha).
* **Drill-down no Gráfico:** Ao clicar em qualquer barra de mês no gráfico, o sistema abre um modal listando a relação de voluntárias atuantes naquele período, quantidade de atendimentos realizados e número de assistidas únicas atendidas.

### 🔹 Aba 2: Detalhamento de Voluntárias
* Tabela consolidada com Nome da Profissional, Registro (CRP/OAB), Contato, Atendimentos Realizados, Horas Convertidas e Quantidade de Assistidas Atendidas.
* **Drill-down por Linha:** Ao clicar em uma voluntária, exibe o histórico completo contendo: *Data do atendimento, Nome da assistida, ID numérico da sessão e Status*.

### 🔹 Aba 3: Detalhamento de Assistidas
* Tabela consolidada com Nome, Telefone de Contato, Sessões Recebidas, Total de Horas, Data da Última Sessão e Status Atual.
* **Drill-down por Linha:** Ao clicar em uma assistida, exibe o histórico completo contendo: *Data do atendimento, ID numérico da sessão, Voluntária responsável e Status*.

### 🔹 Aba 4: Materiais e Informações (Mosaico)
* Visualização em formato de mosaico de cards refletindo os documentos ativos (PDFs, Imagens e Textos) disponibilizados na Central de Apoio do aplicativo principal.

---

## 🚀 4. Canal de Hospedagem (Netlify)

Por se tratar de uma aplicação front-end puramente estática (HTML/CSS/JS), a hospedagem é realizada gratuitamente através do **Netlify**, aproveitando sua CDN global e certificado SSL (HTTPS) automático.

### Fluxo de Publicação
1. **Estrutura de Deploy:** Renomear o arquivo principal do projeto para `index.html` dentro de uma pasta dedicada (ex: `/dist` ou raiz do repositório).
2. **Opção A — Deploy Rápido (Validação do MVP):**
   * Acessar o painel do [Netlify](https://www.netlify.com/).
   * Selecionar **Add new site > Deploy manually**.
   * Arrastar e soltar a pasta contendo o `index.html`.
   * O link público (ex: `ouvidoria-bi.netlify.app`) fica disponível em segundos.
3. **Opção B — Deploy Contínuo / CI-CD (Produção):**
   * Conectar o repositório GitHub do projeto diretamente ao Netlify.
   * A cada `git push` na branch `main`, o portal é atualizado automaticamente em produção.

---

## 🔌 5. Leitura e Integração de Dados (Supabase)

O portal não duplica a base de dados: ele consome em tempo real o **mesmo banco de dados PostgreSQL no Supabase** já utilizado pelo aplicativo Flutter da Ouvidoria.

### Como funciona a conexão no HTML
A comunicação é feita diretamente pelo navegador do usuário utilizando o SDK oficial `@supabase/supabase-js` carregado via CDN:

```html
<!-- 1. Importação do cliente Supabase via CDN -->
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>

<script>
  // 2. Inicialização do cliente (mesmas credenciais públicas do app Flutter)
  const SUPABASE_URL = 'https://SEU-PROJETO.supabase.co';
  const SUPABASE_ANON_KEY = 'SUA_CHAVE_PUBLICA_ANON';
  const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // 3. Exemplo de consulta assíncrona para alimentar o Dashboard
  async function carregarResumoVoluntarias() {
    const { data, error } = await supabaseClient
      .from('tb_usuario')
      .select('id, nome, registro, telefone, acesso_adm')
      .order('nome', { ascending: true });

    if (error) {
      console.error('Erro ao buscar dados no Supabase:', error);
      return;
    }
    
    // Função responsável por renderizar as linhas na tabela HTML
    renderizarTabelaVoluntarias(data);
  }
</script>
```

### Estratégia Recomendada para Agregações (Views SQL)
Para evitar processamento pesado no navegador e manter o painel instantâneo, recomenda-se criar **Views SQL** diretamente no Supabase (ex: `vw_resumo_mensal`, `vw_metricas_voluntarias`, `vw_metricas_assistidas`). Assim, o banco já entrega os cálculos de horas, contagens e últimas sessões prontos para o JavaScript apenas renderizar nos gráficos e tabelas.

---

## 🔐 6. Segurança e Controle de Acesso (Produção)

Enquanto o MVP utiliza dados fictícios (*mock*) para demonstração visual, a transição para produção com dados reais da ONG exige uma camada estrita de proteção:

1. **Barreira de Autenticação:** Implementação de uma tela de login inicial antes da exibição do painel, validando as credenciais da coordenação e verificando a permissão administrativa (`acesso_adm`).
2. **Row Level Security (RLS):** Configuração de políticas de segurança no PostgreSQL do Supabase garantindo que consultas de leitura em massa nas tabelas de sessões e assistidas sejam autorizadas apenas para sessões autenticadas com perfil de gestão.
3. **LGPD e Sigilo:** Como os relatórios envolvem dados sensíveis de mulheres assistidas, o acesso deve ser restrito exclusivamente à coordenação autorizada, utilizando conexão criptografada (HTTPS fornecido pelo Netlify).

---

## 🗺️ 7. Roadmap de Evolução

- [x] **Fase 1 (MVP):** Protótipo funcional em HTML/Tailwind/Chart.js com dados simulados, *drill-down* em tabelas e gráficos, e exportação CSV.
- [ ] **Fase 2 (Validação):** Apresentação do MVP hospedado no Netlify para aprovação da coordenação da Ouvidoria.
- [ ] **Fase 3 (Integração):** Criação das *Views* analíticas no Supabase e substituição dos dados *mock* por consultas reais via `supabase-js`.
- [ ] **Fase 4 (Blindagem):** Implementação da tela de login administrativo e revisão das políticas de RLS.
- [ ] **Fase 5 (Entrega Acadêmica):** Documentação final, evidências de uso pela entidade e fechamento do módulo extensionista.

---

**Autor:** Deivid Milhomem  
**Projeto:** Extensão Universitária — Análise e Desenvolvimento de Sistemas (ADS)