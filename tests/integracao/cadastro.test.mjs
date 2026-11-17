// tests/integracao/cadastro.test.mjs
import test, { after, before, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
    rest, funcao, marcador, criarUsuario, apagarUsuariosCriados, anotarUsuario,
    idDoUsuarioPorEmail, emailTeste, entrar, cpfAleatorio, ultimoIdTentativa, apagarTentativasDepoisDe,
} from './apoio.mjs';
import { dataNoFuso } from '../../supabase/functions/_shared/cadastro.mjs';

const CAMPOS_DESTACADOS = 'Revise os campos destacados.';
const SEM_EMAIL = !emailTeste() && 'preencha EMAIL_TESTE no .env.teste';

// Os testes apagam tudo o que criam: as contas (inclusive as criadas pela própria função) e as tentativas de cadastro.
// Cada teste começa sem as tentativas dos anteriores, para o limite por hora não atrapalhar.
let marcaTentativas;
before(async () => { marcaTentativas = await ultimoIdTentativa(); });
beforeEach(() => apagarTentativasDepoisDe(marcaTentativas));
after(async () => {
    try {
        await apagarTentativasDepoisDe(marcaTentativas);
    } finally {
        await apagarUsuariosCriados();
    }
});

function corpoValido(extra = {}) {
    return {
        email: `${marcador()}@rangepass.test`, senha: `Senha-${marcador()}`, nome_completo: 'Cliente Teste',
        cpf: cpfAleatorio(), telefone: '11987654321', data_nascimento: '1990-01-01', aceite_politica_versao: 1, ...extra,
    };
}

// Envia o cadastro. Se, por engano, uma conta for criada, ela entra na limpeza.
async function cadastrar(corpo) {
    const r = await funcao('cadastro', { metodo: 'POST', corpo });
    const id = typeof corpo?.email === 'string' ? await idDoUsuarioPorEmail(corpo.email.trim()) : null;
    if (id) anotarUsuario(id);
    return { ...r, idCriado: id };
}

async function cpfExiste(cpf) {
    const r = await rest(`perfis?cpf=eq.${cpf}&select=id`);
    return r.dados.length > 0;
}

test('GET devolve a política e a idade mínima', async () => {
    const r = await funcao('cadastro');
    assert.strictEqual(r.status, 200, JSON.stringify(r.dados));
    assert.strictEqual(r.dados.idade_minima, 18);
    assert.strictEqual(r.dados.politica.versao, 1);
    assert.ok(r.dados.politica.texto.length > 0);
    assert.strictEqual(r.dados.estande.fuso, 'America/Sao_Paulo');
});

test('método não permitido recebe 405', async () => {
    const r = await funcao('cadastro', { metodo: 'PUT', corpo: {} });
    assert.strictEqual(r.status, 405, JSON.stringify(r.dados));
});

test('CPF inválido recebe 400 e nenhum login é criado', async () => {
    const r = await cadastrar(corpoValido({ cpf: '111.111.111-11' }));
    assert.strictEqual(r.status, 400, JSON.stringify(r.dados));
    assert.strictEqual(r.dados.erro, CAMPOS_DESTACADOS);
    assert.strictEqual(r.dados.campos.cpf, 'Informe um CPF válido.');
    assert.strictEqual(r.idCriado, null);
});

test('menor de idade recebe 400', async () => {
    const [ano, mes, dia] = dataNoFuso(new Date(), 'America/Sao_Paulo').split('-');
    const r = await cadastrar(corpoValido({ data_nascimento: `${Number(ano) - 17}-${mes}-${dia}` }));
    assert.strictEqual(r.status, 400, JSON.stringify(r.dados));
    assert.strictEqual(r.dados.campos.data_nascimento, 'É preciso ter pelo menos 18 anos para criar uma conta.');
    assert.strictEqual(r.idCriado, null);
});

test('sem aceite da política recebe 400', async () => {
    const r = await cadastrar(corpoValido({ aceite_politica_versao: 0 }));
    assert.strictEqual(r.status, 400, JSON.stringify(r.dados));
    assert.strictEqual(r.dados.campos.aceite_politica_versao, 'Para criar a conta, aceite a política de privacidade.');
    assert.strictEqual(r.idCriado, null);
});

test('dados ilegíveis recebem 400', async () => {
    const r = await funcao('cadastro', { metodo: 'POST', corpo: 'não é um objeto' });
    assert.strictEqual(r.status, 400, JSON.stringify(r.dados));
});

test('CPF já cadastrado recebe 409 e nenhum login novo é criado', async () => {
    const existente = await criarUsuario();
    const r = await cadastrar(corpoValido({ cpf: existente.cpf }));
    assert.strictEqual(r.status, 409, JSON.stringify(r.dados));
    assert.strictEqual(r.dados.campos.cpf, 'Este CPF já tem conta. Entre com o seu e-mail ou recupere a senha.');
    assert.strictEqual(r.idCriado, null);
});

test('e-mail já confirmado recebe 409 e o CPF novo não é gravado', async () => {
    const existente = await criarUsuario();
    const corpo = corpoValido({ email: existente.email });
    const r = await cadastrar(corpo);
    assert.strictEqual(r.status, 409, JSON.stringify(r.dados));
    assert.strictEqual(r.dados.campos.email, 'Este e-mail já tem conta. Entre ou recupere a senha.');
    assert.strictEqual(await cpfExiste(corpo.cpf), false);
});

test('[EMAIL_TESTE] cadastro completo cria login e perfil, e pede confirmação', { skip: !emailTeste() && 'preencha EMAIL_TESTE no .env.teste' }, async () => {
    const corpo = corpoValido({ email: emailTeste() });
    const r = await cadastrar(corpo);
    if (r.idCriado) anotarUsuario(r.idCriado);
    assert.strictEqual(r.status, 201, JSON.stringify(r.dados));
    assert.strictEqual(r.dados.mensagem, `Conta criada. Enviamos um link de confirmação para ${corpo.email}. Abra o e-mail para ativar a conta.`);

    const perfil = await rest(`perfis?cpf=eq.${corpo.cpf}&select=id,politica_versao,politica_aceita_em`);
    assert.strictEqual(perfil.dados[0].id, r.idCriado);
    assert.strictEqual(perfil.dados[0].politica_versao, 1);
    assert.ok(perfil.dados[0].politica_aceita_em);

    const h = await rest(`historico_alteracoes?tabela=eq.perfis&registro_id=eq.${r.idCriado}&select=feito_por`);
    assert.deepStrictEqual(h.dados, [{ feito_por: r.idCriado }]);

    const login = await entrar(corpo.email, corpo.senha);
    assert.strictEqual(login.status, 400, JSON.stringify(login.dados));
    assert.strictEqual(login.dados.error_code, 'email_not_confirmed');
});

// Correções da revisão final do plano 2: conta pendente (nunca confirmada) não "reserva" e-mail nem CPF,
// e há um limite de tentativas de cadastro por hora.

async function historicoDoPerfil(id) {
    return (await rest(`historico_alteracoes?tabela=eq.perfis&registro_id=eq.${id}&select=id`)).dados;
}

test('[EMAIL_TESTE] conta pendente com o mesmo e-mail é descartada e o cadastro novo vale', { skip: SEM_EMAIL }, async () => {
    const pendente = await criarUsuario({ confirmado: false, email: emailTeste() });
    const corpo = corpoValido({ email: pendente.email });
    const r = await cadastrar(corpo);
    assert.strictEqual(r.status, 201, JSON.stringify(r.dados));
    assert.ok(r.idCriado && r.idCriado !== pendente.id, 'deveria haver um login novo');
    assert.strictEqual(await cpfExiste(pendente.cpf), false);
    assert.deepStrictEqual(await historicoDoPerfil(pendente.id), []);
    const novo = await rest(`perfis?cpf=eq.${corpo.cpf}&select=id`);
    assert.strictEqual(novo.dados[0].id, r.idCriado);
});

test('[EMAIL_TESTE] conta pendente com o mesmo CPF é descartada e o cadastro novo vale', { skip: SEM_EMAIL }, async () => {
    const pendente = await criarUsuario({ confirmado: false });
    const r = await cadastrar(corpoValido({ email: emailTeste(), cpf: pendente.cpf }));
    assert.strictEqual(r.status, 201, JSON.stringify(r.dados));
    assert.strictEqual(await idDoUsuarioPorEmail(pendente.email), null);
    const novo = await rest(`perfis?cpf=eq.${pendente.cpf}&select=id`);
    assert.strictEqual(novo.dados[0].id, r.idCriado);
});

test('conta pendente da equipe (com papel) não é descartada', async () => {
    const equipe = await criarUsuario({ confirmado: false, papeis: ['instrutor'] });
    const r = await cadastrar(corpoValido({ email: equipe.email }));
    assert.strictEqual(r.status, 409, JSON.stringify(r.dados));
    assert.strictEqual(r.dados.campos.email, 'Este e-mail já tem conta. Entre ou recupere a senha.');
    assert.strictEqual(r.idCriado, equipe.id);
    assert.strictEqual(await cpfExiste(equipe.cpf), true);
});

test('CPF de conta pendente da equipe continua recusado', async () => {
    const equipe = await criarUsuario({ confirmado: false, papeis: ['atendente'] });
    const r = await cadastrar(corpoValido({ cpf: equipe.cpf }));
    assert.strictEqual(r.status, 409, JSON.stringify(r.dados));
    assert.strictEqual(r.dados.campos.cpf, 'Este CPF já tem conta. Entre com o seu e-mail ou recupere a senha.');
    assert.strictEqual(await idDoUsuarioPorEmail(equipe.email), equipe.id);
});

test('mais tentativas de cadastro que o limite por hora recebem 429', async () => {
    const config = await rest('configuracoes?chave=eq.cadastro&select=valor');
    const limite = config.dados[0].valor.tentativas_por_hora;
    assert.strictEqual(limite, 10);
    const MENSAGEM = { erro: 'Muitas tentativas de cadastro em pouco tempo. Tente de novo daqui a uma hora.' };
    // Dados inválidos de propósito: sem o limite, a resposta é 400, e nenhuma conta nem e-mail é criado.
    const tentar = () => funcao('cadastro', { metodo: 'POST', corpo: { cpf: '123' } });

    // O mesmo IP pode já ter tentativas na última hora (de outros testes ou do uso da página), que o
    // teste não apaga. A primeira tentativa revela o IP; depois contamos quantas esse IP já tem.
    const primeira = await tentar();
    if (primeira.status === 429) {
        // Já bloqueado antes de começar (uma tentativa recusada não é gravada): o limite está valendo.
        assert.deepStrictEqual(primeira.dados, MENSAGEM);
        return;
    }
    assert.strictEqual(primeira.status, 400, `primeira tentativa: ${JSON.stringify(primeira.dados)}`);
    const nova = await rest(`tentativas_cadastro?id=gt.${marcaTentativas}&select=ip,criado_em&order=id.desc&limit=1`);
    assert.strictEqual(nova.status, 200, JSON.stringify(nova.dados));
    assert.ok(nova.dados.length, 'a primeira tentativa deveria ter sido gravada');
    const { ip, criado_em } = nova.dados[0];
    // A janela de 1 hora é contada pelo relógio do banco (o criado_em da tentativa que acabou de ser gravada).
    const desde = new Date(new Date(criado_em).getTime() - 3600 * 1000).toISOString();
    const doIp = await rest(`tentativas_cadastro?ip=eq.${encodeURIComponent(ip)}&criado_em=gt.${encodeURIComponent(desde)}&select=id`);
    assert.strictEqual(doIp.status, 200, JSON.stringify(doIp.dados));
    const n = doIp.dados.length;

    for (let i = n; i < limite; i++) {
        const r = await tentar();
        assert.strictEqual(r.status, 400, `tentativa ${i + 1} de ${limite} deste IP: ${JSON.stringify(r.dados)}`);
    }
    const bloqueada = await cadastrar({ ...corpoValido(), cpf: '123' });
    assert.strictEqual(bloqueada.status, 429, JSON.stringify(bloqueada.dados));
    assert.deepStrictEqual(bloqueada.dados, MENSAGEM);
});

test('o limite não atrapalha quem só abre a página (GET)', async () => {
    for (let i = 0; i < 12; i++) {
        const r = await funcao('cadastro');
        assert.strictEqual(r.status, 200, `GET ${i + 1}: ${JSON.stringify(r.dados)}`);
    }
});
