# RangePass, plano 5 de N: preços, campanhas, pacotes e o preço na revisão (etapa 5, parte 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o superadmin cadastra os preços (hora de pista, aluguel por modelo, munição por tipo), as regras por dia e horário, as campanhas, as classes de desconto e os pacotes; o cliente vê o preço total antes de confirmar, e esse preço fica congelado no agendamento.

**Architecture:**
- **Um módulo puro calcula o preço** (`_shared/precos.mjs`), usado igual no navegador (prévia) e no servidor (valor oficial). O servidor recalcula e compara com o valor que o cliente viu; se mudou, recusa com 409 e manda o valor novo.
- **Banco:** colunas de preço em `modelos` e `tipos_municao`, chave `precos` nas Configurações, tabelas `regras_preco`, `campanhas`, `classes_desconto` e `pacotes` (todas com histórico, nunca apagadas), e o preço congelado em `agendamentos` (`preco_total_centavos`, `preco_detalhe`).
- **Funções:** `agendamentos` passa a calcular e gravar o preço; `catalogo` aceita os preços de modelo e munição; uma função nova, `precos`, cuida de regras, campanhas, classes e pacotes (só superadmin).
- **Telas:** revisão e "Alterar horário" mostram o preço; o cartão mostra o total; a área da equipe ganha as abas **Preços** e **Promoções**, e a aba Agendamentos mostra o total.

**Tech Stack:** o mesmo dos planos 3 e 4.

**Spec:** `docs/superpowers/specs/2026-11-11-rangepass-supabase-design.md`, seções 6.9 (preço do grupo), 7 (preços, descontos, pacotes), 8 (balcão), 12, 13 e 15 (CDC: preço total antes da confirmação).

**Decisões do dono (2026-11-17):** preço congelado; o sistema aplica sozinho o melhor pacote; campanhas ativas aplicadas sozinhas no app; descontos de classe só no balcão (etapa 8); pacote e desconto não se somam, vale o melhor para o cliente.

**Planos seguintes:** 6 = agenda visual e deploy (etapas 6 e 7).

## Global Constraints

Valem todas as dos planos 1 a 4: **PowerShell 5.1**; **português do Brasil**, com mensagens que dizem o que aconteceu e o que fazer; **perguntar antes de cada commit**, nunca push nem merge sem pedido; **parar no fim de cada tarefa**; **testes limpam o que criam** e restauram o que alteram; **o construtor roda os testes, inclusive os de tela, e mostra os resultados**; **migrações aplicadas nunca são editadas**, e toda migração nova repete o bloco de bloqueio completo; **a conta real do dono (`wilmar.assuncao@gmail.com`, superadmin) e os 2 instrutores de exemplo nunca são tocados pelos testes**.

Novas neste plano:
- **Dinheiro em centavos inteiros** (`*_centavos`), nunca número com vírgula no banco ou nas contas. Na tela: `R$ 1.234,56`.
- **Arredondamento:** cada preço de hora de pista ajustado por regra é arredondado para o centavo (`Math.round`); o desconto de campanha também. Todo o resto é soma de inteiros.
- **Sem preço não se aluga:** modelo sem `preco_hora_centavos` ou munição sem `preco_unidade_centavos` não aparecem para o cliente. Sem `precos.hora_pista_centavos`, ninguém agenda.
- **Datas das promoções:** campanhas e pacotes valem pela **data em que o cliente agenda** (hoje, no fuso do estande), com início e fim inclusivos.
- **Grupo:** a hora de pista é cobrada **por pista ocupada** (= instrutores necessários); aluguel e munição, por participante (spec 6.9).
- **Classes de desconto** só são cadastradas neste plano; quem aplica é o atendente, na etapa 8.

## Review Focus

1. **Superadmin muda um preço entre a revisão e o "Confirmar":** o cliente recebe 409 com o valor novo e precisa confirmar de novo; nunca paga um valor que não viu. Teste em `agendamentos-funcao.test.mjs` (Task 4).
2. **Regra de sábado à noite +20% numa sessão que atravessa o início da regra (17h–19h):** só a hora das 18h recebe o acréscimo. Teste de unidade (Task 2).
3. **Campanha de 10% e pacote ativos juntos:** vale só o que dá o maior desconto. Teste de unidade (Task 2).
4. **Preço muda depois do agendamento:** o agendamento antigo continua com o valor gravado; só a alteração de horário recalcula. Teste em `agendamentos-funcao.test.mjs` (Task 4).
5. **Modelo sem preço:** não aparece nas opções do cliente, e um pedido com ele dá 400 em `modelo_id`. Teste (Task 4).

---

## Estrutura de arquivos

```
supabase/migrations/20261117001500_pendencias_plano4.sql   buscar_pessoas ≥3 dígitos; definir_papeis sem histórico vazio
supabase/migrations/20261117001600_precos.sql              colunas de preço, tabelas de promoções, preço do agendamento, RPCs
supabase/functions/_shared/precos.mjs                      puro: calcularPreco, formatarReais, validadores de regra/campanha/classe/pacote
supabase/functions/_shared/configuracoes.mjs               (alterar) chave precos
supabase/functions/_shared/catalogo.mjs                    (alterar) preços em modelo e tipo_municao; exportar CAMPOS
supabase/functions/agendamentos/index.js                   (alterar) preço nas opções, POST, PUT e Item
supabase/functions/catalogo/index.js                       (sem mudança de código além do módulo)
supabase/functions/precos/index.js                         GET/POST/PUT de regras, campanhas, classes e pacotes
supabase/functions/painel-agendamentos/index.js            (alterar) preço na Linha e no detalhe
agendar.js, index.html, agendar.css, agendar-regras.mjs    (alterar) preço na revisão, no alterar e no cartão
admin.html, admin.js, admin.css, admin-regras.mjs          (alterar) abas Preços e Promoções; total na aba Agendamentos
supabase/scripts/dados-de-exemplo.sql                      (alterar) preços de exemplo
tests/integracao/rp101-sql.test.mjs                        teste do último superadmin numa transação desfeita
README.md                                                  (alterar) preços; aviso sobre não criar conta pelo painel; SUPABASE_ACCESS_TOKEN
```

---

### Task 1: Pendências do plano 4

**Files:**
- Create: `supabase/migrations/20261117001500_pendencias_plano4.sql`, `tests/integracao/rp101-sql.test.mjs`, `tests/unidade/catalogo-paridade.test.mjs`
- Modify: `supabase/functions/_shared/catalogo.mjs` (exportar `CAMPOS_CADASTRO`), `admin.js` (usar `CAMPOS_CADASTRO` para `fixo`/`soAoCriar`), `README.md`, `.env.teste.exemplo`, `tests/integracao/equipe.test.mjs`

**Interfaces:**
- `buscar_pessoas` (create or replace, mesma assinatura): CPF só com **3 ou mais** dígitos na busca.
- `definir_papeis` (create or replace, mesma assinatura): não grava histórico quando a lista nova é igual à antiga.
- `catalogo.mjs` exporta `CAMPOS_CADASTRO` (o mapa por tipo, só leitura); `admin.js` tira `fixo`/`soAoCriar` dele em vez de repetir.
- **Teste do último superadmin sem tocar em contas reais** (`rp101-sql.test.mjs`): roda pela Management API (`POST https://api.supabase.com/v1/projects/<ref>/database/query`, token em `SUPABASE_ACCESS_TOKEN` do `.env.teste`; sem token, o teste é pulado com a mensagem `preencha SUPABASE_ACCESS_TOKEN no .env.teste`). O SQL é um bloco `do $$ ... $$` que:
  1. recebe o id de um superadmin de teste **A**, criado antes pelo teste com `criarUsuario({ papeis: ['superadmin'] })` (e apagado no fim, como sempre);
  2. torna inutilizáveis **só dentro do bloco** todos os outros superadmins usáveis (`perfis.ativo = false` e, para quem não tem perfil, `auth.users.banned_until` no futuro), inclusive a conta do dono: como o bloco termina em erro, **nada disso é gravado**;
  3. confere que `definir_papeis(A, '{}', A)` e `marcar_conta(A, false, A)` dão `RP101` (com `begin ... exception when sqlstate 'RP101'`);
  4. termina com `raise exception 'OK_SENTINELA'`, desfazendo tudo.
  O teste passa só se o erro devolvido contiver `OK_SENTINELA`; qualquer outro erro falha com a mensagem do banco. Depois, o teste confere pela API que a conta do dono continua superadmin, ativa e sem bloqueio.
- README: restaurar o aviso "não crie a conta direto no painel do Supabase, porque ela ficaria sem cadastro"; explicar o `SUPABASE_ACCESS_TOKEN` (como gerar em *Account → Access Tokens*, que fica só no `.env.teste` e nunca no Git).
- Os dois testes RP101 de `equipe.test.mjs` que hoje são pulados passam a apontar para o teste novo (mensagem do skip: `coberto por rp101-sql.test.mjs`).

- [ ] **Step 1: Testes** — `catalogo-paridade.test.mjs` (os campos e o `editavel` de cada tipo em `admin.js` vêm de `CAMPOS_CADASTRO`: o teste importa os dois e compara); integração da busca com 1 e 2 dígitos (não acha pelo CPF) e com 3 (acha); `definir_papeis` com a mesma lista não cria linha de histórico; `rp101-sql.test.mjs`.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar e `db push`.**
- [ ] **Step 4: Rodar as duas suítes** (com e sem `SUPABASE_ACCESS_TOKEN`: com, o RP101 passa; sem, é pulado). Conferir que a conta do dono continua superadmin e ativa.
- [ ] **Step 5: Commit (perguntar antes)** — `Fecha as pendências do plano 4: teste do último superadmin, busca por CPF e histórico de papéis`

---

### Task 2: Cálculo do preço (módulo puro)

**Files:**
- Create: `supabase/functions/_shared/precos.mjs`, `tests/unidade/precos.test.mjs`

**Interfaces:**
- `formatarReais(centavos: number) -> string`: `12000` → `'R$ 120,00'`; `123456` → `'R$ 1.234,56'`; `5` → `'R$ 0,05'`.
- `centavosDoTexto(texto: string) -> number | null`: aceita `'120'`, `'120,5'`, `'120,50'`, `'1.234,56'`, `'R$ 1.234,56'`; recusa vazio, negativo, letras e mais de 2 casas → `null`.
- `TabelaPrecos` = `{ hora_pista_centavos, regras: [{ dias: number[], hora_inicio: 'HH:MM', hora_fim: 'HH:MM', percentual, prioridade }], modelos: { [id]: preco_hora_centavos }, tipos_municao: { [id]: preco_unidade_centavos }, campanhas: [{ id, nome, percentual, inicio, fim }], pacotes: [{ id, nome, inicio, fim, preco_centavos, horas, modelo_id|null, tipo_municao_id|null, municao_qtd|null }] }` (só itens ativos).
- `calcularPreco(pedido: PedidoNormalizado, tabela, { hoje: 'AAAA-MM-DD', fuso }) -> Preco`:
  - **Pista:** para cada hora `h` da sessão (início no fuso), o valor da hora é `hora_pista_centavos` ajustado pela regra ativa de **maior prioridade** (empate: menor `percentual`) cujo `dias` contém o dia da semana e cuja faixa `[hora_inicio, hora_fim)` contém o início da hora: `Math.round(base × (100 + percentual) / 100)`. Total da pista = `instrutores_necessarios × Σ valores das horas`.
  - **Aluguel:** para cada participante `estande`: `modelos[modelo_id] × horas`.
  - **Munição:** para cada participante `estande` ou `arma_propria`: `tipos_municao[tipo_municao_id] × municao_qtd`.
  - **Pacote (o melhor):** um pacote vale se `inicio <= hoje <= fim`, `horas <= pedido.horas`, o `modelo_id` (se houver) é usado por algum participante `estande`, e o `tipo_municao_id` (se houver) é usado por algum participante com `municao_qtd >= pacote.municao_qtd`. Valor coberto = as primeiras `pacote.horas` horas de **uma** pista (com o ajuste das regras) + `pacote.horas` horas de aluguel de **um** participante desse modelo + `pacote.municao_qtd` unidades dessa munição. Economia = coberto − `preco_centavos`; só conta se > 0. Fica o de maior economia.
  - **Campanha (a melhor):** ativa se `inicio <= hoje <= fim`; desconto = `Math.round(subtotal × percentual / 100)`; fica a de maior percentual.
  - **Pacote × campanha:** aplica só o de **maior economia** (empate: pacote).
  - Devolve `{ itens: [{ descricao, total_centavos }], subtotal_centavos, desconto: null | { tipo: 'pacote' | 'campanha', nome, valor_centavos }, total_centavos }`. Descrições exatas, só com total > 0:
    - `` `Pista (${p} pista${p > 1 ? 's' : ''} × ${horas} hora${horas > 1 ? 's' : ''})` ``
    - `Aluguel de armas`
    - `Munição`
  - Nome do desconto: pacote → `` `Pacote ${nome}` ``; campanha → `` `Campanha ${nome} (${percentual}%)` ``.
- Validadores (mensagens exatas por campo):
  - `validarRegra(dados) -> { campos, valores }`: `nome` vazio → `Preencha este campo.`; `dias` não é lista não vazia de inteiros 0–6 → `Escolha pelo menos um dia.`; `hora_inicio`/`hora_fim` fora de `HH:MM` → `Use o formato HH:MM, por exemplo 08:00.`; início ≥ fim → `hora_fim`: `O fim deve ser depois do início.`; `percentual` não inteiro em −90..200 ou igual a 0 → `Informe um percentual entre -90 e 200, diferente de 0.`; `prioridade` não inteiro ≥ 0 → `Informe um número inteiro igual ou maior que 0.`; `ativo` não booleano → `Escolha sim ou não.`
  - `validarCampanha`: `nome`; `percentual` inteiro 1–90 → `Informe um percentual entre 1 e 90.`; `inicio`/`fim` → `Use uma data válida.`; fim < início → `fim`: `O fim deve ser no mesmo dia ou depois do início.`; `ativo`.
  - `validarClasse`: `nome`; `percentual` 1–90; `ativo`.
  - `validarPacote`: `nome`; `inicio`/`fim`; `preco_centavos` inteiro > 0 → `Informe um valor maior que zero.`; `horas` inteiro 1–6 → `Informe de 1 a 6 horas.`; `modelo_id` e `tipo_municao_id` opcionais (inteiro > 0 → `Escolha um item da lista.`); `municao_qtd` obrigatório (inteiro > 0) se houver `tipo_municao_id` → `Informe a quantidade de munição do pacote.`, e proibido sem ele; `ativo`.
  - Cada validador aceita `{ criando: boolean }`; numa edição, só os campos enviados, e `{}` → `campos.geral = 'Nada para alterar.'`

- [ ] **Step 1: Testes** (tabela base: pista 10.000; regra sábado 18:00–23:00 +20% prioridade 1; regra sábado 20:00–23:00 −10% prioridade 2; modelo 1 = 3.000/h; munição 5 = 250/un):
  - sozinho, quarta 10h–12h, estande 50 munições: pista 20.000 + aluguel 6.000 + munição 12.500 = **38.500**;
  - sábado 17h–19h: horas 10.000 + 12.000 → pista 22.000;
  - sábado 20h–21h: a regra de prioridade 2 vale → 9.000;
  - grupo de 6 (2 pistas), 1h quarta, 2 estande + 4 tudo_proprio: pista 20.000 + 2 aluguéis 6.000 + munição 2×50×250;
  - pacote "Iniciante" (1h, modelo 1, munição 5 × 50, R$ 150,00) numa sessão de 2h: economia = 10.000 + 3.000 + 12.500 − 15.000 = 10.500; total = subtotal − 10.500, `desconto.tipo = 'pacote'`;
  - pacote vencido ou de modelo não usado: não aplica;
  - campanha 10% e pacote juntos: vence o de maior economia (dois casos, um para cada);
  - nada ativo: `desconto: null`;
  - `formatarReais` e `centavosDoTexto` (todos os exemplos acima);
  - uma asserção por mensagem dos validadores.
- [ ] **Step 2: Rodar e ver falhar.** — [ ] **Step 3: Implementar.** — [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit (perguntar antes)** — `Cria o cálculo do preço: pista com regras por horário, aluguel, munição, pacotes e campanhas`

---

### Task 3: Banco dos preços

**Files:**
- Create: `supabase/migrations/20261117001600_precos.sql`
- Modify: `supabase/functions/_shared/configuracoes.mjs`, `supabase/functions/_shared/catalogo.mjs`, `tests/unidade/configuracoes.test.mjs`, `tests/unidade/catalogo.test.mjs`, `tests/integracao/base.test.mjs`, `tests/integracao/agendar-banco.test.mjs`, `tests/integracao/catalogo-funcao.test.mjs`

**Interfaces:**
- `modelos.preco_hora_centavos int` e `tipos_municao.preco_unidade_centavos int` (podem ficar vazios; `check (> 0)`). Em `catalogo.mjs`, campos editáveis novos: `preco_hora_centavos` (modelo) e `preco_unidade_centavos` (tipo_municao), inteiro > 0 ou `null` (`Informe um valor maior que zero.`); `salvar_cadastro` (create or replace) grava esses campos.
- `configuracoes.precos = {"hora_pista_centavos": null}`; `CHAVES_CONFIGURACAO` ganha `'precos'`; validação: inteiro > 0 → `Informe um valor maior que zero.` (`null` não é aceito pelo PUT).
- Tabelas (todas com `ativo boolean default true`, gatilho de histórico e RLS ligado): `regras_preco (id, nome, dias int[], hora_inicio time, hora_fim time, percentual int, prioridade int)`, `campanhas (id, nome, percentual int, inicio date, fim date)`, `classes_desconto (id, nome unique, percentual int)`, `pacotes (id, nome, inicio date, fim date, preco_centavos int, horas int, modelo_id int null references modelos, tipo_municao_id int null references tipos_municao, municao_qtd int null)`, com os `check` que repetem as regras dos validadores.
- `public.salvar_promocao(p_tipo text, p_id int, p_dados jsonb, p_autor uuid) returns jsonb` (`regra`, `campanha`, `classe`, `pacote`), igual ao `salvar_cadastro`: lista fixa de colunas por tipo, sem SQL montado do pedido, `P0002` em id inexistente.
- `agendamentos.preco_total_centavos int` e `agendamentos.preco_detalhe jsonb` (podem ficar vazios para os antigos).
- `criar_agendamento` (create or replace, mesma assinatura) grava `p_pedido->'preco'` (o objeto `Preco`) em `preco_detalhe` e `total_centavos` em `preco_total_centavos`.
- `alterar_horario_agendamento(p_agendamento uuid, p_inicio timestamptz, p_horas int, p_autor uuid, p_preco jsonb)` (nova assinatura; a de 4 argumentos é removida com `drop function` na mesma migração): grava o preço novo junto com o horário.
- Bloco de bloqueio completo com `salvar_promocao` e as duas assinaturas novas/alteradas.

- [ ] **Step 1: Testes** (unidade das chaves/campos novos; integração: `criar_agendamento` grava o preço; `alterar_horario_agendamento` com 5 argumentos grava o novo; o de 4 argumentos não existe mais (404); `salvar_promocao` cria e edita cada tipo com o autor no histórico; `check` recusa percentual 0 numa regra).
- [ ] **Step 2–4:** ver falhar, implementar, `db push`, rodar as duas suítes (os testes antigos que chamam `alterar_horario_agendamento` passam a mandar `p_preco`).
- [ ] **Step 5: Commit (perguntar antes)** — `Guarda os preços, as promoções e o preço congelado do agendamento no banco`

---

### Task 4: Preço no agendamento (função `agendamentos`, `catalogo` e painel)

**Files:**
- Modify: `supabase/functions/agendamentos/index.js`, `supabase/functions/painel-agendamentos/index.js`, `tests/integracao/agendamentos-funcao.test.mjs`, `tests/integracao/painel-agendamentos.test.mjs`, `tests/integracao/apoio.mjs`

**Interfaces:**
- `opcoes` ganha `precos: TabelaPrecos` (só itens ativos, campanhas/pacotes vigentes hoje) e `hoje` (data no fuso). `catalogo.modelos` só traz modelos com `preco_hora_centavos`; `catalogo.tipos_municao`, só com `preco_unidade_centavos`.
- **POST:** se `precos.hora_pista_centavos` está vazio → 409 `O estande ainda não definiu os preços. Tente de novo mais tarde.` O corpo precisa de `preco_esperado_centavos` (inteiro ≥ 0; senão 400 `Não foi possível ler os dados enviados. Tente de novo.`). O servidor calcula `calcularPreco`; se o total for diferente → 409 `{ erro: 'O preço mudou desde que você abriu a revisão. Confira o novo valor e confirme de novo.', preco: Preco }`. Se igual, manda `preco` dentro de `p_pedido`. A busca por `chave_envio` continua antes de tudo.
- **PUT alterar_horario:** mesma regra do `preco_esperado_centavos` e do 409; chama a RPC com `p_preco`.
- **Item** ganha `preco: { total_centavos, desconto: { tipo, nome, valor_centavos } | null } | null`.
- **Painel:** a Linha ganha `preco_total_centavos`; o detalhe ganha `preco_detalhe`.
- `apoio.mjs`: `definirPrecosDeTeste()` grava preços nos itens criados pelo teste e, se `precos.hora_pista_centavos` estiver vazio, um valor de teste, devolvendo uma função que **restaura** a linha `precos` exatamente.

- [ ] **Step 1: Testes:** opções com a tabela; modelo sem preço fora das opções e 400 em `modelo_id` no POST; POST com o preço certo grava o total; preço mudado entre a prévia e o POST → 409 com o preço novo, e nada gravado; agendamento antigo mantém o valor depois de mudar o preço do modelo; PUT alterar recalcula; sem preço da pista → 409; painel mostra o total.
- [ ] **Step 2–4:** ver falhar, implementar, publicar `agendamentos` e `painel-agendamentos`, rodar as duas suítes.
- [ ] **Step 5: Commit (perguntar antes)** — `Calcula, confere e congela o preço do agendamento`

---

### Task 5: Função `precos` (promoções, só superadmin)

**Files:**
- Create: `supabase/functions/precos/index.js`, `tests/integracao/precos-funcao.test.mjs`
- Modify: `supabase/config.toml`

**Interfaces:**
- **GET** → 200 `{ hora_pista_centavos, regras, campanhas, classes, pacotes }` (tudo, inclusive inativos, em ordem de nome ou de início).
- **POST** `{ tipo, dados }` → 201 `{ item }`; **PUT** `{ tipo, id, dados }` → 200 `{ item }`. Erros como em `catalogo` (400 campos; 404 `Não encontramos este cadastro.`; 23505 em `classes_desconto.nome` → 409 `Já existe uma classe com este nome.`; 23503 → 400 `Um dos itens escolhidos não existe mais. Recarregue a página.`).
- A hora de pista muda pelo `PUT configuracoes` (chave `precos`), que já existe.
- Só superadmin; outros papéis 403; sem login 401; outros métodos 405.

- [ ] **Step 1–4:** testes (403 para cliente, administrativo, instrutor e atendente; criar e editar cada tipo; validação; histórico com autor), implementar, publicar, rodar as suítes.
- [ ] **Step 5: Commit (perguntar antes)** — `Cria a função de promoções: regras por horário, campanhas, classes e pacotes`

---

### Task 6: Preço na tela do cliente

**Files:**
- Modify: `index.html`, `agendar.js`, `agendar.css`, `agendar-regras.mjs`, `tests/unidade/agendar-regras.test.mjs`

**Interfaces:**
- **Revisão:** uma tabela "Valor" com cada `itens[].descricao` e o valor (`formatarReais`), o desconto (`` `− ${formatarReais(valor)}` `` com o nome), e **Total** em destaque. Embaixo, o texto existente do pagamento no balcão e do prazo. O POST manda `preco_esperado_centavos = total`.
- **409 de preço mudado:** a revisão é redesenhada com o `preco` novo, com o aviso `O preço mudou. Confira o novo valor e confirme de novo.`; a `chave_envio` continua a mesma.
- **409 sem preços:** mostra a mensagem do servidor.
- **Alterar horário:** ao escolher dia, hora e duração, aparece `` `Novo valor: ${formatarReais(total)}` `` (com o desconto, se houver); o PUT manda `preco_esperado_centavos`.
- **Cartão de Meus agendamentos:** `` `Total: ${formatarReais(preco.total_centavos)}` `` (e o nome do desconto, se houver); agendamento antigo sem preço não mostra a linha.
- `agendar-regras.mjs`: `linhasDoPreco(preco) -> [{ rotulo, valor }]` (pura, testada).

- [ ] **Step 1–4:** TDD de `linhasDoPreco`; implementar; `npm test`.
- [ ] **Step 5: Teste de tela (construtor):** com preços de teste gravados e restaurados no fim: a revisão mostra itens e total; uma campanha de teste aparece como desconto; mudar o preço do modelo com a revisão aberta e confirmar mostra o aviso de preço mudado e o valor novo; o alterar mostra o novo valor; o cartão mostra o total. Limpar tudo.
- [ ] **Step 6: Commit (perguntar antes)** — `Mostra o preço na revisão, no alterar horário e em Meus agendamentos`

---

### Task 7: Aba Preços (área da equipe)

**Files:**
- Modify: `admin.html`, `admin.js`, `admin.css`, `admin-regras.mjs`, `tests/unidade/admin-regras.test.mjs`

**Interfaces:**
- `ABAS` ganha `{ id: 'precos', papeis: ['superadmin'] }`, entre Pistas e Equipe.
- Seções: **Hora de pista** (campo em reais, salvar pelo `PUT configuracoes` chave `precos`); **Armas** (lista de modelos com o preço por hora, editável em linha, `PUT catalogo`); **Munições** (preço por unidade, igual); **Regras por dia e horário** (lista e formulário: nome, dias da semana em caixas, início, fim, percentual, prioridade, ativa).
- Valores digitados em reais (`centavosDoTexto`) e mostrados com `formatarReais`; campo vazio em arma ou munição = "sem preço" (`null`), com o aviso `Sem preço, esta arma não aparece para os clientes.` / `... esta munição ...`.

- [ ] **Step 1–4:** TDD dos auxiliares novos; implementar; `npm test`.
- [ ] **Step 5: Teste de tela (construtor):** superadmin temporário; mudar a hora de pista e restaurar; dar preço a um modelo de teste; criar uma regra de sábado; valor inválido mostra o erro embaixo do campo. Limpar e restaurar tudo.
- [ ] **Step 6: Commit (perguntar antes)** — `Cria a aba Preços: hora de pista, armas, munições e regras por horário`

---

### Task 8: Aba Promoções (área da equipe)

**Files:**
- Modify: `admin.html`, `admin.js`, `admin.css`

**Interfaces:**
- `ABAS` ganha `{ id: 'promocoes', papeis: ['superadmin'] }`, depois de Preços.
- Seções: **Campanhas** (nome, percentual, início, fim, ativa; mostra `Vigente`, `Agendada` ou `Encerrada` pela data de hoje no fuso); **Classes de desconto** (nome, percentual, ativa; com a nota `Aplicadas pelo atendente no balcão.`); **Pacotes** (nome, início, fim, preço em reais, horas, modelo opcional, munição opcional e quantidade, ativo).
- Desativar/Reativar como no Catálogo; nada é apagado.

- [ ] **Step 1: Implementar.**
- [ ] **Step 2: Teste de tela (construtor):** criar e desativar uma campanha, uma classe e um pacote de teste; erro de percentual inválido embaixo do campo. Limpar tudo.
- [ ] **Step 3: Rodar** `npm test`.
- [ ] **Step 4: Commit (perguntar antes)** — `Cria a aba Promoções: campanhas, classes de desconto e pacotes`

---

### Task 9: Total na visão do administrativo, dados de exemplo e README

**Files:**
- Modify: `admin.js` (aba Agendamentos: coluna Total e o detalhe do preço), `supabase/scripts/dados-de-exemplo.sql`, `README.md`

**Interfaces:**
- Aba Agendamentos: coluna **Total** (`formatarReais`, ou `—` sem preço); no detalhe, os itens, o desconto e o total, como na revisão do cliente.
- `dados-de-exemplo.sql`: preços de exemplo, só se ainda estiverem vazios (`coalesce`): hora de pista R$ 120,00; pistolas R$ 40,00/h; revólveres R$ 35,00/h; carabinas R$ 30,00/h; fuzis R$ 80,00/h; espingarda R$ 60,00/h; munições: 9mm R$ 3,50; .380 R$ 3,80; .40 R$ 4,20; .38 R$ 3,20; .357 R$ 5,00; .22 LR R$ 0,90; 5,56 R$ 6,50; 7,62 R$ 9,00; 12 R$ 7,00 (por unidade). O `select` final mostra quantos modelos e munições têm preço.
- README: seção "Preços e promoções" (como o preço é calculado, o que congela, campanhas e pacotes, classes no balcão).

- [ ] **Step 1: Implementar.** — [ ] **Step 2: O construtor roda o script** pela Management API (dev) e confere os números. — [ ] **Step 3: Teste de tela** do total na aba Agendamentos. — [ ] **Step 4: Rodar as duas suítes.**
- [ ] **Step 5: Commit (perguntar antes)** — `Mostra o total na visão do administrativo e cria os preços de exemplo`
