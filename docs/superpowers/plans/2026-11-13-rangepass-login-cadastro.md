# RangePass, plano 2 de N: login e cadastro do cliente (etapa 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o cliente cria a conta com os dados obrigatórios e o aceite da política de privacidade, confirma o e-mail, entra, recupera a senha e edita o próprio perfil, numa página nova (`conta.html`).

**Architecture:**
- **Autenticação:** a página usa o Supabase Auth direto do navegador (entrar, sair, esqueci a senha, nova senha) com a chave pública. Isso não dá acesso a nenhuma tabela.
- **Cadastro:** passa por uma Edge Function nova, `cadastro`, sem login. Ela confere os dados, cria o login com `signUp` (que envia o e-mail de confirmação) e grava o perfil numa única chamada.
- **Edição do perfil:** usa a função `minha-conta`, que ganha o método PUT.
- **Regras puras:** CPF, idade, telefone e as mensagens de erro ficam em módulos `.mjs`, usados pelo Node nos testes, pelo Deno nas funções e pelo navegador.
- **E-mails:** saem por um SMTP próprio (Brevo), configurado no painel do Supabase.
- **App atual:** o `index.html` não muda neste plano.

**Tech Stack:** o mesmo do plano 1 (Supabase, CLI `2.20.12` via `npx`, Node com `node:test`, `npm:@supabase/supabase-js@2.45.4` nas funções). No navegador, `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm`. Servidor local de teste: `npx --yes http-server@14.1.1`. E-mail: Brevo (plano gratuito, 300 e-mails/dia).

**Spec:** `docs/superpowers/specs/2026-11-11-rangepass-supabase-design.md`. Seções usadas aqui: 3, 5, 12, 13, 15 (LGPD) e 16 (SMTP na etapa 3).

**Planos seguintes:** 3 = desmock e painel "Meus agendamentos" (etapa 4); 4 = admin (etapa 5); 5 = agenda visual e deploy (etapas 6 e 7).

## Global Constraints

Valem todas as do plano 1 (`docs/superpowers/plans/2026-11-11-rangepass-base-supabase.md`), em especial:
- **PowerShell 5.1** nos comandos do dono.
- **Português do Brasil**, com mensagens que dizem o que aconteceu e o que fazer.
- **Perguntar antes de cada commit.** Nunca fazer push nem merge.
- **Parar no fim de cada tarefa** e dizer como testar.
- **Testes limpam tudo o que criam** e restauram o que alteram.

Novas neste plano:
- **Campos do cadastro:**
  - Obrigatórios: nome completo, CPF (válido e único), telefone e data de nascimento.
  - Opcionais: CR e órgão expedidor.
  - O e-mail é o do login. A confirmação de e-mail é obrigatória (spec 3 e 5).
- **Idade mínima:** vem de `configuracoes.cadastro.idade_minima` (18). O "hoje" é calculado no fuso de `configuracoes.estande.fuso`, nunca no fuso do aparelho.
- **Política de privacidade:**
  - O texto e a versão ficam em `configuracoes.privacidade`, no formato `{versao, texto}`.
  - O perfil guarda `politica_versao` e `politica_aceita_em`.
  - O texto inicial é provisório e precisa de revisão de advogado (spec 15).
- **CPF:** sempre gravado só com dígitos (o banco já exige `^\d{11}$`). O telefone também só com dígitos: 10 ou 11, com DDD.
- **Edição do perfil:**
  - O cliente pode mudar `nome_completo`, `telefone`, `cr` e `orgao_expedidor`.
  - CPF e data de nascimento só mudam no atendimento.
  - Toda mudança vai para o histórico com o autor (`feito_por`).
- **Chave pública no Git:** a chave pública (`sb_publishable_...`) e a URL do projeto ficam em `config.js`, que vai para o Git. Elas são públicas por natureza. A chave secreta **nunca** vai para o Git nem para o navegador.
- **Testes que enviam e-mail:** só rodam se `EMAIL_TESTE` estiver preenchido no `.env.teste`.
  - O endereço usado é `seu-email+teste-...@dominio`, para os e-mails chegarem na caixa do dono.
  - Sem `EMAIL_TESTE`, esses testes ficam como "skipped" e o resto roda normalmente.
  - Nenhum teste envia e-mail para endereço inexistente (`@rangepass.test`), porque o Brevo marcaria o remetente como suspeito.

## Review Focus

1. **E-mail já cadastrado mas ainda não confirmado:** o `signUp` devolve o usuário existente. A falha ao gravar o perfil **não pode apagar** esse usuário. A resposta deve ser 409 em `campos.email`. Teste em `cadastro.test.mjs` (Task 4).
2. **Falha ao gravar o perfil depois de criar o login:** o login recém-criado é apagado, para não sobrar conta sem cadastro. Esse caminho só acontece se dois cadastros com o mesmo CPF chegarem ao mesmo tempo, e não há como forçar isso num teste. O revisor confere no código que o `deleteUser` roda antes da resposta 409 ou 500.
3. **Aniversário hoje e 29 de fevereiro:** quem faz 18 anos hoje pode criar a conta, e quem faz amanhã não. O "hoje" segue o fuso do estande. Testes em `cadastro.test.mjs` de unidade (Task 2).
4. **CPF com pontos e traço, ou com todos os dígitos iguais:** `529.982.247-25` é aceito e gravado como `52998224725`, e `111.111.111-11` é recusado. Testes de unidade (Task 2).
5. **Cliente tentando mudar o CPF pelo PUT:** recebe 400 e o CPF continua o mesmo. Teste em `minha-conta.test.mjs` (Task 5).

---

## Estrutura de arquivos

```
supabase/migrations/20261113000600_cadastro.sql   colunas da política, chave privacidade, criar_perfil, atualizar_perfil
supabase/functions/_shared/cadastro.mjs           puro: CPF, idade, data no fuso, validarCadastro, validarEdicaoPerfil
supabase/functions/_shared/configuracoes.mjs      (alterar) chave privacidade
supabase/functions/cadastro/index.js              GET política + idade; POST cria a conta
supabase/functions/minha-conta/index.js           (alterar) PUT edita o perfil
supabase/config.toml                              (alterar) seção [functions.cadastro]
conta.html                                        página: entrar, criar conta, esqueci a senha, nova senha, meu perfil
conta.css                                         visual escuro com laranja (as mesmas cores do index.html)
conta.js                                          liga a página ao Supabase Auth e às funções
config.js                                         URL do projeto e chave pública
conta-regras.mjs                                  puro: mensagens de erro do login, formatar CPF e telefone
tests/unidade/cadastro.test.mjs
tests/unidade/conta-regras.test.mjs
tests/unidade/configuracoes.test.mjs              (alterar)
tests/integracao/apoio.mjs                        (alterar) emailTeste, idDoUsuarioPorEmail, anotarUsuario, cpf no retorno
tests/integracao/cadastro.test.mjs
tests/integracao/minha-conta.test.mjs             (alterar)
.env.teste.exemplo                                (alterar) EMAIL_TESTE=
README.md                                         (alterar) SMTP, URLs do Auth, como abrir a página localmente
```

---

### Task 1: E-mail próprio (SMTP) e configurações do Auth

Esta tarefa é feita pelo **dono, no painel**, com o construtor guiando passo a passo. O construtor só escreve o README.

**Files:**
- Modify: `README.md` (seção "Login e e-mails": o que foi configurado e onde)

- [ ] **Step 1: Guiar a criação da conta no Brevo**
  - Conta gratuita em brevo.com.
  - Em *Senders, Domains & Dedicated IPs → Senders*, cadastrar e confirmar o e-mail remetente.
  - Em *SMTP & API → SMTP*, gerar uma chave SMTP.
  - Avisar o dono: um remetente `@gmail.com` enviado pelo Brevo pode cair no spam. Um domínio próprio resolve isso, mas fica para o deploy (etapa 7).

- [ ] **Step 2: Guiar a configuração no Supabase (projeto de desenvolvimento)**
  - *Authentication → Emails → SMTP Settings:*
    - host `smtp-relay.brevo.com`, porta `587`;
    - usuário = o login SMTP do Brevo, senha = a chave SMTP;
    - remetente = o e-mail confirmado; nome = `RangePass`.
  - *Authentication → Rate Limits:* e-mails por hora = `30`.
  - *Authentication → Sign In / Providers → Email:*
    - "Confirm email" ligado;
    - tamanho mínimo da senha = `8`.
  - *Authentication → URL Configuration:*
    - Site URL = `http://localhost:5500/conta.html`;
    - Redirect URLs: incluir `http://localhost:5500/**`.
  - *Authentication → Emails → Templates:*
    - "Confirm signup": assunto `Confirme o seu e-mail no RangePass`, corpo `<p>Olá! Para ativar a sua conta no RangePass, clique no link abaixo.</p><p><a href="{{ .ConfirmationURL }}">Confirmar meu e-mail</a></p><p>Se você não criou esta conta, ignore este e-mail.</p>`.
    - "Reset password": assunto `Crie uma nova senha no RangePass`, corpo `<p>Recebemos um pedido para criar uma nova senha.</p><p><a href="{{ .ConfirmationURL }}">Criar nova senha</a></p><p>Se não foi você, ignore este e-mail: a senha atual continua valendo.</p>`.

- [ ] **Step 3: Verificar o envio**

  Em *Authentication → Users → Add user → Send invitation*, o dono convida o próprio e-mail com `+convite` antes do `@`.
  Expected: o e-mail chega, com o remetente RangePass. Depois o dono apaga esse usuário convidado no mesmo painel.

- [ ] **Step 4: README e commit**

  Escrever no README uma seção que liste cada configuração do Step 2. Não escrever nenhuma senha ou chave. Perguntar ao dono antes de fazer o commit.
  ```
  git add README.md
  git commit -m "Documenta o e-mail próprio e as configurações do login"
  ```

---

### Task 2: Regras puras do cadastro

**Files:**
- Create: `supabase/functions/_shared/cadastro.mjs`, `tests/unidade/cadastro.test.mjs`

**Interfaces:**
- Produces (todas exportadas de `_shared/cadastro.mjs`):
  - `somenteDigitos(texto: unknown) -> string` (`''` se não for texto).
  - `cpfValido(cpf: string) -> boolean`: aceita com ou sem pontuação. Recusa tudo que não tiver 11 dígitos ou tiver todos iguais. Confere os dois dígitos verificadores.
  - `dataNoFuso(agora: Date, fuso: string) -> 'AAAA-MM-DD'`, via `Intl.DateTimeFormat('en-CA', { timeZone: fuso })`.
  - `idadeEm(dataNascimento: 'AAAA-MM-DD', hoje: 'AAAA-MM-DD') -> number`: anos completos. Quem nasceu em 29/02 faz aniversário em 01/03 nos anos que não são bissextos.
  - `validarCadastro(dados: object, { idadeMinima: number, hoje: string, versaoPolitica: number }) -> { campos: Record<string,string>, conta: { email, senha }, perfil: { nome_completo, cpf, telefone, data_nascimento, cr, orgao_expedidor } }`.
    - O `email` vai com `trim` e em minúsculas.
    - O `nome_completo` vai com `trim` e espaços repetidos reduzidos a um.
    - `cpf` e `telefone` vão só com dígitos.
    - `cr` e `orgao_expedidor` vão com `trim`; vazio vira `null`.
  - `validarEdicaoPerfil(dados: object) -> { campos, alteracoes }`. Aceita só `nome_completo`, `telefone`, `cr` e `orgao_expedidor`, normalizados como acima.

As mensagens são o texto exato que o cliente verá (chave em `campos` → texto):

| Campo | Quando | Mensagem |
|---|---|---|
| `email` | não tem o formato `algo@algo.algo` | `Informe um e-mail válido.` |
| `senha` | vazia ou não é texto | `Crie uma senha.` |
| `nome_completo` | menos de duas palavras | `Informe o nome completo.` |
| `cpf` | inválido | `Informe um CPF válido.` |
| `telefone` | não tem 10 ou 11 dígitos | `Informe o telefone com DDD.` |
| `data_nascimento` | não é uma data `AAAA-MM-DD` real ou é depois de `hoje` | `Informe a data de nascimento.` |
| `data_nascimento` | idade abaixo da mínima | `` `É preciso ter pelo menos ${idadeMinima} anos para criar uma conta.` `` |
| `aceite_politica_versao` | diferente de `versaoPolitica` | `Para criar a conta, aceite a política de privacidade.` |
| `cr` / `orgao_expedidor` | presente e não é texto | `Revise este campo.` |
| `cpf` / `data_nascimento` (só na edição) | presente | `Para mudar este dado, procure o atendimento do estande.` |
| qualquer outro campo (só na edição) | presente | `Este campo não existe.` |
| `geral` (só na edição) | nenhum campo permitido enviado | `Nada para alterar.` |

- [ ] **Step 1: Escrever os testes**

  Arquivo `tests/unidade/cadastro.test.mjs`. O objeto base de um cadastro válido é:
  ```js
  const VALIDO = { email: ' Ana@Exemplo.com ', senha: 'segredo123', nome_completo: '  Ana   Souza ', cpf: '529.982.247-25',
      telefone: '(11) 98765-4321', data_nascimento: '2000-05-10', cr: '', orgao_expedidor: ' SSP ', aceite_politica_versao: 1 };
  const OPCOES = { idadeMinima: 18, hoje: '2026-11-13', versaoPolitica: 1 };
  ```
  Testes:
  - `cpfValido`:
    - aceita `'52998224725'` e `'529.982.247-25'`;
    - recusa `'52998224724'`, `'111.111.111-11'`, `'123'`, `''` e `undefined`.
  - `dataNoFuso(new Date('2026-11-14T02:30:00Z'), 'America/Sao_Paulo') === '2026-11-13'`.
  - `idadeEm`:
    - `('2008-11-13','2026-11-13') === 18`;
    - `('2008-11-14','2026-11-13') === 17`;
    - `('2008-02-29','2026-02-28') === 17`;
    - `('2008-02-29','2026-03-01') === 18`.
  - `validarCadastro(VALIDO, OPCOES)` devolve:
    - `campos` igual a `{}`;
    - `conta` igual a `{ email: 'ana@exemplo.com', senha: 'segredo123' }`;
    - `perfil` igual a `{ nome_completo: 'Ana Souza', cpf: '52998224725', telefone: '11987654321', data_nascimento: '2000-05-10', cr: null, orgao_expedidor: 'SSP' }`.
  - Uma mensagem por linha da tabela: troca-se um campo de `VALIDO` e confere-se `campos[campo]` com o texto exato.
  - Casos de idade:
    - nascimento `'2008-11-14'` dá a mensagem de idade mínima de 18 anos;
    - nascimento `'2008-11-13'` passa;
    - nascimento `'2027-01-01'` dá `Informe a data de nascimento.`
  - `validarEdicaoPerfil`:
    - `{ telefone: '11 3456-7890', cr: ' 123 ' }` dá `alteracoes` igual a `{ telefone: '1134567890', cr: '123' }`, sem campos com erro;
    - `{ cpf: '52998224725' }` dá a mensagem do atendimento em `campos.cpf`;
    - `{ apelido: 'x' }` dá `Este campo não existe.`;
    - `{}` dá `campos.geral`.

- [ ] **Step 2: Rodar e ver falhar**

  Run: `npm test`
  Expected: FAIL, porque o módulo `cadastro.mjs` ainda não existe.

- [ ] **Step 3: Implementar `supabase/functions/_shared/cadastro.mjs`**

  O módulo é puro, como `configuracoes.mjs`: nada do Deno nem do Node. Uma data é real quando `new Date(data + 'T00:00:00Z')` volta à mesma string em `toISOString().slice(0, 10)`.

- [ ] **Step 4: Rodar e ver passar**

  Run: `npm test`
  Expected: todos passam, os 74 anteriores mais os novos.

- [ ] **Step 5: Commit (perguntar antes)**
  ```
  git add supabase/functions/_shared/cadastro.mjs tests/unidade/cadastro.test.mjs
  git commit -m "Cria as regras do cadastro: CPF, idade no fuso do estande e campos do perfil"
  ```

---

### Task 3: Banco: política de privacidade e gravação do perfil com autor

**Files:**
- Create: `supabase/migrations/20261113000600_cadastro.sql`
- Modify: `supabase/functions/_shared/configuracoes.mjs`, `tests/unidade/configuracoes.test.mjs`, `tests/integracao/base.test.mjs`

**Interfaces:**
- Produces:
  - `perfis.politica_versao int` (pode ficar vazio) e `perfis.politica_aceita_em timestamptz` (pode ficar vazio). A equipe cadastrada pelo superadmin pode não ter aceite.
  - Linha `configuracoes.privacidade = {"versao":1,"texto":"..."}`.
    - O texto é provisório, em português, e diz para que os dados servem (operação do estande e obrigações legais).
    - Diz também que o titular pode pedir para ver, corrigir ou anonimizar os dados no atendimento.
    - Termina com a frase `Texto provisório: deve ser revisado por um advogado antes do uso com clientes reais.`
  - `public.criar_perfil(p_usuario uuid, p_dados jsonb) returns public.perfis`:
    - security definer;
    - grava `app.usuario_id = p_usuario`, insere com `jsonb_populate_record` e devolve a linha;
    - CPF repetido dá o erro `23505` do banco.
  - `public.atualizar_perfil(p_usuario uuid, p_dados jsonb, p_autor uuid) returns public.perfis`:
    - security definer;
    - grava `app.usuario_id = p_autor`;
    - muda só as chaves de `nome_completo`, `telefone`, `cr` e `orgao_expedidor` que vierem em `p_dados` (usa `p_dados ? 'cr'`, para que `null` apague o CR);
    - devolve a linha, ou `null` se o perfil não existir.
  - As duas funções recebem `grant execute ... to service_role`, e o bloco de bloqueio é repetido no fim da migração.
  - `CHAVES_CONFIGURACAO` ganha `'privacidade'`. Validação:
    - `texto`: texto não vazio, senão `Escreva o texto da política.`;
    - `versao`: inteiro maior que 0, senão a mensagem já usada para os números.

- [ ] **Step 1: Escrever os testes**
  - **Unidade:**
    - o teste das chaves passa a esperar sete chaves, terminando em `'privacidade'`;
    - `validarConfiguracao('privacidade', { versao: 2, texto: 'x' })` dá `{}`;
    - `{ versao: 0, texto: 'x' }` dá `campos.versao`;
    - `{ versao: 1, texto: '  ' }` dá `campos.texto === 'Escreva o texto da política.'`.
  - **Integração (`base.test.mjs`):**
    - `configuracoes?chave=eq.privacidade` tem `valor.versao === 1`, e o texto contém `advogado`;
    - `rpc('criar_perfil', ...)` para um usuário criado com `criarUsuario({ perfil: false })` devolve o perfil, e o histórico de `perfis` desse id tem `feito_por` igual ao usuário;
    - `rpc('atualizar_perfil', { p_usuario, p_dados: { telefone: '1134567890', cpf: '00000000000' }, p_autor })` muda o telefone e **não** muda o CPF, e o histórico registra `p_autor`;
    - `rpc('criar_perfil')` com CPF já usado dá `code === '23505'`.

- [ ] **Step 2: Rodar e ver falhar**

  Run: `npm test` e `npm run test:integracao`
  Expected: FAIL. A chave `privacidade` ainda não existe, e a RPC dá 404.

- [ ] **Step 3: Escrever a migração e alterar `configuracoes.mjs`**

- [ ] **Step 4: Aplicar e rodar**

  Run: `npx --yes supabase@2.20.12 db push`, depois `npm test` e `npm run test:integracao`.
  Expected: tudo passa, sem resíduo no Table Editor.

- [ ] **Step 5: Commit (perguntar antes)**
  ```
  git add supabase/migrations/20261113000600_cadastro.sql supabase/functions/_shared/configuracoes.mjs tests/unidade/configuracoes.test.mjs tests/integracao/base.test.mjs
  git commit -m "Guarda a política de privacidade e grava o perfil com o autor no histórico"
  ```

---

### Task 4: Edge Function `cadastro`

**Files:**
- Create: `supabase/functions/cadastro/index.js`, `tests/integracao/cadastro.test.mjs`
- Modify: `supabase/config.toml` (`[functions.cadastro]` com `entrypoint = "./functions/cadastro/index.js"` e `verify_jwt = false`), `tests/integracao/apoio.mjs`, `.env.teste.exemplo`

**Interfaces:**
- Consumes: `validarCadastro` e `dataNoFuso` (Task 2), `criar_perfil` (Task 3), `admin` de `_shared/contexto.js`.
- Produces:
  - **`GET /functions/v1/cadastro`** (sem login): 200 `{ estande: { nome, fuso }, idade_minima, politica: { versao, texto } }`.
  - **`POST /functions/v1/cadastro`** (sem login), corpo = os campos de `validarCadastro`. Respostas, nesta ordem de checagem:
    1. JSON ilegível: 400 `{ erro: 'Não foi possível ler os dados enviados. Tente de novo.' }`.
    2. Campos inválidos: 400 `{ erro: 'Revise os campos destacados.', campos }`.
    3. CPF que já existe em `perfis`: 409, `campos.cpf = 'Este CPF já tem conta. Entre com o seu e-mail ou recupere a senha.'`.
    4. Login criado com `signUp`, usando um cliente com `SUPABASE_ANON_KEY` e `{ auth: { persistSession: false } }`. Sem `emailRedirectTo`: vale a Site URL. Erros do `signUp`:
       - `weak_password`: 400, `campos.senha = 'Escolha uma senha mais forte, com pelo menos 8 caracteres.'`;
       - `over_email_send_rate_limit` ou `over_request_rate_limit`: 429 `{ erro: 'Muitos cadastros em pouco tempo. Espere alguns minutos e tente de novo.' }`;
       - `data.user.identities` vazio (e-mail já confirmado): 409, `campos.email = 'Este e-mail já tem conta. Entre ou recupere a senha.'`.
    5. `criar_perfil` com o perfil, mais `politica_versao` e `politica_aceita_em = new Date().toISOString()`. Se falhar:
       - se já existe um perfil com o id desse usuário (e-mail não confirmado com cadastro): **não apaga nada** e responde 409, `campos.email = 'Este e-mail já tem conta. Procure o link de confirmação no seu e-mail.'`;
       - senão, apaga o login recém-criado (`admin.auth.admin.deleteUser`). Com código `23505`, responde 409 com a mensagem de CPF do item 3. Com qualquer outro erro, deixa o `tratar` responder 500.
    6. Sucesso: 201 `{ mensagem: `Conta criada. Enviamos um link de confirmação para ${email}. Abra o e-mail para ativar a conta.` }`.
- Em `apoio.mjs`:
  - `criarUsuario` passa a devolver também `cpf` e aceita `{ confirmado = true, email }`. `confirmado` vai para `email_confirm`; com `confirmado: false`, não faz login e devolve `token: null`. Sem `email`, usa `${marcador()}@rangepass.test`;
  - `anotarUsuario(id: string) -> void` (entra na lista que `apagarUsuariosCriados` apaga);
  - `idDoUsuarioPorEmail(email: string) -> Promise<string|null>` (GET `auth/v1/admin/users?page=1&per_page=1000`, procurando o e-mail);
  - `emailTeste() -> string|null` (de `EMAIL_TESTE`: `a@b.com` vira `a+${marcador()}@b.com`; vazio dá `null`).

- [ ] **Step 1: Escrever os testes em `tests/integracao/cadastro.test.mjs`**

  Um ajudante `corpoValido(extra)` monta um cadastro válido:
  - `email` = `${marcador()}@rangepass.test`;
  - CPF válido gerado, função `cpfValidoAleatorio()` no próprio teste: 9 dígitos aleatórios mais os 2 verificadores;
  - nascimento `1990-01-01` e `aceite_politica_versao: 1`.

  Usuários criados são anotados para limpeza. A política de testes que mandam e-mail está nas Global Constraints. Testes:
  - `GET devolve a política e a idade mínima`: status 200, `idade_minima === 18`, `politica.versao === 1`, `estande.fuso === 'America/Sao_Paulo'`.
  - `CPF inválido recebe 400 e nenhum login é criado`: `campos.cpf`, e `idDoUsuarioPorEmail(email) === null`.
  - `menor de idade recebe 400`: nascimento = hoje em São Paulo menos 17 anos; confere `campos.data_nascimento`.
  - `sem aceite da política recebe 400`: `aceite_politica_versao: 0`; confere `campos.aceite_politica_versao`.
  - `CPF já cadastrado recebe 409`: usa o `cpf` de um `criarUsuario()`; confere `campos.cpf`, e nenhum login novo com aquele e-mail.
  - `e-mail já confirmado recebe 409`: usa o `email` de um `criarUsuario()` e um CPF novo; confere `campos.email`, e o CPF novo não aparece em `perfis`.
  - `[EMAIL_TESTE] cadastro completo` (`test(..., { skip: !emailTeste() })`):
    - status 201;
    - o perfil do CPF existe, com `politica_versao === 1` e `politica_aceita_em` preenchido;
    - o histórico tem `feito_por` igual ao id;
    - o login com senha (`auth/v1/token?grant_type=password`) dá 400 com `error_code === 'email_not_confirmed'`.
  - `[EMAIL_TESTE] e-mail não confirmado com cadastro recebe 409 e a conta continua`:
    - `criarUsuario({ confirmado: false, email: emailTeste() })`;
    - cadastro com o mesmo e-mail e outro CPF dá 409 em `campos.email`;
    - `idDoUsuarioPorEmail` ainda devolve o id, e o perfil antigo continua.

- [ ] **Step 2: Rodar e ver falhar**

  Run: `npm run test:integracao`
  Expected: FAIL, porque a função `cadastro` ainda não existe (404).

- [ ] **Step 3: Implementar `supabase/functions/cadastro/index.js` e a seção do `config.toml`**

  Lê `cadastro`, `privacidade` e `estande` de `configuracoes` numa só consulta. Calcula `hoje = dataNoFuso(new Date(), estande.fuso)`. Métodos que não sejam GET ou POST recebem 405 `Esta ação não é permitida aqui.`

- [ ] **Step 4: Publicar e rodar**

  Run: `npx --yes supabase@2.20.12 functions deploy cadastro --use-api`, depois `npm run test:integracao`.
  Expected: tudo passa. Com `EMAIL_TESTE` preenchido, chegam 2 e-mails de confirmação ao dono, e ninguém deve clicar neles. O Table Editor fica sem resíduo.

- [ ] **Step 5: Commit (perguntar antes)**
  ```
  git add supabase/functions/cadastro/index.js supabase/config.toml tests/integracao/cadastro.test.mjs tests/integracao/apoio.mjs .env.teste.exemplo
  git commit -m "Cria a função de cadastro do cliente, com confirmação de e-mail"
  ```

---

### Task 5: `minha-conta` passa a editar o perfil

**Files:**
- Modify: `supabase/functions/minha-conta/index.js`, `tests/integracao/minha-conta.test.mjs`

**Interfaces:**
- Consumes: `validarEdicaoPerfil` (Task 2), `atualizar_perfil` (Task 3), `obterContexto`.
- Produces: `PUT /functions/v1/minha-conta` com login, corpo = campos editáveis. Respostas:
  - JSON ilegível: 400 com a mensagem do Task 4.
  - Campos inválidos: 400 `{ erro: 'Revise os campos destacados.', campos }`.
  - Sem perfil (`contexto.perfil === null`): 404 `{ erro: 'Não encontramos o seu cadastro. Procure o atendimento do estande.' }`.
  - Sucesso: 200 `{ perfil }` com a linha atualizada.
  - O GET continua igual. Outros métodos recebem 405.

- [ ] **Step 1: Escrever os testes**
  - `cliente altera telefone e CR e o histórico guarda o autor`: 200; `perfil.telefone === '1134567890'`; `perfil.cr === '123'`; a última linha do histórico de `perfis` desse id tem `feito_por === u.id`.
  - `cliente não muda o CPF`: PUT `{ cpf: '52998224725' }` dá 400 e `campos.cpf` com a mensagem do atendimento. O GET depois mostra o CPF antigo.
  - `telefone inválido recebe 400`: `{ telefone: '123' }` dá `campos.telefone === 'Informe o telefone com DDD.'`
  - `usuário sem cadastro recebe 404`.
  - `sem login recebe 401 no PUT`.

- [ ] **Step 2: Rodar e ver falhar**

  Run: `npm run test:integracao`
  Expected: os novos testes falham com 405.

- [ ] **Step 3: Implementar o PUT**

- [ ] **Step 4: Publicar e rodar**

  Run: `npx --yes supabase@2.20.12 functions deploy minha-conta --use-api`, depois `npm run test:integracao`.
  Expected: tudo passa.

- [ ] **Step 5: Commit (perguntar antes)**
  ```
  git add supabase/functions/minha-conta/index.js tests/integracao/minha-conta.test.mjs
  git commit -m "Permite ao cliente editar o próprio perfil, com histórico"
  ```

---

### Task 6: Página `conta.html`

**Files:**
- Create: `conta.html`, `conta.css`, `conta.js`, `config.js`, `conta-regras.mjs`, `tests/unidade/conta-regras.test.mjs`
- Modify: `README.md` (como abrir a página localmente)

**Interfaces:**
- Consumes: `GET`/`POST cadastro` (Task 4), `GET`/`PUT minha-conta` (Task 5), `validarCadastro`, `validarEdicaoPerfil` e `dataNoFuso`, importados no navegador de `./supabase/functions/_shared/cadastro.mjs`.
- Produces:
  - **`config.js`:** `export const SUPABASE_URL`, `export const SUPABASE_CHAVE_PUBLICA`, com os valores do projeto de desenvolvimento.
  - **`conta-regras.mjs`:**
    - `mensagemDoErroDeLogin(erro: { code?: string } | null) -> string`, com estes textos:

      | `code` | Mensagem |
      |---|---|
      | `invalid_credentials` | `E-mail ou senha incorretos. Confira e tente de novo.` |
      | `email_not_confirmed` | `Confirme o seu e-mail antes de entrar. Procure o link na sua caixa de entrada (e no spam).` |
      | `over_request_rate_limit`, `over_email_send_rate_limit` | `Muitas tentativas em pouco tempo. Espere alguns minutos e tente de novo.` |
      | `weak_password` | `Escolha uma senha mais forte, com pelo menos 8 caracteres.` |
      | `same_password` | `A nova senha precisa ser diferente da anterior.` |
      | `user_banned` | `Sua conta está desativada. Procure o atendimento do estande.` |
      | qualquer outro, ou `null` | `Não foi possível concluir agora. Tente de novo em instantes.` |
    - `formatarCpf('52998224725') -> '529.982.247-25'`;
    - `formatarTelefone('11987654321') -> '(11) 98765-4321'`, `formatarTelefone('1134567890') -> '(11) 3456-7890'`;
    - qualquer outra entrada volta sem mudança.
- **Telas de `conta.html`:** uma `<section>` por tela, e só uma visível por vez.
  - **Entrar:** e-mail, senha e os links "Criar conta" e "Esqueci a senha".
  - **Criar conta:**
    - todos os campos do cadastro;
    - a política num `<details>`, mais a caixa "Li e aceito a política de privacidade";
    - os erros aparecem embaixo de cada campo, vindos de `validarCadastro` antes do envio e de `campos` depois;
    - no sucesso, mostra a `mensagem` da função.
  - **Esqueci a senha:** chama `resetPasswordForEmail(email, { redirectTo: location.origin + '/conta.html' })`. Mostra sempre `Se este e-mail tiver conta, enviamos um link para criar uma nova senha.`
  - **Nova senha:** aparece no evento `PASSWORD_RECOVERY` e chama `updateUser({ password })`.
  - **Meu perfil:**
    - mostra e-mail, nome, CPF formatado, nascimento (`DD/MM/AAAA`), telefone formatado, CR e órgão;
    - um formulário edita os campos permitidos (PUT `minha-conta`), e há o botão "Sair";
    - em 403 com a mensagem de conta desativada, mostra a mensagem e faz `signOut`.
- **Comportamento:**
  - Ao abrir: com sessão, vai para "Meu perfil"; sem sessão, vai para "Entrar". O link de confirmação abre a página já com a sessão.
  - As funções são chamadas com `fetch` em `${SUPABASE_URL}/functions/v1/<nome>`, com `apikey: SUPABASE_CHAVE_PUBLICA` e `Authorization: Bearer <access_token>`.
  - Os botões ficam desabilitados enquanto há uma chamada em andamento.
- **Visual:** `conta.css` usa as mesmas variáveis de cor do `:root` do `index.html` (fundo escuro, laranja `#e65100`) e é pensado para o celular, com coluna única e largura máxima de 480px.

- [ ] **Step 1: Escrever `tests/unidade/conta-regras.test.mjs`**

  Uma asserção por linha da tabela de mensagens. Testar também o `null` e os três exemplos de formatação. `formatarCpf('123')` devolve `'123'`.

- [ ] **Step 2: Rodar e ver falhar**

  Run: `npm test`
  Expected: FAIL, porque o módulo ainda não existe.

- [ ] **Step 3: Implementar `conta-regras.mjs`**

  O script `test` do `package.json` já roda `tests/unidade/**/*.test.mjs`, então não precisa mudar nada.

- [ ] **Step 4: Rodar e ver passar**

  Run: `npm test`
  Expected: tudo passa.

- [ ] **Step 5: Implementar `conta.html`, `conta.css`, `conta.js`, `config.js` e o README**

- [ ] **Step 6: Teste manual guiado com o dono**

  Run: `npx --yes http-server@14.1.1 -p 5500 -c-1`, depois abrir `http://localhost:5500/conta.html` no celular (modo de celular do navegador) ou no computador.

  Expected, nesta ordem:
  1. Criar conta com CPF inválido mostra o erro embaixo do CPF, sem enviar nada.
  2. Criar conta válida mostra "Conta criada..." e o e-mail chega em português.
  3. Entrar antes de confirmar mostra a mensagem de e-mail não confirmado.
  4. Clicar no link do e-mail abre "Meu perfil", com CPF e telefone formatados.
  5. Mudar o telefone e salvar faz o valor novo aparecer depois de recarregar a página.
  6. Clicar em "Sair" e depois em "Esqueci a senha" faz o e-mail chegar. O link abre "Nova senha", e com a senha nova dá para entrar.
  7. No Table Editor, o perfil tem `politica_versao = 1`, e o histórico mostra o autor.
  8. No fim, o dono apaga a conta de teste (*Authentication → Users*, depois a linha em `perfis`), ou pede ao construtor para apagar.

- [ ] **Step 7: Commit (perguntar antes)**
  ```
  git add conta.html conta.css conta.js config.js conta-regras.mjs tests/unidade/conta-regras.test.mjs README.md
  git commit -m "Cria a página da conta: entrar, criar conta, recuperar senha e editar o perfil"
  ```
