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

### Aplicar o banco e publicar as funções

```powershell
npx.cmd --yes supabase@2.20.12 db push
npx.cmd --yes supabase@2.20.12 functions deploy minha-conta --use-api
npx.cmd --yes supabase@2.20.12 functions deploy configuracoes --use-api
```

Cada função nova precisa de uma entrada em `supabase/config.toml` com `entrypoint` apontando para o `index.js` e `verify_jwt = false`. A própria função confere o login, com `obterContexto`, e responde em português.

### Criar o primeiro superadmin

1. Com o site aberto (veja "Abrir a página da conta no computador"), crie a conta em `conta.html`, confirme o e-mail pelo link que chegar e preencha o cadastro completo (nome, CPF etc.). O login pela página da conta exige o cadastro completo (nome, CPF, telefone e data de nascimento).
2. No painel do Supabase, abra o **SQL Editor** e cole o conteúdo de `supabase/scripts/promover-superadmin.sql`.
3. Troque `SEU-EMAIL@exemplo.com` pelo e-mail do passo 1 (ele aparece duas vezes) e clique em **Run**.
4. O resultado deve mostrar uma linha com o e-mail e o papel `superadmin`. Essa conta já pode entrar na área da equipe (veja "Área da equipe", abaixo).

## Dados de exemplo

> ⚠️ **Só para o projeto de desenvolvimento (`rangepass-dev`).** Nunca rode este script no banco de um estande de verdade. O catálogo real é cadastrado pelo superadmin.

O script `supabase/scripts/dados-de-exemplo.sql` cria armas, munições, pistas e instrutores de mentira, para você testar o agendamento à mão. Ele pode ser rodado mais de uma vez sem duplicar nada.

1. **Crie duas contas de instrutor.** Com o site aberto (veja "Abrir a página da conta no computador"), crie duas contas em `conta.html`. Use o seu e-mail com `+instrutor1` e `+instrutor2` antes do `@`. Exemplo: `maria+instrutor1@gmail.com` e `maria+instrutor2@gmail.com` (os dois chegam na sua caixa de entrada). Confirme os dois e-mails pelo link que chegar. É a página da conta que cria o perfil com o nome, e sem perfil o instrutor não aparece no aplicativo.
2. No painel do Supabase, abra o **SQL Editor** e cole o conteúdo de `supabase/scripts/dados-de-exemplo.sql`.
3. Troque `INSTRUTOR-1@exemplo.com` e `INSTRUTOR-2@exemplo.com` pelos dois e-mails do passo 1 e clique em **Run**.
4. A tabela do final deve mostrar: categorias 5, calibres 9, modelos 14, tipos_municao 9, unidades 28, pistas 4 e instrutores 2. Se rodar de novo, os números continuam iguais.

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

> Um remetente `@gmail.com` enviado pelo Brevo pode cair no spam. Isso se resolve com um domínio próprio, no deploy (etapa 7). Quando o site for para a Vercel, troque a Site URL e as Redirect URLs pelo endereço novo.

### Abrir a página da conta no computador

A página `conta.html` (entrar, criar conta, esqueci a senha e meu perfil) precisa ser aberta por um servidor local, e não com dois cliques no arquivo. No PowerShell, na pasta do projeto:

```powershell
npx.cmd --yes http-server@14.1.1 -p 5500 -c-1
```

Depois abra `http://localhost:5500/conta.html` no navegador. Para ver como fica no celular, aperte F12 e clique no ícone de celular. Para parar o servidor, volte ao PowerShell e aperte Ctrl+C.

O arquivo `config.js` tem o endereço do projeto e a chave **pública** (`sb_publishable_...`). Ela pode ir para o Git, porque não dá acesso a nenhuma tabela. A chave secreta nunca entra nesse arquivo.

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
| **Equipe** | Dar e tirar papéis, desativar e reativar contas | Superadmin |
| **Agendamentos** | Lista de agendamentos com filtros e o detalhe de cada um, com participantes e histórico | Administrativo e superadmin |

O superadmin vê todas as abas. Os outros papéis de equipe (atendente, almoxarifado, instrutor) ainda não têm aba: eles veem a mensagem de área só para a equipe.

Na aba **Agendamentos**, a lista começa mostrando de hoje até daqui a 15 dias (no fuso do estande). O período pode ter no máximo 92 dias. A lista mostra do responsável só o nome e o telefone. Ao tocar num agendamento, abre o detalhe com os dados pessoais (CPF, e-mail, telefone). Cada detalhe aberto e cada busca feita na lista ficam registrados no banco (quem abriu ou buscou e quando), por causa da LGPD.

### Dar o papel de superadmin ao primeiro usuário

O primeiro superadmin é criado com o script `supabase/scripts/promover-superadmin.sql`, seguindo os passos de "Criar o primeiro superadmin" (acima). Lembre: a conta precisa ser criada e confirmada antes, pela página `conta.html`, com o cadastro completo. Depois disso, esse superadmin dá os outros papéis pela aba **Equipe**, sem precisar do SQL.
