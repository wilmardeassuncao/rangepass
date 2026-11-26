# RangePass, plano 8A: base da operação e Recepção — plano de implementação

> **Para quem executa (agentes):** SUB-SKILL OBRIGATÓRIA: usar superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano tarefa por tarefa. Os passos usam caixas (`- [ ]`) para acompanhar.

**Objetivo:** criar a página do estande (`estande.html`) com a área **Recepção**: lista do dia, ficha de check-in com pagamento no balcão e desconto de classe por parte do preço (pista, aluguel, munição, munição nunca abaixo do custo de compra).

**Arquitetura:** uma migração nova (três percentuais nas classes de desconto, custo de compra na munição, tabela de pagamentos e a função `fazer_check_in`, que grava tudo numa transação); regras puras em `_shared/` (testáveis no Node e usadas no navegador e no servidor); uma Edge Function nova `operacao`; a página `estande.html` com a moldura do plano 7, uma área por `#`.

**Tecnologia:** HTML, CSS e JavaScript puro (módulos ES), sem build; Supabase (Postgres + Edge Functions em Deno); testes com `node:test`; testes de tela com Playwright (roteiros fora do repositório).

**Spec:** `docs/superpowers/specs/2026-11-26-rangepass-operacao-estande-design.md` (aprovada em 8e310a3), seções 1, 5, 6 (até 6.1), 8, 9, 11 (plano 8A), 12 e 13. Onde ela não fala, valem a spec principal e as dos planos 6 e 7.

## Restrições gerais

Valem todas as dos planos 1 a 7:
- **PowerShell 5.1** e **português do Brasil** em tudo (mensagens, comentários, descrições de comandos, instruções para ajudantes). Mensagens dizem o que aconteceu e o que fazer.
- **Perguntar antes de cada commit.** Nunca push nem merge sem pedido. **Cada envio do `nova-arquitetura` ao GitHub atualiza o site da Vercel.** **Parar no fim de cada tarefa.**
- **Os testes limpam o que criam** e restauram o que alteram. **Quem constrói roda os testes, inclusive os de tela, e mostra os resultados.**
- **A conta real do dono (`wilmar.assuncao@gmail.com`, superadmin) e os 2 instrutores de exemplo nunca são tocados pelos testes.**
- **Migrações aplicadas nunca são editadas**; toda migração nova termina com o bloco "Bloqueio" (como `20261123001800_vagas_por_hora.sql`), repetindo os `grant execute ... to service_role` de todas as funções e acrescentando as novas.
- **Dinheiro em centavos inteiros.**
- **Sem framework e sem build:** arquivos do navegador na raiz do projeto (o `.vercelignore` publica a raiz e `supabase/functions/_shared/`).
- **Layout do plano 7:** moldura comum (`moldura.mjs`, `base.css`), ponto de troca em `900px`, botões de pelo menos 44px no celular, a página nunca rola para o lado.
- Aplicar migração no dev: `npx.cmd --yes supabase@2.20.12 db push`. Publicar função: `npx.cmd --yes supabase@2.20.12 functions deploy <nome> --use-api`.

Ajuste desta etapa (do dono, 2026-11-26): o **custo de compra** da munição fica na aba **Preços**, ao lado do "Preço por unidade" (é lá que o preço da munição já é editado), e não no formulário do Catálogo. A spec foi atualizada junto com este plano.

## Pontos de atenção na revisão

1. **Agendamento antigo sem preço guardado** (`preco_total_centavos` nulo, de antes do plano 5): a ficha não oferece desconto de classe e pede o **valor cobrado** digitado; o check-in funciona. Teste na Task 4.
2. **Dois check-ins ao mesmo tempo** no mesmo agendamento: o segundo recebe 409 "O check-in deste agendamento já foi feito." e nada é gravado em dobro. Teste na Task 1 (banco).
3. **Classe desativada entre abrir a ficha e confirmar**, ou **custo/preço que mudou** no meio: o servidor recusa com 409 e a mensagem diz o que fazer; a tela recarrega a ficha. Teste na Task 4.
4. **Sessão perto da meia-noite / fuso:** "hoje" é a data **no fuso do estande** (`configuracoes.estande.fuso`), e a sessão é de hoje se a data do `inicio` no fuso for hoje. Teste de unidade na Task 2.
5. **Superadmin sem o papel atendente** vê a Recepção e faz check-in (é o dono na apresentação); **instrutor ou cliente** recebem 403 na função e não veem o item no menu. Testes nas Tasks 4 e 5.

---

### Task 1: Banco — classes por parte, custo de compra, pagamentos e `fazer_check_in`

**Arquivos:**
- Criar: `supabase/migrations/20261126001900_operacao_recepcao.sql`
- Teste: `tests/integracao/check-in-banco.test.mjs`

**Interfaces:**
- Produz:
  - `classes_desconto`: colunas novas `percentual_pista`, `percentual_aluguel`, `percentual_municao` (`int not null`, `check between 0 and 90`), com `check (percentual_pista + percentual_aluguel + percentual_municao > 0)`; as linhas existentes recebem o `percentual` antigo nas três; a coluna `percentual` sai.
  - `tipos_municao.custo_compra_centavos int check (custo_compra_centavos > 0)` (nulo = sem custo).
  - `create type public.forma_pagamento_balcao as enum ('dinheiro', 'pix', 'cartao_debito', 'cartao_credito');`
  - Tabela `pagamentos`: `id bigint identity pk`, `agendamento_id uuid not null unique references agendamentos`, `valor_centavos int not null check (>= 0)`, `forma public.forma_pagamento_balcao not null`, `classe_id int references classes_desconto`, `documento text` (`check ((classe_id is null) = (documento is null))` e `char_length(btrim(documento)) between 1 and 60`), `conta jsonb` (a conta do desconto, seção 6.1), `desconto_centavos int not null default 0 check (>= 0)`, `registrado_por uuid not null`, `registrado_em timestamptz not null default now()`. RLS ligada; gatilho `registrar_historico`.
  - `public.fazer_check_in(p_agendamento uuid, p_pagamento jsonb, p_autor uuid) returns public.agendamentos` (security definer): define `app.usuario_id`, trava a linha (`for update`), confere a situação, grava o pagamento (quando `p_pagamento` não é nulo) e muda a situação para `check_in`, tudo numa transação. Erros com `errcode 'P0001'` e as mensagens: situação `check_in` ou `concluido` → `O check-in deste agendamento já foi feito.`; `cancelado` → `Este agendamento foi cancelado.`; `nao_compareceu` → `Este agendamento foi marcado como não compareceu.`; `aguardando_pagamento` sem `p_pagamento` → `Registre o pagamento para fazer o check-in.`; `pago` com `p_pagamento` → `Este agendamento já foi pago pelo app.`; agendamento inexistente → `errcode 'P0002'`, `Não encontramos este agendamento.`. (A regra "só a sessão de hoje" fica na Edge Function, que sabe o fuso.)
  - `salvar_promocao` (tipo `classe`) e `salvar_cadastro` (tipo `tipo_municao`) recriados com `create or replace`, aceitando os campos novos (`percentual_pista`, `percentual_aluguel`, `percentual_municao`; `custo_compra_centavos`) no lugar do `percentual` da classe. O resto das duas funções fica igual ao de `20261117001600_precos.sql`.

- [ ] **Passo 1: Testes que falham** (`check-in-banco.test.mjs`, com `rpc` e `criar` de `apoio.mjs`; o agendamento de hoje é criado com `rpc('criar_agendamento', ...)`, que não confere antecedência, e anotado com `anotarAgendamento`):
  - `check-in com pagamento grava o pagamento e muda a situação` → situação `check_in`; uma linha em `pagamentos` com `valor_centavos`, `forma` e `registrado_por` iguais aos enviados.
  - `check-in duas vezes: a segunda é recusada e nada é gravado em dobro` → segunda chamada com erro `O check-in deste agendamento já foi feito.`; 1 linha em `pagamentos`.
  - `aguardando pagamento sem pagamento é recusado` e `cancelado é recusado` → mensagens exatas acima; situação inalterada; 0 pagamentos.
  - `classe sem documento é recusada pelo banco` → `p_pagamento` com `classe_id` e sem `documento` falha e nada é gravado.
  - `classe com os três percentuais em 0 é recusada` → `criar('classes_desconto', {..., percentual_pista: 0, percentual_aluguel: 0, percentual_municao: 0})` falha.
  - `o histórico registra o pagamento com o autor` → linha em `historico_alteracoes` com `tabela = 'pagamentos'` e `feito_por = autor`.
- [ ] **Passo 2: Rodar e ver falhar.** `node --env-file=.env.teste --test --test-concurrency=1 tests/integracao/check-in-banco.test.mjs`. Esperado: FALHA (função e tabela não existem).
- [ ] **Passo 3: Escrever a migração** com o que está em "Produz" e o bloco "Bloqueio" no fim (acrescentando `grant execute on function public.fazer_check_in(uuid, jsonb, uuid) to service_role;`).
- [ ] **Passo 4: Aplicar no dev** (`db push`; esperado: aplica só `20261126001900`) e rodar o teste. Esperado: PASSA. Rodar também `precos-funcao` e `catalogo-funcao`: os testes que usam `percentual` da classe vão falhar — **é esperado** e é corrigido na Task 3; anotar quais.
- [ ] **Passo 5: Commit** (pedir autorização). Mensagem: `Cria a base do check-in: pagamentos, classes por parte e custo de compra`.

---

### Task 2: Regras puras do check-in e do desconto de classe

**Arquivos:**
- Modificar: `supabase/functions/_shared/precos.mjs` (`validarClasse` e função nova `descontoDeClasse`)
- Criar: `supabase/functions/_shared/operacao.mjs`
- Teste: `tests/unidade/precos.test.mjs` (acrescentar), `tests/unidade/operacao.test.mjs` (novo)

**Interfaces:**
- Produz, em `precos.mjs`:
  - `validarClasse(dados, { criando })`: campos `nome` (texto, obrigatório), `percentual_pista`, `percentual_aluguel`, `percentual_municao` (inteiro de 0 a 90, obrigatórios ao criar; mensagem `Informe um percentual entre 0 e 90.`), `ativo`. Ao criar, ou numa edição que mande os três, se os três forem 0: `campos.percentual_pista = 'Informe pelo menos um percentual maior que 0.'`.
  - `descontoDeClasse(preco, classe, custoMunicaoCentavos)` →
    `{ partes: [{ parte, descricao, antes_centavos, percentual, depois_centavos }], total_antes_centavos, total_com_classe_centavos, total_congelado_centavos, valor_cobrado_centavos, desconto_centavos, limitado_ao_custo, melhorou }`.
    `preco` = `{ itens, total_centavos }` como em `preco_detalhe`/`calcularPreco`. A parte vem da descrição do item: começa com `Pista` → `pista`; `Aluguel de armas` → `aluguel`; `Munição` → `municao`. `depois = Math.round(antes * (100 - percentual) / 100)`; na munição, com `custoMunicaoCentavos` não nulo, `depois = Math.min(antes, Math.max(depois, custoMunicaoCentavos))` e `limitado_ao_custo = true` quando o limite mudou o valor. `valor_cobrado = Math.min(total_congelado, total_com_classe)`; `desconto_centavos = total_congelado - valor_cobrado`; `melhorou = total_com_classe < total_congelado`.
- Produz, em `operacao.mjs`:
  - `FORMAS_PAGAMENTO = ['dinheiro', 'pix', 'cartao_debito', 'cartao_credito']` e `ROTULO_FORMA = { dinheiro: 'Dinheiro', pix: 'Pix', cartao_debito: 'Cartão de débito', cartao_credito: 'Cartão de crédito' }`.
  - `motivoSemCheckIn({ situacao, inicio }, { hoje, fuso })` → `null` ou a mensagem: as da Task 1 para a situação, e `O check-in só pode ser feito no dia da sessão.` quando `dataNoFuso(new Date(inicio), fuso) !== hoje`.
  - `validarCheckIn(dados, { situacao, temPreco })` → `{ campos, valores }`. Com situação `pago`: aceita só `{}` (`valores = { pagamento: null }`). Com `aguardando_pagamento`: `forma_pagamento` em `FORMAS_PAGAMENTO` (`Escolha a forma de pagamento.`); `classe_id` inteiro opcional; `documento` obrigatório quando há classe (`Informe o número do documento conferido.`; até 60 caracteres: `Use no máximo 60 caracteres.`); sem preço guardado (`temPreco = false`): `classe_id` não é aceito (`Este agendamento não tem preço guardado: o desconto de classe não está disponível.`) e `valor_centavos` (inteiro ≥ 0) é obrigatório (`Informe o valor cobrado.`); com preço: `valor_esperado_centavos` (inteiro ≥ 0) é obrigatório.

- [ ] **Passo 1: Testes que falham.** Em `precos.test.mjs`, com `preco = { itens: [{ descricao: 'Pista (1 pista × 1 hora)', total_centavos: 10000 }, { descricao: 'Aluguel de armas', total_centavos: 3000 }, { descricao: 'Munição', total_centavos: 12500 }], total_centavos: 25500 }` e `classe = { percentual_pista: 20, percentual_aluguel: 10, percentual_municao: 15 }`:
  - `desconto de classe por parte, sem custo` → depois 8000, 2700, 10625; `total_com_classe_centavos` 21325; `valor_cobrado_centavos` 21325; `desconto_centavos` 4175; `limitado_ao_custo` false; `melhorou` true.
  - `munição limitada ao custo de compra` → com custo 11000: munição depois 11000; total 21700; `limitado_ao_custo` true.
  - `custo acima do preço da munição não aumenta o preço` → custo 13000: munição depois 12500.
  - `vale o melhor para o cliente quando há pacote ou campanha` → mesmo `preco` com `total_centavos: 20000`: `valor_cobrado_centavos` 20000; `desconto_centavos` 0; `melhorou` false.
  - `preço sem aluguel nem munição` → só o item de pista: 1 parte.
  - `validarClasse` → aceita `{ nome: 'Policial', percentual_pista: 20, percentual_aluguel: 0, percentual_municao: 0 }`; recusa os três em 0 com a mensagem de `percentual_pista`; recusa 91.
  Em `operacao.test.mjs`:
  - `motivoSemCheckIn` → cada situação com a mensagem exata; `inicio` às 23h30 de hoje no fuso `America/Sao_Paulo` é de hoje (`null`); às 00h30 de amanhã no fuso, não é.
  - `validarCheckIn` → os casos e mensagens de "Produz".
- [ ] **Passo 2: Rodar e ver falhar.** `npm test`. Esperado: FALHA nos testes novos.
- [ ] **Passo 3: Implementar** o que está em "Produz". Trocar em `precos.mjs` o tipo `percentualDesconto` da classe por um tipo novo de 0 a 90 (o das campanhas não muda).
- [ ] **Passo 4: Rodar.** `npm test`. Esperado: PASSA (os testes antigos de `validarClasse` com `percentual` são atualizados para os três campos).
- [ ] **Passo 5: Commit** (pedir autorização). Mensagem: `Cria as regras do check-in e do desconto de classe por parte`.

---

### Task 3: Classes por parte em Promoções e custo de compra em Preços

**Arquivos:**
- Modificar: `supabase/functions/precos/index.js`, `supabase/functions/_shared/catalogo.mjs` (`tipo_municao.custo_compra_centavos: { tipo: 'centavos', editavel: true }`), `admin-regras.mjs` (`classeDoFormulario`, `formularioDaClasse`), `admin.js` (definição `classe` da aba Promoções; `PRECOS_CATALOGO`/lista de munições da aba Preços), `admin.html` (campos do formulário de classe)
- Teste: `tests/integracao/precos-funcao.test.mjs`, `tests/integracao/catalogo-funcao.test.mjs`, `tests/unidade/admin-regras.test.mjs`

**Interfaces:**
- Consome: Task 1 (colunas) e Task 2 (`validarClasse`).
- Produz: `GET precos` devolve as classes com `percentual_pista`, `percentual_aluguel`, `percentual_municao`; `POST/PUT precos` (tipo `classe`) aceita esses campos. `PUT catalogo` (tipo `tipo_municao`) aceita `custo_compra_centavos` (inteiro > 0 ou `null` para tirar). A coluna "Desconto" da lista de classes mostra `Pista 20% · Aluguel 10% · Munição 15%` (partes em 0 ficam de fora). Na aba Preços, cada munição mostra "Preço por unidade" e **"Custo de compra"** (opcional, em reais, salvo pelo mesmo botão).

- [ ] **Passo 1: Testes que falham.** Integração: `cria classe com os três percentuais` (201, valores devolvidos); `classe com os três em 0 é recusada` (400, `campos.percentual_pista`); os testes antigos de classe passam a mandar os três campos. `salva e tira o custo de compra da munição` (PUT com 1500 → 200 e valor gravado; PUT com `null` → 200 e nulo; restaurar no fim). Unidade: `classeDoFormulario`/`formularioDaClasse` com os três campos.
- [ ] **Passo 2: Rodar e ver falhar.** `npm test` e `node --env-file=.env.teste --test --test-concurrency=1 tests/integracao/precos-funcao.test.mjs tests/integracao/catalogo-funcao.test.mjs`.
- [ ] **Passo 3: Implementar** a função `precos`, o catálogo e a tela (formulário de classe com três campos "Desconto na pista (%)", "Desconto no aluguel de armas (%)", "Desconto na munição (%)" e a ajuda "A munição nunca fica abaixo do custo de compra cadastrado em Preços."; campo "Custo de compra" na lista de munições da aba Preços).
- [ ] **Passo 4: Publicar** `precos` e `catalogo` e rodar as suítes do Passo 2. Esperado: PASSA.
- [ ] **Passo 5: Teste de tela curto** (`p8a-tarefa3.mjs`): criar uma classe com os três percentuais pela tela e ver a coluna "Desconto"; salvar e tirar o custo de compra de uma munição de teste pela aba Preços. Limpeza.
- [ ] **Passo 6: Commit** (pedir autorização). Mensagem: `Classes de desconto por parte e custo de compra da munição`.

---

### Task 4: Edge Function `operacao` (Recepção)

**Arquivos:**
- Criar: `supabase/functions/operacao/index.js`
- Teste: `tests/integracao/operacao-funcao.test.mjs`

**Interfaces:**
- Consome: Task 1 (`fazer_check_in`, `pagamentos`), Task 2 (`descontoDeClasse`, `motivoSemCheckIn`, `validarCheckIn`).
- Produz:
  - `GET operacao?area=recepcao` (atendente) → `200 { hoje, agendamentos: [{ id, inicio, horas, situacao, responsavel: { nome, telefone }, pessoas, pistas: [numero], instrutores: [nome], valor_centavos, pago_no_balcao_centavos }] }`, só as sessões de hoje no fuso do estande, sem `cancelado`, em ordem de `inicio`. `valor_centavos` = `preco_total_centavos` (ou `null`); `pago_no_balcao_centavos` = o pagamento gravado (ou `null`).
  - `GET operacao?id=<uuid>` (atendente) → `200 { agendamento: { id, inicio, horas, situacao, forma_pagamento, preco_detalhe, preco_total_centavos, participantes: [{ nome_completo, cpf, data_nascimento, modalidade, modelo, tipo_municao, municao_qtd }], pagamento }, classes: [{ id, nome, percentual_pista, percentual_aluguel, percentual_municao }], custo_municao_centavos, pode_fazer_check_in, motivo }`. `classes` = só as ativas. `custo_municao_centavos` = Σ `municao_qtd × custo_compra_centavos` dos itens de munição cujo tipo tem custo (tipo sem custo não entra no limite, spec 6.1); `null` se nenhum tipo usado tiver custo. Registra o acesso (`registrar_acesso`, recurso `operacao.ficha`). 404 `Não encontramos este agendamento.`.
  - `POST operacao` com `{ acao: 'check_in', id, forma_pagamento, classe_id, documento, valor_esperado_centavos | valor_centavos }` (atendente) → `200 { agendamento: { id, situacao } }`. O servidor refaz a conta com `descontoDeClasse`; se `valor_esperado_centavos` for diferente do `valor_cobrado_centavos` → `409 { erro: 'O valor mudou. Confira a ficha de novo.' }`; classe inexistente ou desativada → `409 { erro: 'Esta classe de desconto não está mais disponível. Escolha outra.' }`; `motivoSemCheckIn` → `409 { erro: motivo }`; campos → `400 { erro: 'Revise os campos destacados.', campos }`. Grava `conta` (o resultado de `descontoDeClasse`) e `desconto_centavos` no pagamento.
  - Papel conferido antes de qualquer consulta (`exigirPapel(contexto, 'atendente')`; superadmin passa). Outros métodos: 405.

- [ ] **Passo 1: Testes que falham** (agendamentos de hoje criados por `rpc('criar_agendamento', ...)` com o instrutor de teste do arquivo; classes de teste criadas e apagadas pelo arquivo):
  - `sem login 401`; `instrutor e cliente recebem 403`; `superadmin passa`.
  - `a lista da recepção traz só as sessões de hoje, sem canceladas, em ordem` (uma de hoje, uma de amanhã, uma cancelada de hoje).
  - `a ficha traz CPFs, classes ativas e registra o acesso` (linha em `acessos_dados` com recurso `operacao.ficha`; apagar com `apagarAcessosDe`).
  - `check-in sem classe` → 200; pagamento com `valor_centavos = preco_total_centavos`, `desconto_centavos = 0`.
  - `check-in com classe aplica a conta por parte` → `valor_cobrado` igual ao de `descontoDeClasse` com o custo gravado; `conta` gravada.
  - `valor esperado diferente é recusado com 409` e nada é gravado.
  - `classe desativada é recusada com 409`.
  - `sessão de amanhã é recusada com 409` (`O check-in só pode ser feito no dia da sessão.`).
  - `agendamento sem preço guardado aceita valor digitado e recusa classe` (preço tirado com `rest` PATCH no agendamento de teste).
- [ ] **Passo 2: Rodar e ver falhar.** `node --env-file=.env.teste --test --test-concurrency=1 tests/integracao/operacao-funcao.test.mjs`.
- [ ] **Passo 3: Implementar** no estilo de `painel-agendamentos/index.js` (`tratar`, `obterContexto`, `exigirPapel`, `admin`, `fusoDoEstande`).
- [ ] **Passo 4: Publicar** `operacao` e rodar o teste. Esperado: PASSA.
- [ ] **Passo 5: Commit** (pedir autorização). Mensagem: `Cria a função da operação com a lista do dia e o check-in`.

---

### Task 5: Menu, `estande.html` e a tela da Recepção

**Arquivos:**
- Criar: `estande-regras.mjs`, `estande.html`, `estande.css`, `estande.js`
- Modificar: `menu-regras.mjs` (itens do estande no grupo Operação), `admin-regras.mjs` só se precisar de nada; `.vercelignore` só se os arquivos novos da raiz não forem publicados
- Teste: `tests/unidade/estande-regras.test.mjs`, `tests/unidade/menu-regras.test.mjs`

**Interfaces:**
- Consome: Task 4 (rotas), Task 2 (`descontoDeClasse`, `ROTULO_FORMA`, `FORMAS_PAGAMENTO`), plano 7 (`montarMoldura`, `parteDoEndereco`, `saudacao`).
- Produz:
  - `estande-regras.mjs`: `AREAS_ESTANDE = [{ id: 'recepcao', texto: 'Recepção', papeis: ['atendente'] }]` (as áreas `almoxarifado` e `pista` entram no plano 8B); `areasVisiveis(papeis)` → ids na ordem; `ROTULO_SITUACAO` (`aguardando_pagamento: 'Aguardando check-in'`, `pago: 'Pago pelo app'`, `check_in: 'Check-in feito'`, `concluido: 'Concluído'`, `nao_compareceu: 'Não compareceu'`).
  - `menuDe(papeis)`: no grupo **Operação**, antes de "Agendamentos", um item por área visível: `{ id: 'estande-<area>', texto, href: 'estande.html#<area>' }`. O grupo Operação aparece se houver qualquer área do estande ou "Agendamentos".
  - `estande.html#recepcao`: lista do dia (seção 6.1 da spec: horário, responsável e telefone, pessoas, pista(s), instrutor(es), valor, situação; botão **"Fazer check-in"** quando `aguardando_pagamento` ou `pago`; botão **"Atualizar"**); ficha de check-in (participantes com nome, CPF formatado e nascimento; o que cada um usa; valor; lista "Desconto de classe" com "Sem desconto" e as classes; campo "Documento conferido" quando há classe; a **tabela da conta** da spec 6.1, calculada no navegador com `descontoDeClasse` só para mostrar; os avisos `Desconto da munição limitado ao custo de compra.` e `O preço do agendamento já é menor que com este desconto.`; "Forma de pagamento" com as 4 formas; **"Confirmar check-in"** e **"Voltar"**). Sem preço guardado: a ficha diz `Este agendamento não tem preço guardado. Informe o valor cobrado.` e mostra o campo "Valor cobrado (R$)". `pago`: a ficha diz `Pago pelo app.` e só mostra "Confirmar check-in". Depois do check-in: aviso `Check-in feito.` e a lista recarregada. Erro 409: aviso com a mensagem do servidor e a ficha recarregada.
  - Sem `#`, `estande.html` abre a primeira área permitida (`parteDoEndereco`); sem nenhuma área permitida, uma tela "Você não tem acesso a esta área." com o menu (como `admin.html`).

- [ ] **Passo 1: Testes que falham** (unidade): `areasVisiveis` (atendente → `['recepcao']`; superadmin → `['recepcao']`; instrutor → `[]`); `menuDe(['atendente'])` tem o grupo Operação só com Recepção (`estande.html#recepcao`); `menuDe(['superadmin'])` tem Operação com Recepção e depois Agendamentos; `menuDe(['administrativo'])` continua só com Agendamentos.
- [ ] **Passo 2: Rodar e ver falhar.** `npm test`.
- [ ] **Passo 3: Implementar** as regras, o menu e a página (no estilo de `admin.html`/`admin.js`: telas carregando, erro com "Tentar de novo" e "Sair", sem acesso, área).
- [ ] **Passo 4: Rodar.** `npm test`. Esperado: PASSA.
- [ ] **Passo 5: Teste de tela** (`p8a-tarefa5.mjs`, servidor local, 1280px e 390px; agendamentos de hoje criados por `rpc('criar_agendamento', ...)` com o instrutor de teste; superadmin de teste e atendente de teste): menu com Recepção; lista do dia; check-in sem classe (Dinheiro); check-in com classe de teste e documento, conferindo a tabela da conta e o valor a cobrar; aviso de limite de custo; agendamento `pago`; sem `#` abre Recepção; atendente não vê Cadastros; instrutor de teste vê "Você não tem acesso a esta área."; nenhum erro no console; a página não rola para o lado. Limpeza e contagem igual antes e depois.
- [ ] **Passo 6: Commit** (pedir autorização). Mensagem: `Cria a página do estande com a Recepção e o check-in`.

---

### Task 6: Conferência no site publicado

**Arquivos:** nenhum no repositório (roteiro fora dele).

- [ ] **Passo 1: Envio ao GitHub** (pedir autorização explícita: `git push origin nova-arquitetura`). A Vercel republica sozinha.
- [ ] **Passo 2: Conferir** que `estande.html`, `estande.js`, `estande-regras.mjs` e `supabase/functions/_shared/operacao.mjs` publicados são iguais aos locais.
- [ ] **Passo 3: Roteiro no site publicado** (`p8a-final.mjs`, `https://rangepass.vercel.app`, 1280px e 390px): superadmin de teste faz check-in com classe e sem classe; nenhum erro no console; limpeza (0 usuários `@rangepass.test`, contagem igual). Fotos mostradas ao dono.
- [ ] **Passo 4:** se algo falhar só no site publicado, corrigir, pedir autorização de commit e de envio, e repetir o Passo 3.
