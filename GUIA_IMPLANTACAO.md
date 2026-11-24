# Ouvidoria BI — Guia de Implantação do Painel Gerencial

Este guia mostra, passo a passo, como ligar o painel (`painel-bi/`) ao banco Supabase que o app Flutter já usa e como publicá-lo no Netlify.

**O que este roteiro NÃO altera:** as tabelas, os dados e o funcionamento do app Flutter. Os scripts SQL só **criam** uma função e três views novas.

---

## 0. Arquivos entregues

```
Projeto_Ouvidoria_da_Mulher/
├── painel-bi/                    ← pasta que vai para o Netlify
│   ├── index.html                ← tela de login + painel (4 abas do MVP + Links Úteis)
│   ├── _headers                  ← cabeçalhos de segurança do Netlify
│   └── assets/
│       ├── config.js             ← conexão com o Supabase (editar uma única vez)
│       ├── links-uteis.js        ← lista da página "Links Úteis" (edite para incluir/remover links)
│       ├── logo.png              ← logo da Ouvidoria (login, menu, favicon)
│       ├── app.js                ← lógica (login, consultas, gráficos, totais, CSV)
│       └── tailwind.config.js    ← paleta institucional
├── supabase/
│   ├── 01_painel_views.sql       ← cria a função de permissão e as views
│   └── 02_verificacao.sql        ← consultas de conferência (só leitura)
└── GUIA_IMPLANTACAO.md           ← este guia
```

### Como as peças conversam (cliente-servidor)

```
Navegador da coordenadora                     Supabase (servidor)
┌─────────────────────────┐   HTTPS   ┌────────────────────────────────────┐
│ painel-bi (Netlify)     │ ────────► │ 1. Auth: confere e-mail + senha    │
│ - tela de login         │           │ 2. is_admin_painel(): acesso_adm=1?│
│ - KPIs, gráfico, tabelas│ ◄──────── │ 3. Views vw_painel_* (só admin lê) │
│ - exportação CSV        │   JSON    │ 4. Tabelas tb_* (as do app)        │
└─────────────────────────┘           └────────────────────────────────────┘
```

---

## 1. Criar as views no Supabase

1. Acesse <https://supabase.com/dashboard> e abra o projeto da Ouvidoria.
2. No menu lateral, clique em **SQL Editor** e depois em **New query**.
3. Abra o arquivo `supabase/01_painel_views.sql`, copie **todo** o conteúdo e cole no editor.
4. Clique em **Run** (ou `Ctrl + Enter`).
5. O resultado esperado é **"Success. No rows returned"**.

Para conferir: em **Table Editor**, as views `vw_painel_sessoes`, `vw_painel_voluntarias` e `vw_painel_assistidas` aparecem na lista.

> **Não se assuste:** se você abrir essas views pelo Table Editor ou pelo SQL Editor, elas vão aparecer **vazias**. Isso é proposital. Elas só mostram dados para quem fez login no painel com uma conta administradora. O passo 4 mostra como testar.

### O que o script cria

| Objeto | Para que serve |
|---|---|
| `is_admin_painel()` | Retorna `true` se o e-mail logado existir em `tb_usuario` com `acesso_adm = 1`. |
| `vw_painel_sessoes` | Uma linha por sessão, já com assistida, voluntária, ano, mês e status traduzido. |
| `vw_painel_voluntarias` | Cadastro das voluntárias (nome, CRP, contato). |
| `vw_painel_assistidas` | Cadastro das assistidas com a voluntária responsável. |

Tradução do status da sessão (as colunas guardam `'0'` ou `'1'`):

| `indicador_desistencia` | `indicador_sessao_realizada` | Status no painel |
|---|---|---|
| 1 | qualquer valor | **Desistência** |
| 0 | 1 | **Realizada** |
| 0 | 0 | **Em andamento** |

**Por que views simples e não views com totais prontos?** O volume é pequeno (centenas de sessões por ano). Mandar as sessões já organizadas e somar no navegador permite combinar os filtros de ano, mês e voluntária livremente, sem criar uma view para cada combinação.

---

## 2. Criar o login da coordenação (Supabase Auth)

O app Flutter **não** usa o Supabase Auth. Por isso, criar usuários ali **não afeta** as psicólogas.

### 2.1 Bloquear cadastros públicos (muito importante)

1. Menu **Authentication** → **Sign In / Providers**.
2. Confira se o provedor **Email** está habilitado.
3. **Desligue** a opção **"Allow new users to sign up"** e salve.
   - Sem isso, qualquer pessoa poderia criar uma conta. Ela ainda seria barrada pela verificação de admin, mas é melhor fechar essa porta.
4. Se a opção existir, ajuste o tamanho mínimo da senha para **12 caracteres**.

### 2.2 Descobrir o e-mail da administradora

No **SQL Editor**, rode o **bloco A** do arquivo `supabase/02_verificacao.sql`. Ele mostra o e-mail que está com `acesso_adm = 1`.

### 2.3 Criar a conta

1. Menu **Authentication** → **Users** → **Add user** → **Create new user**.
2. Em **Email**, use **exatamente o mesmo e-mail** encontrado no passo 2.2.
3. Em **Password**, use uma senha forte (frase longa, com 12 caracteres ou mais).
4. Marque **Auto Confirm User**.
5. Clique em **Create user**.

> Para dar acesso a outra coordenadora no futuro, são necessárias as duas coisas:
> - o e-mail dela em `tb_usuario` com `acesso_adm = 1`;
> - uma conta criada em **Authentication → Users**.
>
> Atenção: `acesso_adm = 1` também libera a tela de gestão dentro do app.

---

## 3. Conferir no banco (opcional, recomendado)

No arquivo `supabase/02_verificacao.sql`:

- **Bloco B:** troque `EMAIL_DA_ADMIN` pelo e-mail real e rode o bloco inteiro, do `begin` ao `rollback`. Espera-se `sou_admin = true` e as quantidades por status.
- **Bloco C:** simula um e-mail qualquer. Espera-se `false` e `0` linhas, ou seja, quem não é admin não vê nada.
- **Blocos D1 a D3:** mostram dados inconsistentes, que explicam números diferentes no painel:
  - sessões marcadas como realizada **e** desistência ao mesmo tempo;
  - sessões sem data;
  - assistidas sem voluntária.

---

## 4. Configurar o painel

1. Abra o arquivo `painel-bi/assets/config.js`.
2. No Supabase, vá em **Project Settings** → **API** (ou **Data API**) e copie:
   - **Project URL** → cole em `SUPABASE_URL`;
   - a chave **anon / public** → cole em `SUPABASE_ANON_KEY`.

   São os mesmos valores usados no app Flutter.
3. **Nunca** use a chave `service_role`. Ela ignora todas as regras de segurança.
4. Se quiser, ajuste `HORAS_POR_SESSAO` (padrão 1 hora) e `MINUTOS_INATIVIDADE` (padrão 30 minutos).

---

## 5. Testar no seu computador (antes de publicar)

O painel precisa ser aberto por um endereço `http://`. Abrir o arquivo com dois cliques (`file://`) não funciona por causa das regras de segurança. Com o Python instalado, rode no PowerShell, dentro da pasta `painel-bi`:

```powershell
python -m http.server 8080
```

Depois acesse <http://localhost:8080>, entre com o e-mail e a senha do passo 2 e confira:

- [ ] os cartões mostram números coerentes com o Supabase (compare com o bloco B do passo 3);
- [ ] clicar em uma barra do gráfico abre o detalhamento do mês;
- [ ] as abas Voluntárias e Assistidas abrem o histórico ao clicar na linha e mostram a linha de **Total** no final;
- [ ] em Materiais, todo card abre em "Visualizar" (texto + botão para o link, quando houver);
- [ ] a página Links Úteis abre cada canal em uma nova aba;
- [ ] o CSV abre no Excel com acentos corretos e colunas separadas;
- [ ] o botão **Sair** volta para a tela de login.

Para encerrar o servidor local, use `Ctrl + C`.

---

## 6. Publicar no Netlify

Recomendação: publique como um **site separado** do app Flutter. Assim cada um tem seu endereço e suas regras.

1. Acesse <https://app.netlify.com> → **Add new site** → **Deploy manually**.
2. Arraste a **pasta `painel-bi`** inteira. Ela precisa conter o `index.html`, o `_headers` e a pasta `assets`.
3. Em **Site configuration** → **Change site name**, escolha um nome. Evite nomes óbvios; por exemplo, `ouvidoria-gestao-gyn` é melhor que `ouvidoria-bi`.
4. Acesse o link `https://…netlify.app` e repita o checklist do passo 5.

Para atualizar depois, vá em **Deploys** e arraste a pasta de novo. Se o projeto estiver no GitHub, conecte o repositório e defina **Base directory = `painel-bi`**.

---

## 7. Problemas comuns

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| "Painel ainda não configurado" | `config.js` não foi preenchido | Passo 4 |
| "E-mail ou senha inválidos" | conta não criada, senha errada ou usuário não confirmado | Passo 2.3 (marcar **Auto Confirm User**) |
| "Acesso restrito à coordenação" | e-mail do Auth diferente do e-mail em `tb_usuario`, ou `acesso_adm` diferente de 1 | Passo 2.2: os e-mails precisam ser idênticos |
| "Não foi possível validar a permissão" | script `01_painel_views.sql` não foi executado | Passo 1 |
| Aviso vermelho "Não foi possível carregar os dados" | view ausente ou nome de coluna diferente | Leia a mensagem: ela indica a view e a coluna |
| Tudo zerado, mas o login funciona | o ano selecionado não tem sessões, ou `data_sessao` está vazia | Troque o ano; rode o bloco D2 |
| CSV abre tudo em uma coluna | Excel configurado em inglês | Use **Dados → De Texto/CSV** e escolha o separador `;` |

---

## 8. Segurança aplicada (material para o relatório do Projeto Integrador)

| Camada | Medida | Ameaça mitigada |
|---|---|---|
| Autenticação | Login com e-mail e senha no Supabase Auth (senha guardada com hash pelo Supabase) | Acesso por terceiros |
| Autorização (servidor) | `is_admin_painel()` dentro das views: só `acesso_adm = 1` recebe linhas | Usuário autenticado sem perfil de gestão |
| Autorização (banco) | `revoke` das views para `anon` (quem não fez login) | Leitura das views com a chave pública |
| Cadastro fechado | "Allow new users to sign up" desligado | Criação de contas por qualquer pessoa |
| Sessão | Guardada em `sessionStorage` (some ao fechar o navegador) e logout após 30 min sem uso | Computador compartilhado na Câmara |
| Mensagens de erro | Erro genérico de login, sem dizer se o e-mail existe | Descoberta de contas válidas |
| XSS | Todo texto do banco é escapado antes de ir para a tela; links só `http/https` | Script malicioso gravado em nome ou material |
| Injeção em planilha | Células do CSV que começam com `= + - @` recebem `'` na frente | Fórmula maliciosa executada no Excel |
| CSP | `Content-Security-Policy`: scripts só deste site e de CDNs fixadas; conexão só com `*.supabase.co` | Injeção de scripts de terceiros |
| Cabeçalhos (`_headers`) | `X-Frame-Options`, `nosniff`, `Referrer-Policy`, HSTS, `noindex` | Clickjacking, vazamento de URL, indexação no Google |
| Dependências | Versões fixas das bibliotecas (Supabase 2.45.4, Chart.js 4.4.1, Tailwind 3.4.5) | Atualização inesperada de uma biblioteca externa |
| Transporte | HTTPS do Netlify e do Supabase | Interceptação na rede |

---

## 9. Riscos registrados (conhecidos e aceitos nesta versão)

1. **Ligação sessão → voluntária é indireta.** A sessão aponta para a assistida, e a assistida para a voluntária. Se uma assistida for transferida, **todo o histórico dela passa a contar para a nova voluntária**. Isso afeta relatórios por voluntária, inclusive de anos anteriores.
   *Correção futura:* gravar `id_usuario` em `tb_sessao` no momento do registro.

2. **As tabelas originais continuam abertas (RLS desativado).** O painel está protegido por login. Mas a chave pública (`anon`) que vai dentro do app Flutter ainda consegue ler e alterar as tabelas `tb_*` diretamente, porque o app não tem senha.
   *Correção futura:* login com senha no app e políticas de RLS por tabela. O painel já está preparado para isso.

3. **Horas doadas são estimadas.** Não existe coluna de duração. O valor é `sessões realizadas × HORAS_POR_SESSAO`, padrão 1 hora.

4. **Sem trilha de alterações.** As tabelas não guardam data de criação nem de alteração. O painel mostra a situação atual, não quem mudou o quê.

5. **"Situação atual" da assistida é deduzida.** O campo `status_atendimento` não é usado (fica sempre `1`). O painel mostra "Desistência" se a última sessão foi desistência, "Em acompanhamento" se houver outra sessão, e "Sem sessões" se não houver nenhuma.

6. **Tailwind via CDN.** É a forma prevista na documentação do projeto e funciona bem. O próprio Tailwind recomenda compilar o CSS em produção; fica como melhoria futura.
