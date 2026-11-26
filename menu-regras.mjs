// Regras do menu lateral que não mexem na tela: dá para testar no Node.
import { temAlgumPapel } from './supabase/functions/_shared/papeis.mjs';
import { abasVisiveis } from './admin-regras.mjs';
import { AREAS_ESTANDE, areasVisiveis } from './estande-areas.mjs';

// Como as abas da equipe se agrupam no menu, na ordem em que aparecem.
export const GRUPOS_EQUIPE = [
    { titulo: 'Operação', abas: ['agendamentos'] },
    { titulo: 'Cadastros', abas: ['catalogo', 'pistas', 'equipe'] },
    { titulo: 'Vendas', abas: ['precos', 'promocoes'] },
    { titulo: 'Sistema', abas: ['configuracoes'] },
];

export const ROTULO_ABA = {
    agendamentos: 'Agendamentos',
    catalogo: 'Catálogo',
    pistas: 'Pistas',
    equipe: 'Equipe',
    precos: 'Preços',
    promocoes: 'Promoções',
    configuracoes: 'Configurações',
};

// O menu de quem tem esses papéis: primeiro a área pessoal (sem título), depois os grupos da equipe.
// No grupo Operação, as áreas do estande (estande.html) vêm antes de "Agendamentos".
// "Sair" não entra aqui: é um botão da moldura.
export function menuDe(papeis) {
    const proprios = [];
    if (temAlgumPapel(papeis, ['cliente'])) {
        proprios.push({ id: 'agendamentos-cliente', texto: 'Meus agendamentos', href: 'index.html' });
        proprios.push({ id: 'novo', texto: 'Novo agendamento', href: 'index.html#novo' });
    }
    proprios.push({ id: 'perfil', texto: 'Meu perfil', href: 'conta.html' });
    const menu = [{ titulo: null, itens: proprios }];

    const visiveis = abasVisiveis(papeis);
    const areas = areasVisiveis(papeis);
    const itensDoEstande = AREAS_ESTANDE.filter((area) => areas.includes(area.id))
        .map((area) => ({ id: `estande-${area.id}`, texto: area.texto, href: `estande.html#${area.id}` }));
    for (const grupo of GRUPOS_EQUIPE) {
        const itens = grupo.abas
            .filter((aba) => visiveis.includes(aba))
            .map((aba) => ({ id: `equipe-${aba}`, texto: ROTULO_ABA[aba], href: `admin.html#${aba}` }));
        if (grupo.titulo === 'Operação') itens.unshift(...itensDoEstande);
        if (itens.length > 0) menu.push({ titulo: grupo.titulo, itens });
    }
    return menu;
}

// Qual aba abrir a partir do endereço (#aba): a pedida se for permitida, senão a primeira permitida.
export function parteDoEndereco(hash, permitidas) {
    const parte = String(hash ?? '').replace(/^#/, '');
    return permitidas.includes(parte) ? parte : (permitidas[0] ?? null);
}

// As abas que a pessoa pode abrir, na ordem do menu: sem "#" no endereço, abre a primeira (Agendamentos).
export function abasNaOrdemDoMenu(papeis) {
    const visiveis = abasVisiveis(papeis);
    return GRUPOS_EQUIPE.flatMap((grupo) => grupo.abas).filter((aba) => visiveis.includes(aba));
}

// O cumprimento do menu: o primeiro nome; sem nome, o e-mail; sem nenhum dos dois, nada.
export function saudacao(perfil, email) {
    const primeiro = String(perfil?.nome_completo ?? '').trim().split(/\s+/)[0];
    const quem = primeiro || email;
    return quem ? `Olá, ${quem}` : '';
}
