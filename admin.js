// Área da equipe (admin.html): a moldura (cabeçalho, abas e aviso) e uma seção por aba.
// Cada aba tem a sua função "abrirAba..." chamada quando ela é escolhida; as abas ainda sem
// função mostram "Em construção." (Tasks 7 a 9 do plano 4 trocam isso).
import { supabase, chamarFuncao } from './api.mjs';
import {
    NOMES_DIAS, abasVisiveis, funcionamentoDoFormulario, formularioDoFuncionamento, proximaVersao, numeroDoCampo,
} from './admin-regras.mjs';
import { CHAVES_CONFIGURACAO, validarConfiguracao } from './supabase/functions/_shared/configuracoes.mjs';

const ERRO_PADRAO = 'Não foi possível concluir agora. Tente de novo em instantes.';
const ERRO_CARREGAR = 'Não foi possível carregar agora. Verifique a internet e tente de novo.';
const ENTRAR = 'conta.html?voltar=admin.html';
// Só este 403 quer dizer "sem acesso à conta". Outro 403 ("sem permissão") fica na tela, como erro.
const CONTA_DESATIVADA = 'Sua conta está desativada. Procure o atendimento do estande.';

let papeis = [];          // papéis de quem está logado (GET minha-conta)
let abaAtual = null;

// ---------- Ajudantes de tela ----------

function mostrarTela(id) {
    for (const tela of document.querySelectorAll('.tela')) tela.classList.toggle('ativa', tela.id === id);
    window.scrollTo(0, 0);
}

// Aviso no alto da página (fica visível mesmo com a página rolada): vermelho para problema,
// verde (sucesso) para "deu certo".
function avisar(texto, { sucesso = false } = {}) {
    const aviso = document.getElementById('aviso');
    aviso.textContent = texto ?? '';
    aviso.classList.toggle('sucesso', Boolean(texto) && sucesso);
    aviso.hidden = !texto;
}

function mostrarErroGeral(lugar, mensagem) {
    const geral = lugar.querySelector('[data-erro-geral]');
    if (!geral) {
        if (mensagem) avisar(mensagem);
        return;
    }
    geral.textContent = mensagem ?? '';
    geral.hidden = !mensagem;
}

function limparErros(form) {
    for (const el of form.querySelectorAll('[data-erro-para]')) el.textContent = '';
    for (const el of form.querySelectorAll('[aria-invalid]')) el.removeAttribute('aria-invalid');
    mostrarErroGeral(form, null);
}

// Cada chave de `campos` vai para o lugar com data-erro-para igual; sem lugar, vira o erro geral.
// O campo marcado é o de mesmo nome ou os campos do grupo com data-grupo-erro igual (ex.: 'dias.0').
function mostrarErros(form, campos) {
    for (const [chave, mensagem] of Object.entries(campos)) {
        const lugar = form.querySelector(`[data-erro-para="${chave}"]`);
        if (!lugar) {
            mostrarErroGeral(form, mensagem);
            continue;
        }
        lugar.textContent = mensagem;
        const campo = form.elements.namedItem(chave);
        if (campo instanceof Element) campo.setAttribute('aria-invalid', 'true');
        const grupo = form.querySelector(`[data-grupo-erro="${chave}"]`);
        for (const el of grupo?.querySelectorAll('input:not([type="checkbox"])') ?? []) el.setAttribute('aria-invalid', 'true');
    }
    const primeiro = form.querySelector('[aria-invalid="true"]')
        ?? [...form.querySelectorAll('[data-erro-para], [data-erro-geral]')].find((el) => el.textContent);
    primeiro?.scrollIntoView?.({ block: 'center' });
    if (primeiro?.matches('input, textarea') && !primeiro.disabled) primeiro.focus({ preventScroll: true });
}

// Desabilita os botões do lugar enquanto a chamada está em andamento.
async function ocupado(lugar, acao) {
    const botoes = lugar.querySelectorAll('button');
    botoes.forEach((b) => { b.disabled = true; });
    try {
        await acao();
    } catch (erro) {
        console.error(erro);
        mostrarErroGeral(lugar, ERRO_PADRAO);
    } finally {
        botoes.forEach((b) => { b.disabled = false; });
    }
}

// 401 (sem login) ou conta desativada: sair e ir para a página de entrar, que volta para cá.
function precisaEntrar(r) {
    return r.status === 401 || (r.status === 403 && r.dados?.erro === CONTA_DESATIVADA);
}

async function irParaEntrar() {
    await supabase.auth.signOut();
    location.replace(ENTRAR);
}

function copiarMolde(id) {
    return document.getElementById(id).content.firstElementChild.cloneNode(true);
}

// ---------- Moldura: abas ----------

// A função de abrir de cada aba. null = ainda em construção (o painel já mostra o aviso).
const ABRIR_ABA = {
    configuracoes: abrirAbaConfiguracoes,
    catalogo: null,
    pistas: null,
    equipe: null,
    agendamentos: null,
};

function botoesDasAbas() {
    return [...document.querySelectorAll('#abas [data-aba]')].filter((botao) => !botao.hidden);
}

function montarAbas() {
    const visiveis = abasVisiveis(papeis);
    for (const botao of document.querySelectorAll('#abas [data-aba]')) botao.hidden = !visiveis.includes(botao.dataset.aba);
    return visiveis;
}

function escolherAba(id) {
    abaAtual = id;
    avisar(null);
    for (const botao of document.querySelectorAll('#abas [data-aba]')) {
        const escolhida = botao.dataset.aba === id;
        botao.setAttribute('aria-selected', String(escolhida));
        botao.tabIndex = escolhida ? 0 : -1;
        document.getElementById(`painel-${botao.dataset.aba}`).hidden = !escolhida;
    }
    ABRIR_ABA[id]?.();
}

document.getElementById('abas').addEventListener('click', (evento) => {
    const botao = evento.target.closest('[data-aba]');
    if (botao && botao.dataset.aba !== abaAtual) escolherAba(botao.dataset.aba);
});

// Setas do teclado passam de uma aba para a outra.
document.getElementById('abas').addEventListener('keydown', (evento) => {
    if (evento.key !== 'ArrowRight' && evento.key !== 'ArrowLeft') return;
    const botoes = botoesDasAbas();
    const atual = botoes.findIndex((b) => b.dataset.aba === abaAtual);
    const proximo = botoes[(atual + (evento.key === 'ArrowRight' ? 1 : -1) + botoes.length) % botoes.length];
    escolherAba(proximo.dataset.aba);
    proximo.focus();
});

document.getElementById('botao-sair').addEventListener('click', async () => {
    await supabase.auth.signOut();
    location.replace(ENTRAR);
});

// ---------- Aba Configurações ----------
// Um formulário por chave (form-<chave>). Os valores vêm do GET configuracoes e cada "Salvar"
// manda só a sua chave no PUT configuracoes.

let configuracoes = null;  // { chave: valor } como estão salvos no servidor

const listaDias = document.getElementById('dias-semana');
const listaDatas = document.getElementById('datas-fechadas');
const listaFaixas = document.getElementById('faixas-instrutores');
const textoDe = (form, nome) => form.elements[nome].value.trim();

// Uma linha por dia da semana, de domingo (0) a sábado (6). Montadas uma vez só.
function montarDias() {
    NOMES_DIAS.forEach((nome, dia) => {
        const linha = copiarMolde('molde-dia');
        linha.dataset.dia = String(dia);
        linha.dataset.grupoErro = `dias.${dia}`;
        linha.querySelector('[data-nome-dia]').textContent = nome;
        linha.querySelector('[data-erro-dia]').dataset.erroPara = `dias.${dia}`;
        linha.querySelector('[data-campo="fechado"]').addEventListener('change', () => atualizarDia(linha));
        listaDias.append(linha);
    });
}

// Dia fechado: os horários ficam desligados.
function atualizarDia(linha) {
    const fechado = linha.querySelector('[data-campo="fechado"]').checked;
    for (const campo of ['abre', 'fecha']) linha.querySelector(`[data-campo="${campo}"]`).disabled = fechado;
}

function adicionarData(valor = '') {
    const linha = copiarMolde('molde-data');
    const campo = linha.querySelector('[data-campo="data"]');
    campo.value = valor;
    linha.querySelector('[data-remover]').addEventListener('click', () => {
        linha.remove();
        atualizarSemDatas();
    });
    listaDatas.append(linha);
    atualizarSemDatas();
    return campo;
}

function atualizarSemDatas() {
    document.getElementById('sem-datas-fechadas').hidden = listaDatas.children.length > 0;
}

function adicionarFaixa({ ate = '', instrutores = '' } = {}) {
    const linha = copiarMolde('molde-faixa');
    linha.querySelector('[data-campo="ate"]').value = String(ate ?? '');
    linha.querySelector('[data-campo="instrutores"]').value = String(instrutores ?? '');
    linha.querySelector('[data-remover]').addEventListener('click', () => linha.remove());
    listaFaixas.append(linha);
    return linha;
}

document.getElementById('botao-adicionar-data').addEventListener('click', () => adicionarData().focus());
document.getElementById('botao-adicionar-faixa').addEventListener('click', () => {
    adicionarFaixa().querySelector('input').focus();
});

// Campos numéricos (type=number com name) do formulário: { nome: número ou null }.
function numerosDe(form) {
    const numeros = {};
    for (const campo of form.querySelectorAll('input[type="number"][name]')) numeros[campo.name] = numeroDoCampo(campo.value);
    return numeros;
}

function preencherNumeros(form, valor) {
    for (const campo of form.querySelectorAll('input[type="number"][name]')) campo.value = String(valor?.[campo.name] ?? '');
}

// Como cada chave vai para o formulário (preencher) e volta dele (ler). `atual` é o valor salvo:
// o que o formulário não mostra continua igual.
const FORMULARIOS = {
    estande: {
        preencher(form, valor) {
            for (const nome of ['nome', 'fuso', 'endereco', 'contato']) form.elements[nome].value = valor?.[nome] ?? '';
            form.elements.logo_url.value = valor?.logo_url ?? '';
        },
        ler(form, atual) {
            return {
                ...atual,
                nome: textoDe(form, 'nome'),
                fuso: textoDe(form, 'fuso'),
                endereco: textoDe(form, 'endereco'),
                contato: textoDe(form, 'contato'),
                logo_url: textoDe(form, 'logo_url') || null,
            };
        },
    },
    funcionamento: {
        preencher(_form, valor) {
            const { linhas, datas } = formularioDoFuncionamento(valor);
            linhas.forEach((dados, dia) => {
                const linha = listaDias.querySelector(`[data-dia="${dia}"]`);
                linha.querySelector('[data-campo="fechado"]').checked = dados.fechado;
                linha.querySelector('[data-campo="abre"]').value = dados.abre;
                linha.querySelector('[data-campo="fecha"]').value = dados.fecha;
                atualizarDia(linha);
            });
            listaDatas.replaceChildren();
            for (const data of datas) adicionarData(data);
            atualizarSemDatas();
        },
        ler(_form, atual) {
            const linhas = [...listaDias.querySelectorAll('[data-dia]')].map((linha) => ({
                fechado: linha.querySelector('[data-campo="fechado"]').checked,
                abre: linha.querySelector('[data-campo="abre"]').value,
                fecha: linha.querySelector('[data-campo="fecha"]').value,
            }));
            const datas = [...listaDatas.querySelectorAll('[data-campo="data"]')].map((campo) => campo.value);
            return { ...atual, ...funcionamentoDoFormulario(linhas, datas) };
        },
    },
    agenda: {
        preencher(form, valor) {
            preencherNumeros(form, valor);
            listaFaixas.replaceChildren();
            for (const faixa of valor?.faixas_instrutores ?? []) adicionarFaixa(faixa);
        },
        ler(form, atual) {
            const faixas_instrutores = [...listaFaixas.children].map((linha) => ({
                ate: numeroDoCampo(linha.querySelector('[data-campo="ate"]').value),
                instrutores: numeroDoCampo(linha.querySelector('[data-campo="instrutores"]').value),
            }));
            return { ...atual, ...numerosDe(form), faixas_instrutores };
        },
    },
    municao: { preencher: preencherNumeros, ler: (form, atual) => ({ ...atual, ...numerosDe(form) }) },
    cadastro: { preencher: preencherNumeros, ler: (form, atual) => ({ ...atual, ...numerosDe(form) }) },
    creditos: { preencher: preencherNumeros, ler: (form, atual) => ({ ...atual, ...numerosDe(form) }) },
    privacidade: textoVersionado(),
    termo: textoVersionado(),
};

// Política e termo: o texto muda na área grande; a versão só aparece. Texto diferente = versão seguinte.
function textoVersionado() {
    return {
        preencher(form, valor) {
            form.elements.texto.value = valor?.texto ?? '';
            form.querySelector('[data-versao]').textContent = String(valor?.versao ?? '');
        },
        ler(form, atual) {
            const texto = form.elements.texto.value;
            return { ...atual, texto, versao: proximaVersao(atual ?? { versao: 0, texto: '' }, texto) };
        },
    };
}

// Onde os clientes vão ver o texto novo de cada chave com versão.
const ONDE_ACEITAM = { termo: 'no próximo agendamento', privacidade: 'no próximo cadastro' };

function mensagemDeSucesso(chave, antes, depois) {
    if (ONDE_ACEITAM[chave] && depois.versao !== antes?.versao) {
        return `Versão ${depois.versao} publicada. Os clientes vão aceitar o texto novo ${ONDE_ACEITAM[chave]}.`;
    }
    return 'Configuração salva.';
}

function formularioDa(chave) {
    return document.getElementById(`form-${chave}`);
}

function preencherConfiguracao(chave) {
    FORMULARIOS[chave].preencher(formularioDa(chave), configuracoes[chave]);
}

function salvarConfiguracao(form) {
    const chave = form.dataset.chave;
    limparErros(form);
    avisar(null);
    const antes = configuracoes[chave];
    const valor = FORMULARIOS[chave].ler(form, antes);
    const campos = validarConfiguracao(chave, valor);
    if (Object.keys(campos).length) return mostrarErros(form, campos);

    return ocupado(form, async () => {
        const r = await chamarFuncao('configuracoes', { metodo: 'PUT', corpo: { chave, valor } });
        if (r.status === 200) {
            configuracoes[chave] = r.dados.valor;
            preencherConfiguracao(chave);
            avisar(mensagemDeSucesso(chave, antes, r.dados.valor), { sucesso: true });
        } else if (precisaEntrar(r)) {
            await irParaEntrar();
        } else if (r.status === 400 && r.dados?.campos) {
            mostrarErros(form, r.dados.campos);
        } else {
            mostrarErroGeral(form, r.dados?.erro ?? ERRO_PADRAO);
        }
    });
}

for (const chave of CHAVES_CONFIGURACAO) {
    formularioDa(chave).addEventListener('submit', (evento) => {
        evento.preventDefault();
        salvarConfiguracao(evento.currentTarget);
    });
}

function mostrarEstadoConfiguracoes(estado, mensagem) {
    document.getElementById('configuracoes-carregando').hidden = estado !== 'carregando';
    document.getElementById('configuracoes-erro').hidden = estado !== 'erro';
    document.getElementById('configuracoes-formularios').hidden = estado !== 'pronto';
    document.getElementById('configuracoes-erro-mensagem').textContent = mensagem ?? '';
}

async function carregarConfiguracoes() {
    mostrarEstadoConfiguracoes('carregando');
    try {
        const r = await chamarFuncao('configuracoes');
        if (precisaEntrar(r)) return irParaEntrar();
        if (r.status !== 200 || !r.dados?.configuracoes) return mostrarEstadoConfiguracoes('erro', r.dados?.erro ?? ERRO_CARREGAR);
        configuracoes = r.dados.configuracoes;
        for (const chave of CHAVES_CONFIGURACAO) {
            limparErros(formularioDa(chave));
            preencherConfiguracao(chave);
        }
        mostrarEstadoConfiguracoes('pronto');
    } catch (erro) {
        console.error(erro);
        mostrarEstadoConfiguracoes('erro', ERRO_CARREGAR);
    }
}

document.getElementById('botao-recarregar-configuracoes').addEventListener('click', (evento) => {
    ocupado(evento.currentTarget.parentElement, carregarConfiguracoes);
});

// Carrega uma vez; voltar para a aba não apaga o que foi digitado e ainda não salvo.
function abrirAbaConfiguracoes() {
    if (!configuracoes) carregarConfiguracoes();
}

montarDias();

// ---------- Início ----------

function mostrarErroCarregar(mensagem) {
    document.getElementById('erro-carregar-mensagem').textContent = mensagem ?? ERRO_CARREGAR;
    mostrarTela('tela-erro');
}

async function carregar() {
    mostrarTela('tela-carregando');
    const r = await chamarFuncao('minha-conta');
    if (precisaEntrar(r)) return irParaEntrar();
    if (r.status !== 200) return mostrarErroCarregar(r.dados?.erro);
    papeis = r.dados.papeis ?? [];
    document.getElementById('nome-equipe').textContent = r.dados.perfil?.nome_completo ?? r.dados.email ?? '';
    document.getElementById('topo-conta').hidden = false;

    const visiveis = montarAbas();
    if (visiveis.length === 0) return mostrarTela('tela-sem-acesso');
    mostrarTela('tela-admin');
    escolherAba(visiveis[0]);
}

function carregarComErro() {
    return carregar().catch((erro) => {
        console.error(erro);
        mostrarErroCarregar(null);
    });
}

document.getElementById('botao-tentar-de-novo').addEventListener('click', () => {
    ocupado(document.getElementById('tela-erro'), carregarComErro);
});

async function iniciar() {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return location.replace(ENTRAR);
    return carregarComErro();
}

iniciar().catch((erro) => {
    console.error(erro);
    mostrarErroCarregar(null);
});
