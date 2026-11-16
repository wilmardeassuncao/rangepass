# RangePass, plano 4 de N: área da equipe (superadmin e administrativo) e pendências do plano 3 (etapa 5, parte 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o superadmin edita as Configurações, o catálogo, as armas, as pistas e a equipe numa página própria; o administrativo vê todos os agendamentos, com filtros e histórico. Também fecha as pendências deixadas pelo plano 3.

**Architecture:**
- **Mesmo padrão dos planos anteriores:** regras puras em `.mjs` (Node, Deno e navegador); uma função `security definer` por operação que grava, com o autor no histórico (`app.usuario_id`); uma Edge Function por área, que confere o papel com `exigirPapel`.
- **Funções novas:** `catalogo` e `equipe` (só superadmin) e `painel-agendamentos` (administrativo; o superadmin passa em qualquer exigência). A função `configuracoes`, que já existe, ganha a regra de versão do termo e da política.
- **Consultas que precisam do Auth** (e-mail, conta bloqueada) são feitas em SQL, em funções `security definer` que leem `auth.users`. Assim nenhuma função lista todos os usuários do Auth.
- **Front:** uma página nova, `admin.html`, com abas. Cada aba só aparece para o papel que pode usá-la.

**Tech Stack:** o mesmo dos planos 2 e 3.

**Spec:** `docs/superpowers/specs/2026-11-11-rangepass-supabase-design.md`. Seções usadas: 4 (papéis), 6.6, 6.9, 9.1 (pistas), 12 (Configurações), 13 (regras gerais e visão do admin) e 15 (LGPD: registrar quem acessou dados sensíveis).

**Planos seguintes:** 5 = preços, regras de dia e horário, descontos, pacotes e o preço total na revisão (etapa 5, parte 2); 6 = agenda visual e deploy (etapas 6 e 7).

## Global Constraints

Valem todas as dos planos 1 a 3: **PowerShell 5.1** nos comandos do dono; **português do Brasil**, com mensagens que dizem o que aconteceu e o que fazer; **perguntar antes de cada commit**, nunca fazer push nem merge; **parar no fim de cada tarefa**; **testes limpam tudo o que criam** e restauram o que alteram; o banco de desenvolvimento tem os dados de exemplo do plano 3, e os testes não podem supor que estão sozinhos. O construtor roda os testes, inclusive os de tela, e apresenta os resultados ao dono.

Novas neste plano:
- **Desativar em vez de apagar:** nenhuma função nova apaga cadastro. Categorias, calibres, modelos, munições e pistas têm `ativo`/`ativa`; armas têm `situacao`; contas são desativadas.
- **Desativar conta = bloquear o login no Supabase Auth** (`ban_duration: '876000h'`) **e** `perfis.ativo = false` quando houver perfil. Reativar = `ban_duration: 'none'` e `ativo = true`.
- **Papéis:** `cliente`, `atendente`, `almoxarifado`, `instrutor`, `administrativo`, `superadmin`. O superadmin passa em qualquer exigência (`temAlgumPapel`).
- **Proteções da equipe:** ninguém tira o próprio papel de superadmin nem desativa a própria conta, e o sistema nunca fica sem nenhum superadmin.
- **Termo e política versionados:** mudar o `texto` exige uma `versao` maior que a atual. Na página, a versão sobe sozinha ao salvar um texto novo.
- **Nº de registro:** a equipe (superadmin e administrativo) vê; o cliente continua sem ver nunca.
- **LGPD:** abrir o detalhe de um agendamento e buscar pessoas na equipe ficam registrados em `acessos_dados` (quem, o quê, quando).
- **Migrações já aplicadas nunca são editadas.** Toda mudança no banco é uma migração nova, com o bloco de bloqueio completo no fim (todos os `grant` anteriores mais os novos).
- **Visual:** o mesmo da área do cliente (escuro com laranja), mas pensado também para o computador: largura máxima de 960px, tabelas viram cartões em telas estreitas.

## Review Focus

1. **Superadmin que tenta tirar o próprio papel de superadmin, desativar a própria conta ou deixar o sistema sem superadmin:** 409, e nada muda. Testes em `equipe.test.mjs` (Task 4).
2. **Cliente, instrutor ou administrativo chamando as funções do superadmin** (`catalogo`, `equipe`, `PUT configuracoes`): 403, e nada muda; cliente chamando `painel-agendamentos`: 403. Testes nas Tasks 3, 4, 5 e 6.
3. **Mudar o texto do termo sem subir a versão:** 400 em `campos.versao`, e o texto antigo continua. Teste em `configuracoes.test.mjs` (Task 6).
4. **Clique duplo ou internet caindo ao confirmar:** o mesmo `chave_envio` devolve o mesmo agendamento, sem criar outro. Teste em `agendamentos-funcao.test.mjs` (Task 1).
5. **Desativar uma arma ou pista com agendamentos futuros:** a resposta avisa quantos são, e os agendamentos continuam marcados. Teste em `catalogo-funcao.test.mjs` (Task 3).

---

## Estrutura de arquivos

```
supabase/migrations/20261116001100_pendencias_plano3.sql   instrutores_ativos, RP006, RP007, chave_envio
supabase/migrations/20261116001200_cadastros.sql           salvar_cadastro, reservas_futuras
supabase/migrations/20261116001300_equipe.sql              buscar_pessoas, definir_papeis, marcar_conta, acessos_dados, registrar_acesso
supabase/migrations/20261116001400_painel.sql              emails_dos_usuarios
supabase/functions/_shared/agendamento.mjs                 (alterar) RP006, RP007
supabase/functions/_shared/catalogo.mjs                    puro: TIPOS_CADASTRO, validarCadastroCatalogo
supabase/functions/_shared/equipe.mjs                      puro: validarPapeis, regras de proteção
supabase/functions/_shared/configuracoes.mjs               (alterar) conferirVersao
supabase/functions/agendamentos/index.js                   (alterar) instrutores_ativos, chave_envio
supabase/functions/catalogo/index.js                       GET tudo; POST cria; PUT altera
supabase/functions/equipe/index.js                         GET busca; PUT papéis / desativar / reativar
supabase/functions/painel-agendamentos/index.js            GET lista com filtros; GET ?id= detalhe com histórico
supabase/functions/configuracoes/index.js                  (alterar) regra de versão
supabase/config.toml                                       (alterar) três funções novas
agendar.js, agendar-regras.mjs, index.html                 (alterar) pendências de tela do plano 3
admin.html, admin.css, admin.js                            página da equipe: abas
admin-regras.mjs                                           puro do front da equipe
conta.js, conta.html                                       (alterar) botão "Área da equipe"; voltar=admin.html
tests/unidade/catalogo.test.mjs, equipe.test.mjs, admin-regras.test.mjs
tests/unidade/agendamento.test.mjs, agendar-regras.test.mjs, configuracoes.test.mjs   (alterar)
tests/integracao/catalogo-funcao.test.mjs, equipe.test.mjs, painel-agendamentos.test.mjs
tests/integracao/agendar-banco.test.mjs, agendamentos-funcao.test.mjs, configuracoes.test.mjs, apoio.mjs   (alterar)
README.md                                                  (alterar) área da equipe
```

---

### Task 1: Pendências do plano 3 no servidor

**Files:**
- Create: `supabase/migrations/20261116001100_pendencias_plano3.sql`
- Modify: `supabase/functions/_shared/agendamento.mjs`, `supabase/functions/agendamentos/index.js`, `tests/unidade/agendamento.test.mjs`, `tests/integracao/agendar-banco.test.mjs`, `tests/integracao/agendamentos-funcao.test.mjs`

**Interfaces:**
- Produces:
  - `public.instrutores_ativos() returns table (id uuid, nome text)`, `security definer`, `grant ... to service_role`: papel `instrutor`, perfil ativo, login não bloqueado (`banned_until` vazio ou no passado), em ordem de nome. A função `agendamentos` passa a usá-la e perde `loginsLiberados`.
  - `public.instrutor_elegivel(p_instrutor uuid) returns boolean` (interna, sem `grant`): as mesmas três condições, sem olhar reservas. `instrutor_livre` passa a usá-la (`create or replace`, mesma assinatura).
  - **`RP006`** em `criar_agendamento` e `alterar_horario_agendamento`: algum CPF do agendamento já está em outro agendamento ativo (situação diferente de `cancelado` e `nao_compareceu`) com período sobreposto. Na alteração, o próprio agendamento é ignorado.
  - **`RP007`** em `alterar_horario_agendamento`: o instrutor escolhido pelo cliente não é mais elegível (`instrutor_elegivel` falso). Continua `RP001` quando ele é elegível mas está ocupado.
  - `agendamentos.chave_envio uuid` (pode ficar vazio), com `unique (responsavel_id, chave_envio)`. `criar_agendamento` grava `p_pedido->>'chave_envio'`.
  - `erroDeReserva`:

    | Código | `corpo.erro` |
    |---|---|
    | `RP006` | `Uma das pessoas deste agendamento já tem outro agendamento nesse horário. Escolha outro horário.` |
    | `RP007` | `O instrutor escolhido não atende mais pelo app. Para mudar o horário, fale com o estande.` |

  - **POST `agendamentos`** aceita `chave_envio` opcional no corpo:
    - presente e não é uuid: 400 `Não foi possível ler os dados enviados. Tente de novo.`;
    - já existe um agendamento desse responsável com essa chave: 200 `{ agendamento: Item }` com o existente, sem chamar a RPC;
    - a RPC dá `23505` na chave (dois envios ao mesmo tempo): busca o existente e responde 200 com ele.
    - Sucesso continua 201.
  - O bloco de bloqueio no fim repete todos os `grant` da migração `20261116001000` mais `instrutores_ativos()`.

- [ ] **Step 1: Escrever os testes**
  - Unidade: uma asserção por linha nova de `erroDeReserva`.
  - `agendar-banco.test.mjs`:
    - `mesmo CPF em horários sobrepostos dá RP006`: dois pedidos com o mesmo CPF de convidado em períodos que se cruzam; o segundo dá `RP006`; em períodos encostados (10–12 e 12–13) passa.
    - `cancelado não conta para o RP006`: o primeiro cancelado, o segundo passa.
    - `alterar para cima de outro agendamento da mesma pessoa dá RP006`.
    - `alterar com o instrutor escolhido bloqueado dá RP007` (banir com `banirUsuario`, desbanir no `finally`) e `ocupado continua RP001`.
    - `instrutores_ativos não traz bloqueado nem perfil inativo` (restaurar no fim).
  - `agendamentos-funcao.test.mjs`:
    - `mesma chave_envio devolve o mesmo agendamento`: dois POST iguais com a mesma `chave_envio` (`crypto.randomUUID()`); o primeiro 201, o segundo 200 com o mesmo `id`; só um agendamento no banco para esse cliente naquele horário.
    - `chave_envio inválida recebe 400`.
    - `opções continuam trazendo os instrutores` (o teste que já existe passa sem mudança).

- [ ] **Step 2: Rodar e ver falhar** — `npm test` e `npm run test:integracao`. Expected: os novos falham.
- [ ] **Step 3: Escrever a migração e alterar `agendamento.mjs` e `agendamentos/index.js`**
- [ ] **Step 4: Aplicar, publicar e rodar** — `npx --yes supabase@2.20.12 db push`, `npx --yes supabase@2.20.12 functions deploy agendamentos --use-api`, `npm test`, `npm run test:integracao`. Expected: tudo passa, sem resíduo.
- [ ] **Step 5: Commit (perguntar antes)**
  ```
  git add supabase/migrations/20261116001100_pendencias_plano3.sql supabase/functions/_shared/agendamento.mjs supabase/functions/agendamentos/index.js tests/unidade/agendamento.test.mjs tests/integracao/agendar-banco.test.mjs tests/integracao/agendamentos-funcao.test.mjs
  git commit -m "Impede a mesma pessoa em dois horários, evita agendamento repetido e lista instrutores pelo banco"
  ```

---

### Task 2: Pendências do plano 3 na tela do cliente

**Files:**
- Modify: `agendar.js`, `agendar-regras.mjs`, `index.html`, `agendar.css`, `tests/unidade/agendar-regras.test.mjs`

**Interfaces:**
- Consumes: `chave_envio` e os erros `RP006`/`RP007` (Task 1).
- Produces:
  - `agendar-regras.mjs` exporta `somarDias(data, n)` e `doisDigitos(n)`; `agendar.js` passa a importá-los (sem cópias).
  - `textoSemAlteracao(item: Item, agora: Date) -> string | null`:
    - `null` se `item.pode_alterar` ou se a situação não é `aguardando_pagamento`/`pago`, ou se a sessão já terminou;
    - `'Sessão em andamento.'` se `inicio <= agora < fim`;
    - senão `` `Faltam menos de ${item.prazo_alteracao_horas} horas. Para alterar ou cancelar, fale com o estande.` ``. O cartão usa esta função.
  - **Tela de erro de carregamento:** se o GET das opções ou da lista falhar, a tela "Carregando…" dá lugar a `#tela-erro`, com a mensagem do servidor (ou `Não foi possível carregar agora. Verifique a internet e tente de novo.`) e o botão "Tentar de novo", que roda a carga de novo.
  - **Depois de alterar ou cancelar:** se a recarga da lista falhar, a pessoa volta para a lista antiga com o aviso `` `${sucesso} Não foi possível atualizar a lista; recarregue a página.` `` (`sucesso` = `Horário alterado.` ou `Agendamento cancelado.`).
  - **`chave_envio`:** criada com `crypto.randomUUID()` ao abrir a tela de revisão, reaproveitada em "Confirmar" repetidos e trocada ao voltar para o formulário. Vai no corpo do POST. Uma resposta 200 ou 201 leva à tela de sucesso.
  - **Termo trocado com a página aberta:** um 400 com `campos[...aceite_termo_versao]` recarrega as opções (`ver=opcoes`), atualiza o texto do termo nos cartões e desmarca as caixas, mantendo a mensagem de erro.
  - **Erros de `aceite_termo_versao` e `arma_propria`:** recebem `aria-invalid` (na caixa do termo; no primeiro campo da arma) e o foco vai para o primeiro campo com erro.
  - **Remover um cartão** limpa os erros de todos os cartões.

- [ ] **Step 1: Testes de unidade** de `textoSemAlteracao` (4 casos: pode alterar → `null`; cancelado → `null`; em andamento; futuro sem prazo) e de `somarDias`/`doisDigitos`.
- [ ] **Step 2: Rodar e ver falhar** — `npm test`.
- [ ] **Step 3: Implementar**
- [ ] **Step 4: Rodar e ver passar** — `npm test`.
- [ ] **Step 5: Teste de tela (construtor, Playwright + Edge)**, com um cliente de teste criado e apagado no fim:
  1. Com a função `agendamentos` fora do ar simulada (rota do Playwright devolvendo 500 para `ver=opcoes`), aparece `#tela-erro`; "Tentar de novo", com a rota normal, abre a tela.
  2. Confirmar duas vezes seguidas (o segundo clique com a rota do POST atrasada) cria um só agendamento.
  3. Um agendamento que começou há 30 min (gravado direto no banco) mostra `Sessão em andamento.`
  4. Erro do termo: a caixa fica marcada como inválida e recebe o foco.
  - No fim, apagar os agendamentos e a conta de teste.
- [ ] **Step 6: Commit (perguntar antes)**
  ```
  git add agendar.js agendar-regras.mjs index.html agendar.css tests/unidade/agendar-regras.test.mjs
  git commit -m "Acerta a tela do cliente: erro de carregamento, envio repetido, sessão em andamento e termo novo"
  ```

---

### Task 3: Catálogo, armas e pistas (servidor)

**Files:**
- Create: `supabase/functions/_shared/catalogo.mjs`, `supabase/migrations/20261116001200_cadastros.sql`, `supabase/functions/catalogo/index.js`, `tests/unidade/catalogo.test.mjs`, `tests/integracao/catalogo-funcao.test.mjs`
- Modify: `supabase/config.toml` (`[functions.catalogo]`, `entrypoint = "./functions/catalogo/index.js"`, `verify_jwt = false`)

**Interfaces:**
- Produces:
  - `_shared/catalogo.mjs`: `TIPOS_CADASTRO` e `validarCadastroCatalogo(tipo: string, dados: object, { criando: boolean }) -> { campos, valores }`. Campos por tipo (`*` = obrigatório ao criar; `editável` = pode mudar depois):

    | Tipo | Campos |
    |---|---|
    | `categoria` | `nome`* editável, `ativo` editável |
    | `calibre` | `nome`* editável, `ativo` editável |
    | `modelo` | `categoria_id`* editável, `calibre_id`* (não muda), `marca`* editável, `nome`* editável, `ativo` editável |
    | `tipo_municao` | `calibre_id`* (não muda), `nome`* editável, `ativo` editável |
    | `unidade` | `modelo_id`* (não muda), `numero_registro`* editável, `situacao` editável (`disponivel`, `manutencao`, `desativada`; padrão `disponivel`) |
    | `pista` | `numero`* (não muda), `ativa` editável |

    Textos vão com `trim`. Mensagens:

    | Quando | Mensagem |
    |---|---|
    | tipo desconhecido | `campos.tipo = 'Este tipo de cadastro não existe.'` |
    | campo que não existe no tipo, ou que não muda, numa edição | `Este campo não pode ser mudado aqui.` |
    | texto obrigatório vazio | `Preencha este campo.` |
    | `*_id` não é inteiro > 0 | `Escolha um item da lista.` |
    | `ativo`/`ativa` não é booleano | `Escolha sim ou não.` |
    | `situacao` fora da lista | `Escolha a situação da arma.` |
    | `numero` não é inteiro > 0 | `Informe um número inteiro maior que 0.` |
    | edição sem nenhum campo | `campos.geral = 'Nada para alterar.'` |

  - `public.salvar_cadastro(p_tipo text, p_id int, p_dados jsonb, p_autor uuid) returns jsonb`, `security definer`, `grant ... to service_role`: grava `app.usuario_id`, insere (`p_id` nulo) ou atualiza só as chaves enviadas, e devolve a linha como `jsonb`. A tabela vem de uma lista fixa por `p_tipo`; nenhum nome de tabela ou coluna vem montado do pedido. Id inexistente na edição: `P0002`.
  - `public.reservas_futuras(p_tipo text, p_id int) returns int`, `security definer`, `grant ... to service_role`: para `unidade` e `pista`, quantas reservas ativas desse recurso ainda não terminaram; para os outros tipos, 0.
  - **`GET /functions/v1/catalogo`** (superadmin) → 200 `{ categorias: [{id, nome, ativo}], calibres: [{id, nome, ativo}], modelos: [{id, categoria_id, calibre_id, marca, nome, ativo}], tipos_municao: [{id, calibre_id, nome, ativo}], unidades: [{id, modelo_id, numero_registro, situacao}], pistas: [{id, numero, ativa}] }`, tudo, inclusive inativos, em ordem de nome ou número.
  - **`POST /functions/v1/catalogo`** `{ tipo, dados }` → 201 `{ item }`. **`PUT`** `{ tipo, id, dados }` → 200 `{ item, reservas_futuras }`, com `reservas_futuras` > 0 só quando a edição desativa (unidade fora de `disponivel`, pista com `ativa: false`).
  - Erros: JSON ilegível 400 (mensagem padrão); campos 400 `{ erro: 'Revise os campos destacados.', campos }`; `P0002` → 404 `Não encontramos este cadastro.`; `23503` → 400 `Um dos itens escolhidos não existe mais. Recarregue a página.`; `23505` → 409 com `campos`:

    | Tipo | Campo | Mensagem |
    |---|---|---|
    | `categoria`, `calibre` | `nome` | `Já existe um cadastro com este nome.` |
    | `modelo` | `nome` | `Já existe um modelo com esta marca e nome.` |
    | `tipo_municao` | `nome` | `Já existe uma munição com este nome neste calibre.` |
    | `unidade` | `numero_registro` | `Já existe uma arma com este número de registro.` |
    | `pista` | `numero` | `Já existe uma pista com este número.` |
  - Sem login 401; outros papéis 403 `Você não tem permissão para fazer isso.`; outros métodos 405.

- [ ] **Step 1: Testes**
  - Unidade: uma asserção por linha da tabela de mensagens; criação válida de cada tipo devolve `valores` com `trim`; `unidade` sem `situacao` vale `disponivel`.
  - Integração (`catalogo-funcao.test.mjs`; nomes com `marcador()`; tudo criado vai para `criar`/limpeza com histórico):
    - cliente e administrativo recebem 403 em GET, POST e PUT;
    - superadmin cria categoria, calibre, modelo, tipo de munição, unidade e pista; o GET traz todos; o histórico de cada um tem `feito_por` igual ao superadmin;
    - nome repetido de categoria dá 409 com a mensagem da tabela; nº de registro repetido também;
    - PUT mudando `calibre_id` de um modelo dá 400 `Este campo não pode ser mudado aqui.`;
    - desativar uma unidade com um agendamento futuro (criado via RPC e anotado) devolve `reservas_futuras: 1`, e o agendamento continua com a reserva;
    - PUT com id inexistente dá 404.
- [ ] **Step 2: Rodar e ver falhar**
- [ ] **Step 3: Implementar módulo, migração, função e `config.toml`**
- [ ] **Step 4: Aplicar, publicar e rodar** (`db push`, `functions deploy catalogo --use-api`, as duas suítes). Expected: tudo passa, sem resíduo, e os números dos dados de exemplo continuam iguais.
- [ ] **Step 5: Commit (perguntar antes)**
  ```
  git add supabase/functions/_shared/catalogo.mjs supabase/migrations/20261116001200_cadastros.sql supabase/functions/catalogo/index.js supabase/config.toml tests/unidade/catalogo.test.mjs tests/integracao/catalogo-funcao.test.mjs
  git commit -m "Cria os cadastros do superadmin: catálogo, armas e pistas, sem apagar nada"
  ```

---

### Task 4: Equipe e papéis (servidor)

**Files:**
- Create: `supabase/functions/_shared/equipe.mjs`, `supabase/migrations/20261116001300_equipe.sql`, `supabase/functions/equipe/index.js`, `tests/unidade/equipe.test.mjs`, `tests/integracao/equipe.test.mjs`
- Modify: `supabase/config.toml` (`[functions.equipe]`), `tests/integracao/apoio.mjs`

**Interfaces:**
- Produces:
  - `_shared/equipe.mjs`:
    - `validarPapeis(papeis: unknown) -> { erro: string | null, papeis: string[] }`: lista de `PAPEIS` sem repetição (vazia é permitida). Erro: `Escolha papéis da lista.`
    - `conferirMudancaDePapeis({ autorId, usuarioId, papeisNovos, superadminsAtuais: string[] }) -> string | null`, com as mensagens:
      - `Você não pode tirar o seu próprio papel de superadmin.` (autor = usuário, e `superadmin` sai);
      - `O sistema precisa de pelo menos um superadmin.` (o usuário é o único superadmin e `superadmin` sai).
    - `conferirDesativacao({ autorId, usuarioId }) -> string | null`: `Você não pode desativar a sua própria conta.`
  - Migração:
    - `acessos_dados (id bigint identity, usuario_id uuid not null, recurso text not null, registro text, em timestamptz default now())` e `public.registrar_acesso(p_usuario uuid, p_recurso text, p_registro text) returns void`, `security definer`, `grant ... to service_role`;
    - `public.buscar_pessoas(p_busca text) returns table (id uuid, email text, nome_completo text, cpf text, papeis papel[], bloqueado boolean)`, `security definer`, `grant ... to service_role`: com `p_busca` de 2 ou mais caracteres, procura no nome (`ilike`), no e-mail (`ilike`) e no CPF (só dígitos, prefixo); sem busca, devolve só quem tem algum papel que não seja `cliente`. No máximo 50 linhas, em ordem de nome (sem nome por último, por e-mail);
    - `public.definir_papeis(p_usuario uuid, p_papeis papel[], p_autor uuid) returns papel[]`, `security definer`, `grant ... to service_role`: troca os papéis numa transação, trava `papeis_usuario` contra corridas (`pg_advisory_xact_lock(hashtext('papeis'))`), confere de novo no banco que continua existindo pelo menos um superadmin (senão `RP101`) e grava no histórico uma linha `tabela = 'papeis_usuario'`, `registro_id = p_usuario`, `acao = 'alteracao'`, `antes`/`depois` com as listas, `feito_por = p_autor`;
    - `public.marcar_conta(p_usuario uuid, p_ativa boolean, p_autor uuid) returns void`, `security definer`, `grant ... to service_role`: grava o autor e muda `perfis.ativo` quando há perfil.
  - **`GET /functions/v1/equipe?busca=`** (superadmin) → 200 `{ pessoas: [{ id, email, nome_completo, cpf, papeis, ativo }] }` (`ativo` = não bloqueado e perfil ativo, ou sem perfil). Com `busca`, registra o acesso (`recurso = 'equipe.busca'`, `registro = busca`).
  - **`PUT /functions/v1/equipe`**:
    - `{ usuario_id, papeis }` → 200 `{ pessoa }`. Ordem: JSON; `usuario_id` uuid de alguém que existe (senão 404 `Não encontramos esta pessoa.`); `validarPapeis` (400 `{ erro, campos: { papeis } }`); `conferirMudancaDePapeis` (409); `RP101` da RPC → 409 com a mensagem do superadmin.
    - `{ usuario_id, acao: 'desativar' | 'reativar' }` → 200 `{ pessoa }`. Desativar: `conferirDesativacao` (409), depois bloqueio no Auth e `marcar_conta(..., false, ...)`; se a RPC falhar, desfaz o bloqueio. Reativar: desbloqueio e `marcar_conta(..., true, ...)`.
    - `acao` desconhecida: 400 `Esta ação não existe.`
  - Em `apoio.mjs`: `desbanirUsuario(id)` (se ainda não existir) e `apagarAcessosDe(usuarioId)` para a limpeza.

- [ ] **Step 1: Testes**
  - Unidade: cada mensagem de `equipe.mjs`, inclusive "outro superadmin tira o superadmin de alguém, e sobra um" → `null`.
  - Integração (`equipe.test.mjs`), com dois superadmins e um cliente de teste:
    - cliente e administrativo recebem 403;
    - busca pelo e-mail do cliente acha a pessoa, com `cpf` e `papeis: ['cliente']`, e grava uma linha em `acessos_dados`;
    - dar `['instrutor']` ao cliente: o GET mostra o papel, e o histórico tem a linha de `papeis_usuario` com o autor;
    - superadmin A tirando o próprio superadmin: 409, papéis iguais;
    - superadmin A tirando o superadmin de B: passa (sobra A);
    - desativar o cliente: o login dele (`entrar`) passa a falhar; `minha-conta` com o token antigo dá 403; reativar devolve o acesso (novo login funciona);
    - desativar a si mesmo: 409.
    - Restaurar e apagar tudo no fim (usuários, histórico de `papeis_usuario` e `perfis` deles, acessos).
- [ ] **Step 2: Rodar e ver falhar**
- [ ] **Step 3: Implementar**
- [ ] **Step 4: Aplicar, publicar e rodar** (`db push`, `functions deploy equipe --use-api`, as duas suítes).
- [ ] **Step 5: Commit (perguntar antes)**
  ```
  git add supabase/functions/_shared/equipe.mjs supabase/migrations/20261116001300_equipe.sql supabase/functions/equipe/index.js supabase/config.toml tests/unidade/equipe.test.mjs tests/integracao/equipe.test.mjs tests/integracao/apoio.mjs
  git commit -m "Cria a gestão da equipe: papéis, desativar e reativar contas, com histórico e registro de acesso"
  ```

---

### Task 5: Visão do administrativo (servidor)

**Files:**
- Create: `supabase/migrations/20261116001400_painel.sql`, `supabase/functions/painel-agendamentos/index.js`, `tests/integracao/painel-agendamentos.test.mjs`
- Modify: `supabase/config.toml` (`[functions.painel-agendamentos]`)

**Interfaces:**
- Consumes: `registrar_acesso` (Task 4), `dataNoFuso` e `instanteNoFuso`.
- Produces:
  - `public.emails_dos_usuarios(p_ids uuid[]) returns table (id uuid, email text)`, `security definer`, `grant ... to service_role`.
  - **`GET /functions/v1/painel-agendamentos?de=&ate=&situacao=&instrutor_id=&busca=`** (administrativo; superadmin passa) → 200 `{ agendamentos: Linha[], instrutores: [{id, nome}] }`:
    - `de`/`ate` em `AAAA-MM-DD` no fuso do estande, inclusivos; padrão de hoje até hoje + 15 dias; `ate` antes de `de` ou mais de 92 dias de intervalo → 400 `{ erro: 'Revise os campos destacados.', campos: { ate: 'Escolha um período de até 92 dias, com o fim depois do início.' } }`; data inválida → `campos.de`/`campos.ate = 'Use uma data válida.'`;
    - `situacao` (uma das seis) e `instrutor_id` (uuid) opcionais; inválidos → `campos.situacao = 'Escolha uma situação da lista.'` / `campos.instrutor_id = 'Escolha um instrutor da lista.'`;
    - `busca` opcional (nome, e-mail ou CPF do responsável);
    - `Linha` = `{ id, inicio, horas, situacao, forma_pagamento, criado_em, responsavel: { nome_completo, cpf, telefone, email }, participantes_qtd, instrutores: [nome] (principal primeiro), pistas: [numero], armas: [{ modelo: 'Marca Nome', numero_registro }] }`, só reservas ativas, em ordem de início crescente; no máximo 500 (`limite_atingido: true` quando passa).
  - **`GET ...?id=`** → 200 `{ agendamento: Linha + { participantes: [{ nome_completo, cpf, data_nascimento, modalidade, termo_versao, modelo, tipo_municao, municao_qtd, arma_propria: {modelo, calibre, numero_registro, responsavel} }] }, historico: [{ em, tabela, acao, autor: nome ou e-mail ou null, antes, depois }] }`. O histórico junta as linhas do agendamento e das reservas, participantes e itens dele, em ordem de data. Registra o acesso (`recurso = 'agendamento'`, `registro = id`). Id inválido ou inexistente: 404 `Não encontramos este agendamento.`
  - Sem login 401; cliente, atendente, instrutor e almoxarifado 403; outros métodos 405.

- [ ] **Step 1: Testes (`painel-agendamentos.test.mjs`)**: um agendamento de grupo criado via RPC (anotado), um administrativo, um cliente:
  - cliente 403; administrativo 200;
  - o filtro de período traz o agendamento; `situacao=cancelado` não traz; `instrutor_id` do instrutor dele traz; `busca` pelo CPF do responsável traz;
  - `ate` antes de `de` dá 400 com a mensagem;
  - o detalhe traz os participantes com CPF, o nº de registro da arma e o histórico com o autor; e grava uma linha em `acessos_dados`;
  - limpar tudo no fim, inclusive os acessos.
- [ ] **Step 2: Rodar e ver falhar**
- [ ] **Step 3: Implementar**
- [ ] **Step 4: Aplicar, publicar e rodar**
- [ ] **Step 5: Commit (perguntar antes)**
  ```
  git add supabase/migrations/20261116001400_painel.sql supabase/functions/painel-agendamentos/index.js supabase/config.toml tests/integracao/painel-agendamentos.test.mjs
  git commit -m "Cria a visão do administrativo: agendamentos com filtros, detalhe e histórico"
  ```

---

### Task 6: Página da equipe e Configurações

**Files:**
- Create: `admin.html`, `admin.css`, `admin.js`, `admin-regras.mjs`, `tests/unidade/admin-regras.test.mjs`
- Modify: `supabase/functions/_shared/configuracoes.mjs`, `supabase/functions/configuracoes/index.js`, `tests/unidade/configuracoes.test.mjs`, `tests/integracao/configuracoes.test.mjs`, `conta.js`, `conta.html`

**Interfaces:**
- Consumes: `GET`/`PUT configuracoes`, `GET minha-conta` (papéis), `api.mjs`.
- Produces:
  - `configuracoes.mjs`: `conferirVersao(chave, novo, atual) -> Record<string,string>`: para `privacidade` e `termo`, se `novo.texto !== atual.texto` e `novo.versao <= atual.versao` → `` { versao: `Para mudar o texto, use uma versão maior que a atual (${atual.versao}).` } ``; senão `{}`. O PUT da função lê o valor atual e soma este erro aos `campos`.
  - `conta.js`: `voltar` aceita exatamente `index.html` ou `admin.html`. `conta.html`: botão "Área da equipe" (`admin.html`) em "Meu perfil", só para quem tem algum papel além de `cliente`.
  - **`admin.html`:** sem login vai para `conta.html?voltar=admin.html`. Sem papel `administrativo` nem `superadmin`: `Esta área é só para a equipe do estande.` e o link para `index.html`. Abas: **Configurações**, **Catálogo**, **Pistas**, **Equipe** (só superadmin) e **Agendamentos** (administrativo e superadmin). Esta tarefa faz a moldura (cabeçalho com nome e "Sair", abas, aviso) e a aba Configurações; as outras abas mostram `Em construção.` até as Tasks 7 a 9.
  - **Aba Configurações** (só superadmin), um formulário por chave, com os erros de `campos` embaixo de cada campo:
    - `estande`: nome, endereço, contato, fuso (texto), logo (endereço da imagem, opcional);
    - `funcionamento`: uma linha por dia (Domingo a Sábado) com "Fechado" ou abre/fecha; datas fechadas como lista com "Adicionar data" e "Remover";
    - `agenda`: os oito números e as faixas de instrutores (linhas "até N pessoas → M instrutores", com adicionar/remover);
    - `municao`, `cadastro`, `creditos`: os números;
    - `privacidade` e `termo`: o texto (área grande) e a versão atual só para leitura; ao salvar um texto diferente, a página manda `versao` atual + 1, e a mensagem de sucesso diz `` `Versão ${n} publicada. Os clientes vão aceitar o texto novo no próximo agendamento.` `` (no termo) ou `... no próximo cadastro.` (na política).
    - Salvar uma chave mostra `Configuração salva.`
  - **`admin-regras.mjs`:**
    - `NOMES_DIAS = ['Domingo', ..., 'Sábado']`;
    - `funcionamentoDoFormulario(linhas: [{fechado, abre, fecha}], datas: string[]) -> { dias, datas_fechadas }` (dia fechado → `null`; datas em ordem e sem repetição) e o inverso, `formularioDoFuncionamento(funcionamento)`;
    - `proximaVersao(atual: {versao, texto}, textoNovo: string) -> number` (igual ao atual se o texto não mudou; senão + 1).

- [ ] **Step 1: Testes**
  - Unidade: `conferirVersao` (texto igual com mesma versão → `{}`; texto novo com mesma versão → mensagem; texto novo com versão maior → `{}`; chave `agenda` → `{}`); `funcionamentoDoFormulario` ida e volta com um dia fechado e datas repetidas fora de ordem; `proximaVersao`.
  - Integração (`configuracoes.test.mjs`, restaurando o termo no fim, com o histórico gerado apagado): superadmin muda o texto do termo mantendo a versão → 400 em `campos.versao`, e o texto continua; com `versao + 1` → 200.
- [ ] **Step 2: Rodar e ver falhar**
- [ ] **Step 3: Implementar a regra no servidor e publicar** (`functions deploy configuracoes --use-api`), depois a página.
- [ ] **Step 4: Rodar** `npm test` e `npm run test:integracao`.
- [ ] **Step 5: Teste de tela (construtor)** com um superadmin e um administrativo de teste: login → volta para `admin.html`; o administrativo não vê Configurações nem Equipe; o superadmin muda o contato do estande e vê `Configuração salva.`; marca domingo como fechado e salva; publica um termo novo e vê `Versão N publicada...`; um número inválido mostra o erro embaixo do campo. **Restaurar** as configurações mexidas e apagar o histórico gerado e as contas de teste no fim.
- [ ] **Step 6: Commit (perguntar antes)**
  ```
  git add admin.html admin.css admin.js admin-regras.mjs tests/unidade/admin-regras.test.mjs supabase/functions/_shared/configuracoes.mjs supabase/functions/configuracoes/index.js tests/unidade/configuracoes.test.mjs tests/integracao/configuracoes.test.mjs conta.js conta.html
  git commit -m "Cria a página da equipe com as Configurações do estande"
  ```

---

### Task 7: Abas Catálogo e Pistas

**Files:**
- Modify: `admin.html`, `admin.js`, `admin.css`, `admin-regras.mjs`, `tests/unidade/admin-regras.test.mjs`

**Interfaces:**
- Consumes: `GET`/`POST`/`PUT catalogo` (Task 3).
- Produces:
  - **Catálogo** (só superadmin), em seções: Categorias, Calibres, Modelos (com categoria e calibre por nome), Munições (com calibre), Armas (modelo, nº de registro, situação). Cada seção tem a lista (inativos em cinza, com o rótulo `Desativado`), o botão "Adicionar" (formulário com os campos de criar) e, em cada linha, "Editar" (só os campos editáveis) e "Desativar"/"Reativar" (ou a situação, nas armas).
  - **Pistas:** lista de pistas com "Ativa"/"Inativa" e o botão "Adicionar pista", que cria a próxima com o número seguinte ao maior.
  - Um PUT com `reservas_futuras > 0` mostra `` `Salvo. Esta arma tem ${n} agendamento(s) futuro(s); eles continuam marcados e o atendimento precisa resolver.` `` (ou `Esta pista tem ...`).
  - `admin-regras.mjs`: `proximoNumeroDePista(pistas) -> number` (1 se não houver nenhuma) e `rotuloSituacaoArma(s)` (`disponivel` → `Disponível`, `manutencao` → `Em manutenção`, `desativada` → `Desativada`).

- [ ] **Step 1: Testes de unidade** das duas funções.
- [ ] **Step 2: Rodar e ver falhar; implementar; rodar e ver passar** (`npm test`).
- [ ] **Step 3: Teste de tela (construtor)** com um superadmin de teste: criar categoria, calibre, modelo, munição e arma de teste (nomes com marcador); editar o nome do modelo; pôr a arma em manutenção; criar uma pista nova e desativá-la; nome repetido mostra o erro embaixo do campo. No fim, apagar pelo banco (serviço) tudo o que foi criado, com o histórico, e conferir que os números dos dados de exemplo continuam iguais.
- [ ] **Step 4: Commit (perguntar antes)**
  ```
  git add admin.html admin.js admin.css admin-regras.mjs tests/unidade/admin-regras.test.mjs
  git commit -m "Cria as abas de catálogo e pistas na página da equipe"
  ```

---

### Task 8: Aba Equipe

**Files:**
- Modify: `admin.html`, `admin.js`, `admin.css`

**Interfaces:**
- Consumes: `GET`/`PUT equipe` (Task 4).
- Produces:
  - Ao abrir, a lista de quem tem papel de equipe. Um campo "Buscar por nome, e-mail ou CPF" (a partir de 2 caracteres, ao apertar Enter ou "Buscar").
  - Cada pessoa: nome (ou `Sem cadastro`), e-mail, CPF formatado (`formatarCpf`), situação (`Ativa`/`Desativada`), e caixas de marcar para cada papel com o botão "Salvar papéis". Botão "Desativar conta"/"Reativar conta", com `confirm('Desativar a conta de <nome ou e-mail>? A pessoa não vai mais conseguir entrar.')`.
  - Os 409 aparecem num aviso, e a lista é recarregada depois de cada mudança.
  - Nomes dos papéis na tela: Cliente, Atendente, Almoxarifado, Instrutor, Administrativo, Superadmin.

- [ ] **Step 1: Implementar**
- [ ] **Step 2: Teste de tela (construtor)** com dois superadmins e um cliente de teste: buscar o cliente pelo e-mail; dar o papel Instrutor; desativar e reativar a conta; tentar tirar o próprio superadmin e ver o aviso. Apagar tudo no fim.
- [ ] **Step 3: Rodar** `npm test`.
- [ ] **Step 4: Commit (perguntar antes)**
  ```
  git add admin.html admin.js admin.css
  git commit -m "Cria a aba Equipe: buscar pessoas, papéis e desativar contas"
  ```

---

### Task 9: Aba Agendamentos (visão do administrativo)

**Files:**
- Modify: `admin.html`, `admin.js`, `admin.css`, `admin-regras.mjs`, `tests/unidade/admin-regras.test.mjs`, `README.md` (seção "Área da equipe")

**Interfaces:**
- Consumes: `GET painel-agendamentos` (Task 5), `descreverSessao`, `TEXTO_SITUACAO`.
- Produces:
  - Filtros: de, até (padrão hoje e hoje + 15, no fuso), situação (Todas + as seis), instrutor (Todos + a lista), busca. Botão "Filtrar".
  - Tabela (cartões no celular): sessão (`descreverSessao`), situação, responsável (nome e telefone formatado), pessoas, instrutores, pistas, armas (modelo e nº de registro). Com `limite_atingido`: `Mostrando os 500 primeiros. Diminua o período para ver todos.` Sem resultados: `Nenhum agendamento com estes filtros.`
  - Clicar numa linha abre o detalhe: dados do responsável (com e-mail e CPF), participantes (com CPF, nascimento, modalidade, arma e munição, termo aceito na versão N) e o histórico em ordem, uma linha por evento: `` `${data e hora no fuso} · ${autor ou 'Sistema'} · ${descricao}` ``.
  - `admin-regras.mjs`:
    - `consultaDosFiltros({ de, ate, situacao, instrutor_id, busca }) -> string` (só os preenchidos, com `encodeURIComponent`, sem o "?");
    - `descreverEvento(evento) -> string`: `insercao` em `agendamentos` → `Agendamento criado`; `alteracao` com `situacao` diferente → `` `Situação: ${antes} → ${depois}` `` (com `TEXTO_SITUACAO`); com `inicio`/`horas` diferentes → `Horário alterado`; reservas (`agendamento_pistas`, `agendamento_instrutores`, `agendamento_unidades`) → `Pista reservada`/`Instrutor reservado`/`Arma reservada` na inserção e `Reserva atualizada` na alteração; participantes e itens → `Participante incluído`/`Item incluído`; qualquer outro → `Alteração registrada`.

- [ ] **Step 1: Testes de unidade** de `consultaDosFiltros` (vazios fora; acentos e espaço codificados) e uma asserção por regra de `descreverEvento`.
- [ ] **Step 2: Rodar e ver falhar; implementar; rodar e ver passar.**
- [ ] **Step 3: Teste de tela (construtor)** com um administrativo de teste e um agendamento de teste criado pela RPC: o agendamento aparece no período; o filtro "Cancelado" o esconde; o detalhe mostra o histórico com "Agendamento criado"; o administrativo não vê as abas do superadmin. Apagar tudo no fim, inclusive os acessos.
- [ ] **Step 4: Rodar** `npm test` e `npm run test:integracao`.
- [ ] **Step 5: README:** como entrar na área da equipe, quem vê cada aba e como dar o papel de superadmin ao primeiro usuário (o script que já existe).
- [ ] **Step 6: Commit (perguntar antes)**
  ```
  git add admin.html admin.js admin.css admin-regras.mjs tests/unidade/admin-regras.test.mjs README.md
  git commit -m "Cria a aba Agendamentos da equipe: filtros, detalhe e histórico"
  ```
