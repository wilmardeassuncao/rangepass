// Moldura comum das páginas de quem entrou: menu lateral no computador; barra com ☰ e menu por cima no celular.
// Quais itens aparecem vem de menu-regras.mjs; aqui só se monta a tela e se cuida de abrir e fechar o menu.
import { supabase } from './api.mjs';
import { menuDe } from './menu-regras.mjs';

const CELULAR = window.matchMedia('(max-width: 899.98px)');
const SVG = 'http://www.w3.org/2000/svg';

// Cria um elemento com atributos e filhos (texto ou elementos).
function criar(tag, atributos = {}, filhos = []) {
    const el = document.createElement(tag);
    for (const [nome, valor] of Object.entries(atributos)) el.setAttribute(nome, valor);
    el.append(...filhos);
    return el;
}

function marca() {
    return criar('p', { class: 'marca' }, ['RANGE', criar('span', {}, ['PASS'])]);
}

function icone(classe, caminho) {
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('class', classe);
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', caminho);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linecap', 'round');
    svg.append(path);
    return svg;
}

// Desfaz uma moldura montada antes (por exemplo, ao abrir o perfil de novo).
let desmontarAnterior = null;

// Monta o menu de quem tem `papeis`, com o item `ativo` (um id de menuDe) marcado como a tela atual.
export function montarMoldura({ papeis = [], ativo = null } = {}) {
    desmontarAnterior?.();
    const corpo = document.body;
    const conteudo = document.querySelector('main.moldura-conteudo');

    // Barra do celular: marca e botão ☰.
    const rotuloBotao = criar('span', { class: 'so-leitor' }, ['Abrir o menu']);
    const botaoMenu = criar('button', {
        type: 'button', class: 'moldura-abrir', 'aria-controls': 'moldura-menu', 'aria-expanded': 'false',
    }, [rotuloBotao, icone('icone-abrir', 'M4 7h16M4 12h16M4 17h16'), icone('icone-fechar', 'M6 6l12 12M18 6L6 18')]);
    const barra = criar('header', { class: 'moldura-barra' }, [marca(), botaoMenu]);

    // O menu: os grupos de menuDe e, no fim, Sair.
    const menu = criar('nav', { id: 'moldura-menu', class: 'moldura-menu', 'aria-label': 'Menu principal' }, [marca()]);
    menuDe(papeis).forEach((grupo, i) => {
        const lista = criar('ul', {}, grupo.itens.map((item) => criar('li', {}, [
            criar('a', { class: 'moldura-item', href: item.href, 'data-item': item.id }, [item.texto]),
        ])));
        const filhos = [lista];
        if (grupo.titulo) {
            const idTitulo = `moldura-grupo-${i}`;
            filhos.unshift(criar('p', { class: 'moldura-grupo-titulo', id: idTitulo }, [grupo.titulo]));
            lista.setAttribute('aria-labelledby', idTitulo);
        }
        menu.append(criar('div', { class: 'moldura-grupo' }, filhos));
    });
    const botaoSair = criar('button', { type: 'button', class: 'moldura-item moldura-sair' }, ['Sair']);
    menu.append(criar('div', { class: 'moldura-rodape' }, [botaoSair]));

    const fundo = criar('div', { class: 'moldura-fundo', 'aria-hidden': 'true' });

    corpo.prepend(barra, menu, fundo);
    corpo.classList.remove('sem-moldura', 'menu-aberto');
    corpo.classList.add('com-moldura');

    const aberto = () => corpo.classList.contains('menu-aberto');

    function abrir() {
        corpo.classList.add('menu-aberto');
        botaoMenu.setAttribute('aria-expanded', 'true');
        rotuloBotao.textContent = 'Fechar o menu';
        if (conteudo) conteudo.inert = true;
        (menu.querySelector('[aria-current="page"]') ?? menu.querySelector('.moldura-item'))?.focus();
    }

    function fechar({ devolverFoco = true } = {}) {
        if (!aberto()) return;
        corpo.classList.remove('menu-aberto');
        botaoMenu.setAttribute('aria-expanded', 'false');
        rotuloBotao.textContent = 'Abrir o menu';
        if (conteudo) conteudo.inert = false;
        if (devolverFoco) botaoMenu.focus();
    }

    botaoMenu.addEventListener('click', () => (aberto() ? fechar() : abrir()));
    fundo.addEventListener('click', () => fechar());
    // Tocar num item fecha o menu; o link segue o caminho normal.
    menu.addEventListener('click', (evento) => {
        if (evento.target.closest('a.moldura-item')) fechar({ devolverFoco: false });
    });
    const aoTeclar = (evento) => {
        if (evento.key === 'Escape' && aberto()) {
            evento.preventDefault();
            fechar();
        }
    };
    // Se a tela virar de celular para computador com o menu aberto, ele fecha.
    const aoMudarLargura = () => { if (!CELULAR.matches) fechar({ devolverFoco: false }); };
    document.addEventListener('keydown', aoTeclar);
    CELULAR.addEventListener('change', aoMudarLargura);

    botaoSair.addEventListener('click', async () => {
        botaoSair.disabled = true;
        try {
            await supabase.auth.signOut();
        } catch (erro) {
            console.error(erro);
        } finally {
            location.replace('conta.html');
        }
    });

    desmontarAnterior = () => {
        fechar({ devolverFoco: false });
        document.removeEventListener('keydown', aoTeclar);
        CELULAR.removeEventListener('change', aoMudarLargura);
        barra.remove();
        menu.remove();
        fundo.remove();
        corpo.classList.remove('com-moldura');
        desmontarAnterior = null;
    };

    function marcarAtivo(id) {
        for (const link of menu.querySelectorAll('a.moldura-item')) {
            if (link.dataset.item === id) link.setAttribute('aria-current', 'page');
            else link.removeAttribute('aria-current');
        }
    }

    marcarAtivo(ativo);
    return { marcarAtivo };
}

// Tira a moldura (se houver) e volta ao cartão centralizado, para as telas de antes de entrar.
export function tirarMoldura() {
    desmontarAnterior?.();
    document.body.classList.add('sem-moldura');
}
