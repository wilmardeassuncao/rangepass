// tests/unidade/admin-regras.test.mjs
import test from 'node:test';
import assert from 'node:assert';
import {
    NOMES_DIAS, funcionamentoDoFormulario, formularioDoFuncionamento, proximaVersao, abasVisiveis, numeroDoCampo,
    proximoNumeroDePista, rotuloSituacaoArma, mensagemCadastroSalvo, nomeDoModelo, ROTULO_PAPEL,
    consultaDosFiltros, descreverEvento, dataHoraNoFuso,
    precoDoCampo, textoDoPreco, AVISO_SEM_PRECO, regraDoFormulario, formularioDaRegra, diasDaRegra, textoDoPercentual,
    situacaoDaCampanha, textoDoPeriodo, campanhaDoFormulario, formularioDaCampanha, classeDoFormulario, formularioDaClasse,
    textoDoDescontoDaClasse, pacoteDoFormulario, formularioDoPacote, textoDoPacote,
} from '../../admin-regras.mjs';
import { PAPEIS } from '../../supabase/functions/_shared/papeis.mjs';

const ABERTO = { fechado: false, abre: '08:00', fecha: '23:00' };
const FECHADO = { fechado: true, abre: '', fecha: '' };

test('NOMES_DIAS vai de domingo a sábado', () => {
    assert.deepStrictEqual(NOMES_DIAS, ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado']);
});

test('funcionamentoDoFormulario: dia fechado vira null e as datas ficam em ordem, sem repetição', () => {
    const linhas = [FECHADO, ABERTO, ABERTO, ABERTO, ABERTO, ABERTO, { fechado: false, abre: '09:00', fecha: '18:00' }];
    const datas = ['2026-12-31', '2026-12-25', '', '2026-12-31', '2026-01-01'];
    const funcionamento = funcionamentoDoFormulario(linhas, datas);
    assert.deepStrictEqual(funcionamento, {
        dias: {
            0: null,
            1: { abre: '08:00', fecha: '23:00' }, 2: { abre: '08:00', fecha: '23:00' }, 3: { abre: '08:00', fecha: '23:00' },
            4: { abre: '08:00', fecha: '23:00' }, 5: { abre: '08:00', fecha: '23:00' }, 6: { abre: '09:00', fecha: '18:00' },
        },
        datas_fechadas: ['2026-01-01', '2026-12-25', '2026-12-31'],
    });

    // E a volta: o formulário montado de novo a partir do valor salvo.
    assert.deepStrictEqual(formularioDoFuncionamento(funcionamento), {
        linhas,
        datas: ['2026-01-01', '2026-12-25', '2026-12-31'],
    });
});

test('formularioDoFuncionamento: dia que falta aparece como fechado', () => {
    const { linhas, datas } = formularioDoFuncionamento({ dias: { 1: { abre: '10:00', fecha: '20:00' } } });
    assert.strictEqual(linhas.length, 7);
    assert.deepStrictEqual(linhas[0], FECHADO);
    assert.deepStrictEqual(linhas[1], { fechado: false, abre: '10:00', fecha: '20:00' });
    assert.deepStrictEqual(datas, []);
});

test('proximaVersao: texto igual mantém a versão; texto novo soma 1', () => {
    assert.strictEqual(proximaVersao({ versao: 3, texto: 'a' }, 'a'), 3);
    assert.strictEqual(proximaVersao({ versao: 3, texto: 'a' }, 'b'), 4);
});

test('abasVisiveis: o superadmin vê todas, na ordem', () => {
    assert.deepStrictEqual(abasVisiveis(['superadmin']), ['configuracoes', 'catalogo', 'pistas', 'precos', 'promocoes', 'equipe', 'agendamentos']);
});
test('abasVisiveis: o administrativo vê só Agendamentos', () => {
    assert.deepStrictEqual(abasVisiveis(['cliente', 'administrativo']), ['agendamentos']);
});
test('abasVisiveis: quem não é da administração não vê nenhuma', () => {
    assert.deepStrictEqual(abasVisiveis(['cliente', 'atendente', 'instrutor']), []);
});

test('numeroDoCampo: texto do campo vira número; vazio vira null', () => {
    assert.strictEqual(numeroDoCampo(' 15 '), 15);
    assert.strictEqual(numeroDoCampo('0'), 0);
    assert.strictEqual(numeroDoCampo('2.5'), 2.5);
    assert.strictEqual(numeroDoCampo(''), null);
    assert.strictEqual(numeroDoCampo('   '), null);
    assert.strictEqual(numeroDoCampo('abc'), null);
});

test('proximoNumeroDePista: 1 quando não há nenhuma pista', () => {
    assert.strictEqual(proximoNumeroDePista([]), 1);
    assert.strictEqual(proximoNumeroDePista(undefined), 1);
});
test('proximoNumeroDePista: o número seguinte ao maior, mesmo com buracos, fora de ordem e inativas', () => {
    assert.strictEqual(proximoNumeroDePista([{ numero: 1 }, { numero: 2 }, { numero: 3 }]), 4);
    assert.strictEqual(proximoNumeroDePista([{ numero: 7, ativa: false }, { numero: 2 }, { numero: 4 }]), 8);
});

test('rotuloSituacaoArma: nome de cada situação na tela', () => {
    assert.strictEqual(rotuloSituacaoArma('disponivel'), 'Disponível');
    assert.strictEqual(rotuloSituacaoArma('manutencao'), 'Em manutenção');
    assert.strictEqual(rotuloSituacaoArma('desativada'), 'Desativada');
});

test('mensagemCadastroSalvo: sem agendamentos futuros, só "Salvo."', () => {
    assert.strictEqual(mensagemCadastroSalvo('unidade', 0), 'Salvo.');
    assert.strictEqual(mensagemCadastroSalvo('categoria', undefined), 'Salvo.');
});
test('mensagemCadastroSalvo: arma ou pista com agendamentos futuros avisa o atendimento', () => {
    assert.strictEqual(mensagemCadastroSalvo('unidade', 2),
        'Salvo. Esta arma tem 2 agendamento(s) futuro(s); eles continuam marcados e o atendimento precisa resolver.');
    assert.strictEqual(mensagemCadastroSalvo('pista', 1),
        'Salvo. Esta pista tem 1 agendamento(s) futuro(s); eles continuam marcados e o atendimento precisa resolver.');
});

test('nomeDoModelo: marca e nome juntos', () => {
    assert.strictEqual(nomeDoModelo({ marca: 'Glock', nome: 'G17' }), 'Glock G17');
});

test('ROTULO_PAPEL: o nome de cada papel na tela', () => {
    assert.strictEqual(ROTULO_PAPEL.cliente, 'Cliente');
    assert.strictEqual(ROTULO_PAPEL.atendente, 'Atendente');
    assert.strictEqual(ROTULO_PAPEL.almoxarifado, 'Almoxarifado');
    assert.strictEqual(ROTULO_PAPEL.instrutor, 'Instrutor');
    assert.strictEqual(ROTULO_PAPEL.administrativo, 'Administrativo');
    assert.strictEqual(ROTULO_PAPEL.superadmin, 'Superadmin');
});

test('ROTULO_PAPEL: todo papel do sistema tem nome', () => {
    for (const papel of PAPEIS) assert.ok(ROTULO_PAPEL[papel], `sem nome para ${papel}`);
});

// ---------- Agendamentos ----------

test('consultaDosFiltros: só os filtros preenchidos, sem o "?"', () => {
    assert.strictEqual(consultaDosFiltros({ de: '2026-11-17', ate: '2026-12-02', situacao: '', instrutor_id: '', busca: '' }),
        'de=2026-11-17&ate=2026-12-02');
    assert.strictEqual(consultaDosFiltros({}), '');
    assert.strictEqual(consultaDosFiltros({ de: null, ate: undefined, situacao: 'pago', instrutor_id: 'abc', busca: '   ' }),
        'situacao=pago&instrutor_id=abc');
});

test('consultaDosFiltros: acentos e espaços vão codificados', () => {
    assert.strictEqual(consultaDosFiltros({ busca: 'João da Silva' }), 'busca=Jo%C3%A3o%20da%20Silva');
    assert.strictEqual(consultaDosFiltros({ busca: 'a&b=c' }), 'busca=a%26b%3Dc');
});

const evento = (tabela, acao, antes = null, depois = null) => ({ tabela, acao, antes, depois });

test('descreverEvento: agendamento criado', () => {
    assert.strictEqual(descreverEvento(evento('agendamentos', 'insercao', null, { situacao: 'aguardando_pagamento' })),
        'Agendamento criado');
});

test('descreverEvento: mudança de situação, com os nomes da tela', () => {
    assert.strictEqual(descreverEvento(evento('agendamentos', 'alteracao',
        { situacao: 'aguardando_pagamento', inicio: '2026-11-20T13:00:00+00:00', horas: 1 },
        { situacao: 'cancelado', inicio: '2026-11-20T13:00:00+00:00', horas: 1 })),
    'Situação: Aguardando pagamento → Cancelado');
});

test('descreverEvento: situação e horário mudando juntos → vale a situação', () => {
    assert.strictEqual(descreverEvento(evento('agendamentos', 'alteracao',
        { situacao: 'pago', inicio: '2026-11-20T13:00:00+00:00', horas: 1 },
        { situacao: 'check_in', inicio: '2026-11-20T14:00:00+00:00', horas: 2 })),
    'Situação: Pago → Check-in feito');
});

test('descreverEvento: horário alterado (início ou horas)', () => {
    assert.strictEqual(descreverEvento(evento('agendamentos', 'alteracao',
        { situacao: 'pago', inicio: '2026-11-20T13:00:00+00:00', horas: 1 },
        { situacao: 'pago', inicio: '2026-11-21T13:00:00+00:00', horas: 1 })), 'Horário alterado');
    assert.strictEqual(descreverEvento(evento('agendamentos', 'alteracao',
        { situacao: 'pago', inicio: '2026-11-20T13:00:00+00:00', horas: 1 },
        { situacao: 'pago', inicio: '2026-11-20T13:00:00+00:00', horas: 2 })), 'Horário alterado');
});

test('descreverEvento: alteração do agendamento sem situação nem horário → Alteração registrada', () => {
    assert.strictEqual(descreverEvento(evento('agendamentos', 'alteracao',
        { situacao: 'pago', inicio: 'x', horas: 1, forma_pagamento: null },
        { situacao: 'pago', inicio: 'x', horas: 1, forma_pagamento: 'pix' })), 'Alteração registrada');
});

test('descreverEvento: reservas criadas', () => {
    assert.strictEqual(descreverEvento(evento('agendamento_pistas', 'insercao')), 'Pista reservada');
    assert.strictEqual(descreverEvento(evento('agendamento_instrutores', 'insercao')), 'Instrutor reservado');
    assert.strictEqual(descreverEvento(evento('agendamento_unidades', 'insercao')), 'Arma reservada');
});

test('descreverEvento: reserva alterada → Reserva atualizada', () => {
    for (const tabela of ['agendamento_pistas', 'agendamento_instrutores', 'agendamento_unidades']) {
        assert.strictEqual(descreverEvento(evento(tabela, 'alteracao', { ativo: true }, { ativo: false })), 'Reserva atualizada');
    }
});

test('descreverEvento: participante e item incluídos', () => {
    assert.strictEqual(descreverEvento(evento('participantes', 'insercao')), 'Participante incluído');
    assert.strictEqual(descreverEvento(evento('itens_participante', 'insercao')), 'Item incluído');
});

test('descreverEvento: qualquer outro → Alteração registrada', () => {
    assert.strictEqual(descreverEvento(evento('participantes', 'alteracao', {}, {})), 'Alteração registrada');
    assert.strictEqual(descreverEvento(evento('outra_tabela', 'insercao')), 'Alteração registrada');
});

test('dataHoraNoFuso: DD/MM/AAAA HH:MM no fuso do estande', () => {
    assert.strictEqual(dataHoraNoFuso('2026-11-20T02:05:00Z', 'America/Sao_Paulo'), '19/11/2026 23:05');
    assert.strictEqual(dataHoraNoFuso('2026-11-20T15:30:00Z', 'America/Sao_Paulo'), '20/11/2026 12:30');
});

// ---------- Preços ----------

test('abasVisiveis: a aba Preços é só do superadmin', () => {
    assert.ok(!abasVisiveis(['administrativo']).includes('precos'));
    assert.ok(abasVisiveis(['superadmin']).includes('precos'));
});

test('precoDoCampo: reais digitados viram centavos; vazio vira null (sem preço)', () => {
    assert.deepStrictEqual(precoDoCampo('120'), { valor: 12000 });
    assert.deepStrictEqual(precoDoCampo(' 120,5 '), { valor: 12050 });
    assert.deepStrictEqual(precoDoCampo('R$ 1.234,56'), { valor: 123456 });
    assert.deepStrictEqual(precoDoCampo(''), { valor: null });
    assert.deepStrictEqual(precoDoCampo('   '), { valor: null });
    assert.deepStrictEqual(precoDoCampo(undefined), { valor: null });
});

test('precoDoCampo: texto que não é valor em reais vira erro', () => {
    for (const texto of ['abc', '12,345', '-5', '1,2,3']) {
        assert.deepStrictEqual(precoDoCampo(texto), { erro: 'Use um valor em reais, por exemplo 120,00.' }, texto);
    }
});

test('textoDoPreco: centavos viram reais; sem preço vira campo vazio', () => {
    assert.strictEqual(textoDoPreco(12000), 'R$ 120,00');
    assert.strictEqual(textoDoPreco(null), '');
    assert.strictEqual(textoDoPreco(undefined), '');
    // E a volta: o texto mostrado é aceito de novo pelo campo.
    assert.deepStrictEqual(precoDoCampo(textoDoPreco(123456)), { valor: 123456 });
});

test('AVISO_SEM_PRECO: o aviso de cada item sem preço', () => {
    assert.strictEqual(AVISO_SEM_PRECO.modelo, 'Sem preço, esta arma não aparece para os clientes.');
    assert.strictEqual(AVISO_SEM_PRECO.tipo_municao, 'Sem preço, esta munição não aparece para os clientes.');
    assert.strictEqual(AVISO_SEM_PRECO.hora_pista, 'Sem preço da hora de pista, ninguém consegue agendar.');
});

test('regraDoFormulario: os campos da tela viram os dados da regra', () => {
    assert.deepStrictEqual(regraDoFormulario({
        nome: ' Fim de semana ', dias: ['6', '0'], hora_inicio: '18:00', hora_fim: '22:00',
        percentual: '20', prioridade: '1', ativo: true,
    }), {
        nome: ' Fim de semana ', dias: [0, 6], hora_inicio: '18:00', hora_fim: '22:00',
        percentual: 20, prioridade: 1, ativo: true,
    });
});

test('regraDoFormulario: prioridade vazia vira 0; percentual vazio vira null (o servidor recusa)', () => {
    const dados = regraDoFormulario({ nome: 'x', dias: [], hora_inicio: '', hora_fim: '', percentual: '', prioridade: '', ativo: false });
    assert.strictEqual(dados.prioridade, 0);
    assert.strictEqual(dados.percentual, null);
    assert.deepStrictEqual(dados.dias, []);
    assert.strictEqual(dados.ativo, false);
});

test('formularioDaRegra: regra salva → campos da tela; sem regra, o formulário vazio', () => {
    assert.deepStrictEqual(formularioDaRegra({
        id: 3, nome: 'Sábado', dias: [6], hora_inicio: '08:00', hora_fim: '12:00', percentual: -10, prioridade: 2, ativo: false,
    }), { nome: 'Sábado', dias: [6], hora_inicio: '08:00', hora_fim: '12:00', percentual: '-10', prioridade: '2', ativo: false });
    assert.deepStrictEqual(formularioDaRegra(null), {
        nome: '', dias: [], hora_inicio: '', hora_fim: '', percentual: '', prioridade: '0', ativo: true,
    });
});

test('diasDaRegra: os dias abreviados, de domingo a sábado; todos = Todos os dias', () => {
    assert.strictEqual(diasDaRegra([6, 0]), 'Dom, Sáb');
    assert.strictEqual(diasDaRegra([1, 2, 3]), 'Seg, Ter, Qua');
    assert.strictEqual(diasDaRegra([0, 1, 2, 3, 4, 5, 6]), 'Todos os dias');
});

test('textoDoPercentual: aumento com +, desconto com -', () => {
    assert.strictEqual(textoDoPercentual(20), '+20%');
    assert.strictEqual(textoDoPercentual(-10), '-10%');
});

// ---------- Promoções ----------

test('abasVisiveis: a aba Promoções é só do superadmin e vem logo depois de Preços', () => {
    assert.ok(!abasVisiveis(['administrativo']).includes('promocoes'));
    const abas = abasVisiveis(['superadmin']);
    assert.strictEqual(abas.indexOf('promocoes'), abas.indexOf('precos') + 1);
});

test('situacaoDaCampanha: Agendada antes do início, Vigente do início ao fim (inclusive), Encerrada depois', () => {
    const campanha = { inicio: '2026-12-01', fim: '2026-12-10' };
    assert.strictEqual(situacaoDaCampanha(campanha, '2026-11-30'), 'Agendada');
    assert.strictEqual(situacaoDaCampanha(campanha, '2026-12-01'), 'Vigente');
    assert.strictEqual(situacaoDaCampanha(campanha, '2026-12-05'), 'Vigente');
    assert.strictEqual(situacaoDaCampanha(campanha, '2026-12-10'), 'Vigente');
    assert.strictEqual(situacaoDaCampanha(campanha, '2026-12-11'), 'Encerrada');
    assert.strictEqual(situacaoDaCampanha({ inicio: '2026-12-01', fim: '2026-12-01' }, '2026-12-01'), 'Vigente');
});

test('textoDoPeriodo: as datas no formato DD/MM/AAAA; um dia só aparece uma vez', () => {
    assert.strictEqual(textoDoPeriodo('2026-12-01', '2026-12-10'), '01/12/2026 a 10/12/2026');
    assert.strictEqual(textoDoPeriodo('2026-12-25', '2026-12-25'), '25/12/2026');
});

test('campanhaDoFormulario e formularioDaCampanha: ida e volta', () => {
    assert.deepStrictEqual(campanhaDoFormulario({
        nome: ' Natal ', percentual: '15', inicio: '2026-12-01', fim: '2026-12-25', ativo: true,
    }), { nome: ' Natal ', percentual: 15, inicio: '2026-12-01', fim: '2026-12-25', ativo: true });
    assert.strictEqual(campanhaDoFormulario({ nome: '', percentual: '', inicio: '', fim: '', ativo: false }).percentual, null);
    assert.deepStrictEqual(formularioDaCampanha({ id: 1, nome: 'Natal', percentual: 15, inicio: '2026-12-01', fim: '2026-12-25', ativo: false }),
        { nome: 'Natal', percentual: '15', inicio: '2026-12-01', fim: '2026-12-25', ativo: false });
    assert.deepStrictEqual(formularioDaCampanha(null), { nome: '', percentual: '', inicio: '', fim: '', ativo: true });
});

test('classeDoFormulario e formularioDaClasse: ida e volta com os três percentuais', () => {
    assert.deepStrictEqual(
        classeDoFormulario({ nome: 'Policial', percentual_pista: '20', percentual_aluguel: '0', percentual_municao: ' 15 ', ativo: true }),
        { nome: 'Policial', percentual_pista: 20, percentual_aluguel: 0, percentual_municao: 15, ativo: true });
    assert.deepStrictEqual(
        formularioDaClasse({ id: 2, nome: 'Policial', percentual_pista: 20, percentual_aluguel: 0, percentual_municao: 15, ativo: true }),
        { nome: 'Policial', percentual_pista: '20', percentual_aluguel: '0', percentual_municao: '15', ativo: true });
    // Classe nova: as três partes começam em 0 (sem desconto naquela parte).
    assert.deepStrictEqual(formularioDaClasse(null),
        { nome: '', percentual_pista: '0', percentual_aluguel: '0', percentual_municao: '0', ativo: true });
    // Campo vazio vai null: o servidor recusa com "Informe um percentual entre 0 e 90.".
    assert.strictEqual(classeDoFormulario({ nome: 'X', percentual_pista: '', percentual_aluguel: '0', percentual_municao: '0', ativo: true })
        .percentual_pista, null);
});

test('textoDoDescontoDaClasse: as partes com desconto, na ordem pista, aluguel e munição', () => {
    assert.strictEqual(textoDoDescontoDaClasse({ percentual_pista: 20, percentual_aluguel: 10, percentual_municao: 15 }),
        'Pista 20% · Aluguel 10% · Munição 15%');
    assert.strictEqual(textoDoDescontoDaClasse({ percentual_pista: 0, percentual_aluguel: 10, percentual_municao: 0 }), 'Aluguel 10%');
    assert.strictEqual(textoDoDescontoDaClasse({ percentual_pista: 5, percentual_aluguel: 0, percentual_municao: 30 }), 'Pista 5% · Munição 30%');
});

const CAMPOS_PACOTE = {
    nome: 'Iniciante', inicio: '2026-12-01', fim: '2026-12-31', preco_centavos: '250,00', horas: '2',
    modelo_id: '3', tipo_municao_id: '4', municao_qtd: '50', ativo: true,
};

test('pacoteDoFormulario: os campos da tela viram os dados do pacote (preço em centavos)', () => {
    assert.deepStrictEqual(pacoteDoFormulario(CAMPOS_PACOTE), {
        dados: {
            nome: 'Iniciante', inicio: '2026-12-01', fim: '2026-12-31', preco_centavos: 25000, horas: 2,
            modelo_id: 3, tipo_municao_id: 4, municao_qtd: 50, ativo: true,
        },
        erros: {},
    });
});

test('pacoteDoFormulario: "Nenhum" vira null, e sem munição a quantidade vai null', () => {
    const { dados } = pacoteDoFormulario({ ...CAMPOS_PACOTE, modelo_id: '', tipo_municao_id: '', municao_qtd: '50' });
    assert.strictEqual(dados.modelo_id, null);
    assert.strictEqual(dados.tipo_municao_id, null);
    assert.strictEqual(dados.municao_qtd, null);
});

test('pacoteDoFormulario: preço que não é valor em reais vira erro do campo; vazio vai null', () => {
    assert.deepStrictEqual(pacoteDoFormulario({ ...CAMPOS_PACOTE, preco_centavos: 'abc' }).erros,
        { preco_centavos: 'Use um valor em reais, por exemplo 120,00.' });
    const vazio = pacoteDoFormulario({ ...CAMPOS_PACOTE, preco_centavos: '' });
    assert.strictEqual(vazio.dados.preco_centavos, null);
    assert.deepStrictEqual(vazio.erros, {});
});

test('formularioDoPacote: pacote salvo → campos da tela; sem pacote, o formulário vazio', () => {
    assert.deepStrictEqual(formularioDoPacote({
        id: 9, nome: 'Iniciante', inicio: '2026-12-01', fim: '2026-12-31', preco_centavos: 25000, horas: 2,
        modelo_id: null, tipo_municao_id: 4, municao_qtd: 50, ativo: true,
    }), {
        nome: 'Iniciante', inicio: '2026-12-01', fim: '2026-12-31', preco_centavos: 'R$ 250,00', horas: '2',
        modelo_id: '', tipo_municao_id: '4', municao_qtd: '50', ativo: true,
    });
    assert.deepStrictEqual(formularioDoPacote(null), {
        nome: '', inicio: '', fim: '', preco_centavos: '', horas: '1',
        modelo_id: '', tipo_municao_id: '', municao_qtd: '', ativo: true,
    });
    // O preço mostrado é aceito de novo.
    assert.strictEqual(pacoteDoFormulario({ ...CAMPOS_PACOTE, preco_centavos: 'R$ 250,00' }).dados.preco_centavos, 25000);
});

test('textoDoPacote: o que o pacote inclui', () => {
    assert.strictEqual(textoDoPacote({ horas: 2, municao_qtd: null }, { modelo: null, municao: null }), '2 horas de pista');
    assert.strictEqual(textoDoPacote({ horas: 1, municao_qtd: 50 }, { modelo: 'Glock G17', municao: '9mm FMJ' }),
        '1 hora de pista + aluguel de Glock G17 + 50 munições 9mm FMJ');
    assert.strictEqual(textoDoPacote({ horas: 3, municao_qtd: 1 }, { modelo: null, municao: '9mm FMJ' }),
        '3 horas de pista + 1 munição 9mm FMJ');
});
