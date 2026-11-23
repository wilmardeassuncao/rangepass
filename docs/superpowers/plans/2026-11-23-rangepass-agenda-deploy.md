# RangePass, plano 6: agenda visual e publicação na Vercel (etapas 6 e 7)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o cliente escolhe dia, hora e duração numa agenda visual que mostra as vagas reais de pista e instrutor, no agendamento novo e no "Alterar horário", e o sistema novo fica publicado na Vercel usando o banco de testes.

**Architecture:**
- **Banco:** uma função SQL nova, `vagas_por_hora`, devolve para cada hora pedida os ids das pistas livres e dos instrutores livres, usando as mesmas `pista_livre` e `instrutor_livre` que a reserva usa.
- **Servidor:** a função `agendamentos` ganha `GET ?ver=disponibilidade[&agendamento=<id>]`, que monta os dias de hoje até `antecedencia_maxima_dias`, no relógio do estande, e chama a função SQL.
- **Regras puras** (`agenda-regras.mjs`): cruzam as horas da sessão e decidem as cores, as durações e o que fazer com uma escolha que deixou de caber. Testadas no Node.
- **Tela** (`agenda-tela.mjs`): desenha a faixa de dias e os botões como `input type="radio"` com os nomes `data`, `hora` e `horas`, para que o envio continue igual. Ela é usada pelos dois formulários.
- **Publicação:** site estático na Vercel, a partir do branch `nova-arquitetura`.

**Tech Stack:** o mesmo dos planos 3 a 5 (HTML/CSS/JS puro, Supabase Postgres e Edge Functions em JS, `node:test`, Playwright para os testes de tela).

**Spec:** `docs/superpowers/specs/2026-11-23-rangepass-agenda-deploy-design.md` (e a spec principal `2026-11-11-rangepass-supabase-design.md`, seções 6.1 a 6.3).

## Global Constraints

Valem todas as dos planos 1 a 5:
- **PowerShell 5.1** e **português do Brasil**, com mensagens que dizem o que aconteceu e o que fazer.
- **Perguntar antes de cada commit.** Nunca push nem merge sem pedido. **Cada envio ao GitHub também atualiza o site da Vercel.**
- **Parar no fim de cada tarefa.**
- **Os testes limpam o que criam** e restauram o que alteram. **O construtor roda os testes, inclusive os de tela, e mostra os resultados.**
- **Migrações aplicadas nunca são editadas**, e toda migração nova repete o bloco de bloqueio completo da última (`20261117001700_remove_alterar_4args.sql`), mais os grants novos.
- **A conta real do dono (`wilmar.assuncao@gmail.com`, superadmin) e os 2 instrutores de exemplo nunca são tocados pelos testes.**
- **Dinheiro em centavos inteiros.**

Novas neste plano:
- **As cores consideram só pistas e instrutores** (opção A). A falta de arma (RP004) e o mesmo CPF (RP006) continuam aparecendo só no Confirmar.
- **"Poucas vagas":** `vagas ≤ agenda.poucas_vagas` (hoje é 1), em que `vagas = min(⌊pistas livres ÷ necessários⌋, ⌊instrutores livres ÷ necessários⌋)`, contadas no cruzamento das horas da sessão.
- **A agenda tem dois formatos:** uma coluna no celular. No computador (`min-width: 900px`), a agenda ocupa até 960px, em duas colunas: dias e horas de um lado, duração e resumo do outro. O resto do formulário fica como está (480px, centralizado).
- **A cor nunca é o único sinal:** o lotado vem riscado e desabilitado, o amarelo tem a legenda "poucas vagas" e cada botão tem um texto acessível (por exemplo, `aria-label="10:00, poucas vagas"`).
- **Ids, nunca números:** a resposta de disponibilidade traz `pistas.id`, nunca `pistas.numero`. Também não traz nenhum registro de arma nem CPF.

## Review Focus

1. **Sessão de 2 horas com uma pista diferente livre em cada hora** (pista A só às 10h, pista B só às 11h): a duração de 2 horas às 10h fica bloqueada. Teste de unidade na Task 3.
2. **Alterar horário:** o horário atual do próprio cliente aparece livre, e não ocupado por ele mesmo. Teste de integração na Task 2 e de unidade na Task 3.
3. **Instrutor escolhido ocupado, com outros livres:** a hora fica lotada para quem escolheu esse instrutor e livre para "sem preferência". Teste de unidade na Task 3.
4. **Grupo cresce, ou o instrutor muda, depois de a hora ser escolhida:** a escolha que não cabe mais é desfeita, com aviso. Ela nunca fica marcada sem caber. Testes de unidade na Task 3 e de tela na Task 4.
5. **A disponibilidade não carrega** (rede caída, 500): a agenda mostra a mensagem com "Tentar de novo", e a tela não fica presa. Teste de tela na Task 4.

---

## Estrutura de arquivos

```
supabase/migrations/20261123001800_vagas_por_hora.sql   função vagas_por_hora + bloqueio
supabase/functions/_shared/agendamento.mjs              (alterar) exportar somarDias
supabase/functions/agendamentos/index.js                (alterar) GET ?ver=disponibilidade; comentário do topo
agenda-regras.mjs                                       puro: montarAgenda
agenda-tela.mjs                                         DOM: criarAgenda (dias, horas, durações, resumo, aviso)
agendar-regras.mjs                                      (alterar) somarDias reexportado de agendamento.mjs
agendar.js, index.html, agendar.css                     (alterar) agenda nos dois formulários; prévia do Alterar
supabase/functions/_shared/precos.mjs                   (alterar) pacote no mesmo participante; centavosDoTexto; formatarReais; conferirItensDoPacote
supabase/functions/precos/index.js                      (alterar) pacote com item sem preço/calibre errado; classe desativada
.vercelignore                                           publicação
README.md                                               (alterar) site publicado, Site URL, banco que pausa
tests/integracao/vagas-banco.test.mjs                   função SQL
tests/integracao/disponibilidade-funcao.test.mjs        rota nova
tests/unidade/agenda-regras.test.mjs                    regras da agenda
tests/unidade/precos.test.mjs                           (alterar)
tests/integracao/precos-funcao.test.mjs                 (alterar)
```

---

### Task 1: Função SQL `vagas_por_hora`

**Files:**
- Create: `supabase/migrations/20261123001800_vagas_por_hora.sql`
- Test: `tests/integracao/vagas-banco.test.mjs`

**Interfaces:**
- Produces: `public.vagas_por_hora(p_inicios timestamptz[], p_ignorar uuid) returns table (inicio timestamptz, pistas int[], instrutores uuid[])`. Cada linha corresponde a uma hora `[inicio, inicio + 1h)`. Os arrays vêm em ordem crescente e são `'{}'` quando vazios, nunca nulos. Só `service_role` executa.

- [ ] **Step 1: Escrever os testes que falham** (`rpc('vagas_por_hora', ...)` com a chave de serviço, usando o apoio de `tests/integracao/apoio.mjs` e um dia de `diaAbertoDeTeste(3)`; criar 2 pistas e 2 instrutores próprios do teste):
  - `pista e instrutor criados aparecem livres numa hora sem reservas` → o id da pista está em `pistas`, o do instrutor em `instrutores`.
  - `pista interditada na hora não aparece` → com uma `interdicoes` ativa cobrindo a hora, o id dela sai de `pistas`, e ela continua livre na hora seguinte.
  - `instrutor e pista de um agendamento ficam ocupados só nas horas dele` → um agendamento de 2h criado com `criar_agendamento` às `h`: os ids reservados não aparecem em `h` nem em `h+1`, e aparecem em `h+2`.
  - `p_ignorar devolve as reservas do próprio agendamento` → o mesmo agendamento passado em `p_ignorar`: os ids reservados voltam a aparecer em `h`.
  - `pista desativada e instrutor bloqueado nunca aparecem`.
  - `anon e authenticated não executam` → `rpc` com a chave anônima recebe erro de permissão.
- [ ] **Step 2: Rodar e ver falhar.** `node --env-file=.env.teste --test tests/integracao/vagas-banco.test.mjs`. Esperado: FAIL, porque a função não existe.
- [ ] **Step 3: Escrever a migração.** É uma função `language sql stable security definer set search_path = public`. Para cada `inicio` de `unnest(p_inicios)`: as pistas `p` com `pista_livre(p.id, periodo_sessao(inicio, 1), p_ignorar)` e os instrutores de `instrutores_ativos()` com `instrutor_livre(i.id, periodo_sessao(inicio, 1), p_ignorar)`, cada grupo em `coalesce(array_agg(... order by id), '{}')`. No fim, o bloco de bloqueio completo, mais `grant execute on function public.vagas_por_hora(timestamptz[], uuid) to service_role;`.
- [ ] **Step 4: Aplicar no dev.** `npx.cmd --yes supabase@2.20.12 db push`. Esperado: aplica só `20261123001800`.
- [ ] **Step 5: Rodar e ver passar.** O mesmo comando do Step 2. Esperado: PASS.
- [ ] **Step 6: Commit** (pedir autorização). Mensagem: `Cria a função vagas_por_hora (pistas e instrutores livres por hora)`.

---

### Task 2: Rota `GET agendamentos?ver=disponibilidade`

**Files:**
- Modify: `supabase/functions/_shared/agendamento.mjs` (exportar `somarDias`)
- Modify: `supabase/functions/agendamentos/index.js` (`listar` e o comentário do topo, que passa a dizer "números de pista" em vez de "pistas")
- Test: `tests/integracao/disponibilidade-funcao.test.mjs`

**Interfaces:**
- Consumes: `vagas_por_hora` (Task 1); `horariosDoDia`, `instanteNoFuso`, `somarDias` de `agendamento.mjs`; `dataNoFuso` de `cadastro.mjs`.
- Produces: a resposta 200, chamada de **Disponibilidade**:
  ```js
  {
    hoje: 'AAAA-MM-DD',                       // no fuso do estande
    dias: {                                   // de hoje até hoje + antecedencia_maxima_dias, todos presentes
      'AAAA-MM-DD': {                         // {} quando o estande não abre
        '10': { pistas: [1, 4], instrutores: ['uuid', ...] },   // chave = hora cheia de início, em texto
      },
    },
    agendamento: null | { instrutor_escolhido_id: 'uuid' | null, participantes: 3 },
  }
  ```
  As horas de cada dia são as de `horariosDoDia(data, funcionamento)`.

- [ ] **Step 1: Escrever os testes que falham:**
  - `sem login recebe 401` e `usuário sem cadastro recebe 404`, como nos outros testes de `agendamentos`.
  - `traz todos os dias de hoje até a antecedência máxima, e as horas de funcionamento` → `Object.keys(dias).length === antecedencia_maxima_dias + 1`; o dia de `diaAbertoDeTeste(3)` tem exatamente as chaves `dia.horas.map(String)`; `agendamento === null`.
  - `instrutor reservado sai das horas da reserva` → um agendamento do cliente de teste, com instrutor próprio do teste, às `h` por 2h: o id desse instrutor não está em `dias[data][h]` nem em `[h+1]`.
  - `com agendamento=<id> do próprio cliente, as reservas dele voltam a aparecer` → o instrutor volta a aparecer em `[h]`; `agendamento` é `{ instrutor_escolhido_id: <o escolhido>, participantes: 1 }`.
  - `agendamento de outro cliente, cancelado ou id inválido recebe 404 "Não encontramos este agendamento."`
  - `a resposta não traz número de pista, registro de arma nem CPF` → `JSON.stringify(r.dados)` não contém o `numero` da pista criada no teste nem o CPF do cliente.
- [ ] **Step 2: Rodar e ver falhar.** `node --env-file=.env.teste --test tests/integracao/disponibilidade-funcao.test.mjs`. Esperado: FAIL.
- [ ] **Step 3: Implementar `disponibilidade(req, contexto)` em `agendamentos/index.js`** e chamá-la de `listar` quando `ver === 'disponibilidade'`. Ela lê `estande`, `agenda` e `funcionamento` de `configuracoes`. Um `agendamento` informado precisa ser UUID, do responsável logado e com situação em `ATIVAS`; se não for, `ErroHttp(404, NAO_ENCONTRADO)`. A função monta a lista de instantes com `instanteNoFuso(data, hora, fuso)`, faz uma única chamada a `admin.rpc('vagas_por_hora', { p_inicios, p_ignorar })` e devolve o resultado arrumado por dia e hora. O `participantes` do agendamento é a contagem da tabela `participantes`.
- [ ] **Step 4: Publicar.** `npx.cmd --yes supabase@2.20.12 functions deploy agendamentos --use-api`.
- [ ] **Step 5: Rodar e ver passar.** O teste novo e também `tests/integracao/agendamentos-funcao.test.mjs`, para confirmar que nada quebrou. Esperado: PASS.
- [ ] **Step 6: Commit** (pedir autorização). Mensagem: `Cria a rota de disponibilidade da agenda`.

---

### Task 3: Regras puras da agenda

**Files:**
- Create: `agenda-regras.mjs`
- Modify: `agendar-regras.mjs` (`export { somarDias } from './supabase/functions/_shared/agendamento.mjs'` no lugar da cópia)
- Test: `tests/unidade/agenda-regras.test.mjs`

**Interfaces:**
- Consumes: **Disponibilidade** (Task 2); de `agendamento.mjs`, `instanteNoFuso`, `duracoesPossiveis`, `instrutoresNecessarios` e `somarDias`.
- Produces:
  ```js
  // contexto = { disponibilidade, opcoes, agora: Date, quantidade: int, instrutorId: string | null }
  // escolha  = { data: string | null, hora: int | null, horas: int | null }
  montarAgenda(contexto, escolha) → {
    dias:     [{ data, rotulo: 'Ter 24/11', habilitado: bool }],
    horas:    [{ hora, rotulo: '10:00', cor: 'livre' | 'poucas' | 'lotado' }],      // do dia escolhido; [] sem dia
    duracoes: [{ horas, rotulo: '2 horas', ate: '12:00', habilitada: bool }],        // 1..máximo do grupo; [] sem hora
    escolha,  // corrigida: hora/duração que não cabem viram null
    aviso,    // null ou um dos textos abaixo
    resumo,   // 'Terça, 24/11 · das 10:00 às 12:00' quando há data+hora+horas; senão null
  }
  ```
  Regras:
  - **Cabe:** a sessão `(data, hora, k)` cabe quando todas as horas `hora..hora+k-1` existem em `dias[data]`, e o cruzamento dessas horas tem pelo menos `necessarios = instrutoresNecessarios(quantidade, faixas)` pistas e o mesmo número de instrutores. Se há `instrutorId`, ele precisa estar no cruzamento.
  - **Cor da hora:** usa `k = 1`. É `'lotado'` se não cabe ou se `instanteNoFuso(data, hora) − agora < antecedencia_minima_horas`. É `'poucas'` se as vagas são `≤ poucas_vagas`. Senão, `'livre'`.
  - **Duração:** os números vêm de `duracoesPossiveis(data, hora, funcionamento, máximo)`, em que o máximo é `duracao_maxima_individual` ou `duracao_maxima_grupo` (quando `quantidade > 1`). Cada uma tem `habilitada = cabe`.
  - **Dia:** `habilitado` quando alguma hora dele não é `'lotado'`.
  - **Escolha que não cabe mais:** se o dia ficou desabilitado, tudo volta a `null` e o aviso é `'O dia escolhido não tem mais horário livre para este grupo. Escolha outro dia.'`. Se a hora virou `'lotado'`, a hora e a duração voltam a `null`, com o aviso `'O horário escolhido não está mais livre para este grupo. Escolha outro.'`. Se só a duração não cabe, ela volta a `null`, com o aviso `'A duração escolhida não cabe mais neste horário. Escolha outra.'`.
  - **Rótulos:** dia `'Ter 24/11'` (Dom, Seg, Ter, Qua, Qui, Sex, Sáb). Duração `'1 hora'` / `'2 horas'`, com `ate: '12:00'`.

- [ ] **Step 1: Escrever os testes que falham** (dados montados à mão, sem rede; `agora` fixo):
  - `hora com folga é livre, com uma vaga restante é poucas, sem vaga é lotado` (com `poucas_vagas: 1`).
  - `grupo de 6 precisa de 2 pistas e 2 instrutores` → uma hora com 3 pistas e 2 instrutores dá `'poucas'`; com 1 instrutor, `'lotado'`.
  - `sessão de 2 horas com pista diferente livre em cada hora não cabe` → às 10h há só a pista 1 e às 11h só a pista 2, com instrutores sobrando: a duração 2 às 10h fica `habilitada: false`, e a 1, `true`.
  - `instrutor escolhido ocupado deixa a hora lotada; sem preferência fica livre`.
  - `hora a menos da antecedência mínima é lotado, mesmo com vagas`.
  - `duração que passa do fechamento não aparece; acima do máximo individual não aparece para 1 pessoa`.
  - `dia fechado ou sem nenhuma hora livre fica desabilitado`.
  - `escolha que deixou de caber é desfeita com o aviso certo` → os três casos, com os textos exatos acima.
  - `resumo` → `'Terça, 24/11 · das 10:00 às 12:00'` para `{ data: '2026-11-24', hora: 10, horas: 2 }`.
- [ ] **Step 2: Rodar e ver falhar.** `node --test tests/unidade/agenda-regras.test.mjs`. Esperado: FAIL.
- [ ] **Step 3: Implementar `montarAgenda` em `agenda-regras.mjs`** e trocar a cópia de `somarDias` em `agendar-regras.mjs` pela reexportação.
- [ ] **Step 4: Rodar e ver passar.** `npm test`. Esperado: tudo PASS, incluindo os testes antigos de `agendar-regras`.
- [ ] **Step 5: Commit** (pedir autorização). Mensagem: `Cria as regras da agenda visual`.

---

### Task 4: Agenda visual no agendamento novo

**Files:**
- Create: `agenda-tela.mjs`
- Modify: `index.html` (trocar, no `#form-agendar`, os três `label` de dia, hora e duração), `agendar.css`, `agendar.js`

**Interfaces:**
- Consumes: `montarAgenda` (Task 3); a rota de disponibilidade (Task 2).
- Produces, em `agenda-tela.mjs`:
  - `criarAgenda(raiz: HTMLElement, { aoMudar: () => void }) → { desenhar(agenda), escolha(): { data, hora, horas }, mostrarErro(texto | null, aoTentar) }`.
  - `raiz` é um `<div class="agenda" data-agenda>` com `[data-dias]`, `[data-horas]`, `[data-duracoes]`, `[data-resumo]`, `[data-aviso-agenda]` (`role="status"`) e os `span.erro` de `data-erro-para="data|hora|horas"`, que continuam no lugar.
  - Os botões são `<label>` com `<input type="radio" name="data|hora|horas">`. Lotado e desabilitado usam `disabled`. `escolha()` lê `input[name=…]:checked` e devolve números para hora e horas.
  - `desenhar` não perde a escolha (`agenda.escolha`) e não rola a página.
- Produces, em `agendar.js`: `lerPedido()` passa a ler `data`, `hora` e `horas` de `agenda.escolha()`, porque `form.elements.hora.value` falha quando há um só rádio. `limitarDatas`, `atualizarHorarios`, `atualizarDuracoes` e os imports `horariosDoDia` e `duracoesPossiveis` saem do fluxo do agendamento novo.

- [ ] **Step 1: Marcação e estilo.** No `#form-agendar`, o bloco "Dia e horário" ganha a `raiz` da agenda: uma faixa de dias com rolagem horizontal, uma grade de horas, as durações, uma legenda (livre, poucas vagas, lotado), o resumo e o aviso. As cores seguem o tema: verde e amarelo legíveis no fundo escuro, e o lotado em cinza com `text-decoration: line-through`. O `@media (min-width: 900px)` segue as Global Constraints. Botões com pelo menos 44px de altura.
- [ ] **Step 2: Ligar a agenda em `agendar.js`.** `montarFormulario` vira `async`: busca `agendamentos?ver=disponibilidade` e guarda o resultado. Se falhar, chama `mostrarErro('Não foi possível ver os horários livres agora. Verifique a internet e tente de novo.', tentar)` e deixa a agenda vazia. A função `redesenhar()` monta o contexto com `quantidade = cartoes().length` e `instrutorId` do `select`, chama `montarAgenda` e depois `desenhar`. Ela roda em `aoMudar`, em `atualizarGrupo` (no lugar de `atualizarDuracoes`) e no `change` do `instrutor_id`.
- [ ] **Step 3: Recarregar depois de uma recusa por vaga.** No `botao-confirmar`, um 409 sem `dados.preco` (RP001 a RP003, RP006) mostra o erro, como hoje, e busca a disponibilidade de novo. Ao voltar ao formulário, a agenda já está atualizada e a escolha que não cabe mais foi desfeita, com o aviso.
- [ ] **Step 4: Teste de tela (Playwright + Edge headless, roteiro no scratchpad, servidor estático dentro do próprio roteiro, conta de cliente criada e apagada pelo roteiro), em 390×844 e em 1280×800:**
  - a faixa mostra `antecedencia_maxima_dias + 1` dias, e os dias fechados estão desabilitados;
  - com um agendamento de teste que ocupa todos os instrutores numa hora, essa hora aparece riscada e não pode ser marcada;
  - escolher dia, hora verde e 2 horas mostra o resumo certo, e "Revisar" e "Confirmar" criam o agendamento;
  - adicionar participantes até a hora escolhida deixar de caber desfaz a escolha e mostra o aviso;
  - com a rota de disponibilidade bloqueada (`page.route` devolvendo 500), aparece a mensagem com "Tentar de novo", e o botão funciona quando a rota é liberada;
  - em 1280px, a agenda fica em duas colunas; em 390px, numa coluna, sem rolagem horizontal da página (só na faixa de dias).
  
  O roteiro apaga tudo o que criou. Mostrar ao dono as capturas de tela dos dois tamanhos.
- [ ] **Step 5: `npm test`.** Esperado: PASS.
- [ ] **Step 6: Commit** (pedir autorização). Mensagem: `Troca a escolha de dia e horário pela agenda visual no agendamento novo`.

---

### Task 5: Agenda visual no "Alterar horário" e a prévia do valor

**Files:**
- Modify: `index.html` (`#form-alterar` e `#alterar-valor`), `agendar.js`

**Interfaces:**
- Consumes: `criarAgenda` (Task 4), `montarAgenda` (Task 3), a rota com `&agendamento=<id>` (Task 2).

- [ ] **Step 1: Marcação.** O `#form-alterar` ganha a mesma `raiz` de agenda do Step 1 da Task 4, e `#alterar-valor` ganha `role="status"`.
- [ ] **Step 2: Ligar.** `abrirAlterar(a)` vira `async`: busca `ver=disponibilidade&agendamento=${a.id}`, monta o contexto com `quantidade = disponibilidade.agendamento.participantes` e `instrutorId = disponibilidade.agendamento.instrutor_escolhido_id`, e começa com a escolha `{ data, hora, horas }` do horário atual (que aparece livre, porque é ignorado). `lerNovoHorario()` passa a ler de `escolha()`. Um 409 de vaga no salvar busca a disponibilidade de novo e redesenha.
- [ ] **Step 3: O preço do servidor prevalece.** Guardar `precoDoServidor = { chave: 'data|hora|horas', preco }` quando o PUT devolve 409 com `dados.preco`. `atualizarValorAlterar()` usa esse preço enquanto a escolha atual tiver a mesma chave, e só recalcula localmente quando o horário muda. Abrir o Alterar de novo zera o preço guardado.
- [ ] **Step 4: Teste de tela (390px e 1280px):**
  - abrir o Alterar de um agendamento de teste mostra o horário atual marcado e verde;
  - escolher outra hora e salvar muda o agendamento;
  - com o preço do modelo trocado no banco depois de abrir a tela, salvar mostra "O preço mudou…" e o valor do servidor; marcar o mesmo horário de novo não troca esse valor pela estimativa; salvar de novo dá certo.
  
  O roteiro restaura o preço e apaga o que criou.
- [ ] **Step 5: `npm test`.** Esperado: PASS.
- [ ] **Step 6: Commit** (pedir autorização). Mensagem: `Usa a agenda visual no Alterar horário e mantém o preço do servidor na prévia`.

---

### Task 6: Pendências do cálculo de preço e do dinheiro

**Files:**
- Modify: `supabase/functions/_shared/precos.mjs`
- Test: `tests/unidade/precos.test.mjs`

**Interfaces:**
- Produces: `economiaDoPacote` (interna) com a regra nova; `centavosDoTexto` e `formatarReais` com as correções abaixo; `conferirItensDoPacote(valores, { modelo, tipoMunicao }) → campos` (objeto vazio quando está tudo certo), em que `modelo = { preco_hora_centavos, calibre_id } | null` e `tipoMunicao = { preco_unidade_centavos, calibre_id } | null`. A Task 7 usa essa função.

- [ ] **Step 1: Escrever os testes que falham:**
  - `pacote com arma e munição só vale quando o mesmo participante tem as duas` → participante 1 com o modelo do pacote e outra munição, participante 2 com outra arma e a munição do pacote: sem desconto do pacote. Com as duas no mesmo participante: com desconto.
  - `centavosDoTexto aceita ponto como separador decimal` → `'120.50'` → `12050`; `'120.5'` → `12050`; `'1.234'` → `123400` (milhar); `'1.234,56'` → `123456`; `'1.234.56'` → `null`; `'12.345.678'` → `1234567800`.
  - `formatarReais com valor negativo` → `formatarReais(-150) === '-R$ 1,50'`; `formatarReais(-123456) === '-R$ 1.234,56'`; `formatarReais(0) === 'R$ 0,00'`.
  - `conferirItensDoPacote` →
    - modelo com `preco_hora_centavos: null`: `{ modelo_id: 'Este modelo está sem preço. Defina o preço na aba Preços antes de usá-lo num pacote.' }`;
    - munição sem preço: `{ tipo_municao_id: 'Esta munição está sem preço. Defina o preço na aba Preços antes de usá-la num pacote.' }`;
    - calibres diferentes: `{ tipo_municao_id: 'Esta munição não é do calibre do modelo escolhido.' }`;
    - tudo certo: `{}`.
- [ ] **Step 2: Rodar e ver falhar.** `node --test tests/unidade/precos.test.mjs`. Esperado: FAIL nos testes novos.
- [ ] **Step 3: Implementar.** No pacote, quando há `modelo_id` e `tipo_municao_id`, procurar um único participante com `modalidade === 'estande'`, o modelo, a munição e `municao_qtd >= pacote.municao_qtd`. No texto de dinheiro, um ponto seguido de exatamente 3 dígitos é milhar, e um ponto final seguido de 1 ou 2 dígitos, sem vírgula, é o separador dos centavos.
- [ ] **Step 4: Rodar e ver passar.** `npm test`. Esperado: PASS.
- [ ] **Step 5: Publicar** `agendamentos` e `precos`, que usam o módulo (`functions deploy … --use-api`), e rodar `tests/integracao/agendamentos-funcao.test.mjs`. Esperado: PASS.
- [ ] **Step 6: Commit** (pedir autorização). Mensagem: `Pacote vale só no mesmo participante e corrige os valores com ponto e negativos`.

---

### Task 7: Pendências da aba Promoções

**Files:**
- Modify: `supabase/functions/precos/index.js`
- Test: `tests/integracao/precos-funcao.test.mjs`

**Interfaces:**
- Consumes: `conferirItensDoPacote` (Task 6).

- [ ] **Step 1: Escrever os testes que falham:**
  - `pacote com modelo sem preço recebe 400 com a mensagem no campo modelo_id`, e o mesmo ao editar um pacote existente para esse modelo.
  - `pacote com munição de outro calibre recebe 400 no campo tipo_municao_id`.
  - `criar classe com o nome de uma classe desativada recebe 409 sugerindo reativar` → `campos.nome === 'Já existe uma classe desativada com este nome. Reative-a na lista em vez de criar outra.'`. Com uma classe ativa de mesmo nome, a mensagem continua `'Já existe uma classe com este nome.'`.
- [ ] **Step 2: Rodar e ver falhar.** `node --env-file=.env.teste --test tests/integracao/precos-funcao.test.mjs`. Esperado: FAIL nos novos.
- [ ] **Step 3: Implementar.** Em `salvar`, para `tipo === 'pacote'`, depois da validação, ler o modelo e a munição da linha final (a guardada + o que veio, como em `conferirLinhaFinal`) e chamar `conferirItensDoPacote`. Se houver campos, devolver 400 `{ erro: REVISE, campos }`. No `23505` de classe, procurar a classe pelo `nome` exato (o índice único é sobre `nome`) e escolher a mensagem pelo `ativo`. A aba Promoções já mostra `campos` nos campos, então o front não muda. Conferir isso no teste de tela do Step 5.
- [ ] **Step 4: Publicar** `precos` e rodar o teste do Step 1. Esperado: PASS.
- [ ] **Step 5: Teste de tela curto em `admin.html`, aba Promoções:** um pacote com modelo sem preço mostra a mensagem embaixo do campo.
- [ ] **Step 6: Commit** (pedir autorização). Mensagem: `Promoções recusam pacote com item sem preço ou calibre errado e sugerem reativar a classe`.

---

### Task 8: Publicação na Vercel

**Files:**
- Create: `.vercelignore`
- Modify: `README.md`

- [ ] **Step 1: Arquivos de publicação.**
  - `.vercelignore` exclui `tests/`, `docs/`, `.superpowers/`, `.serena/`, `.env*` e tudo de `supabase/`, **menos** `supabase/functions/_shared/`, porque o navegador importa os módulos de lá (`agendamento.mjs`, `cadastro.mjs`, `precos.mjs` e outros). A sintaxe é a do `.gitignore`, em que uma pasta excluída não pode ser reincluída. Por isso, a exclusão é feita nível por nível: `/supabase/*`, `!/supabase/functions`, `/supabase/functions/*`, `!/supabase/functions/_shared`. Conferir com `grep -h "from './supabase" *.js *.mjs` quais módulos o front importa.
  - Sem `vercel.json`: o `package.json` não tem script `build`, então a Vercel serve os arquivos como estão. Só criar um `vercel.json` se a conferência do Step 6 mostrar que é preciso.
- [ ] **Step 2: README.** Uma seção "Site publicado (Vercel)" com o endereço, o fato de que ele usa o banco de testes, que cada envio do `nova-arquitetura` ao GitHub atualiza o site, o passo do Site URL e o aviso: "o banco de testes pausa sozinho depois de cerca de uma semana sem uso (plano grátis). Para voltar: painel do Supabase → o projeto → *Restore*".
- [ ] **Step 3: Commit** (pedir autorização). Mensagem: `Prepara a publicação na Vercel`.
- [ ] **Step 4: Envio ao GitHub** (pedir autorização explícita: `git push origin nova-arquitetura`).
- [ ] **Step 5: Passos do dono, guiados em linguagem simples, um de cada vez:**
  1. Criar a conta grátis em vercel.com com "Continue with GitHub".
  2. *Add New → Project* → importar `rangepass` → *Framework Preset: Other*, sem build → *Deploy*.
  3. Em *Settings → Git*, *Production Branch* = `nova-arquitetura`.
  4. Informar o endereço gerado (`https://<nome>.vercel.app`).
  5. No Supabase: *Authentication → URL Configuration*. *Site URL* = `https://<nome>.vercel.app/conta.html`; em *Redirect URLs*, adicionar `http://localhost:5500/conta.html` e `https://<nome>.vercel.app/conta.html`.
- [ ] **Step 6: Conferência no site publicado** (o construtor faz com Playwright e mostra as capturas):
  - `index.html`, `conta.html` e `admin.html` abrem sem erro no console;
  - `https://<nome>.vercel.app/.env.teste`, `/tests/` e `/supabase/migrations/` dão 404;
  - criar uma conta de teste, confirmar pelo link do e-mail (que deve levar ao endereço da Vercel), agendar pela agenda visual e cancelar. No fim, apagar a conta de teste.
- [ ] **Step 7: Completar o README** com o endereço real. Commit (pedir autorização) e envio (pedir autorização). Mensagem: `Anota o endereço do site publicado`.
