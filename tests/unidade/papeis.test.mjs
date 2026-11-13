// tests/unidade/papeis.test.mjs
import test from 'node:test';
import assert from 'node:assert';
import { PAPEIS, temAlgumPapel } from '../../supabase/functions/_shared/papeis.mjs';

test('PAPEIS lista os seis papéis do sistema', () => {
    assert.deepStrictEqual(PAPEIS, ['cliente', 'atendente', 'almoxarifado', 'instrutor', 'administrativo', 'superadmin']);
});
test('temAlgumPapel: atendente passa quando atendente é exigido', () => assert.strictEqual(temAlgumPapel(['atendente'], ['atendente', 'administrativo']), true));
test('temAlgumPapel: cliente não passa em atendente', () => assert.strictEqual(temAlgumPapel(['cliente'], ['atendente']), false));
test('temAlgumPapel: superadmin passa em tudo', () => assert.strictEqual(temAlgumPapel(['superadmin'], ['almoxarifado']), true));
test('temAlgumPapel: sem papéis não passa', () => assert.strictEqual(temAlgumPapel([], ['cliente']), false));
