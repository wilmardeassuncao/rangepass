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

1. No painel do Supabase, abra **Authentication → Users → Add user → Create new user**. Informe o e-mail e a senha e deixe marcada a opção **Auto Confirm User**.
2. Abra o **SQL Editor** e cole o conteúdo de `supabase/scripts/promover-superadmin.sql`.
3. Troque `SEU-EMAIL@exemplo.com` pelo e-mail do passo 1 (ele aparece duas vezes) e clique em **Run**.
4. O resultado deve mostrar uma linha com o e-mail e o papel `superadmin`. Essa conta já pode alterar as Configurações.

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
