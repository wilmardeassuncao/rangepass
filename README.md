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
