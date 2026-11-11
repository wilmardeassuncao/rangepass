# RangePass: nova arquitetura com Supabase e Vercel

**Data:** 2026-11-11 · **Branch:** `nova-arquitetura` · **Status:** rascunho para aprovação

## 1. Intenção

O RangePass hoje é uma página que envia o agendamento a um cenário do Make, e o Make grava numa planilha. Esse caminho tem limites. Não há login. Instrutores, armas e horários ficam fixos no código. A checagem de conflito de instrutor no Make não funciona: em 20 envios reais, os 6 que deveriam ser recusados foram aceitos. E o endereço do Make fica exposto na página.

O dono quer transformar o RangePass num **sistema profissional para operar um estande de tiro**. Ele deve cobrir o agendamento feito pelo cliente no celular e a operação do dia: separar o kit, fazer check-in, controlar o uso de munição, registrar check-out e incidentes. Também deve ter estoque, preços, descontos e pagamento. Tudo precisa ser configurável pelo próprio estande, sem mexer no código.

**Como seria o sucesso:** o estande instala o sistema, o superadmin faz uma configuração inicial e, a partir daí, cliente e equipe trabalham só pelo app. O banco de dados impede conflitos de horário, de pista, de instrutor e de arma. Ninguém consegue ler ou mudar dados que não lhe pertencem.

## 2. Objetivos, não objetivos e antiobjetivos

**Objetivos**
- O cliente cria conta, confirma o e-mail, agenda, acompanha, altera e cancela pelo celular.
- Cada papel da equipe tem sua tela, e cada um vê e faz só o que lhe cabe.
- Nada de regra de negócio ou de cadastro fica fixo no código. Tudo vem do banco e é editável pelo superadmin.
- Os conflitos são impedidos pelo **banco de dados**, não apenas pela tela.
- O sistema é publicado na Vercel, sem nenhuma dependência do Make.

**Não objetivos (por enquanto)**
- Vários estandes no mesmo sistema. Cada empresa interessada recebe uma **instalação própria**, com banco próprio e sem ligação com as outras.
- WhatsApp e SMS.
- Pacote usado em várias idas (saldo de horas).
- Aplicativo de loja (Android/iOS). O app é um site usado no navegador do celular.

**Antiobjetivos (seria um fracasso mesmo funcionando)**
- O cliente conseguir ver o número de registro de uma arma do estande, ou dados de outro cliente.
- O navegador ler ou gravar tabelas diretamente, contornando as regras.
- Valores como preços, horários ou listas escritos no código, exigindo um programador para mudar.
- Dois agendamentos ocupando o mesmo instrutor, a mesma pista ou a mesma unidade de arma ao mesmo tempo.

## 3. Restrições

- **Front-end:** HTML, CSS e JavaScript puro, sem framework e sem etapa de build. As regras puras continuam em arquivos `.js` testáveis no Node com `node:test`, como já é feito em `regras.js` e `tests/regras.test.js`.
- **Back-end:** Supabase (banco Postgres, Auth e Edge Functions).
- **Login:** Supabase Auth com e-mail e senha, e **confirmação de e-mail obrigatória**.
- **Acesso aos dados:** o front fala **só com Edge Functions** (funções que rodam no servidor do Supabase). O RLS (regras de segurança por linha do banco) bloqueia todo acesso direto às tabelas a partir do navegador. As Edge Functions validam o papel do usuário e aplicam as regras.
- **Publicação:** Vercel, como site estático.
- **Textos:** português do Brasil.
- **Fuso horário:** o horário do estande é guardado nas Configurações (por padrão, `America/Sao_Paulo`). Todas as datas são calculadas nesse fuso, não no fuso do aparelho.
- **Git:** os commits são feitos pelo usuário. Não fazer commit, push ou merge sem pedido explícito.

## 4. Papéis

| Papel | O que faz |
|---|---|
| **Cliente** | Cadastro, agendamento, "Meus agendamentos", alteração e cancelamento até 24h antes, pagamento pelo app, questionário. |
| **Atendente** | Agenda do dia, check-in do cliente, pagamento no balcão, descontos, alterações e cancelamentos dentro das 24h, marcar pista interditada, tratar não comparecimento. |
| **Almoxarifado (armeiro)** | Vê os kits a separar, separa e libera as armas e munições, recebe as devoluções, cuida do estoque. |
| **Instrutor** | Vê a própria agenda, registra o ponto (entrada e saída por QR code), retira o kit, acompanha o cliente na pista, registra no check-out a munição usada e devolvida, responde ao questionário e registra incidentes. |
| **Administrativo** | Visão de todos os agendamentos, relatórios, histórico e incidentes. |
| **Superadmin** | Tudo o que o administrativo faz, mais as **Configurações** e os cadastros (equipe, papéis, catálogo, pistas, preços, descontos, pacotes, perguntas). |

Uma pessoa pode ter mais de um papel. Decisão do construtor: guardar os papéis numa tabela de vínculo pessoa ↔ papel.

## 5. Cadastro do cliente

Campos obrigatórios: **nome completo, CPF, telefone e data de nascimento**. Opcionais: **CR** e **órgão expedidor**. O e-mail é o do login.

O CPF deve ser válido (dígitos verificadores) e único. A idade mínima para agendar fica nas Configurações. *Essa foi uma decisão minha: o dono não definiu um valor.*

## 6. Agendamento (visão do cliente)

### 6.1 Agenda visual (modelo B, aprovado com rascunho)

A tela foi pensada para o celular:

1. **Dia:** uma faixa com os próximos dias, até **15 dias de antecedência**. Dias passados, dias fechados e dias sem nenhum horário livre aparecem desabilitados.
2. **Hora de início:** botões com as horas cheias do dia, nas cores verde (livre), amarelo (poucas vagas) e cinza riscado (lotado).
3. **Quantas horas:** de 1 a 3 para quem vai sozinho (**máximo de 3**), e de 1 a 6 para grupos (**máximo de 6**). Uma duração fica bloqueada quando alguma das horas seguintes está lotada ou passa do fechamento.
4. **Resumo:** dia, início e término, por exemplo "Terça, 17/11 · das 10:00 às 12:00".

O cliente **não escolhe a pista**. O sistema distribui a pista automaticamente.

Um horário está **livre** quando, em todas as horas da sessão, existem ao mesmo tempo as **pistas não interditadas** e os **instrutores disponíveis** de que o agendamento precisa (veja 6.9: uma pista por instrutor), além de **unidades livres** de cada modelo de arma do estande escolhido e munição disponível em estoque. O instrutor pode ser o escolhido ou qualquer um, se a escolha for "sem preferência".

O estande abre em **dias e horários que podem ser diferentes em cada dia da semana**, e o superadmin pode cadastrar **datas fechadas**, como feriados. A sessão precisa terminar até o horário de fechamento daquele dia. *Decisão minha.* "Poucas vagas" é um limite definido nas Configurações. *Decisão minha: por padrão, 1 vaga restante.*

**Antecedência mínima:** fica nas Configurações. *Decisão minha: o padrão é 24h, como no app atual. O dono pode mudar.*

### 6.2 Tempo de uma sessão

- Uma hora de agendamento tem **5 min de montagem + 50 min de tiro + 5 min de finalização**.
- Numa sessão de 2 ou 3 horas, a montagem acontece só no início e a finalização só no fim. Exemplo: das 10:00 às 12:00, com montagem às 10:00, tiro das 10:05 às 11:55 e finalização às 11:55.
- A sessão inteira fica nas **mesmas pistas** e com os **mesmos instrutores**.

### 6.3 Ordem das escolhas

Depois da agenda vêm a modalidade, a arma, a munição, o instrutor, o resumo com o preço e a forma de pagamento. *Decisão minha: o construtor pode escolher a ordem exata, desde que a disponibilidade da agenda leve em conta a arma e o instrutor. Exemplo: escolher a modalidade e a arma antes do dia, ou validar de novo antes de confirmar.*

### 6.4 Modalidades

1. **Arma e munição do estande.**
2. **Arma própria e munição do estande.** O cliente informa o modelo, o calibre, o nº de registro e o nome do responsável pela arma.
3. **Arma e munição próprias.** Inclui só pista e instrutor, e exige o **aceite de um termo de responsabilidade**, cujo texto fica nas Configurações.

### 6.5 Escolha da arma (em cascata)

**Categoria → modelo (com marca) → calibre (preenchido automaticamente) → tipo de munição → quantidade.**

- O catálogo inicial sugerido foi aceito: Glock, Taurus, CZ, Sig, Imbel, revólveres, CBC 7022, T4, AR-15, IA2, FAL e espingardas 12. Ele é cadastrado pelo superadmin, nunca no código.
- As armas do estande são **unidades** com nº de registro, que **o cliente nunca vê**. O cliente escolhe o **modelo** e o sistema aloca uma unidade livre. Unidades desativadas ou em manutenção não são alocadas.
- **Munição mínima de 50** quando a munição é do estande. O valor mínimo fica nas Configurações.

### 6.6 Instrutor

O instrutor é sempre obrigatório. O cliente escolhe um nome ou **"sem preferência"**. Nesse caso, o sistema escolhe um instrutor livre. *Decisão minha: o critério é distribuir de forma equilibrada. Nos grupos que precisam de mais de um instrutor, o cliente escolhe o principal e o sistema escolhe os demais.*

Um instrutor está **disponível** quando **não está reservado em outro agendamento** no mesmo horário. Não há escala de trabalho no sistema.

### 6.7 Alterar e cancelar

- O cliente altera ou cancela sozinho **até 24h antes** do início. Depois disso, só o atendente pode fazer isso.
- O prazo de 24h fica nas Configurações.
- Toda mudança vai para o **histórico de alterações**: quem mudou, quando, o que estava antes e o que ficou depois.

### 6.8 Meus agendamentos

Lista os próximos agendamentos e os passados, com a situação de cada um (aguardando pagamento, pago, check-in feito, concluído, cancelado, não compareceu) e o crédito disponível.

### 6.9 Grupos

- Um agendamento pode ser de uma pessoa ou de um **grupo**. **Todos os participantes devem estar identificados.**
- Quantidade de instrutores: **de 1 a 5 pessoas, 1 instrutor; de 6 a 10, 2 instrutores; mais de 10, 3 instrutores.**
- **Pistas:** o grupo ocupa **uma pista para cada instrutor**.
- Duração máxima: **6 horas** para grupos e **3 horas** para quem vai sozinho.
- *Decisões minhas (o dono pode corrigir):*
  - Quem tem conta faz o agendamento e é o **responsável** pelo grupo. Os demais participantes são identificados com **nome completo, CPF e data de nascimento**, sem precisar de conta.
  - **Cada participante** escolhe a própria modalidade, arma e munição. O mínimo de munição vale **por participante** que usar munição do estande. Cada participante com arma própria aceita o termo de responsabilidade.
  - O grupo tem **no máximo 15 pessoas**. As faixas de instrutores, o tamanho máximo e as durações máximas ficam nas Configurações.
  - O preço é a soma dos itens de cada participante. A hora de pista é cobrada **por pista ocupada**.
- Por isso, um agendamento tem **participantes** e cada participante tem seus **itens** (arma e munição). O banco não deve ter campos únicos de arma e munição no agendamento.

## 7. Preços, descontos e pacotes

Tudo fica em **Configurações** do superadmin. Há uma **configuração inicial** feita na implantação, e os valores ficam salvos até o superadmin mudar.

### 7.1 Tipos de preço

- **Hora de pista**, com o instrutor incluído, cobrada em todas as modalidades.
- **Aluguel de arma por hora**, por modelo, só quando a arma é do estande.
- **Munição por unidade**, por tipo e calibre, só quando a munição é do estande.
- **Total** = pista × horas + aluguel × horas + munição × quantidade, ajustado pelas regras abaixo.

### 7.2 Preço por dia ou horário

O superadmin cria regras com dias da semana, faixa de horário e um **percentual para cima ou para baixo** sobre a hora de pista. Cada estande decide como usar essas regras, junto com o marketing. *Decisão minha: se duas regras valerem para a mesma hora, aplica-se a de maior prioridade, e a prioridade é definida pelo superadmin. O ajuste é calculado hora a hora numa sessão longa.*

### 7.3 Descontos

- **Quem aplica é o atendente**, no atendimento. Na hora do preço final aparece um quadro de descontos: o atendente marca a opção e o sistema aplica o percentual definido pelo superadmin. **O atendente não digita o valor.**
- Há dois tipos:
  - **Campanha:** temporária, com data de início e de fim e percentual definido pelo superadmin a cada campanha.
  - **Classe fixa:** policial, CAC e outras classes que o superadmin cadastrar, cada uma com seu percentual.
- O atendente confere um documento antes de marcar uma classe. O sistema registra quem aplicou o desconto e quando.
- Vale **um desconto por vez**. Se a pessoa tiver direito a mais de um, aplica-se o maior.
- Quem paga pelo app paga o preço cheio, a menos que haja uma campanha ativa. Nesse caso, a campanha é aplicada automaticamente.

### 7.4 Pacotes

- São definidos pelo superadmin **por campanha**: nome, período de validade e **preço fechado**.
- São montados com os itens existentes: horas de pista, aluguel de um modelo de arma e munição (tipo e quantidade).
- O preço do pacote **substitui** a soma desses itens. O que passar do pacote é cobrado pelo preço normal.
- Valem para **uma ida só**. Não há saldo.
- *Decisão minha: pacote e desconto não se somam. O construtor aplica o que for melhor para o cliente.*

## 8. Pagamento e créditos

- O cliente escolhe **pagar pelo app** ou **no balcão**.
- **Pagou e cancelou, ou não compareceu:** recebe **crédito integral**, usado em agendamentos futuros.
- **Não pagou:** nada é separado fisicamente (nem kit nem munição) até o check-in com pagamento no balcão. *Decisão minha: mesmo sem pagamento, o agendamento já **segura** as pistas, os instrutores, as unidades de arma e a reserva de munição. Sem isso, o banco não conseguiria impedir conflitos. Se o cliente não aparecer, o atendente marca "não compareceu" e tudo é liberado.*
- **Crédito:** é um valor em reais, mostrado em "Meus agendamentos", que pode ser usado em parte e abatido no preço de um agendamento futuro. Até a etapa 11, quem aplica o crédito é o atendente, no balcão. *Decisão minha.*
- **Validade do crédito: 1 ano**, contado a partir da data em que foi gerado. Depois disso, o crédito vence. O prazo fica nas Configurações.
- **Não há devolução em dinheiro**, exceto no **direito de arrependimento** do Código de Defesa do Consumidor (art. 49): quem pagou **pelo app** pode desistir em até **7 dias** a partir do pagamento e recebe o dinheiro de volta. *Decisão minha: o pedido é feito pelo cliente no app, dentro desse prazo, e o administrativo processa a devolução.* Veja a seção 15 (Legislação).
- O pagamento online é a **etapa 11**. Até lá, só há pagamento no balcão e registro de crédito. A escolha do serviço de pagamento online fica para essa etapa.

## 9. Operação do estande

### 9.1 Pistas

- O superadmin define a **quantidade de pistas**.
- O atendente marca uma pista como **interditada**, com motivo e período. Se a interdição atingir agendamentos já feitos, o sistema tenta mudar a pista. Se não houver pista livre, o agendamento é marcado como **afetado**, o cliente é avisado e o atendente resolve.

### 9.2 Fluxo do dia

1. **Almoxarifado:** vê a lista de kits a separar, só dos agendamentos pagos ou com check-in. Separa a unidade de arma e a munição e registra a liberação.
2. **Check-in do cliente:** feito pelo atendente. Aqui entra o pagamento no balcão, se for o caso.
3. **Instrutor:** retira o kit no almoxarifado e leva à pista.

**Ponto do instrutor:** o instrutor faz **check-in quando chega ao estande e check-out quando sai**, lendo um **QR code**, como um ponto digital. *Decisão minha: o QR code fica fixo no estande. O instrutor lê com o celular, já logado no app, e o sistema registra a entrada ou a saída com data e hora. O ponto é só um registro de presença, consultado pelo administrativo, e não muda a disponibilidade na agenda.*
4. **Check-out:** o instrutor registra a **munição usada e devolvida** e a devolução da arma. Cliente e instrutor respondem ao **questionário**. Um incidente marcado gera **alerta**.
5. **Não comparecimento:** depois de um tempo de tolerância definido nas Configurações, o atendente marca o agendamento como "não compareceu". Se houve pagamento, o crédito é gerado.

### 9.3 Questionário

As perguntas ficam no banco, são cadastradas pelo superadmin e só entram em uso depois de **aprovadas**. Há um conjunto para o cliente e outro para o instrutor. Se o cliente não responder no check-out, recebe o link por e-mail.

## 10. Estoque

- A munição é **reservada** quando o agendamento é feito. A **baixa** acontece só no check-out, pela quantidade **realmente usada**. O que for devolvido volta ao estoque.
- Quando o estoque de um tipo de munição chega ao **mínimo** definido pelo superadmin, a equipe recebe um alerta.
- *Decisão minha: quando o estoque disponível (total menos reservado) for menor que a quantidade pedida, o horário com aquela munição fica indisponível para agendamento.*

## 11. Notificações

**Para o cliente (por e-mail):**
1. Confirmação do agendamento.
2. Lembrete **1 dia antes**.
3. Alteração ou cancelamento, inclusive quando feito pelo atendente.
4. Crédito gerado.
5. Agendamento afetado (pista interditada ou instrutor indisponível).
6. Pesquisa pós-sessão, se não foi respondida no check-out.

**Para a equipe (aviso dentro do sistema):**
1. Agenda do dia, para o instrutor e o almoxarifado.
2. Agendamento novo ou cancelado nas próximas 24h, para o atendente.
3. Incidente registrado, para o administrativo e o superadmin.
4. Não comparecimento, para o atendente.
5. Estoque no mínimo, para o almoxarifado e o superadmin.

Os textos dos e-mails ficam nas Configurações. A escolha do serviço de envio de e-mails fica com o construtor, na etapa 10.

## 12. Configurações (superadmin)

Uma área única com:
- **Dados do estande:** nome, logo, endereço, contato e fuso horário. Isso permite instalar o sistema em outra empresa sem mudar o código.
- **Funcionamento:** horário de abertura e fechamento por dia da semana, datas fechadas, antecedência mínima e máxima (15 dias), prazo de alteração (24h), duração máxima (3h sozinho e 6h em grupo), tamanho máximo do grupo, faixas de instrutores por tamanho de grupo, tolerância de não comparecimento, limite de "poucas vagas" e idade mínima.
- **Pistas:** quantidade.
- **Equipe e papéis.**
- **Catálogo:** categorias, modelos, marcas, calibres, tipos de munição e unidades de arma com nº de registro. Itens são **desativados, nunca apagados**.
- **Preços, regras de dia/horário, descontos (campanhas e classes) e pacotes.**
- **Munição mínima por agendamento e estoque mínimo.**
- **Termo de responsabilidade, perguntas do questionário e textos de e-mail.**

## 13. Regras gerais aprovadas

- **Desativar em vez de apagar:** cadastros e agendamentos nunca são apagados. Um agendamento cancelado fica com a situação "cancelado".
- **Histórico de alterações** para agendamentos, descontos e configurações.
- **Visão do admin** com todos os agendamentos, filtros por data, situação, instrutor e cliente.
- **Mensagens de erro claras:** dizem o que aconteceu e o que fazer.

## 14. Ordem de construção (aprovada)

1. **Banco:** tabelas, regras que impedem conflitos e RLS.
2. **Gate:** Edge Functions como única porta de entrada, com verificação de papel.
3. **Login:** cadastro, confirmação de e-mail e perfil do cliente.
4. **Desmock + painel:** o app atual deixa de usar valores fixos e o Make; "Meus agendamentos".
5. **Admin:** Configurações e cadastros do superadmin; visão do administrativo.
6. **Agenda visual:** modelo B, com disponibilidade real.
7. **Deploy:** Vercel.
8. **Operação do estande:** almoxarifado, check-in, check-out, questionário e incidentes.
9. **Estoque e alertas.**
10. **E-mails.**
11. **Pagamento online.**

Cada etapa termina com algo testável. O construtor para e espera o teste e o commit do dono antes de seguir.

## 15. Legislação

O dono pediu que o sistema **sempre respeite a legislação**. Os pontos abaixo são o que o sistema precisa permitir. **Antes de usar o sistema com clientes reais, um advogado deve revisar os textos e as regras desta seção.** O sistema não substitui essa revisão.

- **Código de Defesa do Consumidor:** devolução em até 7 dias para compras feitas pelo app (art. 49), preço total mostrado antes da confirmação e regras de cancelamento e crédito visíveis ao cliente antes de pagar.
- **LGPD (Lei Geral de Proteção de Dados):** o sistema guarda CPF, data de nascimento e dados de armas, que são dados pessoais. Ele deve:
  - mostrar uma **política de privacidade** e pedir o aceite no cadastro, com o texto nas Configurações;
  - usar os dados só para a operação do estande e para as obrigações legais;
  - deixar cada pessoa ver só os próprios dados, e a equipe só o que o papel exige;
  - atender pedidos do titular para ver, corrigir ou excluir os dados. Como a regra geral é "desativar em vez de apagar", a **exclusão vira anonimização**: os dados pessoais são apagados e os registros que a lei obriga a manter são preservados sem identificar a pessoa;
  - registrar quem acessou e alterou os dados sensíveis.
- **Regras de armas e tiro desportivo** (Exército e Polícia Federal): o sistema guarda os registros que o estande precisa manter (quem atirou, quando, com qual arma e quanta munição usou). Os textos do termo de responsabilidade, a idade mínima e as exigências de documentos (CR, por exemplo) ficam **nas Configurações**, para o estande ajustar quando as normas mudarem, sem mexer no código.

## 16. Ambiente de desenvolvimento (decisões minhas)

- O banco roda num **projeto Supabase na nuvem** (o plano gratuito serve). Não usar o Supabase local, que no Windows exige o Docker. O construtor explica ao dono, passo a passo, como criar o projeto.
- As mudanças no banco ficam em arquivos de migração versionados no repositório.
- As regras puras são escritas como módulos JavaScript que funcionam tanto no Node (testes com `node:test`) quanto no Deno (Edge Functions).
- **Envio de e-mail:** um serviço de e-mail próprio (SMTP) é configurado já na **etapa 3**. O envio que já vem no Supabase tem um limite muito baixo de e-mails por hora e travaria os testes do cadastro.
- O sistema novo **começa do zero**. Os agendamentos de teste da planilha do Make não são importados.

## 17. O que fica com o construtor

- O desenho exato das tabelas e das Edge Functions.
- O mecanismo do banco para impedir sobreposição (por exemplo, restrições de exclusão por intervalo de tempo).
- A estrutura de pastas e arquivos do front.
- Os serviços de e-mail e de pagamento, nas etapas 10 e 11.
- O visual das telas novas, seguindo o layout atual (escuro com laranja) e a agenda no modelo B.

## 18. Relação com o app atual

- `regras.js` e `tests/regras.test.js` mostram o padrão a manter: regras puras testáveis no Node. As constantes fixas (`INSTRUTORES`, `ARMAMENTOS` e os horários) passam a vir do banco.
- O envio ao Make e a planilha deixam de ser usados. A pendência do conflito de instrutor no Make perde o sentido, porque o banco passa a impedir o conflito.
- O app publicado no GitHub Pages (`main`) continua no ar até a nova versão ser publicada na Vercel.
