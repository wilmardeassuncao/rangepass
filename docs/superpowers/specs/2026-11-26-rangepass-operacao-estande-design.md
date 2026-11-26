# RangePass, etapa 8: operação do estande (a jornada do dia) — design

Este documento detalha a primeira fase da etapa 8 da spec principal (`2026-11-11-rangepass-supabase-design.md`, seções 9 e 12). Onde ele não fala, valem a spec principal, a do plano 6 (`2026-11-23-rangepass-agenda-deploy-design.md`) e a do plano 7 (`2026-11-25-rangepass-acabamento-layout-design.md`).

## 1. Por que

O RangePass é um **protótipo** que o dono vai **apresentar a um estande de tiro em funcionamento**. Ainda não há data; o dono espera fazer acertos antes de apresentar.

Na apresentação, o dono usa **o próprio computador** e **troca de papel na frente das pessoas do estande**: mostra o cliente agendando e depois o atendente, o armeiro e o instrutor trabalhando num agendamento de hoje desse mesmo cliente.

*Decisão do dono (2026-11-26):* como o agendamento exige 24 horas de antecedência (`antecedencia_minima_horas`), o agendamento feito ao vivo serve só para mostrar a tela do cliente; a jornada no estande continua num agendamento **de hoje** do mesmo cliente de demonstração, que o comando de demonstração deixa pronto (seção 10). Nenhuma regra de antecedência muda.

O que mais convence o dono de um estande é ver **o dia completo de um cliente** acontecendo no sistema, de ponta a ponta. Por isso esta fase faz esse caminho inteiro, cada passo simples mas funcionando de verdade, e deixa para depois as partes que ficam em volta dele.

## 2. Objetivos

1. **A jornada do dia, de ponta a ponta:** o cliente agenda (já existe) → o atendente faz o check-in e registra o pagamento no balcão, com desconto de classe se houver → o armeiro libera o kit → o instrutor encerra a sessão com a munição usada e, se houver, um incidente → o armeiro recebe a devolução → o cliente responde a pesquisa.
2. **Troca de papel com um clique:** as áreas novas aparecem no menu lateral (grupo "Operação"); quem tem vários papéis passa de uma para outra sem sair da conta.
3. **Dados de demonstração:** um comando prepara, antes da apresentação, clientes, instrutores e agendamentos **de hoje** em vários pontos da jornada, com nomes que parecem reais, e o mesmo comando apaga tudo depois.
4. **Incidente visível:** um incidente registrado no encerramento aparece destacado para o administrativo e o superadmin.

## 3. Fora do escopo e o que seria um fracasso

**Fora desta fase** (ficam para uma fase seguinte da etapa 8 ou para as etapas 9 a 11, como na spec principal):
- **baixa de estoque de munição** e alerta de estoque mínimo (etapa 9) — aqui a munição usada e a devolvida são só **registradas**;
- **crédito** e **não comparecimento**;
- **ponto do instrutor** por QR code;
- **pista interditada** e remanejamento;
- **e-mails e notificações** (etapa 10) — inclusive o link da pesquisa por e-mail;
- **pagamento online** (etapa 11);
- **questionário do instrutor** e **aprovação** das perguntas (no protótipo há só "ativa/inativa");
- **relatórios** (inclusive o de descontos concedidos);
- **preço do instrutor separado do preço da pista** (e um percentual de desconto só para o instrutor) — muda o preço de todos e a tela do cliente; fica para depois da apresentação, se o estande pedir;
- **classe de desconto guardada no cadastro do cliente** (vir marcada na próxima visita).

**Seria um fracasso, mesmo funcionando tecnicamente:**
- a demonstração **travar no meio** porque falta um dado, um passo exige algo que os dados de demonstração não têm, ou um passo depende de outro que não aparece na tela;
- **trocar de papel exigir sair e entrar** de novo;
- os dados de demonstração **misturarem-se aos dados reais** ou não poderem ser apagados por completo; ou os testes automáticos apagarem os dados de demonstração;
- mostrar CPF ou dados pessoais além do necessário para o passo;
- o painel da equipe (`admin.js`, ~2.000 linhas) crescer com a operação do dia.

## 4. Abordagens consideradas

- **A. Uma página nova do estande, `estande.html`, com as três áreas (escolhida pelo dono).** Recepção, Almoxarifado e Minha pista na mesma página, cada uma num endereço (`#recepcao`, `#almoxarifado`, `#pista`), como o painel da equipe já faz; uma Edge Function nova, `operacao`. As três áreas usam a mesma "lista do dia"; o painel da equipe não cresce. Custo: uma página e uma função novas.
- **B. As três áreas dentro de `admin.html`.** Não cria página, mas o arquivo, já grande, ficaria muito mais difícil de ajustar e testar; cada acerto depois da apresentação arriscaria quebrar outra parte.
- **C. Uma página por papel** (`recepcao.html`, `almoxarifado.html`, `pista.html`). Páginas pequenas, mas o código da lista do dia repetido três vezes, e a apresentação troca de área pelo menu de qualquer jeito.

## 5. A jornada e as situações

### 5.1 Situações do agendamento (já existem no banco)

`aguardando_pagamento` → `check_in` → `concluido`. A situação `pago` existe para o pagamento pelo app (etapa 11); nesta fase um agendamento `pago` (se houver) faz check-in sem registrar pagamento. `cancelado` e `nao_compareceu` não mudam nesta fase.

### 5.2 Estado do kit (novo)

Para os participantes que usam **arma do estande** (modalidade `estande`) ou **munição do estande**: **a separar** → **liberado** → **devolvido**. O kit é **um por agendamento** (todas as armas e munições daquele agendamento saem e voltam juntas). Agendamento sem nada do estande (todos `tudo_proprio`) não tem kit e não aparece no Almoxarifado.

### 5.3 Ordem dos passos (o que libera o quê)

| Passo | Quem | Exige | Resultado |
|---|---|---|---|
| Check-in | atendente | situação `aguardando_pagamento` (com pagamento) ou `pago` (sem); sessão **de hoje** | situação `check_in` |
| Liberar kit | almoxarifado | situação `check_in`; kit "a separar" | kit "liberado" |
| Encerrar sessão | instrutor | situação `check_in`; kit "liberado" (se houver kit) | situação `concluido`; munição usada registrada; incidente (opcional) |
| Receber devolução | almoxarifado | kit "liberado" e situação `concluido` | kit "devolvido" |
| Responder pesquisa | cliente (responsável) | situação `concluido`; ainda não respondeu | respostas gravadas |

Cada passo grava **quem fez e quando**, e passa pelo histórico (`registrar_historico`), como as outras tabelas.

*Decisão minha:* os passos não se desfazem pela tela nesta fase (não há "desfazer check-in"). Um erro na demonstração se resolve rodando de novo o comando dos dados de demonstração.

## 6. As áreas

A página `estande.html` usa a **moldura comum** do plano 7 (`moldura.mjs`, `base.css`): menu lateral no computador, ☰ no celular. O menu ganha no grupo **Operação**, antes de "Agendamentos":

```
OPERAÇÃO
  Recepção        → estande.html#recepcao      (atendente)
  Almoxarifado    → estande.html#almoxarifado  (almoxarifado)
  Minha pista     → estande.html#pista         (instrutor)
  Agendamentos    → admin.html#agendamentos    (administrativo)
```

O superadmin vê todas (como hoje, `temAlgumPapel` deixa o superadmin passar). Sem `#`, a página abre a primeira área permitida na ordem do menu; área proibida ou desconhecida abre a primeira permitida (mesma regra de `admin.html`).

As três áreas mostram **só o dia de hoje** (no fuso do estande), em ordem de horário, e se atualizam ao voltar para a área e por um botão "Atualizar". Nada de atualização automática nesta fase.

### 6.1 Recepção (atendente)

**Lista do dia:** horário, responsável (nome e telefone), número de pessoas, pista(s), instrutor(es), valor e situação. Um selo de **incidente** aparece no agendamento que tiver um.

**"Fazer check-in"** abre a ficha do agendamento:
- os participantes com **nome, CPF e data de nascimento** (o atendente confere o documento); abrir a ficha registra o acesso em `acessos_dados`, como o detalhe do painel faz;
- o que cada um vai usar (arma, munição);
- o **valor**: o preço congelado no agendamento (`preco_total_centavos`, `preco_detalhe`);
- **desconto de classe** (opcional): uma lista com as classes **ativas** (`classes_desconto`). Ao escolher uma classe, aparece o campo obrigatório **"Documento conferido"** (o número do documento que comprova a classe: funcional, CR etc., até 60 caracteres), e a ficha mostra **a conta parte por parte** (abaixo);
- **forma de pagamento**: dinheiro, Pix, cartão de débito ou cartão de crédito;
- botão **"Confirmar check-in"**.

**Desconto de classe por parte do preço** (decisão do dono, 2026-11-26). O superadmin define, **em cada classe**, um percentual para cada parte do preço que o estande controla:
- **Pista** (a hora de pista; o valor do instrutor está dentro dela, porque o preço não tem uma parte separada para o instrutor);
- **Aluguel de armas**;
- **Munição**, **nunca abaixo do custo de compra**: cada tipo de munição ganha no Catálogo o campo **"Custo de compra"** (centavos por unidade, opcional). O desconto da munição é limitado para que o valor cobrado da munição não fique abaixo de Σ (quantidade × custo de compra) dos tipos usados no agendamento; quando o limite age, a ficha avisa "Desconto da munição limitado ao custo de compra." Tipo de munição sem custo cadastrado não tem limite (*decisão minha*). O custo usado é o **atual**, no momento do check-in (*decisão minha*: o custo não é congelado no agendamento).

Cada percentual vai de 0 a 90, e pelo menos um é maior que 0. O percentual único de hoje (`classes_desconto.percentual`) dá lugar aos três; na migração, uma classe existente recebe o percentual antigo nas três partes. A tela de classes em **Promoções** passa a ter os três campos, e o Catálogo ganha o custo de compra no formulário de munição.

**Sobre qual valor:** os percentuais valem sobre os itens **"Pista", "Aluguel de armas" e "Munição" gravados em `preco_detalhe.itens`** — ou seja, já com a regra de preço por horário (um acréscimo de noite continua valendo) e **antes** de pacote ou campanha. O valor com o desconto de classe é a soma das três partes descontadas. **Vale o melhor para o cliente** (decisão do dono no plano 5: pacote/campanha e desconto não se somam): o valor cobrado é o **menor** entre o valor congelado (`preco_total_centavos`) e o valor com o desconto de classe. Se o desconto de classe não melhorar, a ficha diz "O preço do agendamento já é menor que com este desconto." e mantém o valor congelado (a classe e o documento ficam registrados mesmo assim).

**A conta na ficha:** uma tabela com cada parte — valor antes, percentual, valor depois — mais o total antes, o total com o desconto de classe, o valor congelado (se houver pacote ou campanha) e o **valor a cobrar**, em destaque.

```
Parte              Antes      Desconto   Depois
Pista            R$ 100,00      20%    R$  80,00
Aluguel de armas R$  30,00      10%    R$  27,00
Munição          R$ 125,00      15%    R$ 106,25
Total            R$ 255,00             R$ 213,25
Valor a cobrar                         R$ 213,25
```

O cálculo fica em `_shared/precos.mjs` (testável no Node), e o servidor refaz a conta no check-in (a tela só mostra). Ficam para depois: guardar a classe no cadastro do cliente e um relatório de descontos concedidos.

Agendamento `pago`: a ficha mostra "Pago pelo app" e não pede pagamento nem desconto.

### 6.2 Almoxarifado (armeiro)

**Lista do dia** só dos agendamentos com kit e situação `pago`, `check_in` ou `concluido`, separada em três partes: **A separar**, **Liberados** (na pista) e **Devolvidos**. *Decisão minha:* `pago` sem check-in aparece em "A separar", mas o botão "Liberar kit" só fica ativo depois do check-in, com a explicação "Aguardando o check-in na recepção." (a spec principal diz que o almoxarifado vê os kits dos agendamentos pagos ou com check-in; liberar antes do cliente chegar não faz sentido no balcão). O servidor confere a mesma regra (seção 5.3).

Cada kit mostra: horário, pista, instrutor, e por participante a **arma reservada** (modelo e **número de registro** da unidade, de `agendamento_unidades`) e a **munição** (tipo e quantidade, de `itens_participante`). Não mostra CPF.

- **"Liberar kit"** → "liberado".
- **"Receber devolução"** (depois do encerramento) mostra, por participante, a munição **pedida**, **usada** e **a devolver** (pedida − usada), e confirma → "devolvido".

### 6.3 Minha pista (instrutor)

**Lista do dia** das sessões em que a pessoa é instrutor (`agendamento_instrutores` ativos), com horário, pista, participantes (só nomes), o que cada um usa e a situação do kit.

*Decisão minha:* o superadmin (que não é instrutor) vê **todas** as sessões do dia, com o nome do instrutor em cada uma, e pode encerrar qualquer uma — é o que permite ao dono fazer o papel de instrutor na apresentação.

**"Encerrar sessão"** (com situação `check_in` e kit liberado, se houver) abre:
- por participante com munição do estande, a **munição usada** (número de 0 até a quantidade pedida; o campo começa com a quantidade pedida);
- a caixa **"Houve incidente"**; marcada, abre um campo **descrição** (obrigatório, até 1.000 caracteres);
- botão **"Encerrar sessão"** → situação `concluido`.

A área precisa funcionar bem **no celular** (o instrutor usa o celular na pista): campos e botões grandes, sem rolar para o lado.

### 6.4 Incidente

Um incidente fica ligado ao agendamento, com descrição, quem registrou e quando. Aparece:
- como **selo "Incidente"** na lista de **Agendamentos** do painel da equipe e na Recepção;
- com a descrição no **detalhe** do agendamento no painel.

Nada de alerta por e-mail nesta fase (etapa 10).

## 7. Questionário

### 7.1 Cadastro das perguntas (painel da equipe)

Uma parte nova no painel da equipe, **"Pesquisa"**, no grupo **Sistema**, só para o superadmin, no mesmo estilo de "Catálogo" (lista + formulário, nada é apagado, só desativado):
- **texto** da pergunta (obrigatório, até 300 caracteres);
- **tipo**: **nota de 1 a 5** ou **texto livre**;
- **ordem** (número);
- **ativa** (sim/não).

*Decisão minha:* sem "aprovação" separada no protótipo; "ativa" faz esse papel.

### 7.2 Resposta do cliente

Em **"Meus agendamentos"**, um agendamento `concluido` cujo responsável ainda não respondeu mostra o botão **"Responder pesquisa"**. Ele abre as perguntas **ativas** (na ordem): nota em 5 botões (1 a 5) e texto em caixa de texto. Todas são opcionais, mas é preciso responder pelo menos uma. Depois de enviar, o botão vira "Pesquisa respondida". Só o **responsável** responde (participantes sem conta não respondem nesta fase); responde uma vez só.

As respostas guardam o **texto da pergunta no momento da resposta** (se a pergunta for editada depois, a resposta continua fazendo sentido).

### 7.3 Ver as respostas

No **detalhe** do agendamento no painel da equipe (administrativo e superadmin), uma seção "Pesquisa" com as perguntas e respostas. *Relatório agregado fica fora.*

## 8. Dados (o que o banco ganha)

Uma migração nova (as aplicadas nunca são editadas). Tabelas novas, todas com RLS ligada e sem acesso direto pelo navegador (tudo passa pelas Edge Functions, como hoje), e com o histórico ligado:
- **pagamentos**: agendamento, valor cobrado (centavos), forma (dinheiro, pix, cartao_debito, cartao_credito), classe de desconto (opcional), **documento conferido** (obrigatório quando há classe), a conta do desconto por parte (percentuais aplicados, valores antes e depois, se o limite do custo da munição agiu), valor do desconto (centavos), quem registrou, quando. Um por agendamento.

Tabelas existentes que mudam: **classes_desconto** (três percentuais por parte no lugar do percentual único) e **tipos_municao** (custo de compra, opcional).
- **kits** (ou colunas no agendamento — escolha do construtor): liberado por/em, devolvido por/em.
- **uso de munição**: por item de participante com munição, a quantidade usada.
- **incidentes**: agendamento, descrição, quem registrou, quando.
- **perguntas** e **respostas** do questionário.

As mudanças de situação e os registros de cada passo acontecem **numa transação só** (função no banco, como `agendar` e `alterar` já fazem), para não ficar meio feito.

## 9. Servidor

Uma Edge Function nova, **`operacao`**, com o papel conferido antes de qualquer consulta (`exigirPapel`), no estilo de `painel-agendamentos`:
- `GET ?area=recepcao|almoxarifado|pista` — a lista do dia da área;
- `GET ?id=` — a ficha de check-in (com CPFs; registra o acesso);
- `POST` check-in, liberar kit, encerrar sessão, receber devolução — cada um conferindo a ordem da seção 5.3 no servidor (a tela só ajuda).

Quem pode o quê: check-in → atendente; liberar e receber → almoxarifado; encerrar → instrutor **da sessão** (ou superadmin); superadmin pode tudo. Erros com mensagens que dizem o que aconteceu e o que fazer (por exemplo: "Este agendamento ainda não fez check-in. Peça ao cliente para passar na recepção.").

O cadastro das perguntas vai para uma função de cadastro existente ou nova (escolha do construtor); a resposta do cliente vai pela função `agendamentos` (é do cliente). As mudanças no painel (selo de incidente, detalhe com incidente e pesquisa) vão por `painel-agendamentos`.

## 10. Dados de demonstração

Um comando para o dono rodar antes e depois da apresentação, no **projeto de desenvolvimento**:

```
node --env-file=.env.teste scripts/demonstracao.mjs preparar
node --env-file=.env.teste scripts/demonstracao.mjs apagar
```

`preparar`:
- cria **1 cliente de demonstração** (com e-mail e senha mostrados no fim, para a "janela do cliente"), **2 instrutores** e **4 a 6 clientes** com nomes brasileiros que parecem reais e CPFs válidos;
- cria agendamentos **de hoje** (no horário de funcionamento) em pontos diferentes da jornada: aguardando check-in, com check-in e kit a separar, kit liberado (na pista), concluído com kit a devolver, concluído com pesquisa respondida, e um com incidente;
- deixa para o **cliente de demonstração** (o da "janela do cliente") um agendamento **de hoje aguardando check-in**, com arma e munição do estande, para a jornada ao vivo, e um agendamento **concluído sem pesquisa**, para mostrar "Responder pesquisa";
- se não houver classe de desconto ativa, cria uma de exemplo ("Policial": pista 20%, aluguel 10%, munição 15%), e garante custo de compra nos tipos de munição usados pela demonstração, para que a conta da ficha apareça completa — e o `apagar` desfaz o que tiver criado ou preenchido;
- os agendamentos de hoje são gravados direto no banco pelo comando (com a chave de serviço), sem passar pela regra de antecedência mínima, mas respeitando as travas do banco (conflito de pista, instrutor e arma);
- se não houver perguntas ativas, cria 3 perguntas de exemplo (2 notas e 1 texto);
- usa os catálogos, pistas e preços que já existem (se faltar algo essencial, para com uma mensagem clara dizendo o que cadastrar);
- pode rodar de novo: apaga a demonstração anterior antes de criar.

`apagar` remove **tudo** o que a demonstração criou (contas, perfis, agendamentos e tudo ligado a eles, perguntas de exemplo se foram criadas por ela) e confere que não sobrou nada.

Os e-mails da demonstração usam um domínio **próprio**, diferente do dos testes (`@rangepass.test`), para que a limpeza dos testes nunca apague a demonstração nem o contrário (sugestão: `@demo.rangepass.local`; o construtor confere que a limpeza dos testes não a alcança). **Nunca** mexe na conta do dono nem nos 2 instrutores de exemplo.

A conta do dono (superadmin) já vê todas as áreas; não é preciso dar papéis novos a ela.

## 11. Divisão em planos

Grande demais para um plano só. Proposta (o construtor do plano pode ajustar):
1. **Plano 8A — Base e Recepção:** migração, função `operacao`, menu e `estande.html`, área Recepção com check-in, pagamento e desconto de classe por parte (com os três percentuais em Promoções e o custo de compra no Catálogo).
2. **Plano 8B — Almoxarifado, Minha pista e incidente:** liberar e receber kit, encerrar sessão com munição e incidente, selo e detalhe no painel.
3. **Plano 8C — Pesquisa e demonstração:** perguntas no painel, resposta do cliente, respostas no detalhe, comando de demonstração e um ensaio completo da apresentação no site publicado.

Cada plano termina utilizável e publicado no dev, com os testes passando.

## 12. Testes e conferência

- **Unidade** (Node): regra do desconto de classe por parte (incluindo o limite do custo da munição, munição sem custo, regra de horário com acréscimo e o "vale o melhor" contra pacote e campanha); ordem dos passos (o que cada situação/estado permite); munição a devolver; itens do menu com os papéis novos.
- **Integração** (Supabase dev): cada `POST` da função `operacao` com papel certo, papel errado e ordem errada; a transação não deixa nada meio feito; registro em `acessos_dados`; resposta da pesquisa só do responsável e só uma vez.
- **Tela** (Playwright, roteiros fora do repositório): a jornada inteira em 1280px e o "Encerrar sessão" em 390px; troca de área pelo menu; nenhum erro no console.
- **Ensaio da apresentação** (fim do plano 8C): `preparar` → percorrer a jornada no site publicado trocando de papel → `apagar` → conferir que não sobrou nada.
- Todos os testes limpam o que criam; a conta real do dono e os 2 instrutores de exemplo nunca são tocados.

## 13. Restrições (valem todas as dos planos anteriores)

- PowerShell 5.1 e português do Brasil; mensagens dizem o que aconteceu e o que fazer.
- Perguntar antes de cada commit; nunca push nem merge sem pedido (cada envio do `nova-arquitetura` atualiza o site da Vercel).
- Sem framework e sem build; arquivos do navegador na raiz do projeto.
- Dinheiro em centavos inteiros.
- Identidade visual e layout do plano 7 (moldura, cores, Roboto, ponto de troca em 900px, botões de pelo menos 44px no celular).

## 14. O que fica para o construtor

- Nomes exatos de tabelas, colunas e funções do banco; kit como tabela ou colunas.
- Onde fica o cadastro das perguntas no servidor.
- Detalhes visuais das listas do dia (desde que sigam a moldura e o estilo das telas existentes).
- O domínio exato dos e-mails da demonstração, respeitando a seção 10.
