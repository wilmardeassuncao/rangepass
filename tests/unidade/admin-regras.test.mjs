// tests/unidade/admin-regras.test.mjs
import test from 'node:test';
import assert from 'node:assert';
import {
    NOMES_DIAS, funcionamentoDoFormulario, formularioDoFuncionamento, proximaVersao, abasVisiveis, numeroDoCampo,
    proximoNumeroDePista, rotuloSituacaoArma, mensagemCadastroSalvo, nomeDoModelo, ROTULO_PAPEL,
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
    assert.deepStrictEqual(abasVisiveis(['superadmin']), ['configuracoes', 'catalogo', 'pistas', 'equipe', 'agendamentos']);
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
