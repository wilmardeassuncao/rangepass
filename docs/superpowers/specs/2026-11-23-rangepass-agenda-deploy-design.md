# RangePass, plano 6: agenda visual e publicação na Vercel

Este documento detalha as etapas 6 e 7 da spec principal (`2026-11-11-rangepass-supabase-design.md`, seções 6.1 a 6.3 e 9). Onde ele não fala, vale a spec principal.

## 1. Por que

Hoje a tela de agendamento tem uma caixa de data e duas listas (horário e duração). Essas listas só sabem **em que horas o estande abre**. Elas não sabem se ainda há pista ou instrutor livre. O cliente preenche tudo e só descobre no **Confirmar** que o horário está lotado (erros RP001 a RP003). O plano 6 resolve isso com a agenda visual aprovada (modelo B) e coloca o sistema novo na internet, para o dono testar de qualquer lugar, inclusive no celular.

## 2. Objetivos

1. Agenda visual no **agendamento novo** e no **Alterar horário**: faixa de dias, botões de hora coloridos e botões de duração (spec principal, 6.1).
2. As cores mostram a **disponibilidade real de pistas e instrutores**, calculada pelo servidor.
3. O sistema novo publicado na **Vercel**, usando o **banco de testes** atual (projeto `uwbycbjfgjiqaycjdfxz`).
4. As pendências pequenas que ficaram do plano 5 (seção 7).

## 3. Fora do escopo e o que seria um fracasso

- **Fora:** banco de produção separado, domínio próprio, desligar o site antigo do GitHub Pages, juntar o branch no `main`. O dono decidiu que, por enquanto, o site novo é **só para teste**.
- **Fora:** as cores considerarem arma e munição (veja a seção 4).
- **Fracasso, mesmo funcionando:** um horário aparecer **verde** e ser recusado por falta de **pista ou instrutor**; o Alterar horário mostrar o **próprio agendamento** do cliente como ocupando a vaga; a agenda ficar ruim de usar no celular; o site publicado expor a chave secreta ou o arquivo `.env.teste`.

## 4. Abordagens consideradas

- **A. As cores consideram pistas e instrutores (escolhida pelo dono).** O servidor informa o que está livre em cada hora. A tela pinta os botões conforme o tamanho do grupo e o instrutor escolhido, e repinta quando isso muda. A falta de arma ou munição continua aparecendo só no Confirmar, com a mensagem atual (RP004 e semelhantes). A ordem da tela não muda.
- **B. As cores consideram tudo, e a ordem da tela muda** (pessoas e armas antes do dia). As cores ficam sempre exatas, mas o cliente preenche tudo antes de saber se há horário, e o trabalho é bem maior.
- **C. As cores consideram tudo, e a ordem continua igual.** Um horário já escolhido pode virar "lotado" no meio do preenchimento, o que confunde o cliente.

O dono escolheu a **A**: pista e instrutor são o que mais lota, e ela tem o menor risco.

## 5. Agenda visual

### 5.1 O que o servidor informa

Uma rota nova de leitura na função `agendamentos` (por exemplo `GET ?ver=disponibilidade`), que devolve, para cada dia de hoje até `antecedencia_maxima_dias` e para cada hora cheia em que o estande abre:

- os **ids das pistas livres** (ativas, não interditadas e sem reserva naquela hora);
- os **ids dos instrutores livres** (mesma regra de `instrutor_livre`).

Para o **Alterar horário**, a rota recebe o id do agendamento e o **ignora** no cálculo (como o `p_ignorar` das funções `pista_livre` e `instrutor_livre`). Assim, o horário atual do cliente não aparece como ocupado por ele mesmo. O agendamento precisa ser do cliente logado. No Alterar, o número de participantes e o instrutor escolhido vêm do próprio agendamento. O servidor exige o mesmo instrutor principal (RP001), então as cores seguem essa regra. Os outros instrutores e as pistas podem ser trocados pelo banco.

*Minha decisão: devolver os **ids**, e não só a quantidade.* Uma sessão de 2 ou 3 horas precisa das **mesmas** pistas e dos **mesmos** instrutores do começo ao fim (spec 6.2). Com as quantidades, a tela poderia pintar de verde um horário em que a pista 1 está livre só na primeira hora e a pista 2 só na segunda. Com os ids, a tela cruza as horas e chega à mesma resposta do banco. Os ids de pista não são sensíveis, e os ids de instrutor já vão para o navegador na lista de instrutores. O cálculo fica numa função SQL ou num módulo puro testável. Essa escolha é do construtor.

### 5.2 Como a tela decide as cores

Para uma hora de início `h` e uma duração `k`, a sessão **cabe** quando, em todas as horas de `h` até `h+k-1`:

- o número de pistas livres em **todas** essas horas é pelo menos o número de instrutores necessários (faixas de `faixas_instrutores`, conforme o número de participantes);
- o número de instrutores livres em **todas** essas horas também é pelo menos esse número;
- se o cliente escolheu um instrutor, ele está livre em **todas** essas horas.

Cores do botão de hora (para a duração mínima de 1 hora):

- **Verde (livre):** a sessão de 1 hora cabe, com folga.
- **Amarelo (poucas vagas):** cabe, mas restam no máximo `poucas_vagas` sessões do mesmo tamanho naquela hora. *Minha decisão:* vagas = menor entre (pistas livres ÷ instrutores necessários) e (instrutores livres ÷ instrutores necessários), arredondado para baixo.
- **Cinza riscado (lotado):** não cabe, ou a hora já passou da antecedência mínima. O botão fica desabilitado.

Duração: cada botão de 1 a `k` horas fica **bloqueado** quando a sessão não cabe ou passa do fechamento (spec 6.1, item 3). O máximo continua sendo `duracao_maxima_individual` ou `duracao_maxima_grupo`.

Dia: fica **desabilitado** quando o estande não abre, quando é data fechada ou quando nenhuma hora cabe.

A tela repinta tudo quando muda o **número de participantes** ou o **instrutor escolhido**. Se a hora ou a duração já escolhidas deixarem de caber, a escolha é desfeita e aparece um aviso curto explicando o motivo.

### 5.3 Quando os dados são buscados

*Minha decisão:* ao abrir a tela de agendamento ou o Alterar horário, e de novo depois de qualquer recusa do Confirmar por falta de vaga (409). Não há atualização automática enquanto a tela está aberta. O banco continua sendo quem garante que não há conflito.

### 5.4 Visual

- Segue o layout atual (escuro com laranja) e o rascunho do modelo B aprovado em 2026-11-11.
- **Faixa de dias:** rolagem horizontal, com o dia da semana e a data em cada botão, por exemplo "Ter 17/11".
- **Horas:** grade de botões "10:00", "11:00"..., com as três cores. A cor **nunca** é o único sinal: o lotado também vem riscado, o amarelo leva a legenda "poucas vagas" e cada botão tem um texto acessível.
- **Resumo** abaixo: "Terça, 17/11 · das 10:00 às 12:00" (spec 6.1, item 4).
- **Dois formatos (pedido do dono em 2026-11-23):** no celular, tudo fica numa coluna só e os botões têm tamanho bom para o dedo. No computador, a agenda aproveita a largura da tela, por exemplo com a faixa de dias e a grade de horas lado a lado com o resumo, em vez de parecer um celular esticado. É a mesma página, que se ajusta à largura da tela. O resto das telas (conta, admin e as outras partes do agendamento) fica para a etapa de layout geral.
- Os campos atuais (`input date` e os dois `select`) saem. Os valores escolhidos continuam indo ao servidor no mesmo formato (`data`, `hora`, `horas`), então as validações do servidor não mudam.

### 5.5 O que não muda

As regras do servidor (antecedência, fechamento, durações máximas, funções `criar_agendamento` e de alteração) e o preço mostrado na revisão. O preço da prévia do Alterar continua sendo recalculado quando o horário muda.

## 6. Publicação na Vercel

- **Conta:** o dono cria uma conta grátis na Vercel, entrando com a conta do GitHub, e liga o repositório. O construtor explica cada passo em linguagem simples, e o dono faz os cliques que exigem login.
- **Branch publicado:** `nova-arquitetura`, configurado como o branch principal do projeto na Vercel. Cada envio ao GitHub desse branch atualiza o site, e **cada envio só acontece com autorização do dono**. O `main` e o site do GitHub Pages ficam **como estão**.
- **Sem etapa de construção:** o site é estático (HTML, CSS e JS puros). O projeto é configurado sem comando de build, e o `package.json` existe só para os testes.
- **O que não vai para o site:** `tests/`, `docs/`, `supabase/` e os arquivos de configuração das ferramentas, por exemplo com `.vercelignore`. O `.env.teste` já está fora do Git.
- **Login e e-mails:** no painel do Supabase (Auth → URL Configuration), o **Site URL** passa a ser o endereço da Vercel (`https://<projeto>.vercel.app/conta.html`), e `http://localhost:5500/conta.html` vai para a lista de endereços permitidos. Assim, os e-mails de confirmação de cadastro levam ao site publicado. O "esqueci a senha" já usa o endereço de onde o cliente está.
- **Funções do servidor:** já aceitam qualquer origem (CORS `*`). Não precisam mudar para a publicação.
- **Aviso no README:** como usar o site publicado e o lembrete de que o banco de testes **pausa sozinho** depois de cerca de uma semana sem uso (plano grátis do Supabase) e precisa ser restaurado no painel.

## 7. Pendências do plano 5 que entram aqui

1. Um pacote com arma e munição pode ser "cumprido" por participantes diferentes (`precos.mjs`, perto das linhas 75 a 84). O pacote deve valer só quando o **mesmo participante** tem a arma e a munição.
2. A aba Promoções aceita um pacote com item sem preço ou com calibres que não combinam, e o servidor ignora o pacote sem avisar. Ela deve recusar ao salvar, com uma mensagem clara.
3. Recriar uma classe desativada dá "Já existe…". A mensagem deve sugerir reativar a classe.
4. `#alterar-valor` sem `role="status"`. Além disso, a prévia do Alterar pode trocar o preço devolvido pelo 409 pela estimativa local. Deve prevalecer o preço do servidor.
5. `centavosDoTexto` recusa `120.50`. Deve aceitar ponto e vírgula. `formatarReais` está errado para valores negativos.

## 8. Testes

- Testes de unidade para o cálculo das cores e durações (cruzamento das horas, instrutor escolhido, grupos, poucas vagas, fechamento).
- Testes de integração da rota de disponibilidade: pista interditada, instrutor reservado, o próprio agendamento ignorado no Alterar, agendamento de outro cliente recusado. Os testes **apagam tudo o que criam**.
- Teste de tela no navegador: escolher dia, hora e duração no celular e no computador. Conferir que um horário cinza não pode ser escolhido e que um verde é aceito no Confirmar.
- Depois da publicação: abrir o site da Vercel, criar conta, confirmar o e-mail e agendar.

## 9. O que fica com o construtor

- O formato exato da resposta da rota de disponibilidade e onde fica o cálculo (SQL ou módulo puro).
- A estrutura do código da agenda no front, desde que as regras de cor fiquem num módulo puro testável no Node, como `agendar-regras.mjs`.
- Detalhes visuais dentro do layout atual.
- A forma de excluir arquivos da publicação.
