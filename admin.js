// Área da equipe (admin.html): a moldura comum (menu lateral, de moldura.mjs) e uma seção por aba.
// A aba aberta vem do endereço (admin.html#precos); cada aba tem a sua função "abrirAba..." chamada quando ela é escolhida.
import { supabase, chamarFuncao } from './api.mjs';
import { montarMoldura } from './moldura.mjs';
import { parteDoEndereco, abasNaOrdemDoMenu, saudacao } from './menu-regras.mjs';
import {
    NOMES_DIAS, abasVisiveis, funcionamentoDoFormulario, formularioDoFuncionamento, proximaVersao, numeroDoCampo,
    proximoNumeroDePista, rotuloSituacaoArma, mensagemCadastroSalvo, nomeDoModelo, ROTULO_PAPEL,
    consultaDosFiltros, descreverEvento, dataHoraNoFuso, CAMPOS_FORMULARIO,
    precoDoCampo, textoDoPreco, AVISO_SEM_PRECO, regraDoFormulario, formularioDaRegra, diasDaRegra, textoDoPercentual,
    situacaoDaCampanha, textoDoPeriodo, campanhaDoFormulario, formularioDaCampanha, classeDoFormulario, formularioDaClasse,
    textoDoDescontoDaClasse, pacoteDoFormulario, formularioDoPacote, textoDoPacote,
} from './admin-regras.mjs';
import { formatarCpf, formatarTelefone } from './conta-regras.mjs';
import { descreverSessao, TEXTO_SITUACAO, somarDias, linhasDoPreco } from './agendar-regras.mjs';
import { dataNoFuso } from './supabase/functions/_shared/cadastro.mjs';
import { PAPEIS } from './supabase/functions/_shared/papeis.mjs';
import { CHAVES_CONFIGURACAO, validarConfiguracao } from './supabase/functions/_shared/configuracoes.mjs';
import { SITUACOES_UNIDADE, validarCadastroCatalogo } from './supabase/functions/_shared/catalogo.mjs';
import { validarRegra, validarCampanha, validarClasse, validarPacote, formatarReais } from './supabase/functions/_shared/precos.mjs';

const ERRO_PADRAO = 'Não foi possível concluir agora. Tente de novo em instantes.';
const ERRO_CARREGAR = 'Não foi possível carregar agora. Verifique a internet e tente de novo.';
const ENTRAR = 'conta.html?voltar=admin.html';
// Só este 403 quer dizer "sem acesso à conta". Outro 403 ("sem permissão") fica na tela, como erro.
const CONTA_DESATIVADA = 'Sua conta está desativada. Procure o atendimento do estande.';

let papeis = [];          // papéis de quem está logado (GET minha-conta)
let meuId = null;         // id de quem está logado (só para mostrar "você"; o servidor é quem protege)
let abaAtual = null;
let moldura = null;       // a moldura montada (para marcar o item atual do menu)

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
    if (primeiro?.matches('input, textarea, select') && !primeiro.disabled) primeiro.focus({ preventScroll: true });
}

// Desabilita os botões (e as listas de escolha) do lugar enquanto a chamada está em andamento.
async function ocupado(lugar, acao) {
    const botoes = lugar.querySelectorAll('button, select');
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

// A função de abrir de cada aba.
const ABRIR_ABA = {
    configuracoes: abrirAbaConfiguracoes,
    catalogo: abrirAbaCadastros,
    pistas: abrirAbaCadastros,
    precos: abrirAbaPrecos,
    promocoes: abrirAbaPromocoes,
    equipe: abrirAbaEquipe,
    agendamentos: abrirAbaAgendamentos,
};

function escolherAba(id) {
    abaAtual = id;
    avisar(null);
    for (const painel of document.querySelectorAll('#tela-admin > .painel')) {
        painel.hidden = painel.id !== `painel-${id}`;
    }
    moldura?.marcarAtivo(`equipe-${id}`);
    ABRIR_ABA[id]?.();
}

// O endereço manda: abre a aba do "#" (clique no menu, "voltar" do navegador). Aba proibida ou
// desconhecida abre a primeira permitida (na ordem do menu), sem mensagem, e o endereço passa a mostrar essa aba.
function abrirAbaDoEndereco() {
    const id = parteDoEndereco(location.hash, abasNaOrdemDoMenu(papeis));
    if (!id) return;
    if (location.hash !== `#${id}`) history.replaceState(null, '', `#${id}`);
    if (id === abaAtual) return;
    escolherAba(id);
    window.scrollTo(0, 0);
}

window.addEventListener('hashchange', () => {
    if (document.getElementById('tela-admin').classList.contains('ativa')) abrirAbaDoEndereco();
});

// "Sair" da tela de erro (quando o menu ainda não existe).
document.getElementById('botao-erro-sair').addEventListener('click', async (evento) => {
    evento.currentTarget.disabled = true;
    try {
        await supabase.auth.signOut();
    } catch (erro) {
        console.error(erro);
    } finally {
        location.replace('conta.html');
    }
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

// As chaves que têm formulário nesta aba. A chave precos (hora de pista) fica na aba Preços.
const CHAVES_DA_ABA = CHAVES_CONFIGURACAO.filter((chave) => Object.hasOwn(FORMULARIOS, chave));

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

for (const chave of CHAVES_DA_ABA) {
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
        for (const chave of CHAVES_DA_ABA) {
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

// ---------- Abas Catálogo e Pistas ----------
// As duas abas usam o mesmo GET catalogo: carregado uma vez (na primeira das duas que for aberta)
// e de novo depois de cada cadastro salvo. Nada é apagado: só criar, editar e desativar/reativar.
// Cada tipo tem a sua seção (secao-<tipo>), com a lista (linhas-<tipo>) e um formulário
// (form-<tipo>) montado na hora, para "Adicionar" ou "Editar".

let catalogo = null;            // { categorias, calibres, modelos, tipos_municao, unidades, pistas }
let catalogoEmCarga = null;     // a primeira carga em andamento (as duas abas não pedem duas vezes)
let versaoCatalogo = 0;         // soma 1 a cada carga (a aba Preços sabe quando remontar as listas dela)

// campos: o que o formulário mostra (CAMPOS_FORMULARIO, em admin-regras.mjs: rótulos, listas de
// escolha e o fixo/soAoCriar, este tirado das regras do servidor).
const CADASTROS = {
    categoria: {
        lista: 'categorias', nomeItem: 'categoria', campoAtivo: 'ativo',
        campos: CAMPOS_FORMULARIO.categoria,
        colunas: (item) => [['Nome', item.nome]],
    },
    calibre: {
        lista: 'calibres', nomeItem: 'calibre', campoAtivo: 'ativo',
        campos: CAMPOS_FORMULARIO.calibre,
        colunas: (item) => [['Nome', item.nome]],
    },
    modelo: {
        lista: 'modelos', nomeItem: 'modelo', campoAtivo: 'ativo',
        campos: CAMPOS_FORMULARIO.modelo,
        avisoAoEditar: 'O calibre não pode ser mudado depois de criado.',
        colunas: (item) => [
            ['Modelo', nomeDoModelo(item)],
            ['Categoria', nomeNaLista('categorias', item.categoria_id)],
            ['Calibre', nomeNaLista('calibres', item.calibre_id)],
        ],
    },
    tipo_municao: {
        lista: 'tipos_municao', nomeItem: 'munição', campoAtivo: 'ativo',
        campos: CAMPOS_FORMULARIO.tipo_municao,
        avisoAoEditar: 'O calibre não pode ser mudado depois de criado.',
        colunas: (item) => [['Munição', item.nome], ['Calibre', nomeNaLista('calibres', item.calibre_id)]],
    },
    unidade: {
        lista: 'unidades', nomeItem: 'arma',
        campos: CAMPOS_FORMULARIO.unidade,
        avisoAoEditar: 'O modelo não pode ser mudado depois de criado. A situação muda na lista.',
        colunas: (item) => [['Nº de registro', item.numero_registro], ['Modelo', nomeNaLista('modelos', item.modelo_id)]],
    },
    pista: {
        lista: 'pistas', nomeItem: 'pista', campoAtivo: 'ativa', rotulos: ['Ativa', 'Inativa'],
        campos: CAMPOS_FORMULARIO.pista,
        colunas: (item) => [['Pista', `Pista ${item.numero}`]],
    },
};

function nomeDoItem(lista, item) {
    return lista === 'modelos' ? nomeDoModelo(item) : item.nome;
}

function itemDaLista(lista, id) {
    return (catalogo?.[lista] ?? []).find((item) => item.id === id);
}

function nomeNaLista(lista, id) {
    const item = itemDaLista(lista, id);
    return item ? nomeDoItem(lista, item) : '—';
}

function estaAtivo(tipo, item) {
    if (tipo === 'unidade') return item.situacao !== 'desativada';
    return item[CADASTROS[tipo].campoAtivo] === true;
}

// Os campos que o formulário mostra: ao criar, todos; ao editar, só os que podem mudar ali.
function camposDoFormulario(tipo, criando) {
    return CADASTROS[tipo].campos.filter((campo) => criando || (!campo.fixo && !campo.soAoCriar));
}

// ----- Listas -----

function celula(coluna, conteudo) {
    const td = document.createElement('td');
    td.dataset.coluna = coluna;
    td.append(conteudo);
    return td;
}

function rotuloSituacao(texto, ativo) {
    const rotulo = document.createElement('span');
    rotulo.className = `rotulo ${ativo ? 'ativo' : 'inativo'}`;
    rotulo.textContent = texto;
    return rotulo;
}

function botaoDaLinha(texto, acao, item, descricao, { perigo = false } = {}) {
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = `botao secundario pequeno${perigo ? ' perigo' : ''}`;
    botao.textContent = texto;
    botao.dataset.acao = acao;
    botao.dataset.id = String(item.id);
    botao.setAttribute('aria-label', `${texto}: ${descricao}`);
    return botao;
}

// Opções das listas de escolha. Situação: as três. Outras: só os itens ativos, mais o que já está
// escolhido (se tiver sido desativado depois, para não sumir da edição). campo.vazio: o texto da
// opção sem escolha (padrão "Escolha…"; nas opcionais, "Nenhum").
function preencherOpcoes(select, campo, valor) {
    let opcoes;
    if (campo.situacao) {
        opcoes = SITUACOES_UNIDADE.map((situacao) => [situacao, rotuloSituacaoArma(situacao)]);
    } else {
        opcoes = [['', campo.vazio ?? 'Escolha…']];
        for (const item of catalogo?.[campo.escolha] ?? []) {
            if (!item.ativo && item.id !== valor) continue;
            opcoes.push([String(item.id), `${nomeDoItem(campo.escolha, item)}${item.ativo ? '' : ' (desativado)'}`]);
        }
    }
    select.replaceChildren(...opcoes.map(([valorOpcao, texto]) => {
        const opcao = document.createElement('option');
        opcao.value = valorOpcao;
        opcao.textContent = texto;
        return opcao;
    }));
    select.value = valor === null || valor === undefined ? '' : String(valor);
    if (select.selectedIndex < 0) select.value = '';
}

function seletorSituacao(item) {
    const select = document.createElement('select');
    select.dataset.acao = 'situacao';
    select.dataset.id = String(item.id);
    select.setAttribute('aria-label', `Situação da arma ${item.numero_registro}`);
    preencherOpcoes(select, { situacao: true }, item.situacao);
    return select;
}

function linhaDoCadastro(tipo, item) {
    const definicao = CADASTROS[tipo];
    const ativo = estaAtivo(tipo, item);
    const colunas = definicao.colunas(item);
    const descricao = colunas[0][1];
    const linha = document.createElement('tr');
    linha.dataset.id = String(item.id);
    linha.classList.toggle('inativo', !ativo);
    for (const [coluna, texto] of colunas) linha.append(celula(coluna, texto));

    if (tipo === 'unidade') {
        linha.append(celula('Situação', seletorSituacao(item)));
    } else {
        const [textoAtivo, textoInativo] = definicao.rotulos ?? ['Ativo', 'Desativado'];
        linha.append(celula('Situação', rotuloSituacao(ativo ? textoAtivo : textoInativo, ativo)));
    }
    const acoes = document.createElement('div');
    acoes.className = 'acoes';
    if (definicao.campos.length > 0) acoes.append(botaoDaLinha('Editar', 'editar', item, descricao));
    if (definicao.campoAtivo) {
        acoes.append(botaoDaLinha(ativo ? 'Desativar' : 'Reativar', 'alternar', item, descricao, { perigo: ativo }));
    }
    const celulaAcoes = celula('', acoes);
    celulaAcoes.className = 'celula-acoes';
    linha.append(celulaAcoes);
    return linha;
}

function mostrarCadastros() {
    for (const [tipo, definicao] of Object.entries(CADASTROS)) {
        const itens = catalogo[definicao.lista] ?? [];
        const corpo = document.getElementById(`linhas-${tipo}`);
        corpo.replaceChildren(...itens.map((item) => linhaDoCadastro(tipo, item)));
        corpo.closest('table').hidden = itens.length === 0;
        document.getElementById(`vazio-${tipo}`).hidden = itens.length > 0;

        // Formulário aberto: as listas de escolha ganham os itens novos, sem perder o escolhido.
        const form = document.getElementById(`form-${tipo}`);
        if (!form || form.hidden) continue;
        for (const campo of definicao.campos.filter((c) => c.escolha)) {
            const select = form.elements.namedItem(campo.nome);
            if (select instanceof HTMLSelectElement) preencherOpcoes(select, campo, numeroDoCampo(select.value));
        }
    }
}

// ----- Formulário de Adicionar / Editar -----

function montarCampo(campo, item) {
    const rotulo = document.createElement('label');
    rotulo.className = 'campo';
    rotulo.append(campo.rotulo);
    let entrada;
    if (campo.escolha || campo.situacao) {
        entrada = document.createElement('select');
        preencherOpcoes(entrada, campo, item ? item[campo.nome] : (campo.situacao ? 'disponivel' : null));
    } else {
        entrada = document.createElement('input');
        entrada.autocomplete = 'off';
        entrada.value = item?.[campo.nome] ?? '';
    }
    entrada.name = campo.nome;
    const erro = document.createElement('span');
    erro.className = 'erro';
    erro.dataset.erroPara = campo.nome;
    rotulo.append(entrada, erro);
    return rotulo;
}

function criarBotao(texto, tipo, classe) {
    const botao = document.createElement('button');
    botao.type = tipo;
    botao.className = classe;
    botao.textContent = texto;
    return botao;
}

function abrirFormulario(tipo, item = null) {
    const definicao = CADASTROS[tipo];
    const form = document.getElementById(`form-${tipo}`);
    const criando = !item;
    if (criando && !form.hidden && form.dataset.modo === 'criar') {
        form.querySelector('input, select')?.focus();
        return;
    }
    form.dataset.modo = criando ? 'criar' : 'editar';
    form.dataset.id = criando ? '' : String(item.id);

    const titulo = document.createElement('h3');
    titulo.className = 'formulario-titulo';
    titulo.textContent = criando ? `Adicionar ${definicao.nomeItem}` : `Editar ${definicao.nomeItem}`;
    const grade = document.createElement('div');
    grade.className = 'grade';
    for (const campo of camposDoFormulario(tipo, criando)) grade.append(montarCampo(campo, item));
    const partes = [titulo, grade];
    if (!criando && definicao.avisoAoEditar) {
        const aviso = document.createElement('p');
        aviso.className = 'subtitulo';
        aviso.textContent = definicao.avisoAoEditar;
        partes.push(aviso);
    }
    const geral = document.createElement('p');
    geral.className = 'erro';
    geral.dataset.erroGeral = '';
    geral.hidden = true;
    const botoes = document.createElement('div');
    botoes.className = 'botoes';
    const cancelar = criarBotao('Cancelar', 'button', 'botao secundario');
    cancelar.dataset.cancelar = '';
    botoes.append(criarBotao('Salvar', 'submit', 'botao'), cancelar);
    form.replaceChildren(...partes, geral, botoes);
    form.hidden = false;
    form.scrollIntoView?.({ block: 'nearest' });
    form.querySelector('input, select')?.focus({ preventScroll: true });
}

function fecharFormulario(form) {
    form.hidden = true;
    form.replaceChildren();
    delete form.dataset.modo;
    delete form.dataset.id;
}

function dadosDoFormulario(form, tipo, criando) {
    const dados = {};
    for (const campo of camposDoFormulario(tipo, criando)) {
        const valor = form.elements[campo.nome].value;
        dados[campo.nome] = campo.escolha ? numeroDoCampo(valor) : valor;
    }
    return dados;
}

// ----- Enviar (POST cria, PUT edita) -----

// Busca o catálogo e, dando certo, refaz as listas. Devolve {} (certo), { erro } ou { saiu }
// (sem login: já foi para a página de entrar).
async function buscarCatalogo() {
    const r = await chamarFuncao('catalogo');
    if (precisaEntrar(r)) {
        await irParaEntrar();
        return { saiu: true };
    }
    if (r.status !== 200 || !Array.isArray(r.dados?.categorias)) return { erro: r.dados?.erro ?? ERRO_CARREGAR };
    catalogo = r.dados;
    versaoCatalogo += 1;
    mostrarCadastros();
    return {};
}

// Confere no navegador (as mesmas regras do servidor) e envia. Erros vão para os campos do
// formulário ou, sem formulário (botões da lista e "Adicionar pista"), para o aviso.
// Devolve true quando salvou.
async function enviarCadastro(tipo, id, dados, form = null) {
    const criando = id === null;
    const mostrarProblema = (campos) => {
        if (form) mostrarErros(form, campos);
        else avisar(Object.values(campos)[0]);
    };
    const { campos, valores } = validarCadastroCatalogo(tipo, dados, { criando });
    if (Object.keys(campos).length) {
        mostrarProblema(campos);
        return false;
    }

    const corpo = criando ? { tipo, dados: valores } : { tipo, id, dados: valores };
    const r = await chamarFuncao('catalogo', { metodo: criando ? 'POST' : 'PUT', corpo });
    if (r.status === 200 || r.status === 201) {
        if (form) fecharFormulario(form);
        const recarga = await buscarCatalogo().catch((erro) => {
            console.error(erro);
            return { erro: ERRO_CARREGAR };
        });
        if (recarga.saiu) return true;
        if (recarga.erro) avisar('Salvo, mas não deu para atualizar a lista. Recarregue a página.');
        else avisar(mensagemCadastroSalvo(tipo, r.dados?.reservas_futuras), { sucesso: true });
        return true;
    }
    if (precisaEntrar(r)) {
        await irParaEntrar();
    } else if ((r.status === 400 || r.status === 409) && r.dados?.campos) {
        mostrarProblema(r.dados.campos);
    } else if (form) {
        mostrarErroGeral(form, r.dados?.erro ?? ERRO_PADRAO);
    } else {
        avisar(r.dados?.erro ?? ERRO_PADRAO);
    }
    return false;
}

function salvarFormulario(form) {
    const tipo = form.closest('[data-tipo]').dataset.tipo;
    const criando = form.dataset.modo === 'criar';
    limparErros(form);
    avisar(null);
    const id = criando ? null : Number(form.dataset.id);
    const dados = dadosDoFormulario(form, tipo, criando);
    return ocupado(form, () => enviarCadastro(tipo, id, dados, form));
}

// "Editar", "Desativar"/"Reativar" (ativo ou ativa ao contrário) e a situação da arma (lista na linha).
async function acaoDaLinha(tipo, alvo) {
    const definicao = CADASTROS[tipo];
    const id = Number(alvo.dataset.id);
    const item = itemDaLista(definicao.lista, id);
    if (!item) return;
    if (alvo.dataset.acao === 'editar') {
        abrirFormulario(tipo, item);
        return;
    }
    avisar(null);
    const dados = alvo.dataset.acao === 'situacao'
        ? { situacao: alvo.value }
        : { [definicao.campoAtivo]: !item[definicao.campoAtivo] };
    await ocupado(alvo.closest('tr'), async () => {
        let salvou = false;
        try {
            salvou = await enviarCadastro(tipo, id, dados);
        } finally {
            // Não salvou: a lista de situação volta ao valor de antes.
            if (!salvou && alvo.dataset.acao === 'situacao') alvo.value = item.situacao;
        }
    });
}

for (const secao of document.querySelectorAll('#painel-catalogo [data-tipo], #painel-pistas [data-tipo]')) {
    const tipo = secao.dataset.tipo;
    const corpo = document.getElementById(`linhas-${tipo}`);
    corpo.addEventListener('click', (evento) => {
        const alvo = evento.target.closest('button[data-acao]');
        if (alvo) acaoDaLinha(tipo, alvo);
    });
    corpo.addEventListener('change', (evento) => {
        if (evento.target.matches('select[data-acao="situacao"]')) acaoDaLinha(tipo, evento.target);
    });

    const form = document.getElementById(`form-${tipo}`);
    if (!form) continue;
    secao.querySelector('[data-adicionar]').addEventListener('click', () => abrirFormulario(tipo));
    form.addEventListener('submit', (evento) => {
        evento.preventDefault();
        salvarFormulario(form);
    });
    form.addEventListener('click', (evento) => {
        if (evento.target.closest('[data-cancelar]')) fecharFormulario(form);
    });
}

document.getElementById('botao-adicionar-pista').addEventListener('click', () => {
    avisar(null);
    ocupado(document.getElementById('secao-pista'), () => (
        enviarCadastro('pista', null, { numero: proximoNumeroDePista(catalogo.pistas) })
    ));
});

function mostrarEstadoCadastros(estado, mensagem) {
    for (const [nome, conteudo] of [['catalogo', 'catalogo-secoes'], ['pistas', 'pistas-conteudo']]) {
        document.getElementById(`${nome}-carregando`).hidden = estado !== 'carregando';
        document.getElementById(`${nome}-erro`).hidden = estado !== 'erro';
        document.getElementById(conteudo).hidden = estado !== 'pronto';
        document.getElementById(`${nome}-erro-mensagem`).textContent = mensagem ?? '';
    }
}

async function carregarCatalogo() {
    mostrarEstadoCadastros('carregando');
    try {
        const resultado = await buscarCatalogo();
        if (resultado.saiu) return;
        if (resultado.erro) mostrarEstadoCadastros('erro', resultado.erro);
        else mostrarEstadoCadastros('pronto');
    } catch (erro) {
        console.error(erro);
        mostrarEstadoCadastros('erro', ERRO_CARREGAR);
    }
}

for (const botao of document.querySelectorAll('[data-recarregar-cadastros]')) {
    botao.addEventListener('click', () => ocupado(botao.parentElement, carregarCatalogo));
}

// Carrega na primeira vez; depois, as listas já estão montadas (e o que foi digitado continua).
function abrirAbaCadastros() {
    if (!catalogo && !catalogoEmCarga) {
        catalogoEmCarga = carregarCatalogo().finally(() => { catalogoEmCarga = null; });
    }
}

// ---------- Aba Preços ----------
// Hora de pista (PUT configuracoes, chave precos), o preço de cada modelo e de cada munição (PUT catalogo,
// cada um na sua linha) e as regras por dia e horário (POST/PUT precos). Usa o GET precos e o mesmo
// GET catalogo das abas Catálogo e Pistas. As promoções (campanhas, classes, pacotes) não ficam aqui.

let precos = null;              // GET precos: { hora_pista_centavos, regras, campanhas, classes, pacotes }
let precosEmCarga = null;
let versaoNasListasDePreco = -1; // versão do catálogo com que as listas de armas e munições foram montadas

const formHoraPista = document.getElementById('form-hora-pista');

// Preço de cada tipo do catálogo: a lista do GET catalogo, o campo e o rótulo. A munição tem também
// o custo de compra (opcional), salvo pelo mesmo botão: o desconto de classe não desce abaixo dele.
const PRECOS_CATALOGO = {
    modelo: { lista: 'modelos', campo: 'preco_hora_centavos', rotulo: 'Preço por hora' },
    tipo_municao: {
        lista: 'tipos_municao', campo: 'preco_unidade_centavos', rotulo: 'Preço por unidade',
        custo: { campo: 'custo_compra_centavos', rotulo: 'Custo de compra' },
    },
};

// ----- Hora de pista -----

function preencherHoraPista() {
    formHoraPista.elements.hora_pista_centavos.value = textoDoPreco(precos.hora_pista_centavos);
    const aviso = document.getElementById('sem-preco-hora-pista');
    aviso.textContent = AVISO_SEM_PRECO.hora_pista;
    aviso.hidden = Number.isInteger(precos.hora_pista_centavos);
}

function salvarHoraPista(form) {
    limparErros(form);
    avisar(null);
    const lido = precoDoCampo(form.elements.hora_pista_centavos.value);
    if (lido.erro) return mostrarErros(form, { hora_pista_centavos: lido.erro });
    const valor = { hora_pista_centavos: lido.valor };
    const campos = validarConfiguracao('precos', valor);
    if (Object.keys(campos).length) return mostrarErros(form, campos);

    return ocupado(form, async () => {
        const r = await chamarFuncao('configuracoes', { metodo: 'PUT', corpo: { chave: 'precos', valor } });
        if (r.status === 200) {
            precos.hora_pista_centavos = r.dados.valor.hora_pista_centavos;
            if (configuracoes) configuracoes.precos = r.dados.valor;
            preencherHoraPista();
            avisar('Hora de pista salva.', { sucesso: true });
        } else if (precisaEntrar(r)) {
            await irParaEntrar();
        } else if (r.status === 400 && r.dados?.campos) {
            mostrarErros(form, r.dados.campos);
        } else {
            mostrarErroGeral(form, r.dados?.erro ?? ERRO_PADRAO);
        }
    });
}

formHoraPista.addEventListener('submit', (evento) => {
    evento.preventDefault();
    salvarHoraPista(formHoraPista);
});

// ----- Armas e munições -----

function nomeComPreco(tipo, item) {
    if (tipo === 'modelo') return nomeDoModelo(item);
    return `${item.nome} (${nomeNaLista('calibres', item.calibre_id)})`;
}

// O campo mostra o preço salvo; sem preço, o campo fica vazio e aparece o aviso.
function preencherPreco(li, tipo, item) {
    const { campo, custo } = PRECOS_CATALOGO[tipo];
    const temPreco = Number.isInteger(item[campo]);
    li.querySelector('[data-campo-preco]').value = textoDoPreco(item[campo]);
    if (custo) li.querySelector('[data-campo-custo]').value = textoDoPreco(item[custo.campo]);
    const aviso = li.querySelector('[data-sem-preco]');
    aviso.textContent = AVISO_SEM_PRECO[tipo];
    aviso.hidden = temPreco;
}

function itemDePreco(tipo, item) {
    const { campo, rotulo, custo } = PRECOS_CATALOGO[tipo];
    const nome = `${nomeComPreco(tipo, item)}${item.ativo ? '' : ' (desativado)'}`;
    const li = copiarMolde('molde-preco');
    li.dataset.id = String(item.id);
    li.classList.toggle('inativo', !item.ativo);
    li.querySelector('[data-nome]').textContent = nome;
    li.querySelector('[data-rotulo]').textContent = rotulo;
    const entrada = li.querySelector('[data-campo-preco]');
    entrada.name = campo;
    entrada.setAttribute('aria-label', `${rotulo}: ${nome}`);
    li.querySelector('[data-erro-preco]').dataset.erroPara = campo;
    if (custo) {
        li.querySelector('[data-bloco-custo]').hidden = false;
        li.querySelector('[data-rotulo-custo]').textContent = custo.rotulo;
        const entradaCusto = li.querySelector('[data-campo-custo]');
        entradaCusto.name = custo.campo;
        entradaCusto.setAttribute('aria-label', `${custo.rotulo}: ${nome}`);
        li.querySelector('[data-erro-custo]').dataset.erroPara = custo.campo;
    }
    const form = li.querySelector('form');
    form.dataset.tipo = tipo;
    form.dataset.id = String(item.id);
    preencherPreco(li, tipo, item);
    return li;
}

function mostrarPrecosDoCatalogo() {
    for (const [tipo, { lista }] of Object.entries(PRECOS_CATALOGO)) {
        const itens = catalogo[lista] ?? [];
        document.getElementById(`lista-precos-${tipo}`).replaceChildren(...itens.map((item) => itemDePreco(tipo, item)));
        document.getElementById(`vazio-precos-${tipo}`).hidden = itens.length > 0;
    }
    versaoNasListasDePreco = versaoCatalogo;
}

function salvarPreco(form) {
    const tipo = form.dataset.tipo;
    const id = Number(form.dataset.id);
    const { lista, campo, custo } = PRECOS_CATALOGO[tipo];
    limparErros(form);
    avisar(null);
    // O preço e, na munição, o custo de compra: os dois em reais, vazio = sem valor (null).
    const nomes = custo ? [campo, custo.campo] : [campo];
    const dados = {};
    const errosDosCampos = {};
    for (const nome of nomes) {
        const lido = precoDoCampo(form.elements[nome].value);
        if (lido.erro) errosDosCampos[nome] = lido.erro;
        else dados[nome] = lido.valor;
    }
    if (Object.keys(errosDosCampos).length) return mostrarErros(form, errosDosCampos);
    const { campos, valores } = validarCadastroCatalogo(tipo, dados, { criando: false });
    if (Object.keys(campos).length) return mostrarErros(form, campos);

    return ocupado(form, async () => {
        const r = await chamarFuncao('catalogo', { metodo: 'PUT', corpo: { tipo, id, dados: valores } });
        if (r.status === 200) {
            const item = itemDaLista(lista, id);
            if (item) {
                Object.assign(item, valores);
                preencherPreco(form.closest('li'), tipo, item);
            }
            // Na munição vão o preço e o custo juntos: "Salvo." vale para qualquer mudança.
            const mensagem = custo ? 'Salvo.' : (valores[campo] === null ? 'Preço retirado.' : 'Preço salvo.');
            avisar(mensagem, { sucesso: true });
        } else if (precisaEntrar(r)) {
            await irParaEntrar();
        } else if ((r.status === 400 || r.status === 409) && r.dados?.campos) {
            mostrarErros(form, r.dados.campos);
        } else {
            mostrarErroGeral(form, r.dados?.erro ?? ERRO_PADRAO);
        }
    });
}

for (const tipo of Object.keys(PRECOS_CATALOGO)) {
    document.getElementById(`lista-precos-${tipo}`).addEventListener('submit', (evento) => {
        evento.preventDefault();
        salvarPreco(evento.target);
    });
}

// ----- Regras por dia e horário -----

// Uma caixa por dia da semana, de domingo (0) a sábado (6). Montadas uma vez só.
function montarDiasDaRegra() {
    const lugar = document.getElementById('dias-regra');
    NOMES_DIAS.forEach((nome, dia) => {
        const rotulo = document.createElement('label');
        rotulo.className = 'caixa';
        const caixa = document.createElement('input');
        caixa.type = 'checkbox';
        caixa.name = 'dias';
        caixa.value = String(dia);
        rotulo.append(caixa, ` ${nome}`);
        lugar.append(rotulo);
    });
}

// ----- Promoções: o que as regras (aqui) e as campanhas, classes e pacotes (aba Promoções) têm igual -----
// Cada tipo do POST/PUT precos tem, no admin.html, o formulário form-<tipo> (título titulo-form-<tipo>),
// a lista linhas-<tipo>, o aviso vazio-<tipo> e o botão botao-adicionar-<tipo>. Nada é apagado:
// "Desativar"/"Reativar" troca o ativo. PROMOCOES[tipo]:
//   estado(): o objeto que guarda a lista; lista: o nome dela (como no GET precos);
//   nomeItem, rotulos ([ativo, desativado]), salvo: textos da tela; validar: a conferência do servidor;
//   ordem: a mesma ordem do GET; colunas(item): [coluna, texto ou elemento] antes da Situação;
//   paraFormulario(item ou null): os valores dos campos; lerFormulario(campos lidos): { dados, erros? };
//   aoAbrir(form, item): o que mais preparar no formulário depois de preenchido (opcional).

const porNome = (a, b) => a.nome.localeCompare(b.nome, 'pt-BR') || a.id - b.id;

const PROMOCOES = {
    regra: {
        estado: () => precos, lista: 'regras', nomeItem: 'regra', rotulos: ['Ativa', 'Desativada'], salvo: 'Regra salva.',
        validar: validarRegra, ordem: porNome,
        colunas: (regra) => [
            ['Nome', regra.nome],
            ['Dias', diasDaRegra(regra.dias)],
            ['Horário', `${regra.hora_inicio} às ${regra.hora_fim}`],
            ['Ajuste', textoDoPercentual(regra.percentual)],
            ['Prioridade', String(regra.prioridade)],
        ],
        paraFormulario: formularioDaRegra,
        lerFormulario: (campos) => ({ dados: regraDoFormulario(campos) }),
    },
};

const formDaPromocao = (tipo) => document.getElementById(`form-${tipo}`);

function promocaoDaLista(tipo, id) {
    const { estado, lista } = PROMOCOES[tipo];
    return (estado()?.[lista] ?? []).find((item) => item.id === id);
}

function linhaDaPromocao(tipo, item) {
    const definicao = PROMOCOES[tipo];
    const linha = document.createElement('tr');
    linha.dataset.id = String(item.id);
    linha.classList.toggle('inativo', !item.ativo);
    for (const [coluna, conteudo] of definicao.colunas(item)) linha.append(celula(coluna, conteudo));
    const [textoAtivo, textoInativo] = definicao.rotulos;
    linha.append(celula('Situação', rotuloSituacao(item.ativo ? textoAtivo : textoInativo, item.ativo)));
    const acoes = document.createElement('div');
    acoes.className = 'acoes';
    acoes.append(
        botaoDaLinha('Editar', 'editar', item, item.nome),
        botaoDaLinha(item.ativo ? 'Desativar' : 'Reativar', 'alternar', item, item.nome, { perigo: item.ativo }),
    );
    const celulaAcoes = celula('', acoes);
    celulaAcoes.className = 'celula-acoes';
    linha.append(celulaAcoes);
    return linha;
}

function mostrarPromocoes(tipo) {
    const { estado, lista } = PROMOCOES[tipo];
    const itens = estado()[lista];
    const corpo = document.getElementById(`linhas-${tipo}`);
    corpo.replaceChildren(...itens.map((item) => linhaDaPromocao(tipo, item)));
    corpo.closest('table').hidden = itens.length === 0;
    document.getElementById(`vazio-${tipo}`).hidden = itens.length > 0;
}

// Valores → campos. Lista (ex.: dias) marca as caixas de mesmo nome; sim/não marca a caixa.
function preencherCampos(form, valores) {
    for (const [nome, valor] of Object.entries(valores)) {
        if (Array.isArray(valor)) {
            for (const caixa of form.querySelectorAll(`input[name="${nome}"]`)) caixa.checked = valor.includes(Number(caixa.value));
        } else if (typeof valor === 'boolean') {
            form.elements[nome].checked = valor;
        } else {
            form.elements[nome].value = valor;
        }
    }
}

// Campos → valores (texto). A caixa "ativo" vira sim/não; outras caixas de mesmo nome, a lista das marcadas.
function lerCampos(form) {
    const campos = {};
    for (const el of form.elements) {
        if (!el.name) continue;
        if (el.type !== 'checkbox') campos[el.name] = el.value;
        else if (el.name === 'ativo') campos.ativo = el.checked;
        else {
            campos[el.name] ??= [];
            if (el.checked) campos[el.name].push(el.value);
        }
    }
    return campos;
}

function abrirFormularioPromocao(tipo, item = null) {
    const definicao = PROMOCOES[tipo];
    const form = formDaPromocao(tipo);
    form.dataset.id = item ? String(item.id) : '';
    document.getElementById(`titulo-form-${tipo}`).textContent = `${item ? 'Editar' : 'Adicionar'} ${definicao.nomeItem}`;
    preencherCampos(form, definicao.paraFormulario(item));
    definicao.aoAbrir?.(form, item);
    limparErros(form);
    form.hidden = false;
    form.scrollIntoView?.({ block: 'nearest' });
    form.elements.nome.focus({ preventScroll: true });
}

function fecharFormularioPromocao(tipo) {
    const form = formDaPromocao(tipo);
    form.hidden = true;
    form.dataset.id = '';
}

// Confere no navegador (as mesmas regras do servidor) e envia. Erros vão para os campos do
// formulário ou, sem formulário (Desativar/Reativar da lista), para o aviso. errosDaTela: os que
// a leitura do formulário já achou (ex.: preço digitado errado); valem mais que os da conferência.
async function enviarPromocao(tipo, id, dados, form = null, errosDaTela = {}) {
    const definicao = PROMOCOES[tipo];
    const criando = id === null;
    const mostrarProblema = (campos) => {
        if (form) mostrarErros(form, campos);
        else avisar(Object.values(campos)[0]);
    };
    const { campos, valores } = definicao.validar(dados, { criando });
    const erros = { ...campos, ...errosDaTela };
    if (Object.keys(erros).length) return mostrarProblema(erros);

    const corpo = criando ? { tipo, dados: valores } : { tipo, id, dados: valores };
    const r = await chamarFuncao('precos', { metodo: criando ? 'POST' : 'PUT', corpo });
    if ((r.status === 200 || r.status === 201) && r.dados?.item) {
        const item = r.dados.item;
        const estado = definicao.estado();
        const outras = estado[definicao.lista].filter((outro) => outro.id !== item.id);
        estado[definicao.lista] = [...outras, item].sort(definicao.ordem);
        mostrarPromocoes(tipo);
        const aberto = formDaPromocao(tipo);
        if (form) {
            fecharFormularioPromocao(tipo);
        } else if (!aberto.hidden && aberto.dataset.id === String(item.id)) {
            // Desativar/Reativar com o formulário deste item aberto: a caixa "Ativa" acompanha
            // (o resto do que foi digitado fica), para o Salvar não desfazer a mudança.
            aberto.elements.ativo.checked = item.ativo;
        }
        avisar(definicao.salvo, { sucesso: true });
    } else if (precisaEntrar(r)) {
        await irParaEntrar();
    } else if ((r.status === 400 || r.status === 409) && r.dados?.campos) {
        mostrarProblema(r.dados.campos);
    } else if (form) {
        mostrarErroGeral(form, r.dados?.erro ?? ERRO_PADRAO);
    } else {
        avisar(r.dados?.erro ?? ERRO_PADRAO);
    }
}

// Liga o botão "Adicionar", o formulário e os botões da lista de um tipo.
function ligarPromocao(tipo) {
    const form = formDaPromocao(tipo);
    document.getElementById(`botao-adicionar-${tipo}`).addEventListener('click', () => {
        if (!form.hidden && form.dataset.id === '') {
            form.elements.nome.focus();
            return;
        }
        abrirFormularioPromocao(tipo);
    });

    form.addEventListener('submit', (evento) => {
        evento.preventDefault();
        limparErros(form);
        avisar(null);
        const id = form.dataset.id ? Number(form.dataset.id) : null;
        const { dados, erros } = PROMOCOES[tipo].lerFormulario(lerCampos(form));
        ocupado(form, () => enviarPromocao(tipo, id, dados, form, erros));
    });

    form.addEventListener('click', (evento) => {
        if (evento.target.closest('[data-cancelar]')) fecharFormularioPromocao(tipo);
    });

    document.getElementById(`linhas-${tipo}`).addEventListener('click', (evento) => {
        const alvo = evento.target.closest('button[data-acao]');
        const item = alvo && promocaoDaLista(tipo, Number(alvo.dataset.id));
        if (!item) return;
        if (alvo.dataset.acao === 'editar') {
            abrirFormularioPromocao(tipo, item);
            return;
        }
        avisar(null);
        ocupado(alvo.closest('tr'), () => enviarPromocao(tipo, item.id, { ativo: !item.ativo }));
    });
}

ligarPromocao('regra');

// ----- Carga -----

function mostrarEstadoPrecos(estado, mensagem) {
    document.getElementById('precos-carregando').hidden = estado !== 'carregando';
    document.getElementById('precos-erro').hidden = estado !== 'erro';
    document.getElementById('precos-conteudo').hidden = estado !== 'pronto';
    document.getElementById('precos-erro-mensagem').textContent = mensagem ?? '';
}

// O GET precos e o catálogo (pela mesma carga das abas Catálogo e Pistas), ao mesmo tempo.
async function carregarPrecos() {
    mostrarEstadoPrecos('carregando');
    try {
        abrirAbaCadastros();
        const [r] = await Promise.all([chamarFuncao('precos'), catalogoEmCarga]);
        if (precisaEntrar(r)) return irParaEntrar();
        if (r.status !== 200 || !Array.isArray(r.dados?.regras)) return mostrarEstadoPrecos('erro', r.dados?.erro ?? ERRO_CARREGAR);
        if (!catalogo) return mostrarEstadoPrecos('erro', ERRO_CARREGAR);
        precos = r.dados;
        limparErros(formHoraPista);
        preencherHoraPista();
        mostrarPromocoes('regra');
        mostrarPrecosDoCatalogo();
        mostrarEstadoPrecos('pronto');
    } catch (erro) {
        console.error(erro);
        mostrarEstadoPrecos('erro', ERRO_CARREGAR);
    }
}

document.getElementById('botao-recarregar-precos').addEventListener('click', (evento) => {
    ocupado(evento.currentTarget.parentElement, carregarPrecos);
});

// Carrega uma vez; voltar para a aba não apaga o que foi digitado. Se o catálogo foi recarregado
// (ex.: modelo novo na aba Catálogo), as listas de armas e munições são montadas de novo.
function abrirAbaPrecos() {
    if (!precos) {
        if (!precosEmCarga) precosEmCarga = carregarPrecos().finally(() => { precosEmCarga = null; });
        return;
    }
    if (versaoNasListasDePreco !== versaoCatalogo) mostrarPrecosDoCatalogo();
}

montarDiasDaRegra();

// ---------- Aba Promoções ----------
// Campanhas, classes de desconto e pacotes (POST/PUT precos, pelo mesmo código das regras da aba
// Preços). Usa o seu próprio GET precos, o GET catalogo (nomes e opções de arma e munição do pacote)
// e o fuso do estande (a vigência da campanha é pela data de hoje no fuso).

let promocoes = null;           // GET precos: { campanhas, classes, pacotes, ... }
let promocoesEmCarga = null;
let versaoNasPromocoes = -1;    // versão do catálogo com que as listas foram montadas

const porInicio = (a, b) => a.inicio.localeCompare(b.inicio) || porNome(a, b);
const CLASSE_VIGENCIA = { Vigente: 'ativo', Agendada: 'agendada', Encerrada: 'inativo' };
const OPCAO_MODELO = { escolha: 'modelos', vazio: 'Nenhum' };
const OPCAO_MUNICAO = { escolha: 'tipos_municao', vazio: 'Nenhum' };

function rotuloVigencia(campanha) {
    const situacao = situacaoDaCampanha(campanha, dataNoFuso(new Date(), fusoEstande));
    const rotulo = document.createElement('span');
    rotulo.className = `rotulo ${CLASSE_VIGENCIA[situacao]}`;
    rotulo.textContent = situacao;
    return rotulo;
}

// A quantidade de munição só vale com uma munição escolhida; sem munição, o campo fica vazio e desligado.
function atualizarQuantidadeDoPacote(form) {
    const quantidade = form.elements.municao_qtd;
    quantidade.disabled = form.elements.tipo_municao_id.value === '';
    if (quantidade.disabled) quantidade.value = '';
}

// As listas de arma e munição: os itens ativos do catálogo, mais o já escolhido.
function preencherOpcoesDoPacote(form, modeloId, municaoId) {
    preencherOpcoes(form.elements.modelo_id, OPCAO_MODELO, modeloId);
    preencherOpcoes(form.elements.tipo_municao_id, OPCAO_MUNICAO, municaoId);
    atualizarQuantidadeDoPacote(form);
}

Object.assign(PROMOCOES, {
    campanha: {
        estado: () => promocoes, lista: 'campanhas', nomeItem: 'campanha', rotulos: ['Ativa', 'Desativada'],
        salvo: 'Campanha salva.', validar: validarCampanha, ordem: porInicio,
        colunas: (campanha) => [
            ['Nome', campanha.nome],
            ['Desconto', `${campanha.percentual}%`],
            ['Período', textoDoPeriodo(campanha.inicio, campanha.fim)],
            ['Vigência', rotuloVigencia(campanha)],
        ],
        paraFormulario: formularioDaCampanha,
        lerFormulario: (campos) => ({ dados: campanhaDoFormulario(campos) }),
    },
    classe: {
        estado: () => promocoes, lista: 'classes', nomeItem: 'classe', rotulos: ['Ativa', 'Desativada'],
        salvo: 'Classe salva.', validar: validarClasse, ordem: porNome,
        colunas: (classe) => [['Nome', classe.nome], ['Desconto', textoDoDescontoDaClasse(classe)]],
        paraFormulario: formularioDaClasse,
        lerFormulario: (campos) => ({ dados: classeDoFormulario(campos) }),
    },
    pacote: {
        estado: () => promocoes, lista: 'pacotes', nomeItem: 'pacote', rotulos: ['Ativo', 'Desativado'],
        salvo: 'Pacote salvo.', validar: validarPacote, ordem: porInicio,
        colunas: (pacote) => [
            ['Nome', pacote.nome],
            ['Período', textoDoPeriodo(pacote.inicio, pacote.fim)],
            ['Preço', textoDoPreco(pacote.preco_centavos)],
            ['Inclui', textoDoPacote(pacote, {
                modelo: pacote.modelo_id == null ? null : nomeNaLista('modelos', pacote.modelo_id),
                municao: pacote.tipo_municao_id == null ? null : nomeNaLista('tipos_municao', pacote.tipo_municao_id),
            })],
        ],
        paraFormulario: formularioDoPacote,
        lerFormulario: pacoteDoFormulario,
        aoAbrir: (form, pacote) => preencherOpcoesDoPacote(form, pacote?.modelo_id ?? null, pacote?.tipo_municao_id ?? null),
    },
});

const TIPOS_DA_ABA_PROMOCOES = ['campanha', 'classe', 'pacote'];
for (const tipo of TIPOS_DA_ABA_PROMOCOES) ligarPromocao(tipo);

formDaPromocao('pacote').elements.tipo_municao_id.addEventListener('change', (evento) => {
    atualizarQuantidadeDoPacote(evento.target.form);
});

// As listas (e, com o formulário do pacote aberto, as opções dele, sem perder o escolhido).
function mostrarTodasAsPromocoes() {
    for (const tipo of TIPOS_DA_ABA_PROMOCOES) mostrarPromocoes(tipo);
    const form = formDaPromocao('pacote');
    if (!form.hidden) {
        preencherOpcoesDoPacote(form, numeroDoCampo(form.elements.modelo_id.value), numeroDoCampo(form.elements.tipo_municao_id.value));
    }
    versaoNasPromocoes = versaoCatalogo;
}

function mostrarEstadoPromocoes(estado, mensagem) {
    document.getElementById('promocoes-carregando').hidden = estado !== 'carregando';
    document.getElementById('promocoes-erro').hidden = estado !== 'erro';
    document.getElementById('promocoes-conteudo').hidden = estado !== 'pronto';
    document.getElementById('promocoes-erro-mensagem').textContent = mensagem ?? '';
}

// O GET precos, o catálogo (pela mesma carga das abas Catálogo e Pistas) e o fuso, ao mesmo tempo.
async function carregarPromocoes() {
    mostrarEstadoPromocoes('carregando');
    try {
        abrirAbaCadastros();
        let erroDoFuso = null;
        const [r, , fuso] = await Promise.all([
            chamarFuncao('precos'),
            catalogoEmCarga,
            obterFuso((mensagem) => { erroDoFuso = mensagem; }),
        ]);
        if (precisaEntrar(r)) return irParaEntrar();
        if (r.status !== 200 || !Array.isArray(r.dados?.campanhas)) {
            return mostrarEstadoPromocoes('erro', r.dados?.erro ?? ERRO_CARREGAR);
        }
        // Sem fuso e sem erro: a pessoa já foi mandada para entrar.
        if (!fuso) return erroDoFuso ? mostrarEstadoPromocoes('erro', erroDoFuso) : undefined;
        if (!catalogo) return mostrarEstadoPromocoes('erro', ERRO_CARREGAR);
        promocoes = r.dados;
        mostrarTodasAsPromocoes();
        mostrarEstadoPromocoes('pronto');
    } catch (erro) {
        console.error(erro);
        mostrarEstadoPromocoes('erro', ERRO_CARREGAR);
    }
}

document.getElementById('botao-recarregar-promocoes').addEventListener('click', (evento) => {
    ocupado(evento.currentTarget.parentElement, carregarPromocoes);
});

// Carrega uma vez; voltar para a aba não apaga o que foi digitado. A vigência das campanhas é
// conferida de novo, e o catálogo recarregado (ex.: arma nova) entra nos nomes e nas opções.
function abrirAbaPromocoes() {
    if (!promocoes) {
        if (!promocoesEmCarga) promocoesEmCarga = carregarPromocoes().finally(() => { promocoesEmCarga = null; });
        return;
    }
    if (versaoNasPromocoes !== versaoCatalogo) mostrarTodasAsPromocoes();
    else mostrarPromocoes('campanha');
}

// ---------- Aba Equipe ----------
// A lista de quem tem papel de equipe e a busca por outras pessoas (nome, e-mail ou CPF, a partir de
// 2 caracteres). Cada pessoa é um cartão (li.pessoa) com os papéis (caixas de marcar) e o botão de
// desativar ou reativar a conta. As proteções (ex.: não tirar o próprio superadmin) são do servidor:
// a recusa dele (409) aparece no aviso.

const listaEquipe = document.getElementById('lista-equipe');
const campoBuscaEquipe = document.getElementById('busca-equipe');
let buscaEquipe = '';       // a busca em uso ('' = só a equipe)
let cargaEquipe = 0;        // número da última carga: respostas atrasadas são ignoradas

function textoDaEquipe(classe, campo, texto) {
    const p = document.createElement('p');
    p.className = classe;
    p.dataset.campo = campo;
    p.textContent = texto;
    return p;
}

function cartaoDaPessoa(pessoa) {
    const cartao = document.createElement('li');
    cartao.className = 'pessoa';
    cartao.dataset.id = String(pessoa.id);
    cartao.dataset.nome = pessoa.nome_completo || pessoa.email || '';  // para a pergunta de confirmação
    cartao.classList.toggle('inativo', !pessoa.ativo);

    const topo = document.createElement('div');
    topo.className = 'pessoa-topo';
    const identidade = document.createElement('div');
    const nome = textoDaEquipe('pessoa-nome', 'nome', pessoa.nome_completo || 'Sem cadastro');
    if (pessoa.id === meuId) nome.append(' (você)');
    identidade.append(nome, textoDaEquipe('subtitulo', 'email', pessoa.email ?? ''));
    if (pessoa.cpf) identidade.append(textoDaEquipe('subtitulo', 'cpf', formatarCpf(pessoa.cpf)));
    const situacao = rotuloSituacao(pessoa.ativo ? 'Ativa' : 'Desativada', pessoa.ativo);
    situacao.dataset.campo = 'situacao';
    topo.append(identidade, situacao);

    const form = document.createElement('form');
    form.className = 'pessoa-papeis';
    form.noValidate = true;
    const grupo = document.createElement('fieldset');
    grupo.className = 'grupo';
    const legenda = document.createElement('legend');
    legenda.className = 'campo-titulo';
    legenda.textContent = 'Papéis';
    grupo.append(legenda);
    for (const papel of PAPEIS) {
        const rotulo = document.createElement('label');
        rotulo.className = 'caixa';
        const caixa = document.createElement('input');
        caixa.type = 'checkbox';
        caixa.name = 'papeis';
        caixa.value = papel;
        caixa.checked = (pessoa.papeis ?? []).includes(papel);
        rotulo.append(caixa, ROTULO_PAPEL[papel] ?? papel);
        grupo.append(rotulo);
    }
    const erroPapeis = document.createElement('span');
    erroPapeis.className = 'erro';
    erroPapeis.dataset.erroPara = 'papeis';
    const geral = document.createElement('p');
    geral.className = 'erro';
    geral.dataset.erroGeral = '';
    geral.hidden = true;
    const salvar = criarBotao('Salvar papéis', 'submit', 'botao pequeno');
    salvar.dataset.acao = 'salvar-papeis';
    form.append(grupo, erroPapeis, geral, salvar);

    const acoes = document.createElement('div');
    acoes.className = 'acoes';
    const alternar = criarBotao(pessoa.ativo ? 'Desativar conta' : 'Reativar conta', 'button',
        `botao secundario pequeno${pessoa.ativo ? ' perigo' : ''}`);
    alternar.dataset.acao = pessoa.ativo ? 'desativar' : 'reativar';
    acoes.append(alternar);

    cartao.append(topo, form, acoes);
    return cartao;
}

function mostrarEstadoEquipe(estado, mensagem, quantidade = 0) {
    document.getElementById('equipe-carregando').hidden = estado !== 'carregando';
    document.getElementById('equipe-erro').hidden = estado !== 'erro';
    document.getElementById('equipe-erro-mensagem').textContent = mensagem ?? '';
    document.getElementById('equipe-vazio').hidden = !(estado === 'pronto' && quantidade === 0);
    listaEquipe.hidden = !(estado === 'pronto' && quantidade > 0);
}

// Busca a lista (com a busca em uso) e refaz os cartões. Devolve true se mostrou a lista.
async function carregarEquipe() {
    const minha = ++cargaEquipe;
    mostrarEstadoEquipe('carregando');
    try {
        const consulta = buscaEquipe ? `busca=${encodeURIComponent(buscaEquipe)}` : undefined;
        const r = await chamarFuncao('equipe', { consulta });
        if (minha !== cargaEquipe) return false;
        if (precisaEntrar(r)) {
            await irParaEntrar();
            return false;
        }
        if (r.status !== 200 || !Array.isArray(r.dados?.pessoas)) {
            mostrarEstadoEquipe('erro', r.dados?.erro ?? ERRO_CARREGAR);
            return false;
        }
        listaEquipe.replaceChildren(...r.dados.pessoas.map(cartaoDaPessoa));
        mostrarEstadoEquipe('pronto', null, r.dados.pessoas.length);
        return true;
    } catch (erro) {
        console.error(erro);
        if (minha === cargaEquipe) mostrarEstadoEquipe('erro', ERRO_CARREGAR);
        return false;
    }
}

// PUT equipe. 200: recarrega a lista e avisa o sucesso; 400 com campos: erro no cartão;
// 401/conta desativada: sai; outro (409, 404...): aviso de erro e a lista é recarregada.
async function mudarPessoa(cartao, corpo, textoSucesso, form = null) {
    avisar(null);
    await ocupado(cartao, async () => {
        const r = await chamarFuncao('equipe', { metodo: 'PUT', corpo: { usuario_id: cartao.dataset.id, ...corpo } });
        if (r.status === 200) {
            const mostrou = await carregarEquipe();
            avisar(mostrou ? textoSucesso : `${textoSucesso} Mas não deu para atualizar a lista.`, { sucesso: true });
        } else if (precisaEntrar(r)) {
            await irParaEntrar();
        } else if (r.status === 400 && r.dados?.campos && form) {
            mostrarErros(form, r.dados.campos);
        } else {
            const mensagem = r.dados?.erro ?? ERRO_PADRAO;
            await carregarEquipe();
            avisar(mensagem);
        }
    });
}

listaEquipe.addEventListener('submit', (evento) => {
    evento.preventDefault();
    const form = evento.target;
    limparErros(form);
    const marcados = [...form.querySelectorAll('input[name="papeis"]:checked')].map((caixa) => caixa.value);
    mudarPessoa(form.closest('li.pessoa'), { papeis: marcados }, 'Papéis salvos.', form);
});

listaEquipe.addEventListener('click', (evento) => {
    const botao = evento.target.closest('button[data-acao="desativar"], button[data-acao="reativar"]');
    if (!botao) return;
    const cartao = botao.closest('li.pessoa');
    if (botao.dataset.acao === 'desativar') {
        if (!confirm(`Desativar a conta de ${cartao.dataset.nome}? A pessoa não vai mais conseguir entrar.`)) return;
        mudarPessoa(cartao, { acao: 'desativar' }, 'Conta desativada.');
    } else {
        mudarPessoa(cartao, { acao: 'reativar' }, 'Conta reativada.');
    }
});

// Menos de 2 caracteres: não consulta pessoas; mostra a lista da equipe.
document.getElementById('form-busca-equipe').addEventListener('submit', (evento) => {
    evento.preventDefault();
    const texto = campoBuscaEquipe.value.trim();
    buscaEquipe = texto.length >= 2 ? texto : '';
    avisar(null);
    ocupado(evento.currentTarget, carregarEquipe);
});

document.getElementById('botao-recarregar-equipe').addEventListener('click', (evento) => {
    ocupado(evento.currentTarget.parentElement, carregarEquipe);
});

// Carrega toda vez que a aba é aberta, para mostrar o estado de agora.
function abrirAbaEquipe() {
    carregarEquipe();
}

// ---------- Aba Agendamentos ----------
// A visão do administrativo. Duas vistas na mesma aba: a lista (filtros + tabela, que vira cartões no
// celular) e o detalhe de um agendamento (responsável, participantes e histórico). Abrir o detalhe
// chama o GET painel-agendamentos?id=, e o servidor registra esse acesso aos dados pessoais.
// Datas e horas aparecem sempre no relógio do fuso do estande (configuração "estande").

const DIAS_PADRAO_AGENDAMENTOS = 15;
const SEM_VALOR = '—';
const TEXTO_MODALIDADE = {
    estande: 'Arma e munição do estande',
    arma_propria: 'Arma própria com munição do estande',
    tudo_proprio: 'Arma e munição próprias',
};

const formFiltros = document.getElementById('form-filtros-agendamentos');
const linhasAgendamentos = document.getElementById('linhas-agendamentos');
const vistaDetalhe = document.getElementById('agendamentos-vista-detalhe');
let fusoEstande = null;         // fuso do estande (GET configuracoes, chave estande)
let cargaAgendamentos = 0;      // número da última carga da lista: respostas atrasadas são ignoradas
let cargaDetalhe = 0;           // o mesmo, para o detalhe
let agendamentoAberto = null;   // id do agendamento mostrado no detalhe (para voltar à linha dele)
let agendamentosAbertos = false;

function opcao(valor, texto) {
    const el = document.createElement('option');
    el.value = valor;
    el.textContent = texto;
    return el;
}

// Situação: "Todas" e as seis, montadas uma vez só.
function montarSituacoes() {
    formFiltros.elements.situacao.replaceChildren(opcao('', 'Todas'),
        ...Object.entries(TEXTO_SITUACAO).map(([valor, texto]) => opcao(valor, texto)));
}

// Instrutor: "Todos" e a lista que veio na resposta, sem perder o escolhido.
function preencherInstrutores(instrutores) {
    const select = formFiltros.elements.instrutor_id;
    const escolhido = select.value;
    select.replaceChildren(opcao('', 'Todos'), ...(instrutores ?? []).map((i) => opcao(i.id, i.nome)));
    select.value = escolhido;
    if (select.selectedIndex < 0) select.value = '';
}

// O fuso do estande: o da aba Configurações, se já foi carregado; senão, GET configuracoes
// (qualquer pessoa logada pode ler). Devolve o fuso, ou null (o erro já foi entregue a aoFalhar,
// que por padrão o mostra nos filtros dos agendamentos, ou a pessoa foi mandada para entrar).
async function obterFuso(aoFalhar = (mensagem) => mostrarErroGeral(formFiltros, mensagem)) {
    if (fusoEstande) return fusoEstande;
    if (configuracoes?.estande?.fuso) {
        fusoEstande = configuracoes.estande.fuso;
        return fusoEstande;
    }
    const r = await chamarFuncao('configuracoes');
    if (precisaEntrar(r)) {
        await irParaEntrar();
        return null;
    }
    const fuso = r.dados?.configuracoes?.estande?.fuso;
    if (r.status !== 200 || !fuso) {
        aoFalhar(r.dados?.erro ?? ERRO_CARREGAR);
        return null;
    }
    fusoEstande = fuso;
    return fuso;
}

// Datas em branco ganham o padrão: de hoje até hoje + 15 dias, no fuso do estande.
function preencherDatasPadrao(fuso) {
    const { de, ate } = formFiltros.elements;
    if (de.value || ate.value) return;
    de.value = dataNoFuso(new Date(), fuso);
    ate.value = somarDias(de.value, DIAS_PADRAO_AGENDAMENTOS);
}

function filtrosDoFormulario() {
    const campos = formFiltros.elements;
    return {
        de: campos.de.value,
        ate: campos.ate.value,
        situacao: campos.situacao.value,
        instrutor_id: campos.instrutor_id.value,
        busca: campos.busca.value,
    };
}

// estado: 'carregando', 'pronto' (com a quantidade de linhas) ou 'nada' (erro, mostrado no formulário).
function mostrarEstadoAgendamentos(estado, { quantidade = 0, limite = false } = {}) {
    const pronto = estado === 'pronto';
    document.getElementById('agendamentos-carregando').hidden = estado !== 'carregando';
    document.getElementById('agendamentos-vazio').hidden = !(pronto && quantidade === 0);
    document.getElementById('agendamentos-limite').hidden = !(pronto && limite);
    document.getElementById('tabela-agendamentos').hidden = !(pronto && quantidade > 0);
}

// Célula com uma ou mais linhas de texto (ex.: nome e telefone do responsável).
function celulaDeTextos(coluna, textos) {
    const caixa = document.createElement('div');
    caixa.className = 'celula-texto';
    for (const texto of textos) {
        const linha = document.createElement('span');
        linha.textContent = texto;
        caixa.append(linha);
    }
    return celula(coluna, caixa);
}

const listaOuTraco = (itens) => (itens.length ? itens : [SEM_VALOR]);
const textoDasPistas = (pistas) => (pistas ?? []).map((numero) => `Pista ${numero}`);
const textoDasArmas = (armas) => (armas ?? []).map((arma) => {
    const modelo = arma.modelo ?? 'Arma';
    return arma.numero_registro ? `${modelo} (nº ${arma.numero_registro})` : modelo;
});

function rotuloDaSituacao(situacao) {
    const rotulo = document.createElement('span');
    rotulo.className = 'rotulo';
    rotulo.dataset.situacao = situacao;
    rotulo.textContent = TEXTO_SITUACAO[situacao] ?? situacao;
    return rotulo;
}

// Uma linha por agendamento. A linha inteira abre o detalhe (clique, Enter ou espaço).
function linhaDoAgendamento(a) {
    const linha = document.createElement('tr');
    linha.className = 'clicavel';
    linha.dataset.id = a.id;
    linha.tabIndex = 0;
    const responsavel = [a.responsavel?.nome_completo || 'Sem nome'];
    if (a.responsavel?.telefone) responsavel.push(formatarTelefone(a.responsavel.telefone));
    linha.append(
        celula('Sessão', descreverSessao(a.inicio, a.horas, fusoEstande)),
        celula('Situação', rotuloDaSituacao(a.situacao)),
        celulaDeTextos('Responsável', responsavel),
        celula('Pessoas', String(a.participantes_qtd ?? 0)),
        celulaDeTextos('Instrutores', listaOuTraco(a.instrutores ?? [])),
        celulaDeTextos('Pistas', listaOuTraco(textoDasPistas(a.pistas))),
        celulaDeTextos('Armas', listaOuTraco(textoDasArmas(a.armas))),
        // Vazio nos agendamentos feitos antes dos preços.
        celula('Total', Number.isInteger(a.preco_total_centavos) ? formatarReais(a.preco_total_centavos) : SEM_VALOR),
    );
    return linha;
}

// Busca a lista com os filtros do formulário. 400 com campos: o erro vai para baixo de cada filtro;
// outro erro: no fim do formulário.
async function carregarAgendamentos() {
    const minha = ++cargaAgendamentos;
    limparErros(formFiltros);
    mostrarEstadoAgendamentos('carregando');
    try {
        const fuso = await obterFuso();
        if (minha !== cargaAgendamentos) return;
        if (!fuso) {
            mostrarEstadoAgendamentos('nada');
            return;
        }
        preencherDatasPadrao(fuso);
        const consulta = consultaDosFiltros(filtrosDoFormulario());
        const r = await chamarFuncao('painel-agendamentos', { consulta: consulta || undefined });
        if (minha !== cargaAgendamentos) return;
        if (precisaEntrar(r)) {
            await irParaEntrar();
            return;
        }
        if (r.status !== 200 || !Array.isArray(r.dados?.agendamentos)) {
            mostrarEstadoAgendamentos('nada');
            if (r.status === 400 && r.dados?.campos) mostrarErros(formFiltros, r.dados.campos);
            else mostrarErroGeral(formFiltros, r.dados?.erro ?? ERRO_CARREGAR);
            return;
        }
        preencherInstrutores(r.dados.instrutores);
        linhasAgendamentos.replaceChildren(...r.dados.agendamentos.map(linhaDoAgendamento));
        mostrarEstadoAgendamentos('pronto', {
            quantidade: r.dados.agendamentos.length,
            limite: r.dados.limite_atingido === true,
        });
    } catch (erro) {
        console.error(erro);
        if (minha !== cargaAgendamentos) return;
        mostrarEstadoAgendamentos('nada');
        mostrarErroGeral(formFiltros, ERRO_CARREGAR);
    }
}

formFiltros.addEventListener('submit', (evento) => {
    evento.preventDefault();
    avisar(null);
    ocupado(formFiltros, carregarAgendamentos);
});

// ----- Detalhe -----

function mostrarVistaAgendamentos(vista) {
    document.getElementById('agendamentos-vista-lista').hidden = vista !== 'lista';
    vistaDetalhe.hidden = vista !== 'detalhe';
}

function mostrarEstadoDetalhe(estado, mensagem) {
    document.getElementById('detalhe-carregando').hidden = estado !== 'carregando';
    document.getElementById('detalhe-erro').hidden = estado !== 'erro';
    document.getElementById('detalhe-erro-mensagem').textContent = mensagem ?? '';
    document.getElementById('detalhe-conteudo').hidden = estado !== 'pronto';
}

// 'AAAA-MM-DD' → 'DD/MM/AAAA'.
function dataBrasileira(data) {
    const [ano, mes, dia] = String(data ?? '').split('-');
    return dia ? `${dia}/${mes}/${ano}` : SEM_VALOR;
}

function armaDoParticipante(p) {
    if (p.modalidade === 'estande') return `${p.modelo ?? 'Arma'}, do estande`;
    const arma = p.arma_propria;
    if (!arma) return 'Arma própria';
    let texto = arma.modelo ?? 'Arma';
    if (arma.calibre) texto += ` (${arma.calibre})`;
    if (arma.numero_registro) texto += `, nº ${arma.numero_registro}`;
    return `${texto}, arma própria`;
}

function municaoDoParticipante(p) {
    if (p.modalidade === 'tudo_proprio' || !p.tipo_municao) return 'Própria';
    return `${p.municao_qtd ?? 0} × ${p.tipo_municao}`;
}

// Lista de pares nome → valor (dl).
function dadosEmLista(pares) {
    const lista = document.createElement('dl');
    lista.className = 'dados';
    for (const [nome, valor] of pares) {
        const par = document.createElement('div');
        const dt = document.createElement('dt');
        dt.textContent = nome;
        const dd = document.createElement('dd');
        dd.textContent = valor;
        par.append(dt, dd);
        lista.append(par);
    }
    return lista;
}

function cartaoDoParticipante(p) {
    const cartao = document.createElement('li');
    cartao.className = 'participante';
    const nome = document.createElement('p');
    nome.className = 'pessoa-nome';
    nome.textContent = p.nome_completo;
    const pares = [
        ['CPF', p.cpf ? formatarCpf(p.cpf) : SEM_VALOR],
        ['Nascimento', dataBrasileira(p.data_nascimento)],
        ['Modalidade', TEXTO_MODALIDADE[p.modalidade] ?? p.modalidade],
        ['Arma', armaDoParticipante(p)],
        ['Munição', municaoDoParticipante(p)],
    ];
    if (p.termo_versao !== null && p.termo_versao !== undefined) pares.push(['Termo', `Aceito na versão ${p.termo_versao}`]);
    cartao.append(nome, dadosEmLista(pares));
    return cartao;
}

// O preço congelado (preco_detalhe), como na revisão do cliente: cada item, o desconto e o total.
// Os agendamentos feitos antes dos preços não têm preço: mostra o aviso no lugar.
function preencherValor(preco) {
    const lista = document.getElementById('detalhe-valor');
    const temPreco = Array.isArray(preco?.itens) && Number.isInteger(preco.total_centavos);
    const linhas = temPreco ? linhasDoPreco(preco) : [];
    lista.replaceChildren(...linhas.map(({ rotulo, valor }) => {
        const par = document.createElement('div');
        const dt = document.createElement('dt');
        dt.textContent = rotulo;
        const dd = document.createElement('dd');
        dd.textContent = valor;
        par.append(dt, dd);
        return par;
    }));
    if (temPreco) {
        lista.lastElementChild.classList.add('total');
        if (preco.desconto) lista.lastElementChild.previousElementSibling.classList.add('desconto');
    }
    lista.hidden = !temPreco;
    document.getElementById('detalhe-valor-vazio').hidden = temPreco;
}

function preencherDetalhe({ agendamento: a, historico }) {
    preencherValor(a.preco_detalhe);
    document.getElementById('detalhe-sessao').textContent = descreverSessao(a.inicio, a.horas, fusoEstande);
    document.getElementById('detalhe-situacao').replaceChildren(rotuloDaSituacao(a.situacao));
    document.getElementById('detalhe-instrutores').textContent = listaOuTraco(a.instrutores ?? []).join(', ');
    document.getElementById('detalhe-pistas').textContent = listaOuTraco(textoDasPistas(a.pistas)).join(', ');
    document.getElementById('detalhe-armas').textContent = listaOuTraco(textoDasArmas(a.armas)).join(', ');

    const resp = a.responsavel ?? {};
    const valores = {
        nome: resp.nome_completo || SEM_VALOR,
        email: resp.email || SEM_VALOR,
        cpf: resp.cpf ? formatarCpf(resp.cpf) : SEM_VALOR,
        telefone: resp.telefone ? formatarTelefone(resp.telefone) : SEM_VALOR,
    };
    const responsavel = document.getElementById('detalhe-responsavel');
    for (const [campo, valor] of Object.entries(valores)) {
        responsavel.querySelector(`[data-campo="${campo}"]`).textContent = valor;
    }

    document.getElementById('detalhe-participantes').replaceChildren(...(a.participantes ?? []).map(cartaoDoParticipante));

    // Uma linha por evento, na ordem em que aconteceram (o servidor já manda em ordem).
    const eventos = historico ?? [];
    document.getElementById('detalhe-historico').replaceChildren(...eventos.map((evento) => {
        const item = document.createElement('li');
        item.textContent = `${dataHoraNoFuso(evento.em, fusoEstande)} · ${evento.autor || 'Sistema'} · ${descreverEvento(evento)}`;
        return item;
    }));
    document.getElementById('detalhe-historico-vazio').hidden = eventos.length > 0;
}

async function abrirDetalhe(id) {
    const minha = ++cargaDetalhe;
    agendamentoAberto = id;
    avisar(null);
    mostrarVistaAgendamentos('detalhe');
    mostrarEstadoDetalhe('carregando');
    window.scrollTo(0, 0);
    document.getElementById('botao-voltar-agendamentos').focus({ preventScroll: true });
    try {
        const r = await chamarFuncao('painel-agendamentos', { consulta: `id=${encodeURIComponent(id)}` });
        if (minha !== cargaDetalhe) return;
        if (precisaEntrar(r)) {
            await irParaEntrar();
            return;
        }
        if (r.status !== 200 || !r.dados?.agendamento) {
            mostrarEstadoDetalhe('erro', r.dados?.erro ?? ERRO_CARREGAR);
            return;
        }
        preencherDetalhe(r.dados);
        mostrarEstadoDetalhe('pronto');
    } catch (erro) {
        console.error(erro);
        if (minha === cargaDetalhe) mostrarEstadoDetalhe('erro', ERRO_CARREGAR);
    }
}

// Volta para a lista como ela estava, com o foco na linha que foi aberta.
function voltarParaLista() {
    cargaDetalhe++;
    avisar(null);
    mostrarVistaAgendamentos('lista');
    const linha = [...linhasAgendamentos.querySelectorAll('tr[data-id]')].find((tr) => tr.dataset.id === agendamentoAberto);
    agendamentoAberto = null;
    if (linha) {
        linha.scrollIntoView?.({ block: 'center' });
        linha.focus({ preventScroll: true });
    }
}

linhasAgendamentos.addEventListener('click', (evento) => {
    const linha = evento.target.closest('tr[data-id]');
    if (linha) abrirDetalhe(linha.dataset.id);
});

linhasAgendamentos.addEventListener('keydown', (evento) => {
    if (evento.key !== 'Enter' && evento.key !== ' ') return;
    if (!evento.target.matches('tr[data-id]')) return;
    evento.preventDefault();
    abrirDetalhe(evento.target.dataset.id);
});

document.getElementById('botao-voltar-agendamentos').addEventListener('click', voltarParaLista);

// Na primeira vez, carrega com o período padrão. Depois, os filtros continuam como estavam e a
// lista é carregada de novo (estado de agora); se o detalhe estava aberto, ele continua aberto.
function abrirAbaAgendamentos() {
    if (agendamentosAbertos && !vistaDetalhe.hidden) return;
    agendamentosAbertos = true;
    ocupado(formFiltros, carregarAgendamentos);
}

montarSituacoes();

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
    meuId = r.dados.id ?? null;
    moldura = montarMoldura({ papeis, ativo: null, saudacao: saudacao(r.dados.perfil, r.dados.email) });

    if (abasVisiveis(papeis).length === 0) return mostrarTela('tela-sem-acesso');
    mostrarTela('tela-admin');
    abaAtual = null;
    abrirAbaDoEndereco();
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
