# RangePass

## Como preparar o ambiente

1. **Node.js 22 ou mais novo.** Baixe a versão "LTS" em [nodejs.org](https://nodejs.org), instale, feche e abra o terminal de novo. Confira com `node --version`.
2. **Projeto no Supabase.** Crie uma conta em [supabase.com](https://supabase.com) e o projeto `rangepass-dev` (região São Paulo, plano gratuito). **Guarde a senha do banco.** Em *Project Settings → API*, copie a Project URL e as chaves. Se o painel mostrar chaves "publishable" e "secret", use a publishable no lugar da `anon` e a secret no lugar da `service_role`.
3. **Arquivo de chaves.** Copie `.env.teste.exemplo` para `.env.teste` e preencha `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY`. O `.env.teste` fica fora do Git.
4. **Ligar a pasta ao projeto.** No PowerShell, na pasta do projeto:
   ```powershell
   npx.cmd --yes supabase@2.20.12 login
   npx.cmd --yes supabase@2.20.12 link --project-ref <ref>
   ```
   O `<ref>` é o trecho da Project URL antes de `.supabase.co`. Para conferir, rode `npx.cmd --yes supabase@2.20.12 migration list`: ele deve responder sem erro.

> ⚠️ **A chave `service_role` (ou `secret`) é a chave-mestra do banco.** Ela passa por cima de todas as proteções. Nunca a coloque no Git, numa página do site ou numa mensagem. Se ela vazar, gere outra no painel do Supabase.

### Rodar os testes

- `npm test`: testes rápidos, que não usam a internet.
- `npm run test:integracao`: testes contra o projeto Supabase, usando as chaves do `.env.teste`.
- Os testes de integração apagam tudo o que criam. Depois deles, o banco fica como estava.
- O teste `tests/integracao/rp101-sql.test.mjs` (o sistema nunca fica sem superadmin) roda um SQL direto no banco, pela API de gerenciamento do Supabase, e precisa de `SUPABASE_ACCESS_TOKEN` no `.env.teste`. Sem ele, o teste é pulado com o aviso `preencha SUPABASE_ACCESS_TOKEN no .env.teste`. O SQL desse teste sempre termina em erro de propósito, e um erro desfaz tudo: nenhuma conta de verdade muda.
  - **Como gerar o token:** no site do Supabase, clique na sua foto (canto de cima) → *Account* → *Access Tokens* → *Generate new token*. Dê um nome (por exemplo, `rangepass-testes`), copie o valor (ele só aparece uma vez) e cole em `SUPABASE_ACCESS_TOKEN=` no `.env.teste`.
  - ⚠️ Esse token dá acesso a **todos** os seus projetos no Supabase. Ele fica só no `.env.teste` (que fica fora do Git): nunca o coloque no Git, numa página ou numa mensagem. Se vazar, apague-o na mesma tela (*Access Tokens*) e gere outro.

### Aplicar o banco e publicar as funções

```powershell
npx.cmd --yes supabase@2.20.12 db push
npx.cmd --yes supabase@2.20.12 functions deploy minha-conta --use-api
npx.cmd --yes supabase@2.20.12 functions deploy configuracoes --use-api
```

Cada função nova precisa de uma entrada em `supabase/config.toml` com `entrypoint` apontando para o `index.js` e `verify_jwt = false`. A própria função confere o login, com `obterContexto`, e responde em português.

### Criar o primeiro superadmin

1. Com o site aberto (veja "Abrir a página da conta no computador"), crie a conta em `conta.html`, confirme o e-mail pelo link que chegar e preencha o cadastro completo (nome, CPF etc.). O login pela página da conta exige o cadastro completo (nome, CPF, telefone e data de nascimento). Por isso, não crie a conta direto no painel do Supabase: ela ficaria sem cadastro e não conseguiria entrar.
2. No painel do Supabase, abra o **SQL Editor** e cole o conteúdo de `supabase/scripts/promover-superadmin.sql`.
3. Troque `SEU-EMAIL@exemplo.com` pelo e-mail do passo 1 (ele aparece duas vezes) e clique em **Run**.
4. O resultado deve mostrar uma linha com o e-mail e o papel `superadmin`. Essa conta já pode entrar na área da equipe (veja "Área da equipe", abaixo).

## Dados de exemplo

> ⚠️ **Só para o projeto de desenvolvimento (`rangepass-dev`).** Nunca rode este script no banco de um estande de verdade. O catálogo real é cadastrado pelo superadmin.

O script `supabase/scripts/dados-de-exemplo.sql` cria armas, munições, pistas e instrutores de mentira, para você testar o agendamento à mão. Ele pode ser rodado mais de uma vez sem duplicar nada.

1. **Crie duas contas de instrutor.** Com o site aberto (veja "Abrir a página da conta no computador"), crie duas contas em `conta.html`. Use o seu e-mail com `+instrutor1` e `+instrutor2` antes do `@`. Exemplo: `maria+instrutor1@gmail.com` e `maria+instrutor2@gmail.com` (os dois chegam na sua caixa de entrada). Confirme os dois e-mails pelo link que chegar. É a página da conta que cria o perfil com o nome, e sem perfil o instrutor não aparece no aplicativo.
2. No painel do Supabase, abra o **SQL Editor** e cole o conteúdo de `supabase/scripts/dados-de-exemplo.sql`.
3. Troque `INSTRUTOR-1@exemplo.com` e `INSTRUTOR-2@exemplo.com` pelos dois e-mails do passo 1 e clique em **Run**.
4. A tabela do final deve mostrar: categorias 5, calibres 9, modelos 14, tipos_municao 9, unidades 28, pistas 4, instrutores 2, modelos_com_preco 14, tipos_municao_com_preco 9 e hora_pista_centavos 10000. Se rodar de novo, os números continuam iguais.

O script também coloca **preços de exemplo** (veja "Preços e promoções", abaixo), baseados numa pesquisa de mercado de 2025 (Brasília e a média do Brasil): hora de pista R$ 100,00; aluguel por hora de pistola R$ 50,00, revólver R$ 50,00, carabina R$ 40,00, fuzil R$ 90,00 e espingarda R$ 60,00; munição por unidade de .22 LR R$ 2,50, .380 R$ 5,00, 9mm R$ 6,00, .40 R$ 6,50, .38 R$ 5,00, .357 R$ 7,00, 5,56 R$ 14,00, 7,62 R$ 18,00 e 12 R$ 10,00. São só exemplos: cada estande cadastra os seus na aba Preços. O script só preenche o que ainda está **vazio**: um preço que você já cadastrou na aba Preços continua como está (por isso, a hora de pista pode aparecer com o seu valor, e não 10000).

## Login e e-mails

Os e-mails do login (confirmação de cadastro e nova senha) saem por um serviço de e-mail próprio, o **Brevo** (plano gratuito, 300 e-mails por dia). O envio que já vem no Supabase tem um limite muito baixo. Nenhuma senha ou chave fica escrita aqui: elas ficam só no painel do Supabase.

**No Brevo** ([brevo.com](https://www.brevo.com)):
1. Em *Senders, Domains & Dedicated IPs → Senders*, cadastre e confirme o e-mail remetente.
2. Em *SMTP & API → SMTP*, gere uma chave SMTP e anote o login SMTP mostrado na mesma tela.

**No Supabase** (projeto de desenvolvimento):

| Onde | O que configurar |
|---|---|
| *Authentication → Emails → SMTP Settings* | Ligar o SMTP próprio. Host `smtp-relay.brevo.com`, porta `587`, usuário = login SMTP do Brevo, senha = chave SMTP, remetente = e-mail confirmado no Brevo, nome = `RangePass` |
| *Authentication → Rate Limits* | E-mails por hora: `30` |
| *Authentication → Sign In / Providers → Email* | "Confirm email" ligado; tamanho mínimo da senha: `8` |
| *Authentication → URL Configuration* | Site URL: `http://localhost:5500/conta.html`; Redirect URLs: `http://localhost:5500/**` |
| *Authentication → Emails → Templates* | "Confirm signup" e "Reset password" em português (textos abaixo) |

**Confirm signup.** Assunto: `Confirme o seu e-mail no RangePass`. Corpo:
```html
<p>Olá! Para ativar a sua conta no RangePass, clique no link abaixo.</p><p><a href="{{ .ConfirmationURL }}">Confirmar meu e-mail</a></p><p>Se você não criou esta conta, ignore este e-mail.</p>
```

**Reset password.** Assunto: `Crie uma nova senha no RangePass`. Corpo:
```html
<p>Recebemos um pedido para criar uma nova senha.</p><p><a href="{{ .ConfirmationURL }}">Criar nova senha</a></p><p>Se não foi você, ignore este e-mail: a senha atual continua valendo.</p>
```

> Um remetente `@gmail.com` enviado pelo Brevo pode cair no spam. Isso se resolve com um domínio próprio, no deploy (etapa 7). O site já está na Vercel: veja a seção "Site publicado (Vercel)" mais abaixo, que explica como acrescentar o endereço dele à Site URL e às Redirect URLs (sem tirar o `localhost`, que continua valendo para testar no computador).

### Abrir a página da conta no computador

A página `conta.html` (entrar, criar conta, esqueci a senha e meu perfil) precisa ser aberta por um servidor local, e não com dois cliques no arquivo. No PowerShell, na pasta do projeto:

```powershell
npx.cmd --yes http-server@14.1.1 -p 5500 -c-1
```

Depois abra `http://localhost:5500/conta.html` no navegador. Para ver como fica no celular, aperte F12 e clique no ícone de celular. Para parar o servidor, volte ao PowerShell e aperte Ctrl+C.

O arquivo `config.js` tem o endereço do projeto e a chave **pública** (`sb_publishable_...`). Ela pode ir para o Git, porque não dá acesso a nenhuma tabela. A chave secreta nunca entra nesse arquivo.

## Site publicado (Vercel)

O site fica na **Vercel** (um serviço grátis que coloca os arquivos do projeto na internet). Endereço: **https://rangepass.vercel.app**.

- **Ele usa o banco de testes** (o projeto de desenvolvimento do Supabase). Não há dados de clientes de verdade.
- **Atualização automática:** cada vez que o branch `nova-arquitetura` é enviado ao GitHub (`git push origin nova-arquitetura`), a Vercel republica o site sozinha, em cerca de um minuto.
- **O que vai para o ar:** as páginas, os estilos e os arquivos `.js`/`.mjs`. O arquivo `.vercelignore` deixa de fora `tests/`, `docs/`, `.env*` e quase tudo de `supabase/` (só `supabase/functions/_shared/` vai, porque o navegador usa os módulos de lá). Não há etapa de "build": os arquivos são servidos como estão.
- **Login pelo endereço novo (Site URL):** no Supabase, em *Authentication → URL Configuration*, coloque *Site URL* = `https://rangepass.vercel.app/conta.html`. Em *Redirect URLs*, deixe `http://localhost:5500/conta.html` e acrescente `https://rangepass.vercel.app/conta.html`. Sem isso, o link do e-mail de confirmação leva ao endereço errado.
- **Atenção:** o banco de testes pausa sozinho depois de cerca de uma semana sem uso (plano grátis). Para voltar: painel do Supabase → o projeto → *Restore*.

## Como testar o agendamento

Antes, rode uma vez os "Dados de exemplo" (acima) e publique a função de agendamentos. No PowerShell, na pasta do projeto:

```powershell
npx.cmd --yes supabase@2.20.12 functions deploy agendamentos --use-api
```

Depois:

1. Ligue o servidor local (veja "Abrir a página da conta no computador") e abra `http://localhost:5500/index.html`.
2. Se você não estiver logado, a página leva você para entrar. Entre com uma conta de cliente (não use as contas de instrutor).
3. A primeira tela é **Meus agendamentos**, com o seu nome. Sem nenhum agendamento, aparece "Você ainda não tem agendamentos.".
4. Toque em **Novo agendamento**, escolha um dia a pelo menos 2 dias de hoje, preencha e confirme. Em **Ver meus agendamentos**, o agendamento aparece em "Próximos", como "Aguardando pagamento".
5. **Alterar horário:** no cartão, toque em "Alterar horário", escolha outra hora e salve. Deve aparecer "Horário alterado." e o horário novo no cartão. Só o dia, a hora e a duração mudam.
6. **Cancelar:** no cartão, toque em "Cancelar" e confirme na janela que abrir. Deve aparecer "Agendamento cancelado." e o cartão passa para "Anteriores", como "Cancelado".
7. Quando faltar pouco para a sessão (menos que o prazo das Configurações), os botões somem e o cartão diz para falar com o estande.

## Área da equipe

A página `admin.html` é a área de trabalho da equipe do estande. Quem não tem papel de equipe vê a mensagem "Esta área é só para a equipe do estande.".

### Publicar as funções da equipe

Uma vez, no PowerShell, na pasta do projeto (um comando por linha):

```powershell
npx.cmd --yes supabase@2.20.12 functions deploy catalogo --use-api
npx.cmd --yes supabase@2.20.12 functions deploy equipe --use-api
npx.cmd --yes supabase@2.20.12 functions deploy painel-agendamentos --use-api
npx.cmd --yes supabase@2.20.12 functions deploy precos --use-api
```

### Como entrar

1. Ligue o servidor local (veja "Abrir a página da conta no computador").
2. Abra `http://localhost:5500/admin.html`.
3. Se você não estiver logado, a página leva você para entrar e depois volta para a área da equipe.

### Quem vê cada aba

Um **papel** é o tipo de acesso que a pessoa tem no sistema (cliente, instrutor, administrativo, superadmin etc.). Uma pessoa pode ter mais de um.

| Aba | O que tem | Quem vê |
|---|---|---|
| **Configurações** | Dados do estande, horário de funcionamento, regras da agenda, munição, cadastro, créditos, política de privacidade e termo | Superadmin |
| **Catálogo** | Categorias, calibres, modelos, munições e armas | Superadmin |
| **Pistas** | As pistas do estande (ativas e inativas) | Superadmin |
| **Preços** | Hora de pista, preço de cada arma e de cada munição, regras por dia e horário | Superadmin |
| **Promoções** | Campanhas, classes de desconto e pacotes | Superadmin |
| **Equipe** | Dar e tirar papéis, desativar e reativar contas | Superadmin |
| **Agendamentos** | Lista de agendamentos com filtros, o total de cada um e o detalhe, com o valor, os participantes e o histórico | Administrativo e superadmin |

O superadmin vê todas as abas. Os outros papéis de equipe (atendente, almoxarifado, instrutor) ainda não têm aba: eles veem a mensagem de área só para a equipe.

Na aba **Agendamentos**, a lista começa mostrando de hoje até daqui a 15 dias (no fuso do estande). O período pode ter no máximo 92 dias. A lista mostra do responsável só o nome e o telefone. Ao tocar num agendamento, abre o detalhe com os dados pessoais (CPF, e-mail, telefone). Cada detalhe aberto e cada busca feita na lista ficam registrados no banco (quem abriu ou buscou e quando), por causa da LGPD.

### Dar o papel de superadmin ao primeiro usuário

O primeiro superadmin é criado com o script `supabase/scripts/promover-superadmin.sql`, seguindo os passos de "Criar o primeiro superadmin" (acima). Lembre: a conta precisa ser criada e confirmada antes, pela página `conta.html`, com o cadastro completo. Depois disso, esse superadmin dá os outros papéis pela aba **Equipe**, sem precisar do SQL.

## Preços e promoções

O superadmin cadastra os preços na aba **Preços** e as promoções na aba **Promoções**. No banco, todo valor fica em **centavos** (R$ 100,00 = 10000), para as contas nunca errarem por causa da vírgula. Na tela, aparece em reais.

### Como o preço é calculado

- **Hora de pista** (com o instrutor incluído): cobrada **por pista ocupada** e por hora. Um grupo grande pode ocupar mais de uma pista (uma por instrutor necessário). Vale em todas as modalidades.
- **Regras por dia e horário:** cada regra tem dias da semana, uma faixa de horário e um percentual para cima ou para baixo sobre a hora de pista (por exemplo, sábado à noite +20%). A conta é feita **hora a hora**: numa sessão das 17h às 19h, com uma regra que começa às 18h, só a hora das 18h muda. Se duas regras valerem para a mesma hora, vale a de **maior prioridade**.
- **Aluguel de arma:** preço por hora do modelo, cobrado **por participante** que usa arma do estande.
- **Munição:** preço por unidade, cobrado **por participante** que usa munição do estande, vezes a quantidade.
- **Total** = pista + aluguel + munição, menos o desconto (se houver).

### Campanhas e pacotes

- **Campanha:** um percentual de desconto com data de início e de fim. Enquanto está valendo, o app aplica sozinho.
- **Pacote:** um preço fechado para um conjunto de itens (horas de pista, e, se quiser, o aluguel de um modelo e uma quantidade de um tipo de munição), com período de validade. O preço do pacote substitui a soma desses itens; o que passar do pacote é cobrado pelo preço normal. Vale para uma ida só (não fica saldo).
- Campanha e pacote **não se somam**: o sistema escolhe sozinho o que dá o **maior desconto para o cliente**.
- Campanhas e pacotes valem pela **data em que o cliente agenda** (o dia de hoje, no fuso do estande), com o primeiro e o último dia incluídos.
- **Classes de desconto** (policial, CAC etc.): por enquanto só são cadastradas. Quem aplica é o atendente, no balcão, depois de conferir um documento. Isso chega na etapa 8; pelo app elas não são aplicadas.

### O que fica congelado

- O preço é **congelado quando o cliente confirma** o agendamento. Se o superadmin mudar um preço depois, os agendamentos já feitos continuam com o valor que foi gravado.
- Se um preço mudar entre a revisão e o "Confirmar", o sistema avisa o cliente e mostra o valor novo; ele precisa confirmar de novo. Ninguém paga um valor que não viu.
- Só o **"Alterar horário"** calcula o preço de novo (o novo dia e horário podem ter outras regras ou promoções). O cliente vê o novo valor antes de salvar.

### Sem preço

- **Sem o preço da hora de pista, ninguém consegue agendar.**
- Uma arma (modelo) ou uma munição **sem preço não aparece para os clientes**.
- Para tirar uma arma ou munição do app por um tempo, use **"Desativar"** na aba Catálogo. Deixar o preço vazio também esconde o item, mas aí quem já agendou com ele não consegue alterar o horário pelo app e precisa falar com o estande.

### Onde ver o valor

- O cliente vê o valor na revisão (antes de confirmar), no "Alterar horário" e em **Meus agendamentos**.
- Na aba **Agendamentos** da área da equipe, a coluna **Total** mostra o valor de cada agendamento (ou `—` nos feitos antes dos preços). Ao abrir um agendamento, a parte **Valor** mostra cada item, o desconto e o total.
