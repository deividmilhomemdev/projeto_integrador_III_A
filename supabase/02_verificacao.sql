-- =====================================================================
-- Ouvidoria BI — Script 02: conferencias (somente leitura)
-- ---------------------------------------------------------------------
-- Rode cada bloco separadamente no SQL Editor (selecione o trecho e
-- clique em Run). Nada aqui altera dados.
--
-- IMPORTANTE: no SQL Editor voce esta como "postgres", que nao tem
-- e-mail logado. Por isso, consultando as views direto, elas voltam
-- VAZIAS. Isso e esperado. Use o bloco B para simular a administradora.
-- =====================================================================


-- A) Qual e o e-mail cadastrado como administradora?
--    Esse MESMO e-mail deve ser usado ao criar o usuario no
--    Supabase Auth (passo 3 do guia).
select id_usuario, nome_usuario, email, acesso_adm
  from public.tb_usuario
 where trim(acesso_adm::text) = '1';


-- B) Simula o login da administradora e testa as views.
--    Troque EMAIL_DA_ADMIN pelo e-mail retornado no bloco A.
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"email":"EMAIL_DA_ADMIN","role":"authenticated"}';

  select public.is_admin_painel() as sou_admin;          -- esperado: true

  select status_sessao, count(*) as qtd                  -- totais por status
    from public.vw_painel_sessoes
   group by status_sessao
   order by status_sessao;
rollback;


-- C) Simula um e-mail qualquer (nao admin). As views devem voltar vazias.
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"email":"qualquer@exemplo.com","role":"authenticated"}';

  select public.is_admin_painel() as sou_admin;          -- esperado: false
  select count(*) as linhas_visiveis from public.vw_painel_sessoes;  -- esperado: 0
rollback;


-- D) Qualidade dos dados (ajuda a explicar diferencas nos numeros).

-- D1) Sessoes marcadas como realizada E desistencia ao mesmo tempo
--     (o painel considera "Desistência").
select id_sessao, id_assistida, data_sessao
  from public.tb_sessao
 where trim(indicador_desistencia::text) = '1'
   and trim(indicador_sessao_realizada::text) = '1';

-- D2) Sessoes sem data (nao aparecem nos filtros de ano/mes).
select id_sessao, id_assistida
  from public.tb_sessao
 where data_sessao is null;

-- D3) Assistidas sem voluntaria vinculada.
select id_assistida, nome
  from public.tb_assistida
 where id_usuario is null;
