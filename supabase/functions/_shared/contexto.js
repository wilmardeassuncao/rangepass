// Contexto do usuário nas Edge Functions (Deno): quem está chamando, seus papéis e seu perfil.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import { ErroHttp } from './http.mjs';
import { temAlgumPapel } from './papeis.mjs';

// Cliente com a chave de serviço: só existe no servidor e passa por cima do bloqueio do banco.
export const admin = createClient(
    Deno.env.get('SUPABASE_URL'),
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false } },
);

const SESSAO_EXPIRADA = 'Sua sessão expirou. Entre de novo.';
const CONTA_DESATIVADA = 'Sua conta está desativada. Procure o atendimento do estande.';

// Desativar uma conta = bloquear o login dela no Supabase Auth ("banir"). Vale com ou sem cadastro.
function contaBloqueada(usuario) {
    return Boolean(usuario.banned_until) && new Date(usuario.banned_until) > new Date();
}

export async function obterContexto(req) {
    const cabecalho = req.headers.get('Authorization') ?? '';
    const token = cabecalho.startsWith('Bearer ') ? cabecalho.slice(7).trim() : '';
    if (!token) throw new ErroHttp(401, SESSAO_EXPIRADA);

    const { data, error } = await admin.auth.getUser(token);
    if (error?.code === 'user_banned') throw new ErroHttp(403, CONTA_DESATIVADA);
    if (error || !data?.user) throw new ErroHttp(401, SESSAO_EXPIRADA);
    const usuario = data.user;
    if (contaBloqueada(usuario)) throw new ErroHttp(403, CONTA_DESATIVADA);

    const [papeis, perfil] = await Promise.all([
        admin.from('papeis_usuario').select('papel').eq('usuario_id', usuario.id),
        admin.from('perfis').select('*').eq('id', usuario.id).maybeSingle(),
    ]);
    if (papeis.error) throw papeis.error;
    if (perfil.error) throw perfil.error;

    if (perfil.data && perfil.data.ativo === false) {
        throw new ErroHttp(403, CONTA_DESATIVADA);
    }

    return {
        usuarioId: usuario.id,
        email: usuario.email,
        papeis: papeis.data.map(linha => linha.papel),
        perfil: perfil.data ?? null,
    };
}

export function exigirPapel(contexto, ...papeis) {
    if (!temAlgumPapel(contexto.papeis, papeis)) {
        throw new ErroHttp(403, 'Você não tem permissão para fazer isso.');
    }
}
