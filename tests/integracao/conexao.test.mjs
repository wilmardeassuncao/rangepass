// tests/integracao/conexao.test.mjs
import test from 'node:test';
import assert from 'node:assert';
import { URL, CHAVE_ANON } from './apoio.mjs';

test('conexão: o projeto responde às configurações de login', async () => {
    const resposta = await fetch(`${URL}/auth/v1/settings`, { headers: { apikey: CHAVE_ANON } });
    assert.strictEqual(resposta.status, 200);
});
