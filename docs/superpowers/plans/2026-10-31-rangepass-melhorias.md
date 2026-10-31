# RangePass: plano das 4 melhorias

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Objetivo:** tornar o agendamento confiável (falha visível, regras do estande, instrutor sem conflito, um registro por agendamento) e dar ao app um visual profissional.

**Arquitetura:** o app continua sendo uma página sem etapa de build. As regras puras saem para `regras.js`, carregado pelo `index.html` e testado no Node. O Make continua sendo o único backend: recebe o agendamento no Finalizar, recusa conflitos de instrutor, grava na planilha e responde ao app.

**Tecnologias:** HTML, CSS e JavaScript puro; Node 18 com `node:test` só para testes, sem instalar dependências; Make.com; Google Sheets.

**Especificação:** não há documento separado. A especificação é o resumo aprovado no chat em 2026-10-31, reproduzido nas seções "Decisões" e "Restrições globais".

## Decisões

- O atirador edita ou exclui apenas na tela de resumo, antes de finalizar. Depois de finalizar, não há edição nem exclusão pelo app.
- O envio ao Make acontece somente no **Finalizar**.
- Sucesso significa "gravado na planilha".
- Falha: o atirador permanece no resumo, com dados preservados, mensagem clara e botão para tentar de novo.
- Duas pessoas podem usar o mesmo horário com instrutores diferentes. O mesmo instrutor não pode ter sessões sobrepostas.
- Layout: direção B (Moderno) refinada, escura com laranja.
- **Fora do escopo:** lista de agendamentos, login, mostrar horários ocupados antes da escolha, proteger o webhook exposto.

## Restrições globais

- Sem frameworks e sem dependências instaladas.
- Os commits são feitos pelo usuário. Não executar `git commit` nem `git push`.
- Ao final de cada melhoria: **parar** e aguardar o teste e o commit do usuário.
- Instrutores: `J.CARLOS`, `MARLON`, `JP.BROTAS`, `MATOS`, `W.ASSUNCAO`, `PEDRO`, `NAPOLEAO`, `MAURICIO`.
- Armamentos (exemplo, fácil de trocar): `Pistola .380`, `Pistola 9mm`, `Revólver .38`, `Carabina .22`, `Espingarda calibre 12`.
- Munição: inteiro, mínimo 50, sem máximo.
- Início: horas cheias, de 8 a 22. Fim máximo: 23. Duração: inteiro a partir de 1. Antecedência mínima: 24 horas. Todos os dias.
- Horários calculados no fuso do aparelho.
- Webhook: manter a URL atual, em uma única constante.
- Textos da interface em português do Brasil.

## Contrato entre o app e o Make

O app envia `POST` com `Content-Type: application/json`:

```json
{
  "usuario": "Carlos Lima",
  "armamento": "Pistola 9mm",
  "municao_qtd": 50,
  "instrutor": "MARLON",
  "data": "2026-11-14",
  "hora_inicio": 14,
  "duracao_horas": 2,
  "hora_fim": 16
}
```

Até a Melhoria 2, o corpo mantém apenas os campos atuais.

O Make sempre responde com status `200` e um destes corpos:

| Corpo | Significado |
|---|---|
| `{"status":"ok"}` | Gravado na planilha |
| `{"status":"conflito"}` | Instrutor ocupado, nada gravado |

Qualquer outra resposta, inclusive o `Accepted` padrão do Make, conta como **falha**. Essa regra é proposital: sem o módulo Webhook response, o app nunca mostra sucesso sem a confirmação da gravação.

## Pontos a confirmar no Make

Estes pontos não foram confirmados na documentação oficial e são testados nas tarefas indicadas:

- **CORS (Tarefa 3):** não foi encontrada documentação sobre como o Make trata chamadas de navegador. Se o navegador bloquear o envio, trocar o `Content-Type` para `text/plain` e adicionar um módulo **Parse JSON** logo após o webhook.
- **Busca sem resultado (Tarefa 7):** relatos da comunidade divergem. Uma resposta aceita diz que o Search Rows devolve **Total number of bundles = 0**; outras dizem que o cenário para. Se o cenário parar, interromper a tarefa e rever a solução antes de seguir.
- **Tempo limite:** a documentação consultada não informa o limite de espera da resposta do webhook. O app espera 60 segundos.

## Pontos de atenção

1. **Resposta perdida depois de gravar:** a gravação funciona, mas a resposta não chega ao app. Ao tentar de novo, o instrutor aparece ocupado pelo próprio agendamento. O app deve avisar que o agendamento pode já ter sido gravado.
2. **Duplo clique no Finalizar:** apenas um envio pode sair.
3. **Sair do resumo durante o envio:** Editar e Excluir ficam desativados enquanto o envio está em andamento.
4. **Trocar o início depois de escolher a duração:** se a duração deixar de caber, ela não pode continuar selecionada.
5. **Atirador que abre a página e demora:** a antecedência é validada ao revisar e novamente ao finalizar.

---

# Melhoria 1: aviso de falha no envio

### Tarefa 1: interpretar a resposta do Make

**Arquivos:**
- Criar: `regras.js`
- Criar: `tests/regras.test.js`

**Interfaces:**
- Produz: `interpretarResposta(ok: boolean, corpo: string): 'sucesso' | 'conflito' | 'falha'`
- `regras.js` define funções globais para o navegador e termina com `if (typeof module !== 'undefined') module.exports = { ... }` para o Node.

- [ ] **Passo 1: escrever os testes que falham**

```js
const test = require('node:test');
const assert = require('node:assert');
const { interpretarResposta } = require('../regras.js');

test('ok com status ok é sucesso', () => assert.equal(interpretarResposta(true, '{"status":"ok"}'), 'sucesso'));
test('ok com status conflito é conflito', () => assert.equal(interpretarResposta(true, '{"status":"conflito"}'), 'conflito'));
test('Accepted padrão do Make é falha', () => assert.equal(interpretarResposta(true, 'Accepted'), 'falha'));
test('corpo vazio é falha', () => assert.equal(interpretarResposta(true, ''), 'falha'));
test('JSON com status desconhecido é falha', () => assert.equal(interpretarResposta(true, '{"status":"x"}'), 'falha'));
test('JSON null é falha', () => assert.equal(interpretarResposta(true, 'null'), 'falha'));
test('HTTP com erro é falha mesmo com corpo ok', () => assert.equal(interpretarResposta(false, '{"status":"ok"}'), 'falha'));
```

- [ ] **Passo 2: rodar e confirmar a falha**

Rodar: `node --test tests/`
Esperado: FALHA, por `regras.js` não existir.

- [ ] **Passo 3: implementar `interpretarResposta` em `regras.js`**

- [ ] **Passo 4: rodar e confirmar que passa**

Rodar: `node --test tests/`
Esperado: 7 testes passando.

### Tarefa 2: enviar somente no Finalizar

**Arquivos:**
- Modificar: `index.html` (botão Finalizar, nova área de aviso no resumo, `submitData`, novo `finalizar`, inclusão de `regras.js`)

**Interfaces:**
- Consome: `interpretarResposta`
- Produz: `async function finalizar(): Promise<void>`, `mostrarAviso(mensagem: string): void`, `limparAviso(): void`, `definirEnvioEmAndamento(ativo: boolean): void`

- [ ] **Passo 1: ajustar `submitData`** para apenas guardar os dados, preencher o resumo e navegar, sem chamar `fetch`.

- [ ] **Passo 2: adicionar ao resumo** `<div id="aviso-envio" role="alert" hidden></div>`, antes dos botões.

- [ ] **Passo 3: implementar `finalizar()`**

Sequência: ativar envio em andamento (Finalizar, Editar e Excluir desativados; Finalizar mostra "Enviando..."); limpar aviso; fazer `POST`, com `AbortController` de 60 segundos; ler `response.text()`; aplicar `interpretarResposta`. Em `sucesso`, navegar para `screen-success`. Em `falha` ou exceção, permanecer no resumo, trocar o texto do botão para "Tentar novamente" e mostrar:

> Não foi possível confirmar seu agendamento. Seus dados foram mantidos. Verifique sua conexão e tente novamente.

Em `conflito`, nesta melhoria, tratar como `falha`. No `finally`, desativar o envio em andamento.

- [ ] **Passo 4: garantir a limpeza** de aviso e texto do botão em `editData`, ao salvar de novo e em `resetApp`.

- [ ] **Passo 5: verificar no navegador com um `fetch` simulado**

Sem usar o webhook real, substituir `window.fetch` pelo console e conferir:
- rejeição gera aviso, dados mantidos e "Tentar novamente";
- corpo `Accepted` gera aviso;
- `{"status":"ok"}` leva à tela de sucesso;
- duplo clique gera apenas uma chamada;
- nenhuma chamada sai ao clicar em Salvar.

### Tarefa 3: ajustar o Make e testar de ponta a ponta

**Quem faz:** usuário, seguindo este roteiro, antes de testar com o webhook real.

- [ ] **Passo 1:** no cenário, adicionar **Webhooks > Webhook response** logo após **Add a Row**, como último módulo.
- [ ] **Passo 2:** configurar Status `200`; Body `{"status":"ok"}`; em Custom headers, `Content-Type: application/json` e `Access-Control-Allow-Origin: *`.
- [ ] **Passo 3:** confirmar que o cenário termina no Webhook response (Webhook → Google Sheets → Webhook response). O cenário não tem módulo de e-mail.
- [ ] **Passo 4:** com o cenário ativo, abrir o app, finalizar um agendamento de teste e conferir a tela de sucesso e a linha na planilha.
- [ ] **Passo 5:** desativar a internet, finalizar e conferir o aviso. Reativar e tentar novamente.
- [ ] **Passo 6:** se o navegador bloquear o envio, aplicar a alternativa de CORS descrita em "Pontos a confirmar no Make".

**PARADA: o usuário testa e faz o commit da Melhoria 1.**

---

# Melhoria 2: validação, data e horário

### Tarefa 4: regras do agendamento

**Arquivos:**
- Modificar: `regras.js`, `tests/regras.test.js`

**Interfaces:**
- Produz:
  - `INSTRUTORES: string[]`, `ARMAMENTOS: string[]`
  - `HORAS_INICIO: number[]` (8 a 22)
  - `HORA_FECHAMENTO = 23`, `MUNICAO_MINIMA = 50`, `ANTECEDENCIA_HORAS = 24`
  - `duracoesPermitidas(horaInicio: number): number[]`
  - `validarAgendamento(dados, agora: Date): Record<string, string>`, com uma mensagem por campo inválido e objeto vazio quando tudo está válido
- `dados` tem `usuario`, `armamento`, `municao_qtd`, `instrutor`, `data` e `hora_inicio`, `duracao_horas` como textos do formulário.

- [ ] **Passo 1: escrever os testes que falham**, com `agora = new Date(2026, 10, 1, 10, 0)` e um agendamento-base válido:

| Teste | Entrada | Resultado esperado |
|---|---|---|
| válido | base | `{}` |
| usuário vazio | `usuario: '   '` | erro em `usuario` |
| instrutor fora da lista | `instrutor: 'João'` | erro em `instrutor` |
| armamento fora da lista | `armamento: 'Bazuca'` | erro em `armamento` |
| munição 49 | `'49'` | erro em `municao_qtd` |
| munição 50 | `'50'` | sem erro |
| munição negativa | `'-50'` | erro em `municao_qtd` |
| munição decimal | `'50.5'` | erro em `municao_qtd` |
| munição alta | `'100000'` | sem erro |
| data vazia | `''` | erro em `data` |
| exatamente 24h | `2026-11-02`, início `10` | sem erro |
| 23h de antecedência | `2026-11-02`, início `9` | erro em `data` |
| início 7 | `'7'` | erro em `hora_inicio` |
| início 22 com 1h | `'22'`, `'1'` | sem erro |
| início 22 com 2h | `'22'`, `'2'` | erro em `duracao_horas` |
| início 21 com 2h | `'21'`, `'2'` | sem erro |
| duração 0 | `'0'` | erro em `duracao_horas` |
| duração decimal | `'1.5'` | erro em `duracao_horas` |

Também testar: `duracoesPermitidas(22)` é `[1]`, `duracoesPermitidas(21)` é `[1, 2]`, `duracoesPermitidas(8)` tem 15 itens.

- [ ] **Passo 2: rodar e confirmar a falha**

Rodar: `node --test tests/`
Esperado: FALHA nos testes novos.

- [ ] **Passo 3: implementar em `regras.js`**

Números inteiros validados com `/^\d+$/` sobre o texto aparado, para recusar `-50`, `50.5` e `1e3`. Montar o início como `new Date(ano, mes - 1, dia, hora)` e exigir `inicio - agora >= 24h`.

- [ ] **Passo 4: rodar e confirmar que passa**

Rodar: `node --test tests/`
Esperado: todos passando.

### Tarefa 5: formulário novo

**Arquivos:**
- Modificar: `index.html`

**Interfaces:**
- Consome: as constantes, `duracoesPermitidas` e `validarAgendamento`
- Produz: `montarFormulario(): void`, `atualizarDuracoes(): void`, `mostrarErros(erros: Record<string, string>): void`, `lerFormulario(): object`

- [ ] **Passo 1:** preencher, a partir de `regras.js`, as listas de instrutor, armamento, início e duração. O texto inicial de cada lista é uma opção vazia ("Selecione").
- [ ] **Passo 2:** adicionar os campos `data` (`type="date"`, com `min` igual à data mínima pela antecedência), `hora_inicio` e `duracao_horas`. Em munição, usar `min="50"` e `step="1"`.
- [ ] **Passo 3:** ao trocar o início, recalcular as durações. Se a duração atual não couber, limpá-la e mostrar erro no campo.
- [ ] **Passo 4:** usar `novalidate` no formulário e `validarAgendamento` como única fonte de erros, com mensagem abaixo de cada campo e foco no primeiro inválido.
- [ ] **Passo 5:** permitir rolagem nas telas com `overflow-y: auto` em `.screen`, para os novos campos não serem cortados.
- [ ] **Passo 6:** mostrar no resumo data no formato `14/11/2026`, início e fim (`14h às 16h`) e duração.
- [ ] **Passo 7:** verificar no navegador cada linha da tabela da Tarefa 4 e a troca de início de 8h com 5 horas para 22h.

### Tarefa 6: enviar os campos novos e tratar o conflito

**Arquivos:**
- Modificar: `index.html`

**Interfaces:**
- Consome: `finalizar`, `mostrarAviso`, `validarAgendamento`

- [ ] **Passo 1:** enviar o corpo definido no contrato, com `municao_qtd`, `hora_inicio`, `duracao_horas` e `hora_fim` numéricos e `usuario` aparado.
- [ ] **Passo 2:** no início de `finalizar`, validar de novo. Se a antecedência tiver expirado, mostrar o erro no resumo e não enviar.
- [ ] **Passo 3:** ao receber `conflito`, mostrar:

> {instrutor} já está ocupado nesse horário. Altere o horário ou o instrutor em Editar.

Não usar "Tentar novamente" nesse caso. Se uma tentativa anterior deste mesmo agendamento tiver falhado, acrescentar:

> Se você já tentou enviar antes, o agendamento pode ter sido gravado. Confirme com o estande antes de alterar.

- [ ] **Passo 4:** verificar com `fetch` simulado: `conflito` na primeira tentativa mostra só a mensagem de ocupado; `falha` seguida de `conflito` mostra também o texto adicional; `Editar` limpa o aviso.

### Tarefa 7: conflito de instrutor no Make

**Quem faz:** usuário, seguindo este roteiro. A ordem final será: Webhook → Search Rows → Router.

- [ ] **Passo 1:** na planilha, adicionar ao final as colunas `Data`, `Início`, `Duração` e `Fim`. Formatar `Data` como texto simples.
- [ ] **Passo 2:** no webhook, usar **Redetermine data structure** e clicar em Finalizar no app, para o Make conhecer os campos novos.
- [ ] **Passo 3:** adicionar **Google Sheets > Search Rows** após o webhook, com limite 1 e estes filtros combinados com E: `Data` igual a `data`; `Instrutor` igual a `instrutor`; `Início` menor que `hora_fim`; `Fim` maior que `hora_inicio`. Usar comparação numérica em `Início` e `Fim`.
- [ ] **Passo 4:** adicionar um **Router** depois da busca:
  - Rota "livre", com filtro **Total number of bundles = 0**: Add a Row (preenchendo as colunas novas com dados do webhook) → Webhook response `{"status":"ok"}`.
  - Rota "ocupado", com filtro **Total number of bundles > 0**: Webhook response, status `200`, body `{"status":"conflito"}`, com os mesmos headers da Tarefa 3.
- [ ] **Passo 5:** em Scenario settings, ativar **Process data in order**, para dois envios simultâneos não passarem pela busca ao mesmo tempo.
- [ ] **Passo 6:** com datas novas e sem conflito, testar a rota "livre". Se o cenário parar na busca, interromper e voltar ao plano.
- [ ] **Passo 7:** com MARLON ocupado das 14h às 16h, conferir:

| Pedido | Instrutor | Esperado |
|---|---|---|
| 15h, 1h | MARLON | ocupado |
| 13h, 2h | MARLON | ocupado |
| 13h, 1h | MARLON | livre (termina às 14h) |
| 16h, 1h | MARLON | livre (começa às 16h) |
| 14h, 2h | PEDRO | livre (outro instrutor) |
| 14h, 2h, em outro dia | MARLON | livre (outra data) |

**PARADA: o usuário testa e faz o commit da Melhoria 2.**

---

# Melhoria 3: editar e excluir

### Tarefa 8: fechar o fluxo local

**Arquivos:**
- Modificar: `index.html`

**O que muda no Make:** nada nesta melhoria. O Make só recebe o agendamento finalizado, e as mudanças necessárias já foram feitas nas Tarefas 3 e 7.

- [ ] **Passo 1:** em `editData`, restaurar todos os campos, recalculando as durações antes de reaplicar `duracao_horas`. Título do formulário: "Editar agendamento".
- [ ] **Passo 2:** rotular o botão do formulário como "Revisar agendamento", já que ele não salva mais no Make.
- [ ] **Passo 3:** ajustar a confirmação para "Tem certeza de que deseja excluir este agendamento?" e o retorno para "Agendamento excluído.", deixando claro que nada foi registrado.
- [ ] **Passo 4:** verificar com `fetch` simulado, contando as chamadas:
  - Salvar, Editar, Salvar, Editar, Salvar, Finalizar: 1 chamada, com os dados da última edição;
  - Salvar, Excluir: 0 chamadas, volta ao início com formulário limpo;
  - Excluir cancelado: dados mantidos no resumo.

**PARADA: o usuário testa e faz o commit da Melhoria 3.**

---

# Melhoria 4: layout profissional

### Tarefa 9: aplicar a direção B às quatro telas

**Arquivos:**
- Modificar: `index.html` (CSS e estrutura visual, sem alterar a lógica)

- [ ] **Passo 1:** centralizar cores, espaçamentos e raios em variáveis em `:root`, mantendo o fundo escuro e o laranja `#e65100`.
- [ ] **Passo 2:** trocar o título da página para `RangePass`. Cabeçalho das telas: título e subtítulo, como na direção B.
- [ ] **Passo 3:** agrupar o formulário em blocos (Atirador; Data e horário; Sessão) e repetir esses grupos no resumo.
- [ ] **Passo 4:** criar estilos consistentes de botão principal, secundário e destrutivo; estados desativado, em envio e foco visível.
- [ ] **Passo 5:** estilizar avisos e erros com contraste legível sobre o fundo escuro, sem usar `#b00020` como cor de texto.
- [ ] **Passo 6:** manter a moldura de telefone só em telas largas. Em celulares, o app ocupa a tela inteira, sem rolagem horizontal.
- [ ] **Passo 7:** rodar `node --test tests/` e repetir as verificações das Tarefas 2, 6 e 8, confirmando que a lógica não mudou.
- [ ] **Passo 8:** conferir as quatro telas, os estados de erro e o envio em 360px e em tela de computador.

**PARADA: o usuário testa e faz o commit da Melhoria 4.**
