# RangePass, plano 1 de N: base no Supabase (etapas 1 e 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** criar o banco do RangePass no Supabase, com as regras que impedem conflitos e o bloqueio de acesso direto, e a porta de entrada única pelas Edge Functions, com verificação de papel.

**Architecture:** o Postgres do Supabase guarda tudo. O RLS fica ligado em todas as tabelas, sem nenhuma política, e as permissões de `anon` e `authenticated` são retiradas: o navegador não lê nem grava nada diretamente. As Edge Functions usam a chave de serviço, descobrem quem é o usuário pelo token de login, conferem o papel e só então leem ou gravam. Os conflitos de pista, instrutor e unidade de arma são barrados por restrições de exclusão (`EXCLUDE USING gist`) sobre intervalos de tempo. O front-end atual (`index.html` e `regras.js`) não muda neste plano.

**Tech Stack:** Supabase (Postgres 15+, Auth, Edge Functions em Deno), Supabase CLI `2.20.12` via `npx`, Node 22 LTS com `node:test` e `fetch` nativo (sem dependências instaladas), `npm:@supabase/supabase-js@2.45.4` dentro das Edge Functions.

**Spec:** `docs/superpowers/specs/2026-11-11-rangepass-supabase-design.md`. Seções usadas aqui: 3, 4, 6.1, 6.2, 6.9, 8, 9.1, 12, 13, 15 e 16.

**Planos seguintes (fora deste):** 2 = login e cadastro (etapa 3); 3 = desmock e painel (etapa 4); 4 = admin (etapa 5); 5 = agenda visual (etapa 6) e deploy (etapa 7); depois, operação, estoque, e-mails e pagamento.

## Global Constraints

- O dono é iniciante e usa **Windows com PowerShell 5.1**. Todo comando para ele rodar deve funcionar no PowerShell 5.1: sem `&&`, e encadeando com `;` ou `if ($?) { ... }`.
- Textos da interface e mensagens de erro em **português do Brasil**, dizendo o que aconteceu e o que fazer.
- **Commits:** antes de cada commit, **perguntar ao dono** e só fazer depois do "sim". **Nunca** fazer push, merge ou rebase.
- No fim de cada tarefa, **parar**, explicar ao dono em linguagem simples como testar e esperar o teste dele.
- Nada de regra de negócio fixa no código: valores vêm da tabela `configuracoes`.
- Cadastros e agendamentos **nunca são apagados**: desativa-se (`ativo = false`) ou muda-se a situação.
- O navegador nunca acessa tabelas: RLS ligado e sem políticas em todas as tabelas de `public`, e `REVOKE ALL` de `anon` e `authenticated` em tabelas, sequências e funções.
- Intervalos de tempo usam `tstzrange` fechado no início e aberto no fim (`'[)'`), para que sessões encostadas (10h às 12h e 12h às 13h) não conflitem.
- Fuso do estande: `America/Sao_Paulo`, guardado em `configuracoes`. O banco grava `timestamptz`.
- Supabase CLI sempre como `npx --yes supabase@2.20.12 ...`. As funções são publicadas com `--use-api`, porque não há Docker.
- Os segredos (`.env.teste`) **nunca** vão para o Git.
- Testes de integração rodam **só no projeto de desenvolvimento**, nunca num banco com clientes reais.
- Módulos puros compartilhados entre Node e Deno ficam em `supabase/functions/_shared/*.mjs` (ES modules, sem APIs do Deno nem do Node).

## Review Focus

1. **Sessões encostadas:** o mesmo instrutor das 10h às 12h e das 12h às 13h deve ser **aceito**. Teste em `agendamentos.test.mjs` (Task 4).
2. **Cancelar libera, reativar volta a conflitar:** um agendamento cancelado não pode mais bloquear a pista. Teste em `agendamentos.test.mjs` (Task 4).
3. **Alterar o horário para cima de outro:** a alteração deve ser **recusada inteira**, com o agendamento mantendo o horário antigo. Teste em `agendamentos.test.mjs` (Task 4).
4. **Pista interditada:** não pode receber agendamento novo no período da interdição. Teste em `agendamentos.test.mjs` (Task 4).
5. **Usuário desativado com token válido:** deve receber 403 nas funções, não os dados. Teste em `minha-conta.test.mjs` (Task 5).

---

## Estrutura de arquivos

```
.env.teste.exemplo                      modelo dos segredos (vai para o Git)
.env.teste                              segredos reais (fora do Git)
package.json                            só scripts de teste, sem dependências
supabase/config.toml                    gerado pelo `supabase init`
supabase/migrations/20261111000100_base.sql
supabase/migrations/20261111000200_configuracoes_iniciais.sql
supabase/migrations/20261111000300_catalogo_pistas.sql
supabase/migrations/20261111000400_agendamentos.sql
supabase/scripts/promover-superadmin.sql
supabase/functions/_shared/http.mjs          puro: respostas, CORS, ErroHttp
supabase/functions/_shared/papeis.mjs        puro: lista de papéis e checagem
supabase/functions/_shared/configuracoes.mjs puro: validação das configurações
supabase/functions/_shared/contexto.js       Deno: quem é o usuário e seus papéis
supabase/functions/minha-conta/index.js
supabase/functions/configuracoes/index.js
tests/unidade/http.test.mjs
tests/unidade/papeis.test.mjs
tests/unidade/configuracoes.test.mjs
tests/integracao/apoio.mjs                   ajudantes: REST, usuários de teste, limpeza
tests/integracao/conexao.test.mjs
tests/integracao/base.test.mjs
tests/integracao/catalogo.test.mjs
tests/integracao/agendamentos.test.mjs
tests/integracao/minha-conta.test.mjs
tests/integracao/configuracoes.test.mjs
```

---

### Task 1: Preparar o ambiente e conectar ao Supabase

**Files:**
- Create: `package.json`, `.env.teste.exemplo`, `supabase/config.toml` (via CLI), `tests/integracao/apoio.mjs`, `tests/integracao/conexao.test.mjs`
- Modify: `.gitignore`, `README.md`

**Interfaces:**
- Produces, em `tests/integracao/apoio.mjs`:
  - `URL: string` e `CHAVE_ANON: string`, `CHAVE_SERVICO: string` (de `process.env.SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`; lança erro claro se faltar algum)
  - `rest(caminho: string, { metodo = 'GET', corpo, chave = CHAVE_SERVICO, token, prefer } = {}) -> Promise<{ status: number, dados: any }>`: chama `${URL}/rest/v1/${caminho}`. A `chave` vai sempre no cabeçalho `apikey`. O `Authorization: Bearer` só é enviado quando há `token` (login de um usuário). Isso funciona tanto com as chaves antigas (`anon`/`service_role`) quanto com as novas (`sb_publishable_…`/`sb_secret_…`). `prefer` padrão `return=representation`.
  - `rpc(nome: string, args: object, opcoes) -> Promise<{ status, dados }>`: igual, em `rest/v1/rpc/${nome}` com POST.
  - `funcao(nome: string, { metodo = 'GET', corpo, token } = {}) -> Promise<{ status, dados }>`: chama `${URL}/functions/v1/${nome}`.
  - `marcador(): string`: texto único por execução (`teste-<timestamp>-<aleatório>`) para identificar os dados criados.

- [ ] **Step 1: Pedir ao dono para atualizar o Node para a versão 22 LTS**

Explicar: o Node 18.16 instalado está sem suporte e a ferramenta do Supabase reclama dele. Passos para o dono: baixar o instalador "LTS" em nodejs.org, instalar, fechar e abrir o terminal.
Verificar: `node --version`. Esperado: `v22.` seguido de qualquer número.

- [ ] **Step 2: Pedir ao dono para criar o projeto no Supabase**

Passos para o dono: criar uma conta em supabase.com, criar o projeto `rangepass-dev` (região São Paulo, plano gratuito) e **guardar a senha do banco**. Em Project Settings → API, copiar a Project URL, a chave `anon` e a chave `service_role`. Se o painel mostrar chaves "publishable" e "secret" em vez de `anon` e `service_role`, use a publishable no lugar da anon e a secret no lugar da service_role. Explicar que a chave de serviço (service_role ou secret) é como a chave-mestra: nunca vai para o Git nem para a página.

- [ ] **Step 3: Criar `.env.teste.exemplo` e `.env.teste`, e atualizar o `.gitignore`**

`.env.teste.exemplo` tem as três chaves vazias (`SUPABASE_URL=`, `SUPABASE_ANON_KEY=`, `SUPABASE_SERVICE_ROLE_KEY=`). O dono copia esse arquivo para `.env.teste` e preenche os valores. No `.gitignore`, acrescentar `.env.teste` e `supabase/.temp/`.
Verificar: `git status --short` não mostra `.env.teste`.

- [ ] **Step 4: Iniciar e ligar o projeto pela CLI**

Rodar `npx --yes supabase@2.20.12 init` e depois `npx --yes supabase@2.20.12 login`, que abre o navegador para o dono autorizar. Em seguida, rodar `npx --yes supabase@2.20.12 link --project-ref <ref>`, em que o `<ref>` é o trecho da URL antes de `.supabase.co`. A senha do banco é pedida nessa hora.
Verificar: `npx --yes supabase@2.20.12 migration list` responde sem erro, com a lista vazia.

- [ ] **Step 5: Criar o `package.json` com os scripts**

```json
{
  "name": "rangepass",
  "private": true,
  "scripts": {
    "test": "node --test tests/regras.test.js \"tests/unidade/**/*.test.mjs\"",
    "test:integracao": "node --env-file=.env.teste --test --test-concurrency=1 \"tests/integracao/**/*.test.mjs\""
  }
}
```

- [ ] **Step 6: Escrever o teste de conexão**

```js
// tests/integracao/conexao.test.mjs
import test from 'node:test';
import assert from 'node:assert';
import { URL, CHAVE_ANON } from './apoio.mjs';

test('conexão: o projeto responde às configurações de login', async () => {
    const resposta = await fetch(`${URL}/auth/v1/settings`, { headers: { apikey: CHAVE_ANON } });
    assert.strictEqual(resposta.status, 200);
});
```

- [ ] **Step 7: Rodar e ver falhar**

Run: `npm run test:integracao`
Expected: FAIL, porque `apoio.mjs` ainda não existe.

- [ ] **Step 8: Implementar `tests/integracao/apoio.mjs` com as interfaces acima**

`rest`, `rpc` e `funcao` devolvem `dados` já interpretado como JSON, ou `null` quando a resposta vier vazia.

- [ ] **Step 9: Rodar e ver passar**

Run: `npm run test:integracao` e depois `npm test`.
Expected: o teste de conexão passa, e os testes antigos de `regras.test.js` continuam passando.

- [ ] **Step 10: Documentar no README**

Acrescentar a seção "Como preparar o ambiente", com os Steps 1 a 4 e o aviso sobre a chave `service_role`.

- [ ] **Step 11: Perguntar ao dono e fazer o commit**

`git add package.json .env.teste.exemplo .gitignore README.md supabase/config.toml tests/integracao/apoio.mjs tests/integracao/conexao.test.mjs`
Mensagem: `Prepara o ambiente do Supabase e o teste de conexão`

---

### Task 2: Banco base com o acesso direto bloqueado

**Files:**
- Create: `supabase/migrations/20261111000100_base.sql`, `supabase/migrations/20261111000200_configuracoes_iniciais.sql`, `tests/integracao/base.test.mjs`

**Interfaces:**
- Consumes: `rest`, `marcador` (Task 1).
- Produces:
  - `create type papel as enum ('cliente','atendente','almoxarifado','instrutor','administrativo','superadmin')`
  - `perfis(id uuid pk references auth.users on delete restrict, nome_completo text not null, cpf text not null unique check (cpf ~ '^\d{11}$'), telefone text not null, data_nascimento date not null, cr text, orgao_expedidor text, ativo boolean not null default true, criado_em timestamptz not null default now())`
  - `papeis_usuario(usuario_id uuid references auth.users, papel papel, primary key (usuario_id, papel))`. Não depende de `perfis`, para que um usuário recém-criado já possa ter papel.
  - `configuracoes(chave text pk, valor jsonb not null, atualizado_em timestamptz not null default now(), atualizado_por uuid references auth.users)`
  - `historico_alteracoes(id bigint generated always as identity pk, tabela text not null, registro_id text not null, acao text not null check (acao in ('insercao','alteracao')), antes jsonb, depois jsonb, feito_por uuid, feito_em timestamptz not null default now())`
  - Função de gatilho `registrar_historico()`: grava `TG_TABLE_NAME`, a chave primária do registro como texto (coluna `id`, ou `chave` em `configuracoes`), `to_jsonb(OLD)` e `to_jsonb(NEW)`, e `feito_por = nullif(current_setting('app.usuario_id', true), '')::uuid`. Ligada em `configuracoes` e `perfis` (AFTER INSERT OR UPDATE).
  - Função `public.salvar_configuracao(p_chave text, p_valor jsonb, p_usuario uuid) returns configuracoes`, `security definer`: faz `set_config('app.usuario_id', p_usuario::text, true)` e um upsert com `atualizado_por = p_usuario` e `atualizado_em = now()`.
  - As chaves iniciais estão no Step 3.

- [ ] **Step 1: Escrever os testes**

```js
// tests/integracao/base.test.mjs
test('anon não lê configuracoes', async () => {
    const r = await rest('configuracoes?select=chave', { chave: CHAVE_ANON });
    assert.ok([401, 403].includes(r.status), `status ${r.status}`);
});
test('anon não chama salvar_configuracao', async () => {
    const r = await rpc('salvar_configuracao', { p_chave: 'agenda', p_valor: {}, p_usuario: null }, { chave: CHAVE_ANON });
    assert.ok([401, 403, 404].includes(r.status));
});
test('chave de serviço lê as configurações iniciais', async () => {
    const r = await rest('configuracoes?select=chave,valor');
    const mapa = Object.fromEntries(r.dados.map(l => [l.chave, l.valor]));
    assert.deepStrictEqual(Object.keys(mapa).sort(), ['agenda', 'cadastro', 'creditos', 'estande', 'funcionamento', 'municao']);
    assert.strictEqual(mapa.agenda.antecedencia_maxima_dias, 15);
    assert.strictEqual(mapa.agenda.duracao_maxima_grupo, 6);
    assert.strictEqual(mapa.municao.minima_por_participante, 50);
    assert.strictEqual(mapa.creditos.validade_dias, 365);
    assert.strictEqual(mapa.estande.fuso, 'America/Sao_Paulo');
});
test('salvar_configuracao grava histórico com o autor', async () => { /* cria usuário pelo admin API, chama rpc com p_usuario = id, confere historico_alteracoes.feito_por = id; restaura o valor anterior */ });
test('cpf com formato inválido é recusado', async () => { /* insert em perfis com cpf '123' -> status 400, código 23514 */ });
```

O teste do histórico cria o usuário com `POST ${URL}/auth/v1/admin/users` (corpo `{ email: \`${marcador()}@rangepass.test\`, password, email_confirm: true }`, enviando a chave de serviço). Mova esse ajudante para `apoio.mjs` como `criarUsuario({ papeis = [], perfil = true } = {}) -> Promise<{ id, email, senha, token }>`. Quando `perfil` for verdadeiro, ele insere `perfis` com um CPF de 11 dígitos aleatórios e único. Depois insere os `papeis_usuario` e faz login em `${URL}/auth/v1/token?grant_type=password` para obter o `token`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test:integracao`
Expected: FAIL, porque a tabela `configuracoes` ainda não existe.

- [ ] **Step 3: Escrever as duas migrações**

`20261111000100_base.sql` cria `btree_gist`, o tipo, as tabelas e as funções acima. No fim, aplica o bloqueio, que deve se repetir no fim de **toda** migração futura:

```sql
alter table <cada tabela> enable row level security;   -- sem nenhuma policy
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.salvar_configuracao(text, jsonb, uuid) to service_role;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
```

`20261111000200_configuracoes_iniciais.sql` insere estes valores, que são os padrões das seções 6, 8 e 12 da spec:

| chave | valor |
|---|---|
| `estande` | `{"nome":"RangePass","logo_url":null,"endereco":"","contato":"","fuso":"America/Sao_Paulo"}` |
| `funcionamento` | `{"dias":{"0":{"abre":"08:00","fecha":"23:00"}, …igual para "1" a "6"},"datas_fechadas":[]}`. O dia `null` significa fechado. Os valores repetem o app atual. |
| `agenda` | `{"antecedencia_minima_horas":24,"antecedencia_maxima_dias":15,"prazo_alteracao_horas":24,"duracao_maxima_individual":3,"duracao_maxima_grupo":6,"grupo_maximo":15,"faixas_instrutores":[{"ate":5,"instrutores":1},{"ate":10,"instrutores":2},{"ate":15,"instrutores":3}],"poucas_vagas":1,"tolerancia_nao_comparecimento_min":15}` |
| `municao` | `{"minima_por_participante":50}` |
| `cadastro` | `{"idade_minima":18}` |
| `creditos` | `{"validade_dias":365,"arrependimento_dias":7}` |

As escolhas `tolerancia_nao_comparecimento_min = 15` e `idade_minima = 18` são padrões do construtor e podem mudar nas Configurações. Registrar no resumo ao dono que a idade mínima deve passar pela revisão jurídica (spec, seção 15).

- [ ] **Step 4: Aplicar no projeto**

Run: `npx --yes supabase@2.20.12 db push --dry-run` e confirmar que aparecem as duas migrações. Depois, `npx --yes supabase@2.20.12 db push`.
Expected: as duas migrações são aplicadas sem erro.

- [ ] **Step 5: Rodar os testes e ver passar**

Run: `npm run test:integracao`
Expected: todos passam.

- [ ] **Step 6: Perguntar ao dono e fazer o commit**

Mensagem: `Cria o banco base com acesso direto bloqueado e configurações iniciais`

---

### Task 3: Catálogo de armas, munições e pistas

**Files:**
- Create: `supabase/migrations/20261111000300_catalogo_pistas.sql`, `tests/integracao/catalogo.test.mjs`

**Interfaces:**
- Consumes: o bloqueio da Task 2, que deve ser repetido no fim da migração.
- Produces:
  - `categorias(id serial pk, nome text not null unique, ativo bool not null default true)`
  - `calibres(id serial pk, nome text not null unique, ativo bool …)`
  - `modelos(id serial pk, categoria_id int not null references categorias, calibre_id int not null references calibres, marca text not null, nome text not null, ativo bool …, unique (marca, nome))`
  - `tipos_municao(id serial pk, calibre_id int not null references calibres, nome text not null, ativo bool …, unique (calibre_id, nome))`
  - `create type situacao_unidade as enum ('disponivel','manutencao','desativada')`
  - `unidades_arma(id serial pk, modelo_id int not null references modelos, numero_registro text not null unique, situacao situacao_unidade not null default 'disponivel')`
  - `pistas(id serial pk, numero int not null unique check (numero > 0), ativa bool not null default true)`
  - `interdicoes(id bigint identity pk, pista_id int not null references pistas, periodo tstzrange not null check (not isempty(periodo)), motivo text not null, criado_por uuid references auth.users, criado_em timestamptz default now(), ativa bool not null default true)`
  - Gatilho de histórico em `modelos`, `unidades_arma`, `pistas` e `interdicoes`.

- [ ] **Step 1: Escrever os testes**

```js
test('número de registro de unidade é único', async () => { /* 2 inserts iguais -> segundo com status 409 */ });
test('modelo repetido (mesma marca e nome) é recusado', async () => { /* 409 */ });
test('interdição com período vazio é recusada', async () => { /* periodo '[2030-07-01 10:00,2030-07-01 10:00)' -> 400 */ });
test('anon não lê unidades_arma', async () => { /* 401 ou 403 */ });
```

Os dados de teste usam nomes com `marcador()`, e as pistas usam números a partir de `900000 + aleatório`. Como nada é apagado, o `after()` só desativa o que foi criado.

- [ ] **Step 2: Rodar e ver falhar.** Run: `npm run test:integracao`. Expected: FAIL, porque as tabelas não existem.
- [ ] **Step 3: Escrever a migração com as interfaces acima e o bloqueio no fim.**
- [ ] **Step 4: Aplicar.** Run: `npx --yes supabase@2.20.12 db push`. Expected: aplicada sem erro.
- [ ] **Step 5: Rodar e ver passar.** Run: `npm run test:integracao`. Expected: todos passam.
- [ ] **Step 6: Perguntar ao dono e fazer o commit.** Mensagem: `Cria o catálogo de armas, munições, pistas e interdições`

---

### Task 4: Agendamentos com conflitos barrados pelo banco

**Files:**
- Create: `supabase/migrations/20261111000400_agendamentos.sql`, `tests/integracao/agendamentos.test.mjs`

**Interfaces:**
- Consumes: `perfis` (Task 2), `pistas`, `interdicoes`, `modelos`, `unidades_arma` e `tipos_municao` (Task 3), `criarUsuario` (Task 2).
- Produces:
  - `create type situacao_agendamento as enum ('aguardando_pagamento','pago','check_in','concluido','cancelado','nao_compareceu')`
  - `create type forma_pagamento as enum ('app','balcao')`
  - `create type modalidade as enum ('estande','arma_propria','tudo_proprio')`
  - `agendamentos(id uuid pk default gen_random_uuid(), responsavel_id uuid not null references perfis, inicio timestamptz not null, horas int not null check (horas between 1 and 6), periodo tstzrange generated always as (tstzrange(inicio, inicio + make_interval(hours => horas), '[)')) stored, situacao situacao_agendamento not null default 'aguardando_pagamento', forma_pagamento forma_pagamento not null, criado_em timestamptz default now())`. O limite de 3h para quem vai sozinho é regra da Edge Function, lido de `configuracoes`. O banco só garante o teto de 6.
  - `participantes(id uuid pk, agendamento_id uuid not null references agendamentos, nome_completo text not null, cpf text not null check (cpf ~ '^\d{11}$'), data_nascimento date not null, perfil_id uuid references perfis, modalidade modalidade not null, aceite_termo_em timestamptz, unique (agendamento_id, cpf), check (modalidade = 'estande' or aceite_termo_em is not null))`
  - `itens_participante(id uuid pk, participante_id uuid not null references participantes, modelo_id int references modelos, arma_propria jsonb, tipo_municao_id int references tipos_municao, municao_qtd int check (municao_qtd > 0))`. Formato de `arma_propria`: `{modelo, calibre, numero_registro, responsavel}`.
  - As três tabelas de recurso, todas com `id bigint generated always as identity primary key`, `agendamento_id uuid not null references agendamentos`, `periodo tstzrange not null` e `ativo boolean not null default true`:
    - `agendamento_pistas(…, pista_id int not null references pistas)`
    - `agendamento_instrutores(…, instrutor_id uuid not null references perfis, principal boolean not null default false)`
    - `agendamento_unidades(…, unidade_id int not null references unidades_arma, participante_id uuid not null references participantes)`
  - As restrições de conflito, que são o centro deste plano:

```sql
alter table agendamento_pistas      add constraint pista_sem_conflito      exclude using gist (pista_id with =, periodo with &&) where (ativo);
alter table agendamento_instrutores add constraint instrutor_sem_conflito  exclude using gist (instrutor_id with =, periodo with &&) where (ativo);
alter table agendamento_unidades    add constraint unidade_sem_conflito    exclude using gist (unidade_id with =, periodo with &&) where (ativo);
```

  - Gatilho `copiar_periodo_recurso()`, BEFORE INSERT nas três tabelas de recurso: copia `periodo` do agendamento, para que quem insere não precise informá-lo, e define `ativo = situacao not in ('cancelado','nao_compareceu')`.
  - Gatilho `sincronizar_recursos()`, AFTER UPDATE OF inicio, horas, situacao ON agendamentos: atualiza `periodo` e `ativo` nas três tabelas. Se houver conflito, o erro `23P01` desfaz a alteração inteira.
  - Gatilho `pista_nao_interditada()`, BEFORE INSERT OR UPDATE em `agendamento_pistas` quando `ativo`: se houver interdição ativa da mesma pista com `periodo && NEW.periodo`, lança `raise exception 'A pista % está interditada nesse horário.' using errcode = 'P0001'`. Se a pista tiver `ativa = false`, lança `'A pista % está desativada.'`.
  - Gatilho `unidade_disponivel()`, BEFORE INSERT em `agendamento_unidades`: recusa a unidade com `situacao <> 'disponivel'`, com a mensagem `'A arma escolhida não está disponível.'`.
  - Gatilho de histórico em `agendamentos` e nas três tabelas de recurso.

- [ ] **Step 1: Escrever os testes**

Ajudante local `novoAgendamento({ inicio, horas, pista, instrutor })`: insere em `agendamentos` (`forma_pagamento: 'balcao'`) e depois nas tabelas de recurso pedidas. Devolve `{ id, statusPista, statusInstrutor }`. As datas são de julho de 2030, com deslocamento `-03:00`.

```js
test('mesmo instrutor em horários sobrepostos é recusado', async () => {
    await novoAgendamento({ inicio: '2030-07-01T10:00:00-03:00', horas: 2, instrutor: instrutorA });
    const b = await novoAgendamento({ inicio: '2030-07-01T11:00:00-03:00', horas: 1, instrutor: instrutorA });
    assert.strictEqual(b.statusInstrutor, 409);
});
test('sessões encostadas não conflitam (10h–12h e 12h–13h)', async () => { /* mesma pista e instrutor -> 201 nas duas */ });
test('mesma pista em horários sobrepostos é recusada', async () => { /* 409 */ });
test('mesma unidade de arma sobreposta é recusada', async () => { /* 409 */ });
test('cancelar libera a pista e reativar volta a conflitar', async () => {
    /* A ocupa pista P; cancela A (PATCH situacao=cancelado) -> B ocupa P (201);
       PATCH A situacao=pago -> status 409 e A continua 'cancelado' */
});
test('alterar o horário para cima de outro é recusado inteiro', async () => {
    /* A 10h–11h e B 14h–15h com o mesmo instrutor; PATCH B inicio=10h -> 409; GET B mostra inicio 14h */
});
test('pista interditada não recebe agendamento', async () => { /* interdição 10h–12h; agendamento 11h na pista -> 400 e mensagem contém 'interditada' */ });
test('unidade em manutenção não é alocada', async () => { /* 400, mensagem 'não está disponível' */ });
test('arma própria sem aceite do termo é recusada', async () => { /* participante modalidade arma_propria sem aceite -> 400 */ });
test('anon não lê agendamentos', async () => { /* 401 ou 403 */ });
```

Os conflitos de exclusão chegam pelo PostgREST como `409` com código `23P01`. Os `raise exception` chegam como `400` com código `P0001`.

- [ ] **Step 2: Rodar e ver falhar.** Run: `npm run test:integracao`. Expected: FAIL, porque `agendamentos` não existe.
- [ ] **Step 3: Escrever a migração com as interfaces acima e o bloqueio no fim.**
- [ ] **Step 4: Aplicar.** Run: `npx --yes supabase@2.20.12 db push`. Expected: aplicada sem erro.
- [ ] **Step 5: Rodar e ver passar.** Run: `npm run test:integracao`. Expected: todos passam, inclusive os das Tasks 1 a 3.
- [ ] **Step 6: Perguntar ao dono e fazer o commit.** Mensagem: `Cria os agendamentos com conflitos de pista, instrutor e arma barrados pelo banco`

Ao parar para o teste do dono (fim da etapa 1), explicar como ele pode ver as tabelas no painel do Supabase (Table Editor) e como confirmar que um agendamento de teste em conflito é recusado.

---

### Task 5: Porta de entrada: contexto do usuário e `minha-conta`

**Files:**
- Create: `supabase/functions/_shared/http.mjs`, `supabase/functions/_shared/papeis.mjs`, `supabase/functions/_shared/contexto.js`, `supabase/functions/minha-conta/index.js`, `tests/unidade/http.test.mjs`, `tests/unidade/papeis.test.mjs`, `tests/integracao/minha-conta.test.mjs`

**Interfaces:**
- Consumes: `perfis` e `papeis_usuario` (Task 2), `criarUsuario` e `funcao` (Tasks 1 e 2).
- Produces:
  - `http.mjs`:
    - `CABECALHOS_CORS: object` com `Access-Control-Allow-Origin: *` e `Access-Control-Allow-Headers: authorization, x-client-info, apikey, content-type`.
    - `Access-Control-Allow-Methods: GET, POST, PUT, OPTIONS`.
    - `class ErroHttp extends Error { constructor(status: number, mensagem: string) }`
    - `respostaJson(status: number, corpo: object) -> Response`, com CORS e `content-type: application/json; charset=utf-8`.
    - `tratar(manipulador: (req) => Promise<Response>) -> (req) => Promise<Response>`: responde `OPTIONS` com 204 e CORS. Converte `ErroHttp` em `respostaJson(status, { erro: mensagem })`. Qualquer outro erro vira 500 com `{ erro: 'Algo deu errado do nosso lado. Tente de novo em instantes.' }`, e o erro real vai para `console.error`.
  - `papeis.mjs`:
    - `PAPEIS = ['cliente','atendente','almoxarifado','instrutor','administrativo','superadmin']`
    - `temAlgumPapel(papeis: string[], exigidos: string[]) -> boolean`. O `superadmin` passa em qualquer exigência.
  - `contexto.js` (Deno):
    - `admin`, cliente `createClient(Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })`.
    - `obterContexto(req: Request) -> Promise<{ usuarioId: string, email: string, papeis: string[], perfil: object | null }>`. Sem token, ou com token inválido, lança `ErroHttp(401, 'Sua sessão expirou. Entre de novo.')`. Com perfil existente e `ativo = false`, lança `ErroHttp(403, 'Sua conta está desativada. Procure o atendimento do estande.')`.
    - `exigirPapel(contexto, ...papeis) -> void`. Se faltar o papel, lança `ErroHttp(403, 'Você não tem permissão para fazer isso.')`.
  - `minha-conta`: `GET` → `200 { id, email, papeis, perfil }`, em que `perfil` é `null` quando a pessoa ainda não preencheu o cadastro.

- [ ] **Step 1: Escrever os testes de unidade**

```js
// tests/unidade/papeis.test.mjs
test('temAlgumPapel: atendente passa quando atendente é exigido', () => assert.strictEqual(temAlgumPapel(['atendente'], ['atendente','administrativo']), true));
test('temAlgumPapel: cliente não passa em atendente', () => assert.strictEqual(temAlgumPapel(['cliente'], ['atendente']), false));
test('temAlgumPapel: superadmin passa em tudo', () => assert.strictEqual(temAlgumPapel(['superadmin'], ['almoxarifado']), true));
test('temAlgumPapel: sem papéis não passa', () => assert.strictEqual(temAlgumPapel([], ['cliente']), false));

// tests/unidade/http.test.mjs
test('tratar converte ErroHttp em JSON com a mensagem', async () => {
    const r = await tratar(async () => { throw new ErroHttp(403, 'Você não tem permissão para fazer isso.'); })(new Request('http://x', { method: 'GET' }));
    assert.strictEqual(r.status, 403);
    assert.deepStrictEqual(await r.json(), { erro: 'Você não tem permissão para fazer isso.' });
});
test('tratar responde OPTIONS com 204 e CORS', async () => { /* status 204, header access-control-allow-origin = '*' */ });
test('tratar esconde erro inesperado com mensagem amigável', async () => { /* throw new Error('x') -> 500, erro = 'Algo deu errado do nosso lado. Tente de novo em instantes.' */ });
```

O Node 22 tem `Request` e `Response` globais, então esses módulos rodam iguais no Node e no Deno.

- [ ] **Step 2: Rodar e ver falhar.** Run: `npm test`. Expected: FAIL, porque os módulos não existem.
- [ ] **Step 3: Implementar `http.mjs` e `papeis.mjs` com as assinaturas acima.**
- [ ] **Step 4: Rodar e ver passar.** Run: `npm test`. Expected: todos passam.
- [ ] **Step 5: Escrever o teste de integração**

```js
// tests/integracao/minha-conta.test.mjs
test('sem login recebe 401', async () => { const r = await funcao('minha-conta'); assert.strictEqual(r.status, 401); });
test('cliente vê os próprios papéis', async () => {
    const u = await criarUsuario({ papeis: ['cliente'] });
    const r = await funcao('minha-conta', { token: u.token });
    assert.strictEqual(r.status, 200);
    assert.deepStrictEqual(r.dados.papeis, ['cliente']);
    assert.strictEqual(r.dados.id, u.id);
});
test('usuário sem cadastro recebe perfil null', async () => { /* criarUsuario({ perfil: false }) -> 200, perfil null, papeis [] */ });
test('usuário desativado recebe 403 mesmo com token válido', async () => {
    /* criarUsuario, PATCH perfis ativo=false, chamar -> 403 e erro 'Sua conta está desativada. Procure o atendimento do estande.' */
});
```

- [ ] **Step 6: Implementar `contexto.js` e `minha-conta/index.js`** (`Deno.serve(tratar(async (req) => { … }))`).
- [ ] **Step 7: Publicar.** Run: `npx --yes supabase@2.20.12 functions deploy minha-conta --use-api`. Expected: "Deployed Function minha-conta". As variáveis `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` já existem nas Edge Functions e não precisam ser configuradas.
- [ ] **Step 8: Rodar e ver passar.** Run: `npm run test:integracao`. Expected: todos passam.
- [ ] **Step 9: Perguntar ao dono e fazer o commit.** Mensagem: `Cria a porta de entrada das Edge Functions e a função minha-conta`

---

### Task 6: Função `configuracoes`, com edição só para o superadmin

**Files:**
- Create: `supabase/functions/_shared/configuracoes.mjs`, `supabase/functions/configuracoes/index.js`, `supabase/scripts/promover-superadmin.sql`, `tests/unidade/configuracoes.test.mjs`, `tests/integracao/configuracoes.test.mjs`
- Modify: `README.md` (como criar o primeiro superadmin)

**Interfaces:**
- Consumes: `tratar`, `ErroHttp`, `respostaJson` (Task 5), `obterContexto`, `exigirPapel`, `admin` (Task 5), `salvar_configuracao` (Task 2).
- Produces:
  - `configuracoes.mjs`:
    - `CHAVES_CONFIGURACAO = ['estande','funcionamento','agenda','municao','cadastro','creditos']`
    - `validarConfiguracao(chave: string, valor: unknown) -> Record<string, string>`. Devolve `{}` quando está tudo certo. Senão, devolve um mapa campo → mensagem. Regras:
      - a chave precisa estar na lista;
      - o valor precisa ser um objeto;
      - em `agenda`, `municao`, `cadastro` e `creditos`, todo campo numérico é um inteiro maior que 0, exceto `antecedencia_minima_horas` e `tolerancia_nao_comparecimento_min`, que aceitam 0;
      - `duracao_maxima_individual <= duracao_maxima_grupo`;
      - `faixas_instrutores` tem `ate` crescente, o último `ate` é igual a `grupo_maximo` e `instrutores` é inteiro ≥ 1;
      - em `funcionamento`, cada dia de "0" a "6" é `null` ou `{abre, fecha}` no formato `HH:MM`, com `abre < fecha`, e `datas_fechadas` é uma lista de `AAAA-MM-DD`;
      - em `estande`, `nome` não pode ficar vazio.
  - `configuracoes` (função):
    - `GET` → `200 { configuracoes: { [chave]: valor } }` para qualquer usuário logado e ativo.
    - `PUT { chave, valor }` → só `superadmin`. Se a validação falhar, `400 { erro: 'Revise os campos destacados.', campos }`. Senão, chama `admin.rpc('salvar_configuracao', { p_chave, p_valor, p_usuario: contexto.usuarioId })` e devolve `200 { chave, valor }`.
  - `promover-superadmin.sql`: `insert into papeis_usuario (usuario_id, papel) select id, 'superadmin' from auth.users where email = '<EMAIL>' on conflict do nothing;`, com um comentário em português explicando que é para rodar no SQL Editor do painel.

- [ ] **Step 1: Escrever os testes de unidade**

```js
test('validarConfiguracao: padrão da agenda é válido', () => assert.deepStrictEqual(validarConfiguracao('agenda', AGENDA_PADRAO), {}));
test('validarConfiguracao: chave desconhecida', () => assert.ok(validarConfiguracao('xyz', {}).chave));
test('validarConfiguracao: antecedência máxima 0 é inválida', () => assert.ok(validarConfiguracao('agenda', { ...AGENDA_PADRAO, antecedencia_maxima_dias: 0 }).antecedencia_maxima_dias));
test('validarConfiguracao: número com casas decimais é inválido', () => assert.ok(validarConfiguracao('municao', { minima_por_participante: 50.5 }).minima_por_participante));
test('validarConfiguracao: individual maior que grupo é inválido', () => assert.ok(validarConfiguracao('agenda', { ...AGENDA_PADRAO, duracao_maxima_individual: 7 }).duracao_maxima_individual));
test('validarConfiguracao: faixas fora de ordem', () => assert.ok(validarConfiguracao('agenda', { ...AGENDA_PADRAO, faixas_instrutores: [{ ate: 10, instrutores: 2 }, { ate: 5, instrutores: 1 }] }).faixas_instrutores));
test('validarConfiguracao: abre depois de fechar', () => assert.ok(validarConfiguracao('funcionamento', { dias: { ...DIAS_PADRAO, '1': { abre: '23:00', fecha: '08:00' } }, datas_fechadas: [] })['dias.1']));
test('validarConfiguracao: domingo fechado (null) é válido', () => assert.deepStrictEqual(validarConfiguracao('funcionamento', { dias: { ...DIAS_PADRAO, '0': null }, datas_fechadas: ['2026-12-25'] }), {}));
```

`AGENDA_PADRAO` e `DIAS_PADRAO` são os valores da tabela da Task 2, Step 3, repetidos no arquivo de teste.

- [ ] **Step 2: Rodar e ver falhar.** Run: `npm test`. Expected: FAIL.
- [ ] **Step 3: Implementar `validarConfiguracao`.**
- [ ] **Step 4: Rodar e ver passar.** Run: `npm test`. Expected: todos passam.
- [ ] **Step 5: Escrever o teste de integração**

```js
test('cliente lê as configurações', async () => { /* GET com token de cliente -> 200 e configuracoes.agenda.antecedencia_maxima_dias === 15 */ });
test('cliente não altera configurações', async () => { /* PUT -> 403 */ });
test('superadmin altera, o valor fica salvo e o histórico guarda o autor', async () => {
    /* PUT agenda com antecedencia_maxima_dias 20 -> 200; GET mostra 20;
       historico_alteracoes (tabela configuracoes, registro agenda) mais recente tem feito_por = id do superadmin;
       no after(), PUT de volta para 15 */
});
test('superadmin com valor inválido recebe 400 e os campos', async () => { /* antecedencia_maxima_dias 0 -> 400, erro 'Revise os campos destacados.', campos.antecedencia_maxima_dias existe */ });
```

- [ ] **Step 6: Implementar `configuracoes/index.js` e `promover-superadmin.sql`.**
- [ ] **Step 7: Publicar.** Run: `npx --yes supabase@2.20.12 functions deploy configuracoes --use-api`. Expected: "Deployed Function configuracoes".
- [ ] **Step 8: Rodar tudo.** Run: `npm test` e depois `npm run test:integracao`. Expected: todos passam.
- [ ] **Step 9: Documentar no README** como criar o primeiro superadmin: criar o usuário em Authentication → Users → "Add user", com a opção de confirmar o e-mail marcada, e rodar o `promover-superadmin.sql` no SQL Editor com o e-mail trocado.
- [ ] **Step 10: Perguntar ao dono e fazer o commit.** Mensagem: `Cria a função de configurações, com edição só para o superadmin`

Ao parar para o teste do dono (fim da etapa 2), explicar como ele pode criar o próprio superadmin e ver a configuração mudar no Table Editor depois de rodar os testes.
