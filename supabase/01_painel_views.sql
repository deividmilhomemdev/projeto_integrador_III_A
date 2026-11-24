-- =====================================================================
-- Ouvidoria BI — Script 01: funcao de permissao + views do painel
-- ---------------------------------------------------------------------
-- Onde rodar : Supabase > SQL Editor > New query > colar tudo > Run
-- Pode rodar de novo? Sim. Todos os comandos usam "create or replace"
--                    e nao alteram nem apagam dados das tabelas.
-- Efeito no app Flutter: nenhum. As tabelas originais continuam iguais.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1) Funcao que responde: "quem esta logado no painel e administradora?"
--
--    - auth.jwt() ->> 'email' = e-mail da conta logada no Supabase Auth.
--    - Compara com tb_usuario e exige acesso_adm = 1.
--    - "security definer" permite consultar tb_usuario mesmo que, no
--      futuro, o RLS seja ativado nessa tabela.
-- ---------------------------------------------------------------------
create or replace function public.is_admin_painel()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.tb_usuario u
     where lower(trim(u.email)) = lower(trim(auth.jwt() ->> 'email'))
       and trim(u.acesso_adm::text) = '1'
  );
$$;

revoke execute on function public.is_admin_painel() from public, anon;
grant  execute on function public.is_admin_painel() to authenticated;


-- ---------------------------------------------------------------------
-- 2) View de FATOS: uma linha por sessao, ja com assistida, voluntaria,
--    ano/mes e o status traduzido a partir das colunas 0/1.
--
--    Regra do status (colunas varchar '0'/'1'):
--      indicador_desistencia      = 1 -> 'Desistência'
--      indicador_sessao_realizada = 1 -> 'Realizada'
--      nenhuma das duas           = 1 -> 'Em andamento'
--
--    RISCO REGISTRADO: a voluntaria da sessao e obtida pela assistida
--    (tb_sessao -> tb_assistida.id_usuario). Se a assistida for
--    transferida, as sessoes antigas passam a aparecer para a nova
--    voluntaria.
-- ---------------------------------------------------------------------
create or replace view public.vw_painel_sessoes
with (security_invoker = on)
as
select
    s.id_sessao,
    s.numero_sessao,
    s.data_sessao,
    s.horario_sessao,
    extract(year  from s.data_sessao)::int as ano,
    extract(month from s.data_sessao)::int as mes,
    case
        when lower(trim(s.indicador_desistencia::text))      in ('1', 'true') then 'Desistência'
        when lower(trim(s.indicador_sessao_realizada::text)) in ('1', 'true') then 'Realizada'
        else 'Em andamento'
    end as status_sessao,
    a.id_assistida,
    a.nome          as nome_assistida,
    u.id_usuario,
    u.nome_usuario  as nome_voluntaria
from public.tb_sessao s
join public.tb_assistida a on a.id_assistida = s.id_assistida
left join public.tb_usuario u on u.id_usuario = a.id_usuario
where (select public.is_admin_painel());


-- ---------------------------------------------------------------------
-- 3) View das VOLUNTARIAS (cadastro). Inclui a marcacao de admin para
--    o painel esconder a coordenacao quando ela nao tiver atendimentos.
-- ---------------------------------------------------------------------
create or replace view public.vw_painel_voluntarias
with (security_invoker = on)
as
select
    u.id_usuario,
    u.nome_usuario,
    u.crp,
    u.contato,
    u.email,
    (trim(u.acesso_adm::text) = '1') as is_admin
from public.tb_usuario u
where (select public.is_admin_painel());


-- ---------------------------------------------------------------------
-- 4) View das ASSISTIDAS (cadastro + voluntaria responsavel atual).
-- ---------------------------------------------------------------------
create or replace view public.vw_painel_assistidas
with (security_invoker = on)
as
select
    a.id_assistida,
    a.nome,
    a.contato,
    a.id_usuario,
    u.nome_usuario as nome_voluntaria
from public.tb_assistida a
left join public.tb_usuario u on u.id_usuario = a.id_usuario
where (select public.is_admin_painel());


-- ---------------------------------------------------------------------
-- 5) Permissoes das views
--    - anon (quem nao fez login) NAO le as views.
--    - authenticated (quem fez login) le, mas o filtro is_admin_painel()
--      devolve zero linhas para quem nao for administradora.
--    - As views usam security_invoker, entao a conta logada tambem
--      precisa de SELECT nas tabelas de origem (grants abaixo).
-- ---------------------------------------------------------------------
revoke all on public.vw_painel_sessoes     from public, anon;
revoke all on public.vw_painel_voluntarias from public, anon;
revoke all on public.vw_painel_assistidas  from public, anon;

grant select on public.vw_painel_sessoes     to authenticated;
grant select on public.vw_painel_voluntarias to authenticated;
grant select on public.vw_painel_assistidas  to authenticated;

grant select on public.tb_sessao, public.tb_assistida,
                public.tb_usuario, public.tb_informacoes to authenticated;
