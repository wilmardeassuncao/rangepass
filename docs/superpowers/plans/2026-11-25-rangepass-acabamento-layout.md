# RangePass, plano 7: acabamento do layout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao site o layout B (menu lateral fixo + conteúdo largo no computador, ☰ no celular) com uma moldura comum às três páginas, trocar "Revisar agendamento" por "Concluir agendamento", e resolver as 5 pendências do plano 6 e o favicon.

**Architecture:** Um estilo base (`base.css`) com cores, componentes comuns, menu e regras de largura, usado por `index.html`, `conta.html` e `admin.html`; um módulo puro (`menu-regras.mjs`, testável no Node) decide os itens do menu pelos papéis; um módulo de tela (`moldura.mjs`) desenha o menu e cuida do ☰. As abas de `admin.html` viram itens do menu, endereçados por `#<aba>`. As pendências mexem na rota de disponibilidade, em `agenda-regras.mjs`, em `agendar.js` e em `precos/index.js`.

**Tech Stack:** HTML, CSS e JavaScript puro (módulos ES), sem build; Supabase Edge Functions (Deno); testes com `node:test`; testes de tela com Playwright (roteiros fora do repositório).

**Spec:** `docs/superpowers/specs/2026-11-25-rangepass-acabamento-layout-design.md` (aprovada em cf10f5e). Onde ela não fala, valem a do plano 6 e a principal.

## Global Constraints

Valem todas as dos planos 1 a 6:
- **PowerShell 5.1** e **português do Brasil**, com mensagens que dizem o que aconteceu e o que fazer.
- **Perguntar antes de cada commit.** Nunca push nem merge sem pedido. **Cada envio do `nova-arquitetura` ao GitHub atualiza o site da Vercel.** **Parar no fim de cada tarefa.**
- **Os testes limpam o que criam** e restauram o que alteram. **O construtor roda os testes, inclusive os de tela, e mostra os resultados.**
- **A conta real do dono (`wilmar.assuncao@gmail.com`, superadmin) e os 2 instrutores de exemplo nunca são tocados pelos testes.** Nos roteiros de tela, o agendamento escolhe sempre o **instrutor de teste do próprio roteiro**, nunca "Sem preferência".
- **Migrações aplicadas nunca são editadas.** Este plano não prevê migração.
- **Dinheiro em centavos inteiros.**
- **Sem framework e sem build:** a Vercel serve os arquivos como estão. Todo arquivo novo do navegador fica na raiz do projeto (o `.vercelignore` publica a raiz e `supabase/functions/_shared/`).

Novas neste plano:
- **Identidade visual não muda:** fundo escuro, laranja da marca (`--cor-marca: #e65100`, `--cor-marca-clara: #ff9a5c`), fonte Roboto, cartões com borda arredondada.
- **Ponto de troca celular/computador: `900px`** (`@media (min-width: 900px)` é o computador), salvo se a agenda ficar apertada (spec 11.5).
- **Computador:** menu lateral fixo à esquerda; conteúdo com margem à direita parecida com a largura do menu; largura máxima com centralização em telas muito largas.
- **Celular:** barra no topo com a marca e o botão ☰; menu abre por cima e fecha com item, ☰/fechar e **Esc**; página de trás não rola com o menu aberto; **a página nunca rola para o lado**; botões com **pelo menos 44px** de altura.
- **Acessibilidade do menu:** `<nav aria-label="Menu principal">`, item atual com `aria-current="page"`, ☰ com texto para leitor de tela e `aria-expanded`, foco vai ao menu ao abrir e volta ao ☰ ao fechar.
- **Menu mostra só o que a pessoa pode usar** (regras na Task 1).

## Review Focus

1. **Links de e-mail com `#` na `conta.html`** (confirmação e nova senha) continuam funcionando com o menu presente. Teste de tela na Task 2.
2. **Endereço de uma parte proibida** (`admin.html#precos` para quem só é `administrativo`): abre a primeira parte permitida, sem erro. Teste de tela na Task 4.
3. **Largura intermediária (900–1100px)**: a página não rola para o lado; só a faixa de dias rola. Teste de tela na Task 3 (largura 960px).
4. **Menu aberto no celular e tecla Esc / clique num item**: fecha e devolve o foco ao ☰; a página de trás não rola. Teste de tela na Task 2.
5. **Pessoa só com papéis sem área** (por exemplo, só `instrutor`): vê só "Meu perfil" e "Sair". Teste de unidade na Task 1 e de tela na Task 4.

---

## Estrutura de arquivos

```
menu-regras.mjs                         puro: itens do menu por papéis, item ativo, endereço → parte
moldura.mjs                             DOM: desenha o menu (lateral e ☰), Sair, foco e Esc
base.css                                cores, fonte, componentes comuns, menu, larguras, celular
favicon.svg                             ícone da aba ("R" laranja em fundo escuro)
conta.html, conta.css, conta.js         (alterar) base.css; perfil com moldura; cartões centralizados; erro com Sair
index.html, agendar.css, agendar.js     (alterar) base.css; moldura; grade no computador; "Concluir agendamento"; #novo
admin.html, admin.css, admin.js         (alterar) base.css; moldura; abas viram menu; #<aba> com recuo
agenda-regras.mjs                       (alterar) contexto aceita `necessarios`
supabase/functions/agendamentos/index.js (alterar) disponibilidade devolve agendamento.instrutores
supabase/functions/precos/index.js      (alterar) mensagem de classe no PUT
tests/unidade/menu-regras.test.mjs      novo
tests/unidade/agenda-regras.test.mjs    (alterar) contexto do Alterar
tests/integracao/disponibilidade-funcao.test.mjs (alterar) agendamento.instrutores
tests/integracao/precos-funcao.test.mjs (alterar) renomear classe; pacote com item sem preço
```

---

### Task 1: Regras do menu

**Files:**
- Create: `menu-regras.mjs`
- Test: `tests/unidade/menu-regras.test.mjs`

**Interfaces:**
- Consumes: `temAlgumPapel(papeis, exigidos)` de `supabase/functions/_shared/papeis.mjs`; `ABAS` e `abasVisiveis(papeis)` de `admin-regras.mjs`.
- Produces:
  - `GRUPOS_EQUIPE`: `[{ titulo: 'Operação', abas: ['agendamentos'] }, { titulo: 'Cadastros', abas: ['catalogo', 'pistas', 'equipe'] }, { titulo: 'Vendas', abas: ['precos', 'promocoes'] }, { titulo: 'Sistema', abas: ['configuracoes'] }]`.
  - `ROTULO_ABA`: `{ agendamentos: 'Agendamentos', catalogo: 'Catálogo', pistas: 'Pistas', equipe: 'Equipe', precos: 'Preços', promocoes: 'Promoções', configuracoes: 'Configurações' }`.
  - `menuDe(papeis) → Array<{ titulo: string|null, itens: Array<{ id: string, texto: string, href: string }> }>`: os grupos na ordem em que aparecem. Primeiro um grupo `titulo: null` com `{ id: 'agendamentos-cliente', texto: 'Meus agendamentos', href: 'index.html' }` e `{ id: 'novo', texto: 'Novo agendamento', href: 'index.html#novo' }` só quando `temAlgumPapel(papeis, ['cliente'])`, e sempre `{ id: 'perfil', texto: 'Meu perfil', href: 'conta.html' }`. Depois os grupos de `GRUPOS_EQUIPE` com os itens `{ id: 'equipe-<aba>', texto: ROTULO_ABA[aba], href: 'admin.html#<aba>' }` das abas em `abasVisiveis(papeis)`; grupo sem itens não aparece. "Sair" não entra aqui (é um botão da moldura).
  - `parteDoEndereco(hash, permitidas) → string|null`: `'#precos'` com `'precos'` permitida → `'precos'`; parte não permitida, vazia ou desconhecida → `permitidas[0] ?? null`.

- [ ] **Step 1: Escrever os testes que falham** (`tests/unidade/menu-regras.test.mjs`):
  - `cliente vê Meus agendamentos, Novo agendamento e Meu perfil, sem itens da equipe` → `menuDe(['cliente'])` é exatamente um grupo `titulo: null` com os 3 itens acima, nessa ordem.
  - `superadmin vê a própria área e os 4 grupos da equipe` → `menuDe(['superadmin']).map((g) => g.titulo)` é `[null, 'Operação', 'Cadastros', 'Vendas', 'Sistema']`; o item `equipe-precos` tem `href: 'admin.html#precos'` e `texto: 'Preços'`.
  - `administrativo vê só Operação` → `menuDe(['administrativo'])`: grupo `null` só com `perfil`, e `Operação` com `equipe-agendamentos`.
  - `instrutor sem cliente vê só Meu perfil` → `menuDe(['instrutor'])` é `[{ titulo: null, itens: [perfil] }]` (mesmo para `atendente` e `almoxarifado`).
  - `todo id de aba tem grupo e rótulo` → para cada `ABAS[i].id`, ele aparece em exatamente um `GRUPOS_EQUIPE[].abas` e em `ROTULO_ABA`.
  - `parteDoEndereco` → `('#precos', ['precos', 'catalogo'])` dá `'precos'`; `('#precos', ['agendamentos'])` dá `'agendamentos'`; `('', ['catalogo'])` dá `'catalogo'`; `('#xyz', [])` dá `null`.
- [ ] **Step 2: Rodar e ver falhar.** `node --test tests/unidade/menu-regras.test.mjs`. Esperado: FAIL (módulo não existe).
- [ ] **Step 3: Implementar `menu-regras.mjs`** com as exportações acima.
- [ ] **Step 4: Rodar e ver passar.** `npm test`. Esperado: PASS.
- [ ] **Step 5: Commit** (pedir autorização). Mensagem: `Cria as regras do menu lateral`.

---

### Task 2: Moldura comum, base.css, favicon e a página da conta

**Files:**
- Create: `base.css`, `moldura.mjs`, `favicon.svg`
- Modify: `conta.html`, `conta.css`, `conta.js`

**Interfaces:**
- Consumes: `menuDe(papeis)` (Task 1); `supabase` de `api.mjs`.
- Produces:
  - `base.css`: as variáveis de cor e medida que hoje se repetem nos 3 CSS (de `:root` de `conta.css`), fonte, `.botao`, `.botao.secundario`, `.link`, `.aviso`, `.bloco`, `.campo`, `.erro`, `.tela`/`.tela.ativa`, e as classes da moldura: `body.com-moldura`, `.moldura-menu`, `.moldura-barra` (celular), `.moldura-conteudo` (área do conteúdo, com a margem direita e a largura máxima), `body.sem-moldura .moldura-cartao` (cartão centralizado das telas de antes de entrar).
  - `moldura.mjs`: `montarMoldura({ papeis, ativo }) → { marcarAtivo(id: string): void }`. Insere no `<body>` o menu (lateral no computador; barra com ☰ e painel no celular), com os grupos de `menuDe(papeis)` e um botão **Sair** (`supabase.auth.signOut()` e `location.replace('conta.html')`). `ativo` é um id de item de `menuDe` (por exemplo `'perfil'`). Põe `body.classList` `com-moldura`. O conteúdo da página fica dentro de `<main class="moldura-conteudo">`, já presente no HTML.
  - `favicon.svg` ligado nas três páginas com `<link rel="icon" href="favicon.svg" type="image/svg+xml">`.

- [ ] **Step 1: `base.css`.** Tirar de `conta.css` o que é comum (lista acima) e mover para `base.css`; `conta.css` fica só com o que é da conta. Medidas do menu, margem e largura máxima são escolha do construtor (spec 10), seguindo a spec 5.1.
- [ ] **Step 2: `moldura.mjs`** com a interface acima e o comportamento das Global Constraints (☰, Esc, foco, rolagem travada, `aria-current`, `aria-expanded`).
- [ ] **Step 3: `conta.html`/`conta.js`.**
  - Ligar `base.css` antes de `conta.css` e o favicon.
  - Telas de antes de entrar (Entrar, Criar conta, E-mail enviado, Esqueci a senha, Nova senha) e a de carregando: `body.sem-moldura`, cartão centralizado com a marca, sem menu.
  - Tela Meu perfil: depois do `GET minha-conta` que `abrirPerfil` já faz, chamar `montarMoldura({ papeis: r.dados.papeis ?? [], ativo: 'perfil' })`. Os botões "Meus agendamentos" e "Área da equipe" no fim do perfil saem (viraram o menu).
  - O `#` da `conta.html` continua sendo só dos links de e-mail; o menu nunca usa `#` na `conta.html` (spec 11.1).
- [ ] **Step 4: Favicon** nas três páginas.
- [ ] **Step 5: `npm test`.** Esperado: PASS.
- [ ] **Step 6: Teste de tela** (roteiro novo `p7-tarefa2.mjs`, servidor local, 390px e 1280px):
  - Entrar mostra o cartão centralizado, sem menu; o console não tem erro (nem o 404 do favicon).
  - Cliente de teste entra e vê o perfil com o menu: "Meus agendamentos", "Novo agendamento", "Meu perfil" (atual, `aria-current="page"`), "Sair"; sem itens da equipe.
  - 1280px: menu à esquerda, conteúdo sem faixa estreita no meio, margem à direita; a página não rola para o lado.
  - 390px: barra com ☰; abrir o menu, apertar **Esc** fecha e o foco volta ao ☰; abrir e clicar num item fecha e navega; com o menu aberto a página de trás não rola; a página não rola para o lado.
  - Nova senha por link com `#` (gerado com `generate_link` de tipo `recovery` para o usuário de teste) abre a tela Nova senha, como hoje.
  - "Sair" volta para Entrar.
- [ ] **Step 7: Commit** (pedir autorização). Mensagem: `Cria a moldura comum com menu lateral e aplica na página da conta`.

---

### Task 3: Moldura e grade na página do cliente; "Concluir agendamento"

**Files:**
- Modify: `index.html`, `agendar.css`, `agendar.js`

**Interfaces:**
- Consumes: `montarMoldura` (Task 2), `base.css`; `GET minha-conta` (papéis).

- [ ] **Step 1: Ligar a moldura.** `base.css` antes de `agendar.css`; o que for comum sai de `agendar.css`. Ao iniciar, ler os papéis com `GET minha-conta` (junto com o que a página já busca) e chamar `montarMoldura({ papeis, ativo })` com `ativo = 'novo'` na tela Novo agendamento e `'agendamentos-cliente'` nas demais (`marcarAtivo` ao trocar de tela). Se essa leitura falhar, a tela de erro mostra **"Tentar de novo"** e **"Sair"** (spec 11.6). A barra de topo antiga (`.topo` com "Meu perfil") sai.
- [ ] **Step 2: Endereço `index.html#novo`** abre direto a tela Novo agendamento (o mesmo que o botão "Novo agendamento"); voltar para a lista limpa o `#`. O botão "Novo agendamento" da lista continua.
- [ ] **Step 3: Grade no computador.** No `@media (min-width: 900px)`, os blocos do formulário se arrumam em grade (Dia e horário ao lado de Duração; Participantes ao lado de Instrutor, como no mockup da spec 5.1); a regra especial de 960px do plano 6 sai, e a agenda usa a largura do conteúdo. Lista, resumo, sucesso e Alterar usam a largura do conteúdo.
- [ ] **Step 4: Textos.** O botão `type="submit"` do `#form-agendar` passa de `Revisar agendamento` para **`Concluir agendamento`**. O subtítulo da tela de resumo passa de `Confira os dados antes de confirmar.` para **`Falta só confirmar: confira os dados e clique em Confirmar agendamento.`**
- [ ] **Step 5: `npm test`.** Esperado: PASS.
- [ ] **Step 6: Teste de tela** (roteiro `p7-tarefa3.mjs`, servidor local, 390px, **960px** e 1280px; catálogo, pistas, preços e instrutor de teste criados pelo roteiro, como em `p6-tarefa5.mjs`):
  - Lista com o menu ("Meus agendamentos" atual); `index.html#novo` abre Novo agendamento com "Novo agendamento" atual no menu.
  - 1280px: blocos em grade, sem faixa estreita; 960px e 390px: a página não rola para o lado (só a faixa de dias rola).
  - Agendar escolhendo o **instrutor de teste**: o botão diz "Concluir agendamento"; o resumo mostra o subtítulo novo; "Confirmar agendamento" cria; Alterar horário e cancelar continuam funcionando.
  - Sem erros no console. Limpeza: nada criado sobra.
- [ ] **Step 7: Commit** (pedir autorização). Mensagem: `Aplica a moldura na página do cliente e troca Revisar por Concluir agendamento`.

---

### Task 4: Moldura na página da equipe; abas viram o menu

**Files:**
- Modify: `admin.html`, `admin.css`, `admin.js`

**Interfaces:**
- Consumes: `montarMoldura` (Task 2); `menuDe`, `parteDoEndereco` (Task 1); `abasVisiveis` (existente).

- [ ] **Step 1: Ligar a moldura.** `base.css` antes de `admin.css`; comum sai de `admin.css`. Depois do `GET minha-conta` que a página já faz, `montarMoldura({ papeis, ativo: 'equipe-<parte>' })`. Saem a barra de topo antiga (`.topo`, `#topo-conta`, `#botao-sair`) e a fileira de abas `#abas` (os botões `[data-aba]`). Se a leitura de `minha-conta` falhar, a tela de erro mostra "Tentar de novo" e "Sair" (spec 11.6).
- [ ] **Step 2: Endereço manda.** A parte aberta é `parteDoEndereco(location.hash, abasVisiveis(papeis))`; abrir uma parte = o que `escolherAba(id)` faz hoje. Ao trocar o `#` (clique no menu, "voltar" do navegador), a página abre a parte nova e chama `marcarAtivo('equipe-<parte>')`. Parte proibida ou desconhecida abre a primeira permitida, sem mensagem; sem nenhuma permitida, a tela "sem acesso" de hoje. Os `role="tab"`/`tabpanel` viram seções comuns, com o título de cada parte como `h1`.
- [ ] **Step 3: Largura.** Tabelas e listas da equipe usam a largura do conteúdo; formulários longos podem ficar em duas colunas no computador (escolha do construtor).
- [ ] **Step 4: `npm test`.** Esperado: PASS (ajustar testes que dependiam de `#abas`, se houver).
- [ ] **Step 5: Teste de tela** (roteiro `p7-tarefa4.mjs`, 390px e 1280px; usuários de teste criados pelo roteiro):
  - superadmin de teste: o menu mostra os grupos Operação, Cadastros, Vendas e Sistema e "Meus agendamentos"/"Novo agendamento"; cada item da equipe abre a parte certa e fica com `aria-current="page"`; o "voltar" do navegador volta à parte anterior.
  - `administrativo` de teste: só "Agendamentos" na equipe; `admin.html#precos` abre Agendamentos, sem erro.
  - `instrutor` de teste (sem cliente): o menu tem só "Meu perfil" e "Sair"; `admin.html` mostra "sem acesso".
  - 390px: ☰ abre o menu com os grupos; a página não rola para o lado. Sem erros no console. Limpeza.
- [ ] **Step 6: Commit** (pedir autorização). Mensagem: `Aplica a moldura na página da equipe e troca as abas pelo menu`.

---

### Task 5: Pendências do Alterar horário

**Files:**
- Modify: `supabase/functions/agendamentos/index.js` (função `disponibilidade`), `agenda-regras.mjs` (`montarAgenda`), `agendar.js` (`redesenharAlterar`, `abrirAlterar`)
- Test: `tests/integracao/disponibilidade-funcao.test.mjs`, `tests/unidade/agenda-regras.test.mjs`

**Interfaces:**
- Produces:
  - Na resposta de `GET agendamentos?ver=disponibilidade&agendamento=<id>`, `agendamento` ganha **`instrutores: number`** = quantas linhas de `agendamento_instrutores` com `agendamento_id = id` e `ativo = true`. Se der 0, a rota usa `instrutoresNecessarios(participantes, faixas_instrutores)` (spec 11.4).
  - `montarAgenda(contexto, escolha)`: `contexto` aceita **`necessarios?: number`**; quando presente, substitui `instrutoresNecessarios(quantidade, agenda.faixas_instrutores)`. A duração máxima continua vindo de `quantidade`.
  - Aviso do instrutor que não atende mais: **`O instrutor escolhido não atende mais. Cancele este agendamento e faça um novo.`**

- [ ] **Step 1: Testes que falham.**
  - Integração (`disponibilidade-funcao.test.mjs`): `com agendamento=<id>, a resposta traz instrutores igual às reservas de instrutor ativas do agendamento` → para um agendamento de teste de 1 participante, `r.dados.agendamento.instrutores === 1`.
  - Unidade (`agenda-regras.test.mjs`):
    - `necessarios do contexto prevalece sobre as faixas` → com faixas que dariam 1 instrutor para 3 pessoas, `necessarios: 2` e uma hora com 1 pista e 1 instrutor livres: a hora sai `lotado`; sem `necessarios`, sai `livre` ou `poucas`.
    - `contexto do Alterar: o horário atual vem marcado e livre` → disponibilidade em que o horário atual tem as pistas e o instrutor do próprio agendamento livres (como a rota devolve com `p_ignorar`), `quantidade` e `instrutorId` do agendamento e `escolha = { data, hora, horas }` atual: a escolha volta marcada e a hora tem cor `livre` ou `poucas`.
- [ ] **Step 2: Rodar e ver falhar.** `npm test` e `node --env-file=.env.teste --test --test-concurrency=1 tests/integracao/disponibilidade-funcao.test.mjs`. Esperado: FAIL nos novos.
- [ ] **Step 3: Implementar** a rota, `necessarios` em `montarAgenda`, e em `redesenharAlterar` passar `necessarios: agendamento.instrutores`.
- [ ] **Step 4: Instrutor que não atende mais.** Em `abrirAlterar`, se `agendamento.instrutor_escolhido_id` não é nulo e não está entre os instrutores de `opcoes` (a lista do select de instrutor), mostrar o aviso acima no lugar da agenda e desabilitar "Salvar novo horário".
- [ ] **Step 5: Publicar** `agendamentos` (`npx.cmd --yes supabase@2.20.12 functions deploy agendamentos --use-api`) e rodar `npm test` e os testes de integração `disponibilidade-funcao` e `agendamentos-funcao`. Esperado: PASS.
- [ ] **Step 6: Teste de tela curto** (`p7-tarefa5.mjs`): com `page.route` devolvendo `opcoes` sem o instrutor do agendamento, o Alterar mostra o aviso e "Salvar novo horário" fica desabilitado. Limpeza.
- [ ] **Step 7: Commit** (pedir autorização). Mensagem: `Alterar horário usa as reservas gravadas e avisa quando o instrutor não atende mais`.

---

### Task 6: Pendências das Promoções

**Files:**
- Modify: `supabase/functions/precos/index.js` (`erroDoBanco`)
- Test: `tests/integracao/precos-funcao.test.mjs`

**Interfaces:**
- Produces: no 23505 de classe com a classe de mesmo nome desativada, a mensagem em `campos.nome` é **`Já existe uma classe desativada com este nome. Reative-a na lista ou escolha outro nome.`** no **PUT**, e continua **`Já existe uma classe desativada com este nome. Reative-a na lista em vez de criar outra.`** no **POST**. Com a classe ativa, continua `Já existe uma classe com este nome.`

- [ ] **Step 1: Testes que falham.**
  - `renomear classe para o nome de uma desativada sugere reativar ou escolher outro nome` → PUT 409 com a mensagem do PUT acima.
  - `salvar pacote cujo modelo perdeu o preço, mudando só o nome ou o ativo, dá certo` → criar pacote com modelo e munição com preço; tirar o preço do modelo (restaurar no fim); PUT só com `nome` → 200; PUT só com `ativo: false` → 200.
- [ ] **Step 2: Rodar e ver falhar.** `node --env-file=.env.teste --test --test-concurrency=1 tests/integracao/precos-funcao.test.mjs`. Esperado: FAIL no primeiro (o segundo pode já passar: ele trava o comportamento atual).
- [ ] **Step 3: Implementar.** `erroDoBanco` recebe se é criação ou edição (o chamador já sabe) e escolhe a mensagem.
- [ ] **Step 4: Publicar** `precos` e rodar `npm test` e `precos-funcao`. Esperado: PASS.
- [ ] **Step 5: Commit** (pedir autorização). Mensagem: `Ajusta a mensagem de classe ao renomear e trava o pacote com item sem preço`.

---

### Task 7: Conferência no site publicado

**Files:** nenhum no repositório (roteiro fora dele).

- [ ] **Step 1: Envio ao GitHub** (pedir autorização explícita: `git push origin nova-arquitetura`). A Vercel republica sozinha.
- [ ] **Step 2: Conferir que o site publicado tem a versão nova** (comparar `moldura.mjs` e `menu-regras.mjs` publicados com os locais).
- [ ] **Step 3: Roteiro de tela no site publicado** (`p7-final.mjs`, BASE `https://rangepass.vercel.app`, 390px e 1280px): os passos principais das Tasks 2, 3 e 4 (cartão de Entrar; menu do cliente; agendar com o instrutor de teste, Concluir → Confirmar; cancelar; menu do superadmin de teste com os grupos; ☰ e Esc no celular); `favicon.svg` dá 200; nenhum erro no console. Capturas mostradas ao dono. Limpeza e conferência do banco (0 usuários `@rangepass.test`).
- [ ] **Step 4:** se algo falhar só no site publicado (arquivo novo fora da publicação, por exemplo), corrigir, pedir autorização de commit e de envio, e repetir o Step 3.
