# RangePass, plano 7: acabamento (layout profissional e responsivo)

Este documento detalha um plano de acabamento entre a etapa 7 (publicação) e a etapa 8 (operação do estande) da spec principal (`2026-11-11-rangepass-supabase-design.md`). Onde ele não fala, valem a spec principal e a do plano 6 (`2026-11-23-rangepass-agenda-deploy-design.md`).

## 1. Por que

O site está no ar (https://rangepass.vercel.app), mas no computador **tudo fica estreito e parece tela de celular**: as páginas têm uma faixa de 480px no meio da tela. O dono quer uma **tela ampla, com cara profissional e bonita**, que caiba bem **no computador e no celular**.

Além disso, no primeiro teste o dono **não achou como salvar o agendamento**: o formulário só tinha "Revisar agendamento" e "Voltar", e não ficou claro que "Revisar" era o caminho para salvar.

Fazer isto **antes** da etapa 8 é decisão do dono: o site publicado fica apresentável, e as telas novas da operação do estande já nascem no formato certo.

## 2. Objetivos

1. **Layout B** (escolhido pelo dono no navegador, com mockups): **menu lateral fixo à esquerda** e conteúdo largo, em todas as páginas de quem já entrou (cliente e equipe).
2. **Responsivo:** no celular, o menu vira um botão **☰** no topo e o conteúdo fica numa coluna.
3. **Botão "Concluir agendamento"** no lugar de "Revisar agendamento".
4. As **5 pendências** da revisão final do plano 6 e o **favicon** (seção 7).

## 3. Fora do escopo e o que seria um fracasso

- **Fora:** mudar regras de agendamento, preço ou permissões; telas novas (as da operação do estande são da etapa 8); trocar cores, fonte ou logotipo (a identidade atual continua: fundo escuro, laranja da marca, Roboto); juntar tudo numa página só.
- **Fora:** um botão para criar o agendamento direto, sem passar pelo resumo. O dono pediu isso primeiro e depois decidiu que bastava trocar o nome do botão (seção 6).
- **Fracasso, mesmo funcionando:**
  - no computador, alguma página de quem entrou continuar com cara de celular (faixa estreita no meio);
  - no celular, a página rolar para o lado, ou o menu cobrir o conteúdo sem como fechar;
  - alguém ver no menu uma área a que não tem acesso (por exemplo, o cliente ver "Preços");
  - alguma tela que funciona hoje parar de funcionar (agenda, alterar, cancelar, perfil, abas da equipe);
  - o cliente continuar sem entender onde salvar o agendamento.

## 4. Abordagens consideradas

**Desenho da tela** (o dono escolheu vendo os mockups):
- **A.** Barra no topo e duas colunas (formulário | resumo com valor). Parece site de reserva.
- **B. Menu lateral e conteúdo largo (escolhida).** Cara de sistema; comporta bem as muitas áreas da equipe, hoje e na etapa 8.
- **C.** Barra no topo e passos numerados em largura total. A mais parecida com a tela de hoje.

O dono escolheu a **B**, pedindo **margem à direita** parecida com a largura do menu.

**Como construir:**
- **1. Uma moldura comum (escolhida).** Um arquivo de estilo base, com cores, menu, margens e regras do celular, usado pelas três páginas, e um módulo que monta o menu conforme os papéis de quem entrou. Cada página fica só com o que é dela.
- **2. Cada página ajeitada separadamente.** Mudanças menores, mas o menu e a base ficam em três cópias que se afastam com o tempo.
- Descartada: juntar tudo numa página só (reescrever o site sem necessidade).

O dono escolheu a **1**.

## 5. O layout

### 5.1 Computador (largura a partir de 900px)

```
┌──────────┬─────────────────────────────────────────────┬──────────┐
│ RANGEPASS│  Novo agendamento                           │          │
│          │  ┌───────────────────┐ ┌──────────────┐     │ margem   │
│ Meus     │  │ Dia e horário     │ │ Duração      │     │ ≈ largura│
│ agendam. │  └───────────────────┘ └──────────────┘     │ do menu  │
│▶Novo     │  ┌───────────────────┐ ┌──────────────┐     │          │
│ Meu      │  │ Participantes     │ │ Instrutor    │     │          │
│ perfil   │  └───────────────────┘ └──────────────┘     │          │
│ Sair     │                                             │          │
└──────────┴─────────────────────────────────────────────┴──────────┘
```

- **Menu lateral** fixo à esquerda, com a marca "RANGEPASS" no topo, os itens da pessoa (seção 5.3) e **Sair** no fim. O item da tela atual fica destacado (fundo escuro alaranjado e texto laranja, como no mockup). O menu fica parado ao rolar a página.
- **Conteúdo** à direita do menu, com uma **margem à direita parecida com a largura do menu** (pedido do dono). Em telas muito largas, o conteúdo tem uma largura máxima e fica centralizado no espaço que sobra, para as linhas não ficarem compridas demais. *Os números exatos (largura do menu, margem, largura máxima) são do construtor; o mockup usou um menu de cerca de 150px numa tela de cerca de 1000px.*
- Os **blocos** de cada tela (cartões com borda arredondada, como hoje) passam a se arrumar **em grade** quando há espaço. No "Novo agendamento", por exemplo, ficam "Dia e horário" e "Duração" lado a lado, e "Participantes" e "Instrutor" lado a lado. A agenda visual deixa de ser a única parte larga: a regra especial de 960px do plano 6 dá lugar à largura do conteúdo.
- **Mensagens** (avisos, erros, "Agendamento cancelado.") aparecem no topo do conteúdo, como hoje.

### 5.2 Celular (largura abaixo de 900px)

```
┌──────────────────────┐
│ RANGEPASS          ☰ │
├──────────────────────┤
│ Novo agendamento     │
│ [Dia e horário     ] │
│ [Duração           ] │
│ [Participantes     ] │
│ [Concluir agendam. ] │
└──────────────────────┘
```

- No lugar do menu lateral, uma **barra no topo** com a marca e o botão **☰**.
- Tocar no ☰ **abre o menu** por cima do conteúdo, com os mesmos itens. Ele fecha ao tocar num item, ao tocar no ☰ de novo (ou num "fechar") e com a tecla Esc. Enquanto está aberto, a página de trás não rola.
- O conteúdo fica numa coluna só, ocupando a largura do aparelho. **A página nunca rola para o lado** (só a faixa de dias da agenda rola, como hoje).
- Botões continuam com pelo menos 44px de altura, como no plano 6.

### 5.3 O menu de cada pessoa

O menu mostra **só o que a pessoa pode usar**. A regra de cada área já existe e não muda.

- **Minha área**, para quem é cliente: **Meus agendamentos**, **Novo agendamento**. (Quem a página `index.html` aceita hoje é o critério.)
- **Meu perfil**: para todos.
- **Área da equipe**, agrupada como no mockup aprovado. Cada item aparece só se a pessoa tiver acesso a ele, pela mesma regra de hoje (`abasVisiveis` em `admin-regras.mjs`):
  - **Operação:** Agendamentos.
  - **Cadastros:** Catálogo, Pistas, Equipe.
  - **Vendas:** Preços, Promoções.
  - **Sistema:** Configurações.
  - Um grupo sem nenhum item visível não aparece.
- **Sair**: para todos, no fim.

As abas de hoje no topo do painel da equipe (`admin.html`) **deixam de existir**: viram os itens do menu. Clicar num item da equipe abre a parte correspondente (o mesmo que clicar na aba hoje).

*Decisão minha:* cada item do menu é um **link de verdade** (por exemplo, `index.html#novo` e `admin.html#precos`). Assim o "voltar" do navegador e o "abrir em nova aba" funcionam, e cada página abre na parte certa a partir do endereço. Hoje "Novo agendamento" é um botão dentro de "Meus agendamentos"; ele continua lá e também vira item do menu.

### 5.4 Telas sem menu

As telas de **antes de entrar** (Entrar, Criar conta, E-mail enviado, Esqueci a senha, Nova senha) continuam **sem menu**, com um **cartão centralizado** e a marca em cima, como na maioria dos sites. *Decisão minha; o dono pode corrigir.* A tela **Meu perfil** (na mesma página `conta.html`) já é de quem entrou, então ganha o menu.

As telas de **carregando**, **erro ao abrir** e **sem acesso** usam a moldura com o menu quando já se sabe quem é a pessoa, e o cartão centralizado quando ainda não se sabe. *Decisão do construtor.*

### 5.5 A moldura comum

- Um **arquivo de estilo base**, usado pelas três páginas, com: as cores e medidas (as variáveis de hoje, como `--cor-marca`, que hoje se repetem nos três arquivos), a fonte, os botões, campos, cartões e mensagens comuns, o menu lateral, a barra do celular e as regras de largura. Os arquivos de cada página (`agendar.css`, `admin.css`, `conta.css`) ficam só com o que é deles.
- Um **módulo do navegador** que monta o menu a partir dos papéis de quem entrou e da tela atual, e cuida de abrir e fechar o menu no celular. As regras puras (que itens aparecem, em que grupo, qual está ativo) ficam num arquivo testável no Node, como as outras regras do projeto.
- A marcação do menu é **acessível**: um `<nav>` com nome, o item atual com `aria-current="page"`, o botão ☰ com texto para leitor de tela e `aria-expanded`, e o foco indo para o menu ao abrir e voltando ao ☰ ao fechar.
- Os papéis de quem entrou já são lidos hoje (`GET minha-conta` em `admin.js` e `conta.js`). A moldura reaproveita essa leitura, sem chamada nova ao servidor quando a página já a faz. *O jeito de compartilhar isso entre as páginas é do construtor.*

## 6. Botão "Concluir agendamento"

- No formulário do agendamento novo, o botão **"Revisar agendamento" passa a se chamar "Concluir agendamento"**. O que ele faz não muda: leva à tela de resumo.
- Na tela de resumo, o subtítulo **"Confira os dados antes de confirmar."** passa a ser **"Falta só confirmar: confira os dados e clique em Confirmar agendamento."**, para deixar claro que ainda não foi salvo. *Sugestão minha, apresentada ao dono sem objeção; ele pode corrigir.*
- O botão **"Confirmar agendamento"** e o **"Voltar e mudar"** continuam iguais.

## 7. Pendências que entram

Da revisão final do plano 6:

1. **Alterar horário, instrutores necessários.** Hoje a tela recalcula quantos instrutores o grupo precisa pelas faixas **atuais** (`faixas_instrutores`), mas o servidor, ao alterar, mantém as reservas de instrutor **gravadas** no agendamento. Se o dono mudar as faixas depois, a agenda pode pintar verde um horário que o servidor recusa. **Correção:** a rota de disponibilidade devolve, em `agendamento`, quantos instrutores esse agendamento reserva, e a tela do Alterar usa esse número.
2. **Alterar com instrutor escolhido que não atende mais** (RP007). Hoje a agenda fica toda cinza, sem explicação. **Correção:** se o instrutor escolhido do agendamento não está entre os instrutores que atendem, a tela mostra o aviso **"O instrutor escolhido não atende mais. Cancele este agendamento e faça um novo."** e não deixa salvar. *Texto e comportamento: decisão minha.*
3. **Texto ao renomear classe.** Ao renomear uma classe de desconto para o nome de uma classe desativada, a mensagem diz "…em vez de criar outra". **Correção:** no PUT (renomear), a mensagem passa a ser **"Já existe uma classe desativada com este nome. Reative-a na lista ou escolha outro nome."**; no POST (criar), continua a de hoje. *Texto: decisão minha.*
4. **Teste que falta.** Salvar um pacote cujo modelo ou munição perdeu o preço, mudando só o nome ou o "ativo", **deve dar certo** (decisão da Task 7 do plano 6). Um teste de integração em `precos-funcao.test.mjs` trava isso.
5. **Teste de unidade do Alterar.** Um teste em `agenda-regras.test.mjs` com o contexto do Alterar (o horário atual livre e marcado, quantidade e instrutor vindos do agendamento).

E também:

6. **Favicon.** O site não tem ícone na aba do navegador (`/favicon.ico` dá 404 e gera um aviso no console). Criar um ícone simples com a identidade atual (por exemplo, "R" laranja em fundo escuro) e ligá-lo nas três páginas.

## 8. Testes e conferência

- `npm test` e os testes de integração afetados passam. As regras novas do menu têm testes de unidade (quem vê o quê; item ativo; grupo vazio some).
- **Teste de tela em 390px e 1280px**, no servidor local e, depois do envio, no site publicado, com capturas mostradas ao dono:
  - cliente: Meus agendamentos, Novo agendamento (agenda, "Concluir agendamento", resumo com o subtítulo novo, confirmar), Alterar horário, cancelar, Meu perfil;
  - equipe: um usuário de teste com todos os papéis da equipe vê os grupos e itens certos, e cada item abre a parte certa; um usuário só cliente **não** vê itens da equipe;
  - celular: o ☰ abre e fecha (inclusive com Esc), a página não rola para o lado;
  - computador: o conteúdo ocupa a largura com a margem à direita, sem faixa estreita no meio;
  - telas de antes de entrar: cartão centralizado, sem menu;
  - nenhum erro de programa no console (o aviso do favicon some).
- As regras de sempre: os testes limpam o que criam; **a conta real do dono e os 2 instrutores de exemplo nunca são usados** — nos roteiros de tela, o agendamento sempre escolhe o **instrutor de teste** do próprio roteiro, nunca "Sem preferência".

## 9. Restrições (valem todas as dos planos anteriores)

- HTML, CSS e JavaScript puro, sem framework e sem etapa de build (a Vercel serve os arquivos como estão). Nenhum arquivo novo pode ficar de fora da publicação por engano: conferir o `.vercelignore`.
- PowerShell 5.1 e português do Brasil, com mensagens que dizem o que aconteceu e o que fazer.
- Perguntar antes de cada commit; nunca push nem merge sem pedido (cada envio do `nova-arquitetura` atualiza o site da Vercel). Parar no fim de cada tarefa.
- O construtor roda os testes, inclusive os de tela, e mostra os resultados.
- Migrações aplicadas nunca são editadas (este plano não deve precisar de migração; se a pendência 1 precisar, segue a regra do bloco de bloqueio do plano 6).

## 10. O que fica para o construtor

- As medidas exatas (largura do menu, margem, largura máxima, ponto de troca para o celular, se mantido em 900px).
- Como cada tela arruma seus blocos em grade no computador, seguindo o espírito do mockup.
- Como compartilhar a leitura dos papéis entre as páginas.
- O desenho do favicon, dentro da identidade atual.

## 11. Pontos esclarecidos depois da leitura do construtor

Todos são *decisões minhas*; o dono pode corrigir.

1. **"Meu perfil" e o endereço da `conta.html`.** O link do menu para o perfil é `conta.html`, **sem `#`**. Na `conta.html`, o `#` continua sendo só dos links de e-mail (confirmação e nova senha), que têm prioridade como hoje. O menu não pode quebrar esses fluxos; o teste de tela confere a tela Nova senha aberta por um link com `#`.
2. **Quem é só atendente, instrutor ou almoxarifado.** Hoje esses papéis ainda não têm área (as telas deles são da etapa 8). O menu dessas pessoas mostra só **Meu perfil** e **Sair** (mais "Minha área" se também forem clientes). É o esperado.
3. **Abrir uma parte proibida pelo endereço** (por exemplo, `admin.html#precos` sem ser superadmin). A página abre a **primeira parte que a pessoa pode ver**, sem mensagem de erro. Se ela não pode ver nenhuma, continua a tela "sem acesso" de hoje. A `index.html` para quem não é cliente continua como hoje.
4. **Pendência 1, de onde vem o número de instrutores.** A rota conta as **reservas de instrutor ativas gravadas** no agendamento. Se não houver nenhuma (caso que não deveria existir), usa o cálculo pelas faixas atuais.
5. **Agenda entre 900px e telas médias.** A faixa de dias **pode rolar por dentro em qualquer largura**, como já acontece no celular; os botões de hora e de duração quebram linha. A página nunca rola para o lado. O construtor pode subir o ponto de troca para o formato celular se a agenda ficar apertada.
6. **Telas de erro sem saber quem é a pessoa.** O cartão centralizado de erro tem **"Tentar de novo"** e também **"Sair"**, para ninguém ficar preso.
