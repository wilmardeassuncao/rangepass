// tests/unidade/equipe.test.mjs
import test from 'node:test';
import assert from 'node:assert';
import { validarPapeis, conferirMudancaDePapeis, conferirDesativacao } from '../../supabase/functions/_shared/equipe.mjs';

const ESCOLHA = 'Escolha papéis da lista.';
const PROPRIO = 'Você não pode tirar o seu próprio papel de superadmin.';
const ULTIMO = 'O sistema precisa de pelo menos um superadmin.';
const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';

test('validarPapeis aceita papéis da lista e tira repetições', () => {
    assert.deepStrictEqual(validarPapeis(['instrutor', 'cliente', 'instrutor']), { erro: null, papeis: ['instrutor', 'cliente'] });
});
test('validarPapeis aceita lista vazia', () => {
    assert.deepStrictEqual(validarPapeis([]), { erro: null, papeis: [] });
});
test('validarPapeis recusa papel fora da lista', () => {
    assert.deepStrictEqual(validarPapeis(['cliente', 'dono']), { erro: ESCOLHA, papeis: [] });
});
test('validarPapeis recusa o que não é lista', () => {
    for (const valor of [undefined, null, 'cliente', { 0: 'cliente' }, [1]]) {
        assert.strictEqual(validarPapeis(valor).erro, ESCOLHA, JSON.stringify(valor));
    }
});

test('tirar o próprio superadmin', () => {
    assert.strictEqual(conferirMudancaDePapeis({ autorId: A, usuarioId: A, papeisNovos: ['instrutor'], superadminsAtuais: [A, B] }), PROPRIO);
});
test('tirar o superadmin do único superadmin', () => {
    assert.strictEqual(conferirMudancaDePapeis({ autorId: B, usuarioId: A, papeisNovos: [], superadminsAtuais: [A] }), ULTIMO);
});
test('outro superadmin tira o superadmin de alguém, e sobra um', () => {
    assert.strictEqual(conferirMudancaDePapeis({ autorId: A, usuarioId: B, papeisNovos: ['cliente'], superadminsAtuais: [A, B] }), null);
});
test('manter o próprio superadmin passa', () => {
    assert.strictEqual(conferirMudancaDePapeis({ autorId: A, usuarioId: A, papeisNovos: ['superadmin', 'instrutor'], superadminsAtuais: [A] }), null);
});
test('mudar papéis de quem não é superadmin passa', () => {
    assert.strictEqual(conferirMudancaDePapeis({ autorId: A, usuarioId: B, papeisNovos: ['instrutor'], superadminsAtuais: [A] }), null);
});

test('desativar a própria conta', () => {
    assert.strictEqual(conferirDesativacao({ autorId: A, usuarioId: A }), 'Você não pode desativar a sua própria conta.');
});
test('desativar a conta de outra pessoa passa', () => {
    assert.strictEqual(conferirDesativacao({ autorId: A, usuarioId: B }), null);
});
