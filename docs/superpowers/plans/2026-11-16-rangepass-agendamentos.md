# RangePass, plano 3 de N: agendar de verdade e "Meus agendamentos" (etapa 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o cliente logado agenda uma sessão (sozinho ou em grupo) com dados vindos do banco, sem o Make e sem listas fixas no código, e vê, altera o horário e cancela os próprios agendamentos.

**Architecture:**
- **Regras puras** (horários no fuso do estande, validação do pedido, prazo de alteração, tradução dos erros de reserva) num módulo `.mjs` usado pelo Node, pelo Deno e pelo navegador.
- **Banco:** três funções `security definer` fazem cada operação numa transação só: `criar_agendamento` (escolhe pistas, instrutores e armas livres), `alterar_horario_agendamento` (mantém o recurso se ele continua livre, senão troca) e `cancelar_agendamento`. As restrições de exclusão do plano 1 continuam sendo a última barreira contra conflito.
- **Edge Function `agendamentos`:** a única porta para o navegador. Confere o dono, a situação e o prazo.
- **Front:** o `index.html` passa a exigir login, perde o Make e o `regras.js`, e ganha a lista "Meus agendamentos". A escolha do dia continua simples (campo de data e listas); a agenda visual com cores de disponibilidade é a etapa 6.

**Tech Stack:** o mesmo do plano 2 (Supabase, CLI `2.20.12` via `npx`, Node com `node:test`, `npm:@supabase/supabase-js@2.45.4` nas funções, `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm` no navegador, `npx --yes http-server@14.1.1` para abrir as páginas).

**Spec:** `docs/superpowers/specs/2026-11-11-rangepass-supabase-design.md`. Seções usadas: 3, 6.1 (só as regras de horário, sem o visual), 6.2, 6.4 a 6.9, 8 (pagamento no balcão), 12, 13, 15 e 18.

**Planos seguintes:** 4 = admin (etapa 5, inclui preços); 5 = agenda visual e deploy (etapas 6 e 7).

## Global Constraints

Valem todas as dos planos 1 e 2, em especial: **PowerShell 5.1** nos comandos do dono; **português do Brasil**, com mensagens que dizem o que aconteceu e o que fazer; **perguntar antes de cada commit**, nunca fazer push nem merge; **parar no fim de cada tarefa** e dizer como testar; **testes limpam tudo o que criam** e restauram o que alteram.

Novas neste plano:
- **Fuso:** toda data e hora do pedido (`data` `AAAA-MM-DD` + `hora` inteira) é do fuso `configuracoes.estande.fuso`. O banco guarda o instante (`timestamptz`). O front mostra as datas nesse fuso, nunca no do aparelho.
- **Horas cheias:** o início é sempre hora cheia, de `abre` (arredondado para cima) até a última hora que ainda cabe antes de `fecha`.
- **Valores vindos das Configurações:** antecedência mínima e máxima, prazo de alteração, durações máximas (3 sozinho, 6 em grupo), grupo máximo (15), faixas de instrutores (1-5 → 1, 6-10 → 2, 11-15 → 3), munição mínima (50), idade mínima (18) e o termo de responsabilidade. Nada disso fica escrito no código.
- **Grupo** = mais de 1 participante. O participante 1 é sempre o responsável logado, com os dados do perfil. Os demais informam nome completo, CPF e data de nascimento.
- **Uma pista por instrutor.** A sessão inteira fica nas mesmas pistas, instrutores e armas.
- **Modalidades:** `estande` exige `modelo_id`, `tipo_municao_id` do calibre do modelo e `municao_qtd` ≥ mínimo. `arma_propria` exige `arma_propria` + `tipo_municao_id` + `municao_qtd` ≥ mínimo + aceite do termo. `tudo_proprio` exige `arma_propria` + aceite do termo, sem munição. `arma_propria` = `{modelo, calibre, numero_registro, responsavel}`, os quatro textos não vazios.
- **Pagamento:** `forma_pagamento` é sempre `'balcao'` até a etapa 11, mesmo que o pedido diga outra coisa.
- **O cliente nunca vê:** o nº de registro das armas do estande, os ids das unidades, o nº de registro da arma própria (depois de enviado) nem dados de outros clientes.
- **Situações que o cliente pode alterar ou cancelar:** `aguardando_pagamento` e `pago`, e só até `prazo_alteracao_horas` antes do início.
- **Códigos de erro do banco** (5 caracteres, para a função reconhecer): `RP001` instrutor escolhido ocupado, `RP002` sem instrutores livres, `RP003` sem pistas livres, `RP004` sem unidade livre do modelo.

## Review Focus

1. **Aparelho em outro fuso:** um cliente com o celular no horário de Nova York que escolhe 20/11 às 10h agenda 10h de São Paulo (13:00 UTC), e a lista mostra "10:00". Testes de `instanteNoFuso` (Task 1) e `descreverSessao` com fuso (Task 6).
2. **Dois clientes no último horário livre ao mesmo tempo:** o segundo recebe 409 "Esse horário acabou de ser ocupado", nunca 500. A corrida não pode ser forçada num teste; o teste de `erroDeReserva('23P01')` (Task 1) fixa a tradução, e o revisor confere que a função passa todo erro da RPC por ela.
3. **Alterar para um horário em que só a pista está interditada:** a pista é trocada e o instrutor e as armas continuam os mesmos. Teste em `agendar-banco.test.mjs` (Task 3).
4. **Participante com o mesmo CPF do responsável:** 400 em `participantes.1.cpf`. Teste de `validarPedido` (Task 1).
5. **Mexer no agendamento de outra pessoa, ou procurar nº de registro na resposta:** PUT com o id de outro cliente dá 404, igual a um id que não existe; nenhuma resposta da função contém `numero_registro`. Testes em `agendamentos-funcao.test.mjs` (Task 4).

---

## Estrutura de arquivos

```
supabase/functions/_shared/agendamento.mjs      puro: fuso, horários do dia, validação do pedido, prazo, erros de reserva
supabase/functions/_shared/configuracoes.mjs    (alterar) chave termo
supabase/migrations/20261116000800_agendar.sql   termo, colunas novas, funções de livre, criar_agendamento
supabase/migrations/20261116000900_alterar_cancelar.sql   alterar_horario_agendamento, cancelar_agendamento
supabase/functions/agendamentos/index.js        GET opções, GET lista, POST cria, PUT altera/cancela
supabase/config.toml                            (alterar) [functions.agendamentos]
supabase/scripts/dados-de-exemplo.sql            só desenvolvimento: catálogo sugerido, 4 pistas, unidades, instrutores
api.mjs                                         navegador: cliente Supabase e chamarFuncao (usado por conta.js e agendar.js)
agendar-regras.mjs                              puro do front: textos da sessão, situações, cascata, próximos/anteriores
agendar.js                                      telas do index.html: lista, novo agendamento, alterar, cancelar
index.html                                      (reescrever) exige login; sem Make; sem regras.js
agendar.css                                     visual do index.html (cores atuais, tirado do <style>)
conta.js, conta.html                            (alterar) usar api.mjs; link "Meus agendamentos"; voltar=index.html
regras.js, tests/regras.test.js                 (apagar)
package.json                                    (alterar) script test sem tests/regras.test.js
tests/unidade/agendamento.test.mjs
tests/unidade/agendar-regras.test.mjs
tests/unidade/configuracoes.test.mjs            (alterar)
tests/integracao/apoio.mjs                      (alterar) anotarAgendamento, apagarTudoCriado, diaAbertoDeTeste
tests/integracao/agendar-banco.test.mjs
tests/integracao/agendamentos-funcao.test.mjs
README.md                                       (alterar) dados de exemplo; como testar o agendamento
```

---

### Task 1: Regras puras do agendamento

**Files:**
- Create: `supabase/functions/_shared/agendamento.mjs`, `tests/unidade/agendamento.test.mjs`

**Interfaces:**
- Consumes: `cpfValido`, `somenteDigitos`, `idadeEm`, `dataNoFuso` de `_shared/cadastro.mjs`.
- Produces (todas exportadas de `_shared/agendamento.mjs`):
  - `instanteNoFuso(data: 'AAAA-MM-DD', hora: number, fuso: string) -> Date`: o instante em que o relógio do fuso marca aquela data e hora. Algoritmo: palpite = `Date.UTC(a, m-1, d, hora)`; duas vezes, `palpite = Date.UTC(a, m-1, d, hora) - deslocamento(palpite)`, onde `deslocamento(ms)` = as partes de `Intl.DateTimeFormat('en-US', { timeZone: fuso, hourCycle: 'h23', year, month, day, hour, minute, second: 'numeric' })` montadas com `Date.UTC` menos `ms`.
  - `partesNoFuso(instante: Date, fuso: string) -> { data: 'AAAA-MM-DD', hora: number, minuto: number, diaSemana: 0-6 }`.
  - `horariosDoDia(data: string, funcionamento: object) -> number[]`: horas de início possíveis. `[]` se a data está em `datas_fechadas` ou `dias[diaDaSemana]` é `null`. O dia da semana vem de `new Date(data + 'T12:00:00Z').getUTCDay()`.
  - `duracoesPossiveis(data: string, hora: number, funcionamento: object, maximo: number) -> number[]`: `[1..k]`, com `k` ≤ `maximo` e `hora + k` ≤ o horário de fechamento (em horas, `"22:30"` = 22,5).
  - `instrutoresNecessarios(quantidade: number, faixas: {ate, instrutores}[]) -> number`: o `instrutores` da primeira faixa com `quantidade <= ate`.
  - `validarPedido(pedido: object, { agora: Date, opcoes: object }) -> { campos: Record<string,string>, pedido: PedidoNormalizado }`. `opcoes` tem o formato do `GET agendamentos?ver=opcoes` (Task 4). Entrada: `{ data, hora, horas, instrutor_id: uuid|null, participantes: [ {modalidade, modelo_id?, tipo_municao_id?, municao_qtd?, arma_propria?, aceite_termo_versao?}, {nome_completo, cpf, data_nascimento, ...os mesmos} ] }`. Do participante 1 só valem os campos da modalidade; nome, CPF e nascimento vêm de `opcoes.responsavel`.
  - `PedidoNormalizado` = `{ inicio: string ISO, horas, instrutor_id, instrutores_necessarios, participantes: [{ nome_completo, cpf, data_nascimento, perfil_id: uuid|null, modalidade, termo_versao: number|null, modelo_id, tipo_municao_id, municao_qtd, arma_propria }] }`. Campos que a modalidade não usa vão como `null`; `perfil_id` só no participante 1 (`opcoes.responsavel.id`); CPF só com dígitos; nome com `trim` e espaços repetidos reduzidos; textos da `arma_propria` com `trim`.
  - `validarNovoHorario({ data, hora, horas }, { agora, opcoes, quantidade: number }) -> { campos, inicio: string ISO, horas }`: as mesmas regras de `data`, `hora` e `horas` de `validarPedido`.
  - `podeAlterar({ inicio: string, situacao: string }, agora: Date, prazoHoras: number) -> boolean`.
  - `erroDeReserva(codigo: string) -> { status: 409, corpo: { erro } } | null`.

Mensagens exatas (chave em `campos` → texto). `i` é a posição no array, começando em 0:

| Campo | Quando | Mensagem |
|---|---|---|
| `data` | não é data real | `Escolha o dia.` |
| `data` | `horariosDoDia` vazio | `O estande não abre neste dia. Escolha outro.` |
| `data` | depois de hoje (no fuso) + `antecedencia_maxima_dias` | `` `Agende com até ${n} dias de antecedência.` `` |
| `hora` | não está em `horariosDoDia` | `Escolha o horário de início.` |
| `hora` | início − agora < `antecedencia_minima_horas` | `` `Agende com pelo menos ${n} horas de antecedência.` `` |
| `horas` | não é inteiro ≥ 1 | `Escolha a duração.` |
| `horas` | sozinho e > `duracao_maxima_individual` | `` `Quem vai sozinho pode agendar no máximo ${n} horas.` `` |
| `horas` | grupo e > `duracao_maxima_grupo` | `` `Grupos podem agendar no máximo ${n} horas.` `` |
| `horas` | passa do fechamento | `` `A sessão precisa terminar até as ${fecha}.` `` (`fecha` como está nas Configurações, ex. `23:00`) |
| `instrutor_id` | não é `null` nem um id de `opcoes.instrutores` | `Escolha um instrutor da lista ou "Sem preferência".` |
| `participantes` | não é array ou está vazio | `Informe quem vai atirar.` |
| `participantes` | mais que `grupo_maximo` | `` `O grupo pode ter no máximo ${n} pessoas.` `` |
| `participantes.i.nome_completo` (i ≥ 1) | menos de duas palavras | `Informe o nome completo.` |
| `participantes.i.cpf` (i ≥ 1) | inválido | `Informe um CPF válido.` |
| `participantes.i.cpf` (i ≥ 1) | igual ao de outro participante, inclusive o responsável | `Este CPF já está em outro participante.` |
| `participantes.i.data_nascimento` (i ≥ 1) | não é data real ou é depois de hoje | `Informe a data de nascimento.` |
| `participantes.i.data_nascimento` (i ≥ 1) | idade < `idade_minima` | `` `Cada participante precisa ter pelo menos ${n} anos.` `` |
| `participantes.i.modalidade` | não é uma das três | `Escolha a modalidade.` |
| `participantes.i.modelo_id` | `estande` e não está em `catalogo.modelos` | `Escolha uma arma da lista.` |
| `participantes.i.tipo_municao_id` | precisa e não está em `catalogo.tipos_municao` (ou, em `estande`, é de outro calibre) | `Escolha a munição da lista.` |
| `participantes.i.municao_qtd` | precisa e não é inteiro ≥ mínimo | `` `A quantidade mínima de munição é ${n}.` `` |
| `participantes.i.arma_propria` | precisa e falta algum dos quatro textos | `Informe o modelo, o calibre, o número de registro e o responsável pela arma.` |
| `participantes.i.aceite_termo_versao` | precisa e é diferente de `termo.versao` | `Para usar arma própria, aceite o termo de responsabilidade.` |

`erroDeReserva`:

| Código | `corpo.erro` |
|---|---|
| `RP001` | `O instrutor escolhido já tem outro agendamento nesse horário. Escolha outro horário.` |
| `RP002` | `Não há instrutores livres nesse horário. Escolha outro horário.` |
| `RP003` | `Não há pistas livres nesse horário. Escolha outro horário.` |
| `RP004` | `Não há arma livre do modelo escolhido nesse horário. Escolha outro horário ou outro modelo.` |
| `23P01`, `P0001` | `Esse horário acabou de ser ocupado. Escolha outro horário.` |
| outro | (devolve `null`) |

- [ ] **Step 1: Escrever os testes em `tests/unidade/agendamento.test.mjs`**

  Base dos testes (as Configurações iniciais do banco, com o horário de domingo fechado para testar dia fechado):
  ```js
  const OPCOES = {
      estande: { nome: 'RangePass', fuso: 'America/Sao_Paulo' },
      agenda: { antecedencia_minima_horas: 24, antecedencia_maxima_dias: 15, prazo_alteracao_horas: 24,
          duracao_maxima_individual: 3, duracao_maxima_grupo: 6, grupo_maximo: 15,
          faixas_instrutores: [{ ate: 5, instrutores: 1 }, { ate: 10, instrutores: 2 }, { ate: 15, instrutores: 3 }] },
      funcionamento: { dias: { 0: null, 1: { abre: '08:00', fecha: '23:00' }, 2: { abre: '08:00', fecha: '23:00' },
          3: { abre: '08:00', fecha: '23:00' }, 4: { abre: '08:00', fecha: '23:00' }, 5: { abre: '08:00', fecha: '23:00' },
          6: { abre: '08:30', fecha: '22:30' } }, datas_fechadas: ['2026-11-20'] },
      municao: { minima_por_participante: 50 }, idade_minima: 18, termo: { versao: 1, texto: 'x' },
      catalogo: { modelos: [{ id: 1, calibre_id: 10 }], tipos_municao: [{ id: 5, calibre_id: 10 }, { id: 6, calibre_id: 11 }] },
      instrutores: [{ id: 'i-1', nome: 'Ana Instrutora' }],
      responsavel: { id: 'r-1', nome_completo: 'Rui Responsável', cpf: '52998224725', data_nascimento: '1990-01-01' },
  };
  const AGORA = new Date('2026-11-16T12:00:00Z'); // 09:00 em São Paulo, segunda
  const ESTANDE = { modalidade: 'estande', modelo_id: 1, tipo_municao_id: 5, municao_qtd: 50 };
  const PEDIDO = { data: '2026-11-18', hora: 10, horas: 2, instrutor_id: null, participantes: [ESTANDE] };
  ```
  Testes:
  - `instanteNoFuso`:
    - `('2026-11-18', 10, 'America/Sao_Paulo').toISOString() === '2026-11-18T13:00:00.000Z'`;
    - `('2026-07-01', 10, 'America/New_York')` dá `14:00Z` e `('2026-12-01', 10, 'America/New_York')` dá `15:00Z` (horário de verão).
  - `partesNoFuso(new Date('2026-11-18T13:00:00Z'), 'America/Sao_Paulo')` dá `{ data: '2026-11-18', hora: 10, minuto: 0, diaSemana: 3 }`.
  - `horariosDoDia`:
    - `'2026-11-18'` dá `[8, 9, ..., 22]` (15 horas);
    - `'2026-11-21'` (sábado, 08:30–22:30) dá `[9, ..., 21]`;
    - `'2026-11-22'` (domingo, `null`) e `'2026-11-20'` (data fechada) dão `[]`.
  - `duracoesPossiveis('2026-11-18', 21, funcionamento, 3)` dá `[1, 2]`; `('2026-11-18', 10, funcionamento, 3)` dá `[1, 2, 3]`.
  - `instrutoresNecessarios`: 1 → 1, 5 → 1, 6 → 2, 10 → 2, 11 → 3, 15 → 3.
  - `validarPedido(PEDIDO, { agora: AGORA, opcoes: OPCOES })`:
    - `campos` igual a `{}`;
    - `pedido.inicio === '2026-11-18T13:00:00.000Z'`, `pedido.instrutores_necessarios === 1`;
    - `pedido.participantes[0]` igual a `{ nome_completo: 'Rui Responsável', cpf: '52998224725', data_nascimento: '1990-01-01', perfil_id: 'r-1', modalidade: 'estande', termo_versao: null, modelo_id: 1, tipo_municao_id: 5, municao_qtd: 50, arma_propria: null }`.
  - Um teste por linha da tabela de mensagens, trocando um campo de `PEDIDO` e conferindo `campos[campo]` com o texto exato. Valores que disparam cada linha:
    - `data: '2026-02-30'`; `data: '2026-11-22'`; `data: '2026-12-02'` (hoje + 16 dias);
    - `hora: 7`; `data: '2026-11-17', hora: 8` (23 horas de antecedência);
    - `horas: 0`; `horas: 4` sozinho; `horas: 7` com 2 participantes; `hora: 21, horas: 3` (`campos.horas === 'A sessão precisa terminar até as 23:00.'`);
    - `instrutor_id: 'outro'`; `participantes: []`; 16 participantes;
    - participante 2 com `nome_completo: 'Ana'`; com `cpf: '123'`; com o CPF do responsável (`'529.982.247-25'`); com `data_nascimento: '2030-01-01'`; com nascimento em `'2008-11-17'` (17 anos);
    - `modalidade: 'x'`; `modelo_id: 99`; `tipo_municao_id: 6` em `estande` (outro calibre); `municao_qtd: 49`;
    - `arma_propria` sem `numero_registro`; `arma_propria` completo sem `aceite_termo_versao`.
  - `arma_propria` válido (`{ modalidade: 'arma_propria', arma_propria: { modelo: ' Taurus TH9 ', calibre: '9mm', numero_registro: 'X1', responsavel: 'Rui' }, tipo_municao_id: 6, municao_qtd: 50, aceite_termo_versao: 1 }`) passa, com `modelo_id: null`, `termo_versao: 1` e `arma_propria.modelo === 'Taurus TH9'`.
  - `tudo_proprio` com `arma_propria` e aceite passa, com `tipo_municao_id` e `municao_qtd` `null`, mesmo que o pedido os envie.
  - Grupo de 6 dá `instrutores_necessarios === 2`, e o participante 2 vai com `perfil_id: null`.
  - `validarNovoHorario({ data: '2026-11-18', hora: 10, horas: 4 }, { agora: AGORA, opcoes: OPCOES, quantidade: 2 })` passa (grupo); com `quantidade: 1` dá a mensagem de quem vai sozinho.
  - `podeAlterar`:
    - `{ inicio: '2026-11-17T12:00:00Z', situacao: 'pago' }`, agora `AGORA`, prazo 24 → `true` (exatamente 24h);
    - um minuto depois → `false`;
    - `situacao: 'cancelado'` ou `'check_in'` → `false`.
  - `erroDeReserva`: uma asserção por linha da tabela, inclusive `erroDeReserva('42501') === null`.

- [ ] **Step 2: Rodar e ver falhar**

  Run: `npm test`
  Expected: FAIL, porque o módulo ainda não existe.

- [ ] **Step 3: Implementar `supabase/functions/_shared/agendamento.mjs`**

  Puro, como `cadastro.mjs`. Ordem das checagens de `data`/`hora`/`horas`: só a primeira mensagem de cada campo vale. A antecedência máxima compara a `data` com `dataNoFuso(agora, fuso)` + n dias.

- [ ] **Step 4: Rodar e ver passar**

  Run: `npm test`
  Expected: todos passam.

- [ ] **Step 5: Commit (perguntar antes)**
  ```
  git add supabase/functions/_shared/agendamento.mjs tests/unidade/agendamento.test.mjs
  git commit -m "Cria as regras do agendamento: horários no fuso do estande, grupos e modalidades"
  ```

---

### Task 2: Banco: termo de responsabilidade e `criar_agendamento`

**Files:**
- Create: `supabase/migrations/20261116000800_agendar.sql`, `tests/integracao/agendar-banco.test.mjs`
- Modify: `supabase/functions/_shared/configuracoes.mjs`, `tests/unidade/configuracoes.test.mjs`, `tests/integracao/apoio.mjs`

**Interfaces:**
- Consumes: as tabelas do plano 1 e o formato `PedidoNormalizado` (Task 1).
- Produces:
  - Linha `configuracoes.termo = {"versao":1,"texto":"..."}`. Texto provisório em português: quem traz arma declara que ela é legal e registrada, que é responsável pelo transporte e pelo uso seguro, e que segue as instruções do instrutor e as regras do estande. Termina com `Texto provisório: deve ser revisado por um advogado antes do uso com clientes reais.`
  - `CHAVES_CONFIGURACAO` ganha `'termo'` (oito chaves). Validação igual à de `privacidade`, com a mensagem `Escreva o texto do termo.` para `texto`.
  - `agendamentos.instrutor_escolhido_id uuid references public.perfis` (pode ficar vazio = sem preferência).
  - `participantes.termo_versao int` (pode ficar vazio).
  - Funções internas (sem `grant`), cada uma ignorando as reservas do agendamento `p_ignorar`:
    - `instrutor_livre(p_instrutor uuid, p_periodo tstzrange, p_ignorar uuid) returns boolean`: tem o papel `instrutor`, o perfil está ativo, o login não está banido (`auth.users.banned_until` vazio ou no passado) e não há reserva ativa que se sobreponha;
    - `pista_livre(p_pista int, p_periodo tstzrange, p_ignorar uuid) returns boolean`: pista ativa, sem interdição ativa sobreposta e sem reserva ativa sobreposta;
    - `unidade_livre(p_unidade int, p_periodo tstzrange, p_ignorar uuid) returns boolean`: situação `disponivel` e sem reserva ativa sobreposta;
    - `carga_instrutor(p_instrutor uuid) returns int`: quantas reservas ativas o instrutor tem que ainda não terminaram (`upper(periodo) > now()`).
  - `public.criar_agendamento(p_responsavel uuid, p_pedido jsonb) returns uuid`, `security definer`, `grant execute ... to service_role`:
    1. grava `app.usuario_id = p_responsavel`;
    2. insere o agendamento com `forma_pagamento = 'balcao'` e `instrutor_escolhido_id`;
    3. instrutores: o escolhido entra como `principal`; se não estiver livre, `raise ... using errcode = 'RP001'`. Os demais (ou todos, sem preferência; o primeiro é o principal) são os livres em ordem de `carga_instrutor`, depois `random()`. Se faltar, `RP002`;
    4. pistas: tantas quanto `instrutores_necessarios`, livres, em ordem de `numero`. Se faltar, `RP003`;
    5. participantes e itens (um item por participante). `aceite_termo_em = now()` quando `termo_versao` vem preenchido;
    6. uma unidade livre do `modelo_id` para cada participante `estande`, diferente das já escolhidas neste agendamento. Se faltar, `RP004`;
    7. devolve o id.
  - Em `apoio.mjs`:
    - `anotarAgendamento(id: string) -> void`;
    - `apagarAgendamentosAnotados() -> Promise<void>`: para cada id, apaga (com o histórico de cada linha) `agendamento_unidades`, `agendamento_instrutores`, `agendamento_pistas`, `itens_participante`, `participantes` e o agendamento, nesta ordem;
    - `apagarTudoCriado` passa a rodar `[apagarAgendamentosAnotados, apagarCriados, apagarUsuariosCriados]`.
  - O bloco de bloqueio é repetido no fim da migração, com os `grant` das funções anteriores mais `criar_agendamento(uuid, jsonb)`.

- [ ] **Step 1: Escrever os testes**
  - **Unidade (`configuracoes.test.mjs`):** oito chaves terminando em `'termo'`; `validarConfiguracao('termo', { versao: 1, texto: ' ' })` dá `campos.texto === 'Escreva o texto do termo.'`.
  - **Integração (`agendar-banco.test.mjs`).** O banco de desenvolvimento pode ter os dados de exemplo da Task 5, então os testes não supõem que só existem os recursos que criaram. Datas em 2030 (a RPC não confere antecedência). No `before`: um cliente, dois instrutores (`criarUsuario({ papeis: ['instrutor'] })`), duas pistas, um modelo com calibre e tipo de munição, duas unidades `disponivel` e uma em `manutencao`. Um ajudante `pedido(extra)` monta um `PedidoNormalizado` de 1 participante `estande`. Todo id devolvido vai para `anotarAgendamento`. Testes:
    - `configuracoes tem o termo`: `valor.versao === 1` e o texto contém `advogado`.
    - `cria com o instrutor escolhido`: a RPC devolve um id; `agendamento_instrutores` tem 1 linha, `principal = true`, com o instrutor escolhido; 1 linha em `agendamento_pistas`; 1 em `agendamento_unidades`, com uma das unidades `disponivel` (nunca a de manutenção); `forma_pagamento === 'balcao'`; o histórico do agendamento tem `feito_por` igual ao cliente.
    - `instrutor escolhido ocupado dá RP001`: outro agendamento no mesmo período com esse instrutor; `code === 'RP001'`, e nenhum agendamento novo fica gravado (a transação é desfeita).
    - `sem preferência escolhe o instrutor com menos reservas`: todos os outros instrutores do banco (lidos em `papeis_usuario?papel=eq.instrutor`) ficam ocupados no período por agendamentos de teste; o instrutor A recebe 1 reserva futura em outro período; o pedido sem preferência fica com o B.
    - `sem instrutores livres dá RP002`: todos os instrutores ocupados no período.
    - `sem pistas livres dá RP003`: uma interdição de teste em cada pista ativa (lidas em `pistas?ativa=eq.true`) no período.
    - `sem unidade livre do modelo dá RP004`: as duas unidades `disponivel` reservadas no período; a de manutenção não é usada.
    - `grupo de 6 ocupa 2 instrutores e 2 pistas`: 6 participantes (1 `estande`, 1 `arma_propria` e 4 `tudo_proprio`, porque o modelo de teste só tem 2 unidades livres), com `instrutores_necessarios: 2`. Resultado: 2 linhas em `agendamento_instrutores` (uma `principal`), 2 em `agendamento_pistas` e 1 em `agendamento_unidades`; os participantes de arma própria têm `termo_versao = 1` e `aceite_termo_em` preenchido.

- [ ] **Step 2: Rodar e ver falhar**

  Run: `npm test` e `npm run test:integracao`
  Expected: FAIL. A chave `termo` não existe e a RPC dá 404.

- [ ] **Step 3: Escrever a migração e alterar `configuracoes.mjs` e `apoio.mjs`**

- [ ] **Step 4: Aplicar e rodar**

  Run: `npx --yes supabase@2.20.12 db push`, depois `npm test` e `npm run test:integracao`.
  Expected: tudo passa, sem resíduo no Table Editor (nem interdições nem agendamentos de teste).

- [ ] **Step 5: Commit (perguntar antes)**
  ```
  git add supabase/migrations/20261116000800_agendar.sql supabase/functions/_shared/configuracoes.mjs tests/unidade/configuracoes.test.mjs tests/integracao/apoio.mjs tests/integracao/agendar-banco.test.mjs
  git commit -m "Cria o agendamento no banco: escolhe pistas, instrutores e armas livres"
  ```

---

### Task 3: Banco: alterar o horário e cancelar

**Files:**
- Create: `supabase/migrations/20261116000900_alterar_cancelar.sql`
- Modify: `tests/integracao/agendar-banco.test.mjs`

**Interfaces:**
- Consumes: `instrutor_livre`, `pista_livre`, `unidade_livre`, `carga_instrutor` (Task 2).
- Produces:
  - `public.alterar_horario_agendamento(p_agendamento uuid, p_inicio timestamptz, p_horas int, p_autor uuid) returns public.agendamentos`, `security definer`, `grant ... to service_role`:
    1. grava `app.usuario_id = p_autor` e trava a linha (`for update`);
    2. calcula o período novo com `periodo_sessao`;
    3. para cada reserva ativa do agendamento: se o recurso continua livre no período novo (ignorando o próprio agendamento), fica. Se não, troca por um livre que ainda não esteja neste agendamento: instrutor em ordem de carga (`RP002` se faltar), pista em ordem de número (`RP003`), unidade do mesmo modelo (`RP004`). O instrutor escolhido pelo cliente nunca é trocado: se não estiver livre, `RP001`. Cada reserva é atualizada num só `update`, com o recurso e o período finais juntos; assim o gatilho de interdição confere a pista certa no período certo. Por isso as restrições de exclusão não precisam ser `deferrable`;
    4. atualiza `inicio` e `horas` do agendamento e devolve a linha.
  - `public.cancelar_agendamento(p_agendamento uuid, p_autor uuid) returns public.agendamentos`, `security definer`, `grant ... to service_role`: grava o autor, muda a situação para `cancelado` (o gatilho do plano 1 desativa as reservas) e devolve a linha.
  - Bloco de bloqueio no fim, com todos os `grant` anteriores mais as duas funções.

- [ ] **Step 1: Escrever os testes (no mesmo arquivo da Task 2)**
  - `alterar mantém os recursos livres`: cria às 10h, altera para 15h; pista, instrutor e unidade continuam os mesmos, e o `periodo` das três reservas é o novo.
  - `alterar troca só a pista interditada`: interdição de teste na pista atual só no horário novo; depois da alteração, a pista é outra, e o instrutor e a unidade continuam os mesmos.
  - `alterar troca a unidade em manutenção`: a unidade alocada passa para `manutencao` (restaurar no fim); depois da alteração, a reserva usa a outra unidade `disponivel`.
  - `alterar com o instrutor escolhido ocupado dá RP001` e o agendamento continua no horário antigo.
  - `alterar troca o instrutor que não foi escolhido`: agendamento sem preferência com o instrutor A; A ocupado no horário novo; depois da alteração, o instrutor é outro, livre.
  - `alterar grava o autor no histórico`: a última linha do histórico do agendamento tem `feito_por` igual ao `p_autor`.
  - `cancelar desativa as reservas`: `situacao === 'cancelado'`; as reservas ficam com `ativo = false`; outro agendamento consegue o mesmo instrutor escolhido no mesmo período.

- [ ] **Step 2: Rodar e ver falhar**

  Run: `npm run test:integracao`
  Expected: os testes novos falham com 404 (RPC inexistente).

- [ ] **Step 3: Escrever a migração**

- [ ] **Step 4: Aplicar e rodar**

  Run: `npx --yes supabase@2.20.12 db push`, depois `npm run test:integracao`.
  Expected: tudo passa, sem resíduo; a unidade posta em manutenção volta a `disponivel`.

- [ ] **Step 5: Commit (perguntar antes)**
  ```
  git add supabase/migrations/20261116000900_alterar_cancelar.sql tests/integracao/agendar-banco.test.mjs
  git commit -m "Permite alterar o horário (trocando só o recurso ocupado) e cancelar o agendamento"
  ```

---

### Task 4: Edge Function `agendamentos`

**Files:**
- Create: `supabase/functions/agendamentos/index.js`, `tests/integracao/agendamentos-funcao.test.mjs`
- Modify: `supabase/config.toml` (`[functions.agendamentos]`, `entrypoint = "./functions/agendamentos/index.js"`, `verify_jwt = false`), `tests/integracao/apoio.mjs`

**Interfaces:**
- Consumes: Task 1 inteira, `criar_agendamento` (Task 2), `alterar_horario_agendamento` e `cancelar_agendamento` (Task 3), `obterContexto` e `admin`.
- Produces (todas com login; sem perfil = 404 `Não encontramos o seu cadastro. Procure o atendimento do estande.`):
  - **`GET /functions/v1/agendamentos?ver=opcoes`** → 200:
    ```
    { estande: {nome, fuso}, agenda: {antecedencia_minima_horas, antecedencia_maxima_dias, prazo_alteracao_horas,
        duracao_maxima_individual, duracao_maxima_grupo, grupo_maximo, faixas_instrutores},
      funcionamento, municao: {minima_por_participante}, idade_minima, termo: {versao, texto},
      catalogo: { categorias: [{id, nome}], calibres: [{id, nome}], modelos: [{id, categoria_id, calibre_id, marca, nome}],
                  tipos_municao: [{id, calibre_id, nome}] },
      instrutores: [{id, nome}], responsavel: {id, nome_completo, cpf, data_nascimento} }
    ```
    Só itens ativos. `modelos` só traz os que têm pelo menos uma unidade `disponivel` e categoria e calibre ativos. `instrutores` = perfis ativos com o papel `instrutor` e login não banido, em ordem de nome.
  - **`GET /functions/v1/agendamentos`** → 200 `{ agendamentos: Item[] }`, só os do responsável logado, em ordem de `inicio` decrescente. `Item` = `{ id, inicio, horas, situacao, forma_pagamento, pode_alterar, prazo_alteracao_horas, instrutores: [nome] (principal primeiro), participantes: [{ nome_completo, modalidade, modelo: {marca, nome, calibre}|null, arma_propria: {modelo, calibre}|null, tipo_municao: {nome, calibre}|null, municao_qtd }] }`. Sem pistas, unidades, CPFs nem nº de registro.
  - **`POST /functions/v1/agendamentos`**, corpo = pedido da Task 1:
    - JSON ilegível: 400 `Não foi possível ler os dados enviados. Tente de novo.`;
    - `validarPedido` com erro: 400 `{ erro: 'Revise os campos destacados.', campos }`;
    - erro da RPC com `erroDeReserva(error.code)` diferente de `null`: o status e o corpo dele; outros erros: 500 pelo `tratar`;
    - sucesso: 201 `{ agendamento: Item }`.
  - **`PUT /functions/v1/agendamentos`**, corpo `{ id, acao: 'alterar_horario', data, hora, horas }` ou `{ id, acao: 'cancelar' }`, nesta ordem de checagem:
    1. JSON ilegível: 400 (mensagem acima);
    2. `acao` desconhecida: 400 `{ erro: 'Esta ação não existe.' }`;
    3. `id` que não é uuid, que não existe ou que é de outro responsável: 404 `{ erro: 'Não encontramos este agendamento.' }`;
    4. situação fora de `aguardando_pagamento`/`pago`: 409 `{ erro: 'Este agendamento não pode mais ser alterado pelo app. Fale com o estande.' }`;
    5. fora do prazo (`podeAlterar` falso): 403 `` { erro: `Faltam menos de ${prazo} horas para o início. Para alterar ou cancelar, fale com o estande.` } ``;
    6. `alterar_horario`: `validarNovoHorario` com a quantidade de participantes; erro → 400 com `campos`; erros da RPC como no POST;
    7. sucesso: 200 `{ agendamento: Item }`.
  - Outros métodos: 405 `Esta ação não é permitida aqui.`
- Em `apoio.mjs`: `diaAbertoDeTeste(dias: number) -> Promise<{ data, horas: number[] }>`: lê `funcionamento` e `estande` de `configuracoes` e devolve o primeiro dia, a partir de hoje (no fuso) + `dias`, com `horariosDoDia` não vazio.

- [ ] **Step 1: Escrever os testes em `tests/integracao/agendamentos-funcao.test.mjs`**

  Dias de teste dentro da janela de 15 dias: `diaAbertoDeTeste(3)` em diante. Cada teste que agenda usa um instrutor próprio, criado no teste, escolhido no pedido, e uma hora diferente das dos outros testes. O `before` cria um modelo com uma unidade `disponivel` (nº `REG-...`), um modelo só com unidade em `manutencao`, um tipo de munição e duas pistas. Todo agendamento criado vai para `anotarAgendamento`. Testes:
  - `opções trazem o termo, os instrutores e só modelos com arma disponível`: 200; `termo.versao === 1`; o modelo em manutenção não aparece e o outro aparece; cada instrutor tem só as chaves `id` e `nome`; `JSON.stringify` da resposta não contém `numero_registro` nem `REG-`.
  - `sem login recebe 401`; `usuário sem cadastro recebe 404` (`criarUsuario({ perfil: false })`).
  - `pedido inválido recebe 400`: `participantes: []` dá `campos.participantes`.
  - `cria e aparece na lista`: POST 201; `agendamento.situacao === 'aguardando_pagamento'`; `forma_pagamento === 'balcao'` mesmo com `forma_pagamento: 'app'` no corpo; o GET da lista traz o id com `pode_alterar === true` e o nome do instrutor; nem o POST nem o GET contêm `numero_registro` ou `REG-`, inclusive com um participante de arma própria.
  - `instrutor ocupado recebe 409`: dois POST iguais com o mesmo instrutor; o segundo dá 409 com a mensagem de `RP001`.
  - `outro cliente não vê nem mexe`: o GET de outro cliente não traz o agendamento; o PUT `cancelar` dele dá 404, igual a um id inventado (`crypto.randomUUID()`) e a `'abc'`.
  - `altera o horário`: PUT `alterar_horario` para outra hora do mesmo dia; 200 e `inicio` novo.
  - `cancela, e cancelar de novo recebe 409`: o primeiro PUT `cancelar` dá 200 e `situacao === 'cancelado'`; o segundo dá 409.
  - `dentro do prazo recebe 403`: agendamento gravado direto no banco (`criar('agendamentos', ...)`) começando daqui a 2 horas; PUT `cancelar` dá 403 com a mensagem do prazo.
  - `ação desconhecida recebe 400`.

- [ ] **Step 2: Rodar e ver falhar**

  Run: `npm run test:integracao`
  Expected: FAIL, função inexistente (404).

- [ ] **Step 3: Implementar a função e a seção do `config.toml`**

  O `opcoes` montado pelo GET é o mesmo objeto passado a `validarPedido` no POST, para o servidor e o navegador validarem com os mesmos dados. `agora = new Date()`.

- [ ] **Step 4: Publicar e rodar**

  Run: `npx --yes supabase@2.20.12 functions deploy agendamentos --use-api`, depois `npm run test:integracao`.
  Expected: tudo passa, sem resíduo.

- [ ] **Step 5: Commit (perguntar antes)**
  ```
  git add supabase/functions/agendamentos/index.js supabase/config.toml tests/integracao/agendamentos-funcao.test.mjs tests/integracao/apoio.mjs
  git commit -m "Cria a função de agendamentos: opções, lista, criar, alterar horário e cancelar"
  ```

---

### Task 5: Dados de exemplo para o teste manual

O catálogo de verdade é cadastrado pelo superadmin na etapa 5. Para o dono testar agora, um script **só de desenvolvimento**, no mesmo estilo de `promover-superadmin.sql`. Não é migração, para não ir para o banco de um estande real.

**Files:**
- Create: `supabase/scripts/dados-de-exemplo.sql`
- Modify: `README.md` (seção "Dados de exemplo")

**Interfaces:**
- Produces: o script pode rodar mais de uma vez sem duplicar nada (`on conflict do nothing`, buscando os ids pelo nome). Ele cria:
  - **Categorias:** Pistola, Revólver, Carabina, Fuzil, Espingarda.
  - **Calibres:** `9mm`, `.380 ACP`, `.40 S&W`, `.38 SPL`, `.357 Magnum`, `.22 LR`, `5,56x45mm`, `7,62x51mm`, `12`.
  - **Modelos** (marca, nome, calibre): Glock G17 (9mm), Glock G25 (.380 ACP), Taurus TS9 (9mm), CZ Shadow 2 (9mm), Sig Sauer P320 (9mm), Imbel MD7 (.40 S&W), Taurus RT 82S (.38 SPL), Taurus RT 627 (.357 Magnum), CBC 7022 (.22 LR), Taurus T4 (5,56x45mm), Colt AR-15 (5,56x45mm), Imbel IA2 (5,56x45mm), Imbel FAL (7,62x51mm), CBC Pump Military 3.0 (12).
  - **Tipos de munição:** um por calibre (`ETOG` nas pistolas e fuzis, `CHOG` em `.38 SPL` e `.22 LR`, `EXPO` em `.357 Magnum`, `Chumbo 3T` em `12`).
  - **Unidades:** duas por modelo, `disponivel`, nº de registro `EXEMPLO-<marca>-<nome>-1` e `-2`.
  - **Pistas:** 1 a 4.
  - **Instrutores:** o papel `instrutor` para os e-mails `INSTRUTOR-1@exemplo.com` e `INSTRUTOR-2@exemplo.com`, que o dono troca pelos e-mails das contas criadas no passo 1 abaixo.
  - No fim, um `select` que mostra quantos itens de cada tipo existem.

- [ ] **Step 1: Escrever o script e o README**

  O README explica, em passos: (1) criar duas contas de instrutor em `conta.html` com `+instrutor1` e `+instrutor2` antes do `@` do e-mail do dono, e confirmar os e-mails; (2) colar o script no *SQL Editor*, trocar os dois e-mails e clicar em *Run*.

- [ ] **Step 2: O dono roda o script (guiado)**

  Expected: o `select` final mostra 5 categorias, 9 calibres, 14 modelos, 28 unidades, 4 pistas e 2 instrutores. Rodar de novo não muda os números.

- [ ] **Step 3: Conferir que os testes continuam passando com os dados de exemplo no banco**

  Run: `npm run test:integracao`
  Expected: tudo passa, e os números do `select` continuam os mesmos depois.

- [ ] **Step 4: Commit (perguntar antes)**
  ```
  git add supabase/scripts/dados-de-exemplo.sql README.md
  git commit -m "Cria o script de dados de exemplo para testar o agendamento"
  ```

---

### Task 6: Tela de novo agendamento (o `index.html` sem Make e sem valores fixos)

**Files:**
- Create: `api.mjs`, `agendar-regras.mjs`, `agendar.js`, `agendar.css`, `tests/unidade/agendar-regras.test.mjs`
- Modify: `index.html` (reescrever), `conta.js` (importar de `api.mjs`; `?voltar=index.html`), `conta.html` (botão "Meus agendamentos"), `package.json` (`"test": "node --test \"tests/unidade/**/*.test.mjs\""`)
- Delete: `regras.js`, `tests/regras.test.js`

**Interfaces:**
- Consumes: `GET agendamentos?ver=opcoes` e `POST agendamentos` (Task 4); `validarPedido`, `horariosDoDia`, `duracoesPossiveis` e `instrutoresNecessarios`, importados no navegador de `./supabase/functions/_shared/agendamento.mjs`.
- Produces:
  - **`api.mjs`:** `export const supabase` (o cliente criado com `config.js`) e `export async function chamarFuncao(nome, { metodo, corpo, consulta }) -> { status, dados }` (a de `conta.js`, movida; `consulta` vira `?ver=opcoes`). O `conta.js` passa a importar os dois daqui.
  - **`agendar-regras.mjs`:**
    - `descreverSessao(inicio: string ISO, horas: number, fuso: string) -> string`: `'Quarta, 18/11 · das 10:00 às 12:00'`. Dias: Domingo, Segunda, Terça, Quarta, Quinta, Sexta, Sábado;
    - `TEXTO_SITUACAO`: `aguardando_pagamento` → `Aguardando pagamento`, `pago` → `Pago`, `check_in` → `Check-in feito`, `concluido` → `Concluído`, `cancelado` → `Cancelado`, `nao_compareceu` → `Não compareceu`;
    - `modelosDaCategoria(catalogo, categoriaId) -> modelo[]` (em ordem de marca e nome) e `municoesDoModelo(catalogo, modeloId) -> tipo[]` (do calibre do modelo);
    - `nomeDoCalibre(catalogo, modeloId) -> string`;
    - `separarAgendamentos(lista: Item[], agora: Date) -> { proximos, anteriores }`: próximos = término depois de `agora` e situação diferente de `cancelado` e `nao_compareceu`, em ordem crescente de início; os demais em ordem decrescente.
  - **Login:** sem sessão, o `index.html` vai para `conta.html?voltar=index.html`. O `conta.js`, ao entrar (ou ao abrir já com sessão), volta para `index.html` só quando `voltar` for exatamente `index.html`; qualquer outro valor é ignorado.
  - **Telas do `index.html`** (uma `<section>` visível por vez, visual de `agendar.css` com as cores do `:root` atual):
    - **Novo agendamento:**
      - *Quando:* dia (`<input type="date">` com `min` = hoje e `max` = hoje + `antecedencia_maxima_dias`, no fuso), horário (`horariosDoDia`; dia sem horário mostra `O estande não abre neste dia. Escolha outro.`) e duração (`duracoesPossiveis`, com o máximo de sozinho ou de grupo conforme a quantidade de participantes; texto `2 horas (até 12:00)`).
      - *Instrutor:* "Sem preferência" (valor vazio → `null`) mais os nomes.
      - *Participantes:* um cartão por pessoa. O primeiro é "Você (nome)" e não tem nome, CPF nem nascimento. O botão "Adicionar participante" some ao chegar em `grupo_maximo`, e cada cartão extra tem "Remover". Em cada cartão: modalidade; para `estande`, categoria → modelo → calibre (texto, preenchido sozinho) → munição → quantidade (`min` = mínimo); para arma própria, os quatro campos da arma, munição (todas as do catálogo) e quantidade só em `arma_propria`, e o termo num `<details>` com a caixa "Li e aceito o termo de responsabilidade".
      - Uma linha diz quantos instrutores e pistas o grupo vai ocupar (`instrutoresNecessarios`).
      - Os erros de `validarPedido` aparecem embaixo de cada campo, pela chave de `campos` (`participantes.2.cpf` fica no cartão 3).
    - **Revisar:** `descreverSessao`, o instrutor, cada participante com a arma e a munição, e a frase `Pagamento no balcão, no dia da sessão.` Botões "Confirmar agendamento" e "Voltar e mudar". Um 409 mostra o `erro` aqui; um 400 volta para o formulário com os `campos`.
    - **Sucesso:** `Agendamento feito!`, `descreverSessao`, e o botão "Ver meus agendamentos" (a lista é a Task 7; até lá ele volta para o formulário).
  - Os botões ficam desabilitados durante a chamada. 401 ou 403 faz `signOut` e vai para `conta.html?voltar=index.html`.

- [ ] **Step 1: Escrever `tests/unidade/agendar-regras.test.mjs`**
  - `descreverSessao('2026-11-18T13:00:00Z', 2, 'America/Sao_Paulo') === 'Quarta, 18/11 · das 10:00 às 12:00'`, e o mesmo instante com `'America/New_York'` dá `'Quarta, 18/11 · das 08:00 às 10:00'`.
  - Uma asserção por situação de `TEXTO_SITUACAO`.
  - `modelosDaCategoria` e `municoesDoModelo` com um catálogo de dois calibres: só os da categoria e só os do calibre do modelo.
  - `separarAgendamentos`: um futuro `pago`, um futuro `cancelado`, um passado `concluido` e um em andamento (começou há 30 min, dura 1h) dão `proximos` = [em andamento, futuro pago] e `anteriores` = [futuro cancelado, passado].

- [ ] **Step 2: Rodar e ver falhar**

  Run: `npm test`
  Expected: FAIL, módulo inexistente.

- [ ] **Step 3: Implementar `agendar-regras.mjs`, mudar o `package.json` e apagar `regras.js` e `tests/regras.test.js`**

- [ ] **Step 4: Rodar e ver passar**

  Run: `npm test`
  Expected: tudo passa, sem os testes antigos de `regras.test.js`.

- [ ] **Step 5: Implementar `api.mjs`, `agendar.js`, `agendar.css`, o novo `index.html` e as mudanças em `conta.js` e `conta.html`**

  O `index.html` não pode ter mais `hook.us2.make.com`, `INSTRUTORES`, `ARMAMENTOS` nem `regras.js`.

- [ ] **Step 6: Teste manual guiado com o dono**

  Run: `npx --yes http-server@14.1.1 -p 5500 -c-1`, depois abrir `http://localhost:5500/index.html` (com os dados de exemplo da Task 5 no banco).

  Expected, nesta ordem:
  1. Sem login, a página vai para "Entrar"; depois de entrar, volta sozinha para o agendamento.
  2. As listas mostram os instrutores e as armas do banco, e o calibre se preenche ao escolher o modelo.
  3. Um dia de amanhã às 8h mostra o erro de antecedência embaixo do horário.
  4. Agendar sozinho, com arma do estande, mostra "Agendamento feito!".
  5. Agendar de novo, no mesmo horário e com o mesmo instrutor, mostra o aviso de instrutor ocupado na tela de revisão.
  6. Um grupo de 6 diz que vai ocupar 2 instrutores e 2 pistas, e um participante com o CPF do dono mostra o erro no cartão dele.
  7. No Table Editor, o agendamento tem `forma_pagamento = balcao`, e as reservas de pista, instrutor e arma existem.

- [ ] **Step 7: Commit (perguntar antes)**
  ```
  git add api.mjs agendar-regras.mjs agendar.js agendar.css index.html conta.js conta.html package.json tests/unidade/agendar-regras.test.mjs
  git rm regras.js tests/regras.test.js
  git commit -m "Liga o agendamento ao banco: sem Make, sem listas fixas e com login"
  ```

---

### Task 7: "Meus agendamentos": lista, alterar horário e cancelar

**Files:**
- Modify: `index.html`, `agendar.js`, `agendar.css`, `README.md` (como testar o agendamento)

**Interfaces:**
- Consumes: `GET agendamentos`, `PUT agendamentos` (Task 4); `separarAgendamentos`, `descreverSessao`, `TEXTO_SITUACAO` (Task 6); `validarNovoHorario`, `horariosDoDia`, `duracoesPossiveis` (Task 1).
- Produces:
  - **Tela inicial = Meus agendamentos:** o nome do cliente, o link "Meu perfil" (`conta.html`), o botão "Novo agendamento" e duas listas, "Próximos" e "Anteriores". Sem nenhum agendamento: `Você ainda não tem agendamentos.`
  - **Cartão:** `descreverSessao`, a situação (`TEXTO_SITUACAO`), os instrutores, os participantes com a arma e a munição. Com `pode_alterar`: botões "Alterar horário" e "Cancelar". Sem `pode_alterar` num próximo ativo: `` `Faltam menos de ${prazo_alteracao_horas} horas. Para alterar ou cancelar, fale com o estande.` ``
  - **Alterar horário:** os mesmos campos de dia, horário e duração da Task 6 (preenchidos com o horário atual), mais a frase `Só o dia, o horário e a duração mudam. Para mudar armas ou participantes, cancele e agende de novo.` Erros 400 embaixo dos campos; 409 e 403 num aviso; sucesso volta para a lista com o aviso `Horário alterado.`
  - **Cancelar:** `confirm('Cancelar o agendamento de <descreverSessao>?')`; sucesso volta para a lista com `Agendamento cancelado.`
  - O botão "Ver meus agendamentos" da tela de sucesso (Task 6) passa a abrir esta lista.

- [ ] **Step 1: Implementar as telas**

  A lógica pura já está testada (Tasks 1 e 6). Esta tarefa só liga as telas.

- [ ] **Step 2: Rodar os testes automáticos**

  Run: `npm test` e `npm run test:integracao`
  Expected: tudo passa.

- [ ] **Step 3: Teste manual guiado com o dono**

  Expected, nesta ordem:
  1. Ao entrar, aparece a lista, com o agendamento da Task 6 em "Próximos" e a situação "Aguardando pagamento".
  2. "Alterar horário" para outra hora mostra "Horário alterado." e o horário novo no cartão.
  3. Alterar para um horário de amanhã mostra o erro de antecedência.
  4. "Cancelar" pede confirmação e move o cartão para "Anteriores", com a situação "Cancelado".
  5. No Table Editor, o histórico do agendamento mostra o dono como autor da alteração e do cancelamento.
  6. Um agendamento que começa em menos de 24h (o construtor grava um direto no banco) mostra a frase de "fale com o estande", sem os botões. O construtor apaga esse agendamento no fim.

- [ ] **Step 4: Commit (perguntar antes)**
  ```
  git add index.html agendar.js agendar.css README.md
  git commit -m "Cria Meus agendamentos: lista, alterar horário e cancelar"
  ```
