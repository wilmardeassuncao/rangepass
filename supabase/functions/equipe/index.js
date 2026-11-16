// Edge Function equipe: só o superadmin procura pessoas, troca os papéis delas e desativa ou
// reativa contas. Desativar = bloquear o login no Supabase Auth e marcar o perfil como inativo.
// Toda mudança fica no histórico com o autor; toda busca fica registrada em acessos_dados.
import { tratar, respostaJson, ErroHttp } from '../_shared/http.mjs';
import { obterContexto, exigirPapel, contaBloqueada, admin } from '../_shared/contexto.js';
import { PAPEIS } from '../_shared/papeis.mjs';
import { validarPapeis, conferirMudancaDePapeis, conferirDesativacao } from '../_shared/equipe.mjs';

const NAO_ENCONTRADA = 'Não encontramos esta pessoa.';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BLOQUEIO_LONGO = '876000h'; // cerca de 100 anos: na prática, até ser reativada.
const ULTIMO_SUPERADMIN = 'O sistema precisa de pelo menos um superadmin.';

function emOrdem(papeis) {
    return [...papeis].sort((a, b) => PAPEIS.indexOf(a) - PAPEIS.indexOf(b));
}

async function buscar(req, contexto) {
    const busca = (new URL(req.url).searchParams.get('busca') ?? '').trim();

    const { data: linhas, error } = await admin.rpc('buscar_pessoas', { p_busca: busca });
    if (error) throw error;

    // A conta está ativa se o login não está bloqueado e o perfil (quando existe) está ativo.
    const inativos = new Set();
    if (linhas.length) {
        const perfis = await admin.from('perfis').select('id, ativo').in('id', linhas.map(l => l.id));
        if (perfis.error) throw perfis.error;
        for (const perfil of perfis.data) if (perfil.ativo === false) inativos.add(perfil.id);
    }

    // Só uma busca de verdade (2 ou mais caracteres) consulta dados de pessoas: fica registrada.
    if (busca.length >= 2) {
        const acesso = await admin.rpc('registrar_acesso', {
            p_usuario: contexto.usuarioId, p_recurso: 'equipe.busca', p_registro: busca,
        });
        if (acesso.error) throw acesso.error;
    }

    const pessoas = linhas.map(l => ({
        id: l.id,
        email: l.email,
        nome_completo: l.nome_completo,
        cpf: l.cpf,
        papeis: l.papeis,
        ativo: !l.bloqueado && !inativos.has(l.id),
    }));
    return respostaJson(200, { pessoas });
}

async function lerCorpo(req) {
    try {
        return (await req.json()) ?? {};
    } catch {
        throw new ErroHttp(400, 'Não foi possível ler os dados enviados. Tente de novo.');
    }
}

// Usuário do Supabase Auth. Quem não tem perfil também existe e pode receber papéis.
async function obterUsuario(id) {
    if (typeof id !== 'string' || !UUID.test(id)) throw new ErroHttp(404, NAO_ENCONTRADA);
    const { data, error } = await admin.auth.admin.getUserById(id);
    if (error?.status === 404 || (!error && !data?.user)) throw new ErroHttp(404, NAO_ENCONTRADA);
    if (error) throw error;
    return data.user;
}

// A pessoa como o GET a mostra, a partir do usuário do Auth.
async function montarPessoa(usuario) {
    const [perfil, papeis] = await Promise.all([
        admin.from('perfis').select('nome_completo, cpf, ativo').eq('id', usuario.id).maybeSingle(),
        admin.from('papeis_usuario').select('papel').eq('usuario_id', usuario.id),
    ]);
    if (perfil.error) throw perfil.error;
    if (papeis.error) throw papeis.error;
    return {
        id: usuario.id,
        email: usuario.email,
        nome_completo: perfil.data?.nome_completo ?? null,
        cpf: perfil.data?.cpf ?? null,
        papeis: emOrdem(papeis.data.map(l => l.papel)),
        ativo: !contaBloqueada(usuario) && perfil.data?.ativo !== false,
    };
}

async function trocarPapeis(contexto, usuario, papeisEnviados) {
    const { erro, papeis } = validarPapeis(papeisEnviados);
    if (erro) return respostaJson(400, { erro: 'Revise os campos destacados.', campos: { papeis: erro } });

    // Só contam os superadmins que conseguem entrar (login liberado e perfil ativo).
    const atuais = await admin.rpc('superadmins_ativos');
    if (atuais.error) throw atuais.error;
    const conflito = conferirMudancaDePapeis({
        autorId: contexto.usuarioId,
        usuarioId: usuario.id,
        papeisNovos: papeis,
        superadminsAtuais: atuais.data.map(l => l.usuario_id),
    });
    if (conflito) throw new ErroHttp(409, conflito);

    // O banco confere de novo, sob trava, que sobra pelo menos um superadmin (RP101).
    const { error } = await admin.rpc('definir_papeis', {
        p_usuario: usuario.id, p_papeis: papeis, p_autor: contexto.usuarioId,
    });
    if (error?.code === 'RP101') throw new ErroHttp(409, ULTIMO_SUPERADMIN);
    if (error) throw error;

    return respostaJson(200, { pessoa: await montarPessoa(usuario) });
}

async function bloquearLogin(id, bloquear) {
    const { data, error } = await admin.auth.admin.updateUserById(id, { ban_duration: bloquear ? BLOQUEIO_LONGO : 'none' });
    if (error) throw error;
    return data.user;
}

function marcarConta(contexto, usuarioId, ativa) {
    return admin.rpc('marcar_conta', { p_usuario: usuarioId, p_ativa: ativa, p_autor: contexto.usuarioId });
}

async function desativar(contexto, usuario) {
    const conflito = conferirDesativacao({ autorId: contexto.usuarioId, usuarioId: usuario.id });
    if (conflito) throw new ErroHttp(409, conflito);

    // Primeiro o banco, sob trava: recusa (RP101) se esta é o último superadmin que consegue
    // entrar, antes de qualquer bloqueio no Auth.
    const { error } = await marcarConta(contexto, usuario.id, false);
    if (error?.code === 'RP101') throw new ErroHttp(409, ULTIMO_SUPERADMIN);
    if (error) throw error;

    let bloqueado;
    try {
        bloqueado = await bloquearLogin(usuario.id, true);
    } catch (erro) {
        // Sem o bloqueio no Auth, a desativação ficaria pela metade: desfaz a marca no banco.
        const volta = await marcarConta(contexto, usuario.id, true);
        if (volta.error) console.error(volta.error);
        throw erro;
    }
    return respostaJson(200, { pessoa: await montarPessoa(bloqueado) });
}

async function reativar(contexto, usuario) {
    const liberado = await bloquearLogin(usuario.id, false);
    const { error } = await marcarConta(contexto, usuario.id, true);
    if (error) throw error;
    return respostaJson(200, { pessoa: await montarPessoa(liberado) });
}

async function alterar(req, contexto) {
    const corpo = await lerCorpo(req);
    const usuario = await obterUsuario(corpo.usuario_id);

    if (corpo.acao === undefined) return trocarPapeis(contexto, usuario, corpo.papeis);
    if (corpo.acao === 'desativar') return desativar(contexto, usuario);
    if (corpo.acao === 'reativar') return reativar(contexto, usuario);
    throw new ErroHttp(400, 'Esta ação não existe.');
}

Deno.serve(tratar(async (req) => {
    if (req.method !== 'GET' && req.method !== 'PUT') throw new ErroHttp(405, 'Esta ação não é permitida aqui.');
    const contexto = await obterContexto(req);
    exigirPapel(contexto, 'superadmin');
    if (req.method === 'GET') return buscar(req, contexto);
    return alterar(req, contexto);
}));
