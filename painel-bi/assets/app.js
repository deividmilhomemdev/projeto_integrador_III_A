/*
 * Ouvidoria BI — logica do Portal Gerencial v1.0
 * -------------------------------------------------------------
 * Fluxo:
 *   1. Login (Supabase Auth, e-mail + senha)
 *   2. Confere se a conta e administradora (funcao is_admin_painel)
 *   3. Le as views vw_painel_* e a tabela tb_informacoes
 *   4. Calcula indicadores no navegador conforme os segmentadores
 *
 * Seguranca aplicada no front-end:
 *   - todo texto vindo do banco e "escapado" antes de ir para a tela (anti-XSS)
 *   - CSV protegido contra injecao de formulas do Excel
 *   - links aceitos somente com http/https
 *   - sessao guardada em sessionStorage (some ao fechar o navegador)
 *   - logout automatico por inatividade
 */
(function () {
  'use strict';

  const CFG = window.PAINEL_CONFIG || {};
  const HORAS_POR_SESSAO = Number(CFG.HORAS_POR_SESSAO) || 1;
  const MINUTOS_INATIVIDADE = Number(CFG.MINUTOS_INATIVIDADE) || 30;
  const TAMANHO_PAGINA = 1000;        // limite padrao de linhas por consulta no Supabase
  const LINHAS_ANIMADAS = 25;         // so as primeiras linhas entram com animacao
  const REDUZIR_MOVIMENTO = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const MESES_LONGOS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho',
    'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

  const STATUS = { REALIZADA: 'Realizada', DESISTENCIA: 'Desistência', ANDAMENTO: 'Em andamento' };

  // Abas que usam os segmentadores (ano/mes/voluntaria)
  const ABAS = {
    painel: { titulo: 'Segmentadores', icone: 'fa-filter', filtros: true },
    voluntarias: { titulo: 'Segmentadores', icone: 'fa-filter', filtros: true },
    assistidas: { titulo: 'Segmentadores', icone: 'fa-filter', filtros: true },
    materiais: { titulo: 'Central de Apoio', icone: 'fa-folder-open', filtros: false },
    links: { titulo: 'Links Úteis', icone: 'fa-link', filtros: false }
  };

  const state = {
    sessoes: [],
    voluntarias: [],
    assistidas: [],
    materiais: [],
    filtros: { ano: null, mes: 0, voluntaria: '' },
    grafico: null,
    exportModal: null,
    timerInatividade: null,
    timerModal: null
  };

  let sb = null;

  // ---------------------------------------------------------------
  // Utilitarios
  // ---------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const nf = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

  function esc(valor) {
    return String(valor ?? '').replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function fmtData(iso) {
    if (!iso) return '—';
    const [a, m, d] = String(iso).slice(0, 10).split('-');
    return `${d}/${m}/${a}`;
  }

  const fmtHorario = (t) => (t ? String(t).slice(0, 5) : '—');
  const horas = (qtdRealizadas) => qtdRealizadas * HORAS_POR_SESSAO;
  const fmtHoras = (qtdRealizadas) => nf.format(horas(qtdRealizadas)) + 'h';
  const plural = (n, um, varios) => `${nf.format(n)} ${n === 1 ? um : varios}`;
  const distintos = (lista, campo) => new Set(lista.map((x) => x[campo]).filter((v) => v != null)).size;
  const contar = (lista, status) => lista.filter((s) => s.status_sessao === status).length;

  function chaveOrdemSessao(s) {
    return `${s.data_sessao || '0000-00-00'} ${s.horario_sessao || '00:00'} ${String(s.numero_sessao ?? 0).padStart(6, '0')}`;
  }

  function badgeStatus(status) {
    const cores = {
      [STATUS.REALIZADA]: 'bg-green-100 text-green-800',
      [STATUS.DESISTENCIA]: 'bg-rose-100 text-rose-800',
      [STATUS.ANDAMENTO]: 'bg-amber-100 text-amber-800',
      'Em acompanhamento': 'bg-blue-100 text-blue-800',
      'Sem sessões': 'bg-gray-100 text-gray-600'
    };
    const cls = cores[status] || 'bg-gray-100 text-gray-700';
    return `<span class="${cls} py-1 px-3 rounded-full text-xs font-bold uppercase tracking-wider whitespace-nowrap">${esc(status)}</span>`;
  }

  function linhaVazia(colspan, texto) {
    return `<tr><td colspan="${colspan}" class="px-6 py-10 text-center text-gray-500">${esc(texto)}</td></tr>`;
  }

  // Atributos de animacao escalonada para o item de posicao i
  function anim(i, animar = true) {
    return animar && i < LINHAS_ANIMADAS ? ` style="--i:${i}"` : '';
  }
  const classeAnim = (i, animar = true) => (animar && i < LINHAS_ANIMADAS ? 'anim-item ' : '');

  /*
   * Linha de total (tfoot). Cada celula: { texto, alinhamento, destaque }.
   * O texto e escapado; "sub" (opcional) aparece menor, abaixo.
   */
  function htmlTotais(celulas) {
    return '<tr class="bg-purple-50/70 border-t-2 border-ouvidoria-light/40">' + celulas.map((c, i) => {
      const alinh = c.alinhamento === 'center' ? 'text-center' : 'text-left';
      const cor = i === 0 ? 'text-ouvidoria-dark' : 'text-gray-800';
      const sub = c.sub ? `<div class="text-[11px] font-medium text-gray-500 mt-0.5">${esc(c.sub)}</div>` : '';
      return `<td class="px-6 py-3 whitespace-nowrap ${alinh} ${cor} font-bold">${esc(c.texto ?? '')}${sub}</td>`;
    }).join('') + '</tr>';
  }

  // Converte as celulas de total em uma linha de CSV
  // (rotulos tecnicos como "soma" ficam so na tela, para o Excel tratar o valor como numero)
  const SUB_SO_TELA = ['soma', 'distintas', 'mais recente'];
  const totaisParaCSV = (celulas) => celulas.map((c) =>
    [c.texto, SUB_SO_TELA.includes(c.sub) ? '' : c.sub].filter(Boolean).join(' · '));

  // Contador animado dos KPIs (0 -> valor)
  function animarNumero(el, alvo, sufixoHtml = '') {
    const inicio = Number(el.dataset.valor || 0);
    el.dataset.valor = alvo;
    const pintar = (v) => { el.innerHTML = esc(nf.format(v)) + sufixoHtml; };
    if (el._raf) cancelAnimationFrame(el._raf);
    if (REDUZIR_MOVIMENTO || inicio === alvo) { pintar(alvo); return; }
    const t0 = performance.now();
    const duracao = 750;
    const passo = (t) => {
      const p = Math.min(1, (t - t0) / duracao);
      const suave = 1 - Math.pow(1 - p, 3);
      const v = inicio + (alvo - inicio) * suave;
      pintar(p < 1 ? (Number.isInteger(alvo) ? Math.round(v) : Math.round(v * 10) / 10) : alvo);
      if (p < 1) el._raf = requestAnimationFrame(passo);
    };
    el._raf = requestAnimationFrame(passo);
  }

  // CSV com ';' (padrao do Excel em portugues) + BOM UTF-8 para acentos
  function baixarCSV(nomeArquivo, cabecalho, linhas, totais) {
    const celula = (v) => {
      let s = String(v ?? '');
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // evita que o Excel execute formulas
      return '"' + s.replace(/"/g, '""') + '"';
    };
    const todas = [cabecalho, ...linhas];
    if (totais) todas.push(totais);
    const conteudo = todas.map((l) => l.map(celula).join(';')).join('\r\n');
    const blob = new Blob(['﻿' + conteudo], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nomeArquivo;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function urlSegura(url) {
    try {
      const u = new URL(String(url || '').trim());
      return (u.protocol === 'https:' || u.protocol === 'http:') ? u.href : null;
    } catch (_) {
      return null;
    }
  }

  // ---------------------------------------------------------------
  // Filtros e periodo
  // ---------------------------------------------------------------
  function sessoesDoPeriodo({ ignorarMes = false } = {}) {
    const f = state.filtros;
    return state.sessoes.filter((s) =>
      s.ano === f.ano &&
      (ignorarMes || !f.mes || s.mes === f.mes) &&
      (!f.voluntaria || String(s.id_usuario) === f.voluntaria)
    );
  }

  function rotuloPeriodo() {
    const f = state.filtros;
    if (f.ano == null) return 'sem dados';
    return f.mes ? `${MESES_LONGOS[f.mes - 1]} de ${f.ano}` : `Ano de ${f.ano}`;
  }

  function sufixoArquivo() {
    const f = state.filtros;
    return f.mes ? `${f.ano}-${String(f.mes).padStart(2, '0')}` : String(f.ano);
  }

  function nomeVoluntaria(id) {
    const v = state.voluntarias.find((x) => String(x.id_usuario) === String(id));
    return v ? v.nome_usuario : 'Sem voluntária vinculada';
  }

  // ---------------------------------------------------------------
  // Autenticacao
  // ---------------------------------------------------------------
  function configPreenchida() {
    return CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY &&
      !CFG.SUPABASE_URL.includes('SEU-PROJETO') && !CFG.SUPABASE_ANON_KEY.includes('SUA_CHAVE');
  }

  function mostrarErroLogin(msg) {
    const el = $('login-erro');
    if (msg) {
      el.textContent = msg;
      el.classList.remove('hidden');
    } else {
      el.textContent = '';
      el.classList.add('hidden');
    }
  }

  function mostrarLogin(msg) {
    pararTimerInatividade();
    $('app').classList.add('hidden');
    $('tela-login').classList.remove('hidden');
    fecharModal(true);
    if (msg) mostrarErroLogin(msg);
    $('login-senha').value = '';
  }

  function mostrarPainel() {
    $('tela-login').classList.add('hidden');
    $('app').classList.remove('hidden');
  }

  function travarBotaoEntrar(travar) {
    const btn = $('btn-entrar');
    btn.disabled = travar;
    btn.querySelector('span').textContent = travar ? 'Verificando...' : 'Entrar';
  }

  async function aoEnviarLogin(ev) {
    ev.preventDefault();
    mostrarErroLogin('');
    const email = $('login-email').value.trim();
    const senha = $('login-senha').value;
    if (!email || !senha) {
      mostrarErroLogin('Informe e-mail e senha.');
      return;
    }
    travarBotaoEntrar(true);
    try {
      const { data, error } = await sb.auth.signInWithPassword({ email, password: senha });
      if (error) {
        // Mensagem generica: nao revela se o e-mail existe
        mostrarErroLogin(error.status === 429
          ? 'Muitas tentativas. Aguarde alguns minutos e tente novamente.'
          : 'E-mail ou senha inválidos.');
        return;
      }
      await entrar(data.session);
    } catch (e) {
      console.error(e);
      mostrarErroLogin('Falha de conexão com o servidor. Verifique a internet e tente novamente.');
    } finally {
      travarBotaoEntrar(false);
    }
  }

  async function entrar(session) {
    const { data: ehAdmin, error } = await sb.rpc('is_admin_painel');
    if (error || ehAdmin !== true) {
      if (error) console.error('is_admin_painel:', error);
      await sb.auth.signOut();
      mostrarLogin(error
        ? 'Não foi possível validar a permissão. Confira se o script SQL do painel foi executado.'
        : 'Acesso restrito à coordenação. Esta conta não tem perfil administrativo.');
      return;
    }
    document.querySelectorAll('.usuario-logado').forEach((el) => { el.textContent = session.user.email; });
    $('login-senha').value = '';
    mostrarPainel();
    iniciarTimerInatividade();
    await carregarDados();
  }

  async function sair(msg) {
    try { await sb.auth.signOut(); } catch (_) { /* ignora */ }
    state.sessoes = []; state.voluntarias = []; state.assistidas = []; state.materiais = [];
    mostrarLogin(msg);
  }

  function iniciarTimerInatividade() {
    pararTimerInatividade();
    state.timerInatividade = setTimeout(
      () => sair('Sessão encerrada por inatividade. Entre novamente.'),
      MINUTOS_INATIVIDADE * 60 * 1000
    );
  }

  function pararTimerInatividade() {
    if (state.timerInatividade) clearTimeout(state.timerInatividade);
    state.timerInatividade = null;
  }

  function aoInteragir() {
    if (state.timerInatividade) iniciarTimerInatividade();
  }

  // ---------------------------------------------------------------
  // Carga de dados
  // ---------------------------------------------------------------
  async function buscarTodas(fonte, colunaOrdem) {
    let inicio = 0;
    let todas = [];
    for (;;) {
      const { data, error } = await sb.from(fonte).select('*')
        .order(colunaOrdem, { ascending: true })
        .range(inicio, inicio + TAMANHO_PAGINA - 1);
      if (error) throw new Error(`${fonte}: ${error.message}`);
      todas = todas.concat(data || []);
      if (!data || data.length < TAMANHO_PAGINA) break;
      inicio += TAMANHO_PAGINA;
    }
    return todas;
  }

  async function carregarDados() {
    $('carregando').classList.remove('hidden');
    $('aviso-erro').classList.add('hidden');
    try {
      const [sessoes, voluntarias, assistidas, materiais] = await Promise.all([
        buscarTodas('vw_painel_sessoes', 'id_sessao'),
        buscarTodas('vw_painel_voluntarias', 'id_usuario'),
        buscarTodas('vw_painel_assistidas', 'id_assistida'),
        buscarTodas('tb_informacoes', 'ordem')
      ]);

      state.sessoes = sessoes.map((s) => ({
        ...s,
        ano: s.ano == null ? null : Number(s.ano),
        mes: s.mes == null ? null : Number(s.mes)
      }));
      state.voluntarias = voluntarias;
      state.assistidas = assistidas;
      state.materiais = materiais.sort((a, b) => Number(a.ordem ?? 0) - Number(b.ordem ?? 0));

      montarFiltros();
      renderizarTudo();
      $('rotulo-atualizacao').textContent = new Date().toLocaleString('pt-BR');
    } catch (e) {
      console.error(e);
      $('aviso-erro-texto').textContent = e.message || 'Erro desconhecido.';
      $('aviso-erro').classList.remove('hidden');
    } finally {
      $('carregando').classList.add('hidden');
    }
  }

  // ---------------------------------------------------------------
  // Segmentadores
  // ---------------------------------------------------------------
  function voluntariasParaListar() {
    const comSessao = new Set(state.sessoes.map((s) => String(s.id_usuario)));
    return state.voluntarias
      .filter((v) => !v.is_admin || comSessao.has(String(v.id_usuario)))
      .sort((a, b) => String(a.nome_usuario).localeCompare(String(b.nome_usuario), 'pt-BR'));
  }

  function montarFiltros() {
    const anoAtual = new Date().getFullYear();
    const anos = [...new Set(state.sessoes.map((s) => s.ano).filter((a) => a != null))].sort((a, b) => b - a);
    if (!anos.length) anos.push(anoAtual);

    const f = state.filtros;
    if (f.ano == null || !anos.includes(f.ano)) f.ano = anos.includes(anoAtual) ? anoAtual : anos[0];

    $('filtro-ano').innerHTML = anos.map((a) => `<option value="${a}">${a}</option>`).join('');
    $('filtro-ano').value = String(f.ano);

    $('filtro-mes').innerHTML = '<option value="0">Todos os meses</option>' +
      MESES_LONGOS.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('');
    $('filtro-mes').value = String(f.mes);

    const lista = voluntariasParaListar();
    $('filtro-voluntaria').innerHTML = '<option value="">Todas as voluntárias</option>' +
      lista.map((v) => `<option value="${esc(v.id_usuario)}">${esc(v.nome_usuario)}</option>`).join('');
    if (!lista.some((v) => String(v.id_usuario) === f.voluntaria)) f.voluntaria = '';
    $('filtro-voluntaria').value = f.voluntaria;
  }

  function aoMudarFiltro() {
    state.filtros.ano = Number($('filtro-ano').value);
    state.filtros.mes = Number($('filtro-mes').value);
    state.filtros.voluntaria = $('filtro-voluntaria').value;
    renderizarTudo();
  }

  // ---------------------------------------------------------------
  // Renderizacao
  // ---------------------------------------------------------------
  function renderizarTudo() {
    $('rotulo-periodo').textContent = rotuloPeriodo();
    renderizarKPIs();
    renderizarGrafico();
    renderizarVoluntarias(true);
    renderizarAssistidas(true);
    renderizarMateriais();
  }

  function renderizarKPIs() {
    const periodo = sessoesDoPeriodo();
    const realizadas = periodo.filter((s) => s.status_sessao === STATUS.REALIZADA);

    animarNumero($('kpi-atendimentos'), realizadas.length);
    $('kpi-atendimentos-sub').textContent =
      `${plural(contar(periodo, STATUS.DESISTENCIA), 'desistência', 'desistências')} · ${nf.format(contar(periodo, STATUS.ANDAMENTO))} em andamento`;

    animarNumero($('kpi-voluntarias'), distintos(realizadas, 'id_usuario'));
    $('kpi-voluntarias-sub').textContent = `de ${nf.format(voluntariasParaListar().length)} cadastradas`;

    animarNumero($('kpi-assistidas'), distintos(realizadas, 'id_assistida'));
    $('kpi-assistidas-sub').textContent = `de ${nf.format(state.assistidas.length)} cadastradas`;

    animarNumero($('kpi-horas'), horas(realizadas.length), '<span class="text-lg text-gray-500 ml-1">hrs</span>');
    $('kpi-horas-sub').textContent = `estimativa: ${nf.format(HORAS_POR_SESSAO)}h por sessão realizada`;
  }

  function renderizarGrafico() {
    const doAno = sessoesDoPeriodo({ ignorarMes: true }).filter((s) => s.status_sessao === STATUS.REALIZADA);
    const porMes = new Array(12).fill(0);
    doAno.forEach((s) => { if (s.mes >= 1 && s.mes <= 12) porMes[s.mes - 1] += 1; });
    const horasMes = porMes.map((q) => horas(q));
    const mesSel = state.filtros.mes;
    const coresBarras = porMes.map((_, i) => (!mesSel || mesSel === i + 1 ? '#6A1B9A' : '#d8c3e6'));

    $('rotulo-ano-grafico').innerHTML = `<i class="fa-regular fa-calendar mr-1"></i> ${esc(state.filtros.ano ?? '')}`;

    if (typeof Chart === 'undefined') return; // CDN indisponivel: painel segue sem o grafico

    if (state.grafico) {
      state.grafico.data.datasets[0].data = horasMes;
      state.grafico.data.datasets[1].data = porMes;
      state.grafico.data.datasets[1].backgroundColor = coresBarras;
      state.grafico.update();
      return;
    }

    state.grafico = new Chart($('grafico-mensal').getContext('2d'), {
      type: 'bar',
      data: {
        labels: MESES,
        datasets: [
          {
            type: 'line',
            label: 'Horas Doadas',
            data: horasMes,
            borderColor: '#eab308',
            backgroundColor: '#eab308',
            borderWidth: 3,
            tension: 0.4,
            pointRadius: 3,
            pointHoverRadius: 7
          },
          {
            type: 'bar',
            label: 'Atendimentos Realizados',
            data: porMes,
            backgroundColor: coresBarras,
            hoverBackgroundColor: '#9c4dcc',
            borderRadius: 6,
            barPercentage: 0.6
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        // Barras "crescem" uma apos a outra na primeira exibicao
        animation: REDUZIR_MOVIMENTO ? false : {
          duration: 900,
          easing: 'easeOutQuart',
          delay: (ctx) => (ctx.type === 'data' && ctx.mode === 'default' ? ctx.dataIndex * 60 : 0)
        },
        onClick: (_evt, elementos) => {
          if (elementos && elementos.length) abrirModalMes(elementos[0].index + 1);
        },
        onHover: (evt, elementos) => {
          evt.native.target.style.cursor = elementos[0] ? 'pointer' : 'default';
        },
        interaction: { mode: 'index', intersect: false },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
        plugins: {
          legend: { position: 'top' },
          tooltip: {
            callbacks: {
              label: (ctx) => ctx.dataset.type === 'line'
                ? ` Horas doadas: ${nf.format(ctx.parsed.y)}h`
                : ` Atendimentos: ${nf.format(ctx.parsed.y)}`
            }
          }
        }
      }
    });
  }

  // ---- Voluntarias -----------------------------------------------
  function dadosVoluntarias() {
    const periodo = sessoesDoPeriodo();
    const busca = $('busca-voluntarias').value.trim().toLowerCase();
    return voluntariasParaListar()
      .filter((v) => !state.filtros.voluntaria || String(v.id_usuario) === state.filtros.voluntaria)
      .filter((v) => !busca || `${v.nome_usuario} ${v.crp}`.toLowerCase().includes(busca))
      .map((v) => {
        const realizadas = periodo.filter((s) =>
          String(s.id_usuario) === String(v.id_usuario) && s.status_sessao === STATUS.REALIZADA);
        const idsAssistidas = new Set(realizadas.map((s) => s.id_assistida));
        return { ...v, atendimentos: realizadas.length, idsAssistidas, assistidasUnicas: idsAssistidas.size };
      })
      .sort((a, b) => b.atendimentos - a.atendimentos ||
        String(a.nome_usuario).localeCompare(String(b.nome_usuario), 'pt-BR'));
  }

  function totaisVoluntarias(linhas) {
    const atend = linhas.reduce((t, v) => t + v.atendimentos, 0);
    const assist = new Set(linhas.flatMap((v) => [...v.idsAssistidas])).size;
    const ativas = linhas.filter((v) => v.atendimentos > 0).length;
    return [
      { texto: `Total · ${plural(linhas.length, 'voluntária', 'voluntárias')}` },
      { texto: `${plural(ativas, 'com atendimento', 'com atendimentos')}` },
      { texto: '' },
      { texto: nf.format(atend), alinhamento: 'center', sub: 'soma' },
      { texto: fmtHoras(atend), alinhamento: 'center', sub: 'soma' },
      { texto: plural(assist, 'mulher', 'mulheres'), alinhamento: 'center', sub: 'distintas' }
    ];
  }

  function renderizarVoluntarias(animar = false) {
    const linhas = dadosVoluntarias();
    $('tbody-voluntarias').innerHTML = linhas.length ? linhas.map((v, i) => `
      <tr data-id="${esc(v.id_usuario)}" tabindex="0"${anim(i, animar)} class="${classeAnim(i, animar)}linha-click hover:bg-purple-50/50 cursor-pointer group">
        <td class="px-6 py-4 whitespace-nowrap font-medium text-gray-900 group-hover:text-ouvidoria-main transition-colors">${esc(v.nome_usuario)}</td>
        <td class="px-6 py-4 whitespace-nowrap text-gray-600">${esc(v.crp || '—')}</td>
        <td class="px-6 py-4 whitespace-nowrap text-gray-600">${esc(v.contato || '—')}</td>
        <td class="px-6 py-4 whitespace-nowrap text-center font-bold text-ouvidoria-main">${nf.format(v.atendimentos)}</td>
        <td class="px-6 py-4 whitespace-nowrap text-center text-gray-700 font-semibold">${fmtHoras(v.atendimentos)}</td>
        <td class="px-6 py-4 whitespace-nowrap text-center font-bold text-emerald-600">${plural(v.assistidasUnicas, 'mulher', 'mulheres')}</td>
      </tr>`).join('') : linhaVazia(6, 'Nenhuma voluntária encontrada.');
    $('tfoot-voluntarias').innerHTML = linhas.length ? htmlTotais(totaisVoluntarias(linhas)) : '';
  }

  function exportarVoluntarias() {
    const linhas = dadosVoluntarias();
    baixarCSV(`voluntarias_${sufixoArquivo()}.csv`,
      ['Voluntária', 'CRP', 'Contato', 'Atendimentos realizados', 'Horas doadas', 'Assistidas atendidas', 'Período'],
      linhas.map((v) => [v.nome_usuario, v.crp, v.contato, v.atendimentos,
        nf.format(horas(v.atendimentos)), v.assistidasUnicas, rotuloPeriodo()]),
      linhas.length ? [...totaisParaCSV(totaisVoluntarias(linhas)), rotuloPeriodo()] : null);
  }

  function abrirModalVoluntaria(id) {
    const sessoes = sessoesDoPeriodo()
      .filter((s) => String(s.id_usuario) === String(id))
      .sort((a, b) => chaveOrdemSessao(b).localeCompare(chaveOrdemSessao(a)));
    const realizadas = contar(sessoes, STATUS.REALIZADA);
    const nome = nomeVoluntaria(id);

    abrirModalTabela({
      titulo: `Histórico da Voluntária: ${nome}`,
      subtitulo: `${rotuloPeriodo()} · sessões de todas as situações (realizadas, desistências e em andamento).`,
      colunas: [['Data', 'left'], ['Horário', 'center'], ['Assistida', 'left'], ['Nº Sessão', 'center'], ['Status', 'center']],
      linhas: sessoes.map((s) => [
        fmtData(s.data_sessao), fmtHorario(s.horario_sessao), s.nome_assistida,
        s.numero_sessao ?? '—', { html: badgeStatus(s.status_sessao) }
      ]),
      totais: [
        { texto: `Total · ${plural(sessoes.length, 'sessão', 'sessões')}` },
        { texto: '' },
        { texto: plural(distintos(sessoes, 'id_assistida'), 'assistida', 'assistidas'), sub: 'distintas' },
        { texto: '' },
        {
          texto: `${nf.format(realizadas)} realizadas · ${fmtHoras(realizadas)}`, alinhamento: 'center',
          sub: `${nf.format(contar(sessoes, STATUS.DESISTENCIA))} desist. · ${nf.format(contar(sessoes, STATUS.ANDAMENTO))} em andamento`
        }
      ],
      csv: {
        nome: `historico_voluntaria_${id}_${sufixoArquivo()}.csv`,
        cabecalho: ['Data', 'Horário', 'Assistida', 'Nº sessão', 'Status', 'ID sessão', 'Voluntária'],
        linhas: sessoes.map((s) => [fmtData(s.data_sessao), fmtHorario(s.horario_sessao), s.nome_assistida,
          s.numero_sessao, s.status_sessao, s.id_sessao, nome])
      }
    });
  }

  // ---- Assistidas ------------------------------------------------
  function dadosAssistidas() {
    const periodo = sessoesDoPeriodo();
    const busca = $('busca-assistidas').value.trim().toLowerCase();
    const incluirSemSessao = $('chk-sem-sessoes').checked;

    // situacao atual = ultima sessao registrada (qualquer periodo)
    const ultimaGeral = new Map();
    state.sessoes.forEach((s) => {
      const atual = ultimaGeral.get(s.id_assistida);
      if (!atual || chaveOrdemSessao(s) > chaveOrdemSessao(atual)) ultimaGeral.set(s.id_assistida, s);
    });

    return state.assistidas
      .filter((a) => !state.filtros.voluntaria || String(a.id_usuario) === state.filtros.voluntaria)
      .filter((a) => !busca || `${a.nome} ${a.contato}`.toLowerCase().includes(busca))
      .map((a) => {
        const doPeriodo = periodo.filter((s) => s.id_assistida === a.id_assistida);
        const ultimaPeriodo = doPeriodo.reduce((m, s) =>
          (!m || chaveOrdemSessao(s) > chaveOrdemSessao(m) ? s : m), null);
        const ultima = ultimaGeral.get(a.id_assistida);
        let situacao = 'Sem sessões';
        if (ultima) situacao = ultima.status_sessao === STATUS.DESISTENCIA ? STATUS.DESISTENCIA : 'Em acompanhamento';
        return {
          ...a,
          sessoesPeriodo: doPeriodo.length,
          realizadas: contar(doPeriodo, STATUS.REALIZADA),
          ultimaData: ultimaPeriodo ? ultimaPeriodo.data_sessao : null,
          situacao
        };
      })
      .filter((a) => incluirSemSessao || a.sessoesPeriodo > 0)
      .sort((a, b) => b.realizadas - a.realizadas ||
        String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
  }

  function totaisAssistidas(linhas) {
    const realizadas = linhas.reduce((t, a) => t + a.realizadas, 0);
    const maisRecente = linhas.map((a) => a.ultimaData).filter(Boolean).sort().pop();
    const qtd = (sit) => linhas.filter((a) => a.situacao === sit).length;
    return [
      { texto: `Total · ${plural(linhas.length, 'assistida', 'assistidas')}` },
      { texto: '' },
      { texto: plural(distintos(linhas, 'id_usuario'), 'voluntária', 'voluntárias'), sub: 'distintas' },
      { texto: nf.format(realizadas), alinhamento: 'center', sub: 'soma' },
      { texto: fmtHoras(realizadas), alinhamento: 'center', sub: 'soma' },
      { texto: fmtData(maisRecente), alinhamento: 'center', sub: 'mais recente' },
      {
        texto: `${nf.format(qtd('Em acompanhamento'))} em acomp.`, alinhamento: 'center',
        sub: `${nf.format(qtd(STATUS.DESISTENCIA))} desist. · ${nf.format(qtd('Sem sessões'))} sem sessões`
      }
    ];
  }

  function renderizarAssistidas(animar = false) {
    const linhas = dadosAssistidas();
    $('tbody-assistidas').innerHTML = linhas.length ? linhas.map((a, i) => `
      <tr data-id="${esc(a.id_assistida)}" tabindex="0"${anim(i, animar)} class="${classeAnim(i, animar)}linha-click hover:bg-purple-50/50 cursor-pointer group">
        <td class="px-6 py-4 whitespace-nowrap font-medium text-gray-900 group-hover:text-ouvidoria-main transition-colors">${esc(a.nome)}</td>
        <td class="px-6 py-4 whitespace-nowrap text-gray-600">${esc(a.contato || '—')}</td>
        <td class="px-6 py-4 whitespace-nowrap text-gray-600">${esc(a.nome_voluntaria || 'Sem voluntária vinculada')}</td>
        <td class="px-6 py-4 whitespace-nowrap text-center font-bold text-gray-800">${nf.format(a.realizadas)}</td>
        <td class="px-6 py-4 whitespace-nowrap text-center text-gray-700 font-semibold">${fmtHoras(a.realizadas)}</td>
        <td class="px-6 py-4 whitespace-nowrap text-center text-gray-600">${fmtData(a.ultimaData)}</td>
        <td class="px-6 py-4 whitespace-nowrap text-center">${badgeStatus(a.situacao)}</td>
      </tr>`).join('') : linhaVazia(7, 'Nenhuma assistida com sessões no período selecionado.');
    $('tfoot-assistidas').innerHTML = linhas.length ? htmlTotais(totaisAssistidas(linhas)) : '';
  }

  function exportarAssistidas() {
    const linhas = dadosAssistidas();
    baixarCSV(`assistidas_${sufixoArquivo()}.csv`,
      ['Assistida', 'Telefone', 'Voluntária responsável', 'Sessões realizadas', 'Total de horas',
        'Última sessão no período', 'Situação atual', 'Período'],
      linhas.map((a) => [a.nome, a.contato, a.nome_voluntaria, a.realizadas,
        nf.format(horas(a.realizadas)), fmtData(a.ultimaData), a.situacao, rotuloPeriodo()]),
      linhas.length ? [...totaisParaCSV(totaisAssistidas(linhas)), rotuloPeriodo()] : null);
  }

  function abrirModalAssistida(id) {
    const assistida = state.assistidas.find((a) => String(a.id_assistida) === String(id));
    const nome = assistida ? assistida.nome : `Assistida ${id}`;
    const sessoes = sessoesDoPeriodo()
      .filter((s) => String(s.id_assistida) === String(id))
      .sort((a, b) => chaveOrdemSessao(b).localeCompare(chaveOrdemSessao(a)));
    const realizadas = contar(sessoes, STATUS.REALIZADA);

    abrirModalTabela({
      titulo: `Histórico da Assistida: ${nome}`,
      subtitulo: `${rotuloPeriodo()} · sessões de todas as situações (realizadas, desistências e em andamento).`,
      colunas: [['Data', 'left'], ['Horário', 'center'], ['Nº Sessão', 'center'], ['Voluntária', 'left'], ['Status', 'center']],
      linhas: sessoes.map((s) => [
        fmtData(s.data_sessao), fmtHorario(s.horario_sessao), s.numero_sessao ?? '—',
        s.nome_voluntaria || '—', { html: badgeStatus(s.status_sessao) }
      ]),
      totais: [
        { texto: `Total · ${plural(sessoes.length, 'sessão', 'sessões')}` },
        { texto: '' },
        { texto: '' },
        { texto: plural(distintos(sessoes, 'id_usuario'), 'voluntária', 'voluntárias'), sub: 'distintas' },
        {
          texto: `${nf.format(realizadas)} realizadas · ${fmtHoras(realizadas)}`, alinhamento: 'center',
          sub: `${nf.format(contar(sessoes, STATUS.DESISTENCIA))} desist. · ${nf.format(contar(sessoes, STATUS.ANDAMENTO))} em andamento`
        }
      ],
      csv: {
        nome: `historico_assistida_${id}_${sufixoArquivo()}.csv`,
        cabecalho: ['Data', 'Horário', 'Nº sessão', 'Voluntária', 'Status', 'ID sessão', 'Assistida'],
        linhas: sessoes.map((s) => [fmtData(s.data_sessao), fmtHorario(s.horario_sessao), s.numero_sessao,
          s.nome_voluntaria, s.status_sessao, s.id_sessao, nome])
      }
    });
  }

  // ---- Drill-down do grafico (mes) -------------------------------
  function abrirModalMes(mes) {
    const f = state.filtros;
    const doMes = state.sessoes.filter((s) =>
      s.ano === f.ano && s.mes === mes &&
      (!f.voluntaria || String(s.id_usuario) === f.voluntaria) &&
      s.status_sessao === STATUS.REALIZADA);

    const grupos = new Map();
    doMes.forEach((s) => {
      const k = String(s.id_usuario);
      if (!grupos.has(k)) grupos.set(k, { nome: s.nome_voluntaria || 'Sem voluntária vinculada', qtd: 0, assistidas: new Set() });
      const g = grupos.get(k);
      g.qtd += 1;
      g.assistidas.add(s.id_assistida);
    });
    const linhas = [...grupos.values()].sort((a, b) => b.qtd - a.qtd || a.nome.localeCompare(b.nome, 'pt-BR'));
    const rotulo = `${MESES_LONGOS[mes - 1]} de ${f.ano}`;

    abrirModalTabela({
      titulo: `Detalhamento Mensal: ${rotulo}`,
      subtitulo: 'Atendimentos realizados no mês, por voluntária.',
      colunas: [['Profissional / Voluntária', 'left'], ['Atendimentos no Mês', 'center'], ['Horas Doadas', 'center'], ['Assistidas Únicas', 'center']],
      linhas: linhas.map((g) => [g.nome, g.qtd, fmtHoras(g.qtd), g.assistidas.size]),
      totais: [
        { texto: `Total · ${plural(linhas.length, 'voluntária', 'voluntárias')}` },
        { texto: nf.format(doMes.length), alinhamento: 'center', sub: 'soma' },
        { texto: fmtHoras(doMes.length), alinhamento: 'center', sub: 'soma' },
        { texto: nf.format(distintos(doMes, 'id_assistida')), alinhamento: 'center', sub: 'distintas' }
      ],
      csv: {
        nome: `detalhamento_${f.ano}-${String(mes).padStart(2, '0')}.csv`,
        cabecalho: ['Voluntária', 'Atendimentos no mês', 'Horas doadas', 'Assistidas únicas', 'Mês'],
        linhas: linhas.map((g) => [g.nome, g.qtd, nf.format(horas(g.qtd)), g.assistidas.size, rotulo])
      }
    });
  }

  // ---- Materiais -------------------------------------------------
  const TIPOS_MATERIAL = {
    pdf: { icone: 'fa-file-pdf', cor: 'bg-red-50 text-red-500', rotulo: 'PDF', acao: 'Abrir documento' },
    imagem: { icone: 'fa-image', cor: 'bg-blue-50 text-blue-500', rotulo: 'Imagem', acao: 'Abrir imagem' },
    texto: { icone: 'fa-file-lines', cor: 'bg-purple-50 text-purple-600', rotulo: 'Texto', acao: 'Acessar link' }
  };
  const tipoMaterial = (m) => TIPOS_MATERIAL[String(m.tipo || '').toLowerCase()] || TIPOS_MATERIAL.texto;

  function renderizarMateriais() {
    const grid = $('grid-materiais');
    if (!state.materiais.length) {
      grid.innerHTML = '<p class="text-gray-500 col-span-full">Nenhum material publicado na Central de Apoio.</p>';
      return;
    }
    grid.innerHTML = state.materiais.map((m, i) => {
      const tipo = tipoMaterial(m);
      const link = urlSegura(m.url);
      const miniatura = (String(m.tipo).toLowerCase() === 'imagem' && link)
        ? `<img src="${esc(link)}" alt="" loading="lazy" referrerpolicy="no-referrer" class="w-full h-32 object-contain rounded-lg mb-3 bg-gray-50">`
        : '';
      const temLink = link ? '<span class="text-xs text-gray-400" title="Possui link"><i class="fa-solid fa-link mr-1"></i>com link</span>' : '<span></span>';
      return `
        <div data-material="${i}" style="--i:${i}" tabindex="0" role="button" aria-label="Visualizar ${esc(m.titulo || 'material')}"
             class="anim-item card-hover cursor-pointer bg-white rounded-xl shadow-md border border-gray-100 p-5 flex flex-col h-full">
          <div class="flex justify-between items-start mb-4">
            <div class="${tipo.cor} p-3 rounded-lg"><i class="fa-solid ${tipo.icone} text-2xl"></i></div>
            <span class="bg-gray-100 text-gray-600 text-xs px-2.5 py-1 rounded-full font-bold">${tipo.rotulo}</span>
          </div>
          ${miniatura}
          <h4 class="text-lg font-bold text-gray-800 mb-2 line-clamp-2">${esc(m.titulo || 'Sem título')}</h4>
          <p class="text-gray-500 text-sm flex-1 line-clamp-3">${esc(m.descricao || '')}</p>
          <div class="mt-4 pt-4 border-t border-gray-100 flex justify-between items-center">
            ${temLink}
            <span class="text-ouvidoria-main text-sm font-medium"><i class="fa-solid fa-eye mr-1"></i> Visualizar</span>
          </div>
        </div>`;
    }).join('');
  }

  // Texto puro com URLs transformadas em links (montado via DOM, sem innerHTML)
  function textoComLinks(texto) {
    const frag = document.createDocumentFragment();
    const partes = String(texto || '').split(/(https?:\/\/[^\s<>"']+)/g);
    partes.forEach((p, i) => {
      const url = i % 2 === 1 ? urlSegura(p) : null;
      if (url) {
        const a = document.createElement('a');
        a.href = url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.className = 'text-ouvidoria-main underline break-all';
        a.textContent = p;
        frag.appendChild(a);
      } else {
        frag.appendChild(document.createTextNode(p));
      }
    });
    return frag;
  }

  function abrirModalMaterial(m) {
    const tipo = tipoMaterial(m);
    const link = urlSegura(m.url);
    const box = $('modal-material');
    box.replaceChildren();

    if (String(m.tipo).toLowerCase() === 'imagem' && link) {
      const img = document.createElement('img');
      img.src = link;
      img.alt = m.titulo || '';
      img.referrerPolicy = 'no-referrer';
      img.className = 'max-h-80 mx-auto object-contain rounded-lg bg-gray-50 mb-5';
      box.appendChild(img);
    }

    const texto = document.createElement('div');
    texto.className = 'whitespace-pre-line text-gray-700 leading-relaxed';
    if (m.conteudo) {
      texto.appendChild(textoComLinks(m.conteudo));
    } else {
      texto.className += ' text-gray-400 italic';
      texto.textContent = link ? 'Este material não possui texto. Use o botão abaixo para acessar o conteúdo.' : 'Este material não possui conteúdo cadastrado.';
    }
    box.appendChild(texto);

    if (link) {
      const rodape = document.createElement('div');
      rodape.className = 'mt-6 pt-4 border-t border-gray-100 flex flex-wrap items-center justify-between gap-3';
      const dominio = document.createElement('span');
      dominio.className = 'text-xs text-gray-400 break-all';
      dominio.textContent = new URL(link).hostname;
      const a = document.createElement('a');
      a.href = link;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.className = 'btn-anim inline-flex items-center gap-2 bg-ouvidoria-main hover:bg-ouvidoria-dark text-white text-sm font-semibold px-4 py-2 rounded-lg shadow-sm';
      a.innerHTML = `<i class="fa-solid fa-arrow-up-right-from-square"></i> ${esc(tipo.acao)}`;
      rodape.append(dominio, a);
      box.appendChild(rodape);
    }

    $('modal-titulo').textContent = m.titulo || 'Material';
    $('modal-subtitulo').textContent = m.descricao || '';
    box.classList.remove('hidden');
    $('modal-tabela-wrap').classList.add('hidden');
    $('modal-csv').classList.add('hidden');
    state.exportModal = null;
    exibirModal();
  }

  // ---- Links uteis -----------------------------------------------
  function renderizarLinks() {
    const grupos = window.LINKS_UTEIS || [];
    let n = 0;
    $('lista-links').innerHTML = grupos.map((g) => `
      <div>
        <h3 class="text-sm font-bold uppercase tracking-wider text-ouvidoria-main mb-4 flex items-center gap-2">
          <i class="fa-solid ${esc(g.icone)}"></i> ${esc(g.grupo)}
        </h3>
        <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
          ${g.links.map((l) => {
            const url = urlSegura(l.url);
            if (!url) return '';
            const i = n++;
            const tel = l.telefone ? `
              <a href="tel:${esc(String(l.telefone).replace(/[^0-9+]/g, ''))}" class="btn-anim inline-flex items-center gap-2 bg-rose-600 hover:bg-rose-700 text-white text-sm font-semibold px-4 py-2 rounded-lg shadow-sm">
                <i class="fa-solid fa-phone"></i> Ligar ${esc(l.telefone)}
              </a>` : '';
            return `
              <div class="anim-item card-hover bg-white rounded-xl shadow-md border border-gray-100 p-5 flex flex-col" style="--i:${i}">
                <div class="flex items-start gap-4 flex-1">
                  <div class="icone-kpi flex-shrink-0 w-12 h-12 rounded-xl bg-purple-50 text-ouvidoria-main flex items-center justify-center">
                    <i class="${esc(l.icone || 'fa-solid fa-link')} text-xl"></i>
                  </div>
                  <div class="min-w-0">
                    <h4 class="font-bold text-gray-800 leading-snug">${esc(l.titulo)}</h4>
                    <p class="text-sm text-gray-500 mt-1">${esc(l.descricao)}</p>
                  </div>
                </div>
                <div class="mt-4 pt-4 border-t border-gray-100 flex flex-wrap items-center justify-between gap-2">
                  <span class="text-xs text-gray-400 truncate max-w-[12rem]">${esc(new URL(url).hostname)}</span>
                  <div class="flex gap-2">
                    ${tel}
                    <a href="${esc(url)}" target="_blank" rel="noopener noreferrer" class="btn-anim inline-flex items-center gap-2 bg-ouvidoria-main hover:bg-ouvidoria-dark text-white text-sm font-semibold px-4 py-2 rounded-lg shadow-sm">
                      Acessar <i class="fa-solid fa-arrow-up-right-from-square text-xs"></i>
                    </a>
                  </div>
                </div>
              </div>`;
          }).join('')}
        </div>
      </div>`).join('');
  }

  // ---------------------------------------------------------------
  // Modal
  // ---------------------------------------------------------------
  function abrirModalTabela({ titulo, subtitulo, colunas, linhas, totais, csv }) {
    $('modal-titulo').textContent = titulo;
    $('modal-subtitulo').textContent = subtitulo;
    $('modal-material').classList.add('hidden');
    $('modal-tabela-wrap').classList.remove('hidden');
    $('modal-csv').classList.remove('hidden');

    const alinh = (a) => (a === 'center' ? 'text-center' : 'text-left');
    $('modal-thead').innerHTML = '<tr>' + colunas.map(([rotulo, a]) =>
      `<th scope="col" class="px-6 py-4 ${alinh(a)} font-bold text-gray-700">${esc(rotulo)}</th>`).join('') + '</tr>';
    $('modal-tbody').innerHTML = linhas.length ? linhas.map((l, n) =>
      `<tr${anim(n)} class="${classeAnim(n)}hover:bg-purple-50/50 transition-colors">` +
      l.map((c, i) => `<td class="px-6 py-3 whitespace-nowrap ${alinh(colunas[i][1])} ${i === 0 ? 'text-gray-900 font-medium' : 'text-gray-600'}">${
        c && typeof c === 'object' && 'html' in c ? c.html : esc(c)}</td>`).join('') + '</tr>').join('')
      : linhaVazia(colunas.length, 'Nenhum registro encontrado no período.');
    $('modal-tfoot').innerHTML = linhas.length && totais ? htmlTotais(totais) : '';

    state.exportModal = csv && totais && linhas.length
      ? { ...csv, totais: totaisParaCSV(totais).concat(new Array(Math.max(0, csv.cabecalho.length - totais.length)).fill('')) }
      : csv;
    exibirModal();
  }

  function exibirModal() {
    clearTimeout(state.timerModal);
    const modal = $('modal');
    modal.classList.remove('hidden');
    requestAnimationFrame(() => requestAnimationFrame(() => modal.classList.add('aberto')));
    $('modal-fechar').focus();
  }

  function fecharModal(imediato = false) {
    const modal = $('modal');
    modal.classList.remove('aberto');
    clearTimeout(state.timerModal);
    if (imediato || REDUZIR_MOVIMENTO) modal.classList.add('hidden');
    else state.timerModal = setTimeout(() => modal.classList.add('hidden'), 220);
  }

  // ---------------------------------------------------------------
  // Navegacao
  // ---------------------------------------------------------------
  function trocarAba(aba) {
    const cfg = ABAS[aba] || ABAS.painel;
    document.querySelectorAll('.tab-content').forEach((s) => s.classList.toggle('active', s.id === aba));
    document.querySelectorAll('aside .nav-btn').forEach((b) => {
      const ativo = b.dataset.tab === aba;
      b.classList.toggle('ativo', ativo);
      b.classList.toggle('bg-white/20', ativo);
      b.classList.toggle('text-white', ativo);
      b.classList.toggle('text-white/70', !ativo);
      b.classList.toggle('hover:bg-white/10', !ativo);
    });

    // Materiais e Links Uteis nao usam os segmentadores
    $('barra-filtros').classList.toggle('hidden', !cfg.filtros);
    $('linha-periodo').classList.toggle('hidden', !cfg.filtros);
    $('titulo-cabecalho').textContent = cfg.titulo;
    $('icone-cabecalho').className = `fa-solid ${cfg.icone} text-ouvidoria-light mr-2 text-base`;

    // Reinicia as animacoes de entrada dos cartoes da aba
    if (aba === 'materiais') renderizarMateriais();
    if (aba === 'links') renderizarLinks();

    $('menu-mobile').classList.add('hidden');
  }

  function ligarCliqueLinhas(tbodyId, acao) {
    const tbody = $(tbodyId);
    tbody.addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-id]');
      if (tr) acao(tr.dataset.id);
    });
    tbody.addEventListener('keydown', (e) => {
      const tr = e.target.closest('tr[data-id]');
      if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); acao(tr.dataset.id); }
    });
  }

  function ligarEventos() {
    $('form-login').addEventListener('submit', aoEnviarLogin);
    document.querySelectorAll('.btn-sair').forEach((b) => b.addEventListener('click', () => sair()));

    document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => trocarAba(b.dataset.tab)));
    $('btn-menu-mobile').addEventListener('click', () => $('menu-mobile').classList.toggle('hidden'));

    ['filtro-ano', 'filtro-mes', 'filtro-voluntaria'].forEach((id) => $(id).addEventListener('change', aoMudarFiltro));
    $('btn-atualizar').addEventListener('click', carregarDados);
    $('btn-tentar-novamente').addEventListener('click', carregarDados);

    $('busca-voluntarias').addEventListener('input', () => renderizarVoluntarias());
    $('busca-assistidas').addEventListener('input', () => renderizarAssistidas());
    $('chk-sem-sessoes').addEventListener('change', () => renderizarAssistidas(true));
    $('csv-voluntarias').addEventListener('click', exportarVoluntarias);
    $('csv-assistidas').addEventListener('click', exportarAssistidas);
    ligarCliqueLinhas('tbody-voluntarias', abrirModalVoluntaria);
    ligarCliqueLinhas('tbody-assistidas', abrirModalAssistida);

    const abrirCard = (e) => {
      const card = e.target.closest('[data-material]');
      if (card) abrirModalMaterial(state.materiais[Number(card.dataset.material)]);
    };
    $('grid-materiais').addEventListener('click', abrirCard);
    $('grid-materiais').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrirCard(e); }
    });

    $('modal-fechar').addEventListener('click', () => fecharModal());
    $('modal').addEventListener('click', (e) => { if (e.target === $('modal')) fecharModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fecharModal(); });
    $('modal-csv').addEventListener('click', () => {
      const x = state.exportModal;
      if (x) baixarCSV(x.nome, x.cabecalho, x.linhas, x.totais);
    });

    ['click', 'keydown', 'mousemove', 'scroll', 'touchstart'].forEach((evt) =>
      document.addEventListener(evt, aoInteragir, { passive: true, capture: true }));
  }

  // ---------------------------------------------------------------
  // Inicio
  // ---------------------------------------------------------------
  async function iniciar() {
    ligarEventos();
    trocarAba('painel');

    if (!configPreenchida()) {
      mostrarErroLogin('Painel ainda não configurado: preencha SUPABASE_URL e SUPABASE_ANON_KEY em assets/config.js.');
      $('btn-entrar').disabled = true;
      return;
    }
    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
      mostrarErroLogin('Não foi possível carregar a biblioteca do Supabase. Verifique a conexão com a internet.');
      $('btn-entrar').disabled = true;
      return;
    }

    sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, storage: window.sessionStorage }
    });

    sb.auth.onAuthStateChange((evento) => {
      if (evento === 'SIGNED_OUT' && !$('app').classList.contains('hidden')) mostrarLogin();
    });

    const { data } = await sb.auth.getSession();
    if (data && data.session) await entrar(data.session);
  }

  document.addEventListener('DOMContentLoaded', iniciar);
})();
