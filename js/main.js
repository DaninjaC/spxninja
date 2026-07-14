/* ========================================= */
/* main.js - Variáveis Globais e Utilitários */
/* ========================================= */

// --- VARIÁVEIS GLOBAIS (Compartilhadas entre todos os arquivos) ---
let planilhaStopsData = []; 
let rotaSpx = []; // A rota final unificada que vai para a Doca/GPS (seja do auto ou do manual)
let horaInicioExpediente = null;
let historicoParadas = [];
let listaRadares = [];
let radarAtivo = null;
let audioCtx = null;
let wakeLock = null;

// --- GERENCIAMENTO DE TELAS ---
function esconderTodasTelas() {
    const telas = [
        'controles-iniciais', 'modal-escolha-modo', 'modal-auditoria', 
        'modal-info-padrao', 'modal-info-otimizada', 'modal-desenho-manual', 
        'modal-doca', 'tela-navegacao', 'modal-menu-stops', 'modal-relatorio'
    ];
    telas.forEach(id => {
        let el = document.getElementById(id);
        if(el) el.style.display = 'none';
    });
}

function mostrarTela(id, displayType = 'flex') {
    let el = document.getElementById(id);
    if(el) el.style.display = displayType;
}

function toggleFaq(element) {
    element.classList.toggle('active');
}

function limparERecarregar() {
    localStorage.removeItem('spx_ninja_estado');
    location.reload();
}

// --- UTILITÁRIOS MATEMÁTICOS E DE TEXTO ---
function dist(la1, lo1, la2, lo2) {
    const R = 6371000;
    const dLat = (la2-la1) * Math.PI/180;
    const dLon = (lo2-lo1) * Math.PI/180;
    const a = Math.sin(dLat/2)**2 + Math.cos(la1*Math.PI/180)*Math.cos(la2*Math.PI/180)*Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function getCorVolume(vol) {
    if (vol === 1) return { bg: '#39FF14', color: '#000' };
    if (vol === 2) return { bg: '#FFCC00', color: '#000' };
    if (vol === 3) return { bg: '#FFA500', color: '#000' };
    if (vol === 4) return { bg: '#FF4500', color: '#fff' };
    if (vol >= 5) return { bg: '#FF0000', color: '#fff' };
    return { bg: '#8B0000', color: '#fff' };
}

function extrairRuaPadrao(enderecoBruto) {
    if (!enderecoBruto) return "DESCONHECIDO";
    let limpo = enderecoBruto.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    let match = limpo.match(/^([^,0-9-]+)/);
    if (match) limpo = match[1].trim();
    limpo = limpo.replace(/^R\.\s|^R\s/, "RUA ");
    limpo = limpo.replace(/^AV\.\s|^AV\s/, "AVENIDA ");
    const abreviacoes = {
        '\\bGEN\\b': 'GENERAL', '\\bMAL\\b': 'MARECHAL', '\\bDR\\b': 'DOUTOR',
        '\\bPRES\\b': 'PRESIDENTE', '\\bSTO\\b': 'SANTO', '\\bSTA\\b': 'SANTA',
        '\\bPROF\\b': 'PROFESSOR', '\\bCEL\\b': 'CORONEL', '\\bCAP\\b': 'CAPITAO'
    };
    for (let padrao in abreviacoes) {
        limpo = limpo.replace(new RegExp(padrao, 'g'), abreviacoes[padrao]);
    }
    return limpo.trim();
}

function formatarEnderecos(listaEnderecos) {
    return listaEnderecos.map(end => {
        let texto = end.toUpperCase().replace(/(\d+)/g, '<span class="num-box">$1</span>');
        return `<div class="endereco-item">${texto}</div>`;
    }).join('');
}

// --- HARDWARE E APIS (Bipe, Tela acesa, Radar) ---
async function requestWakeLock() {
    try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } 
    catch (err) { console.log(err); }
}
function releaseWakeLock() {
    if (wakeLock !== null) { wakeLock.release(); wakeLock = null; }
}

function initAudio() {
    try {
        window.AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!audioCtx) audioCtx = new AudioContext();
        if (audioCtx.state === 'suspended') audioCtx.resume();
    } catch(e) {}
}

function playBipeRadar() {
    if (!audioCtx) return;
    try {
        let osc = audioCtx.createOscillator();
        let gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.type = 'square'; osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
        osc.start(audioCtx.currentTime); osc.stop(audioCtx.currentTime + 0.3);
    } catch(e) {}
}

async function baixarRadaresDaRegiao(rota) {
    if (!rota || rota.length === 0) return;
    try {
        let lats = rota.map(p => p.lat), lons = rota.map(p => p.lon);
        let minLat = Math.min(...lats) - 0.015, maxLat = Math.max(...lats) + 0.015;
        let minLon = Math.min(...lons) - 0.015, maxLon = Math.max(...lons) + 0.015;
        let query = `[out:json][timeout:15];node["highway"="speed_camera"](${minLat},${minLon},${maxLat},${maxLon});out;`;
        let res = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`);
        let data = await res.json();
        if (data && data.elements) {
            listaRadares = data.elements.map(e => ({ lat: e.lat, lon: e.lon, speed: e.tags.maxspeed || "" }));
        }
    } catch(e) {}
}

// --- TRANSIÇÃO DE MÓDULOS ---
// Essas funções são chamadas pela tela de escolha de modo do index.html
function iniciarModoAutomatico() {
    esconderTodasTelas();
    if (typeof roteirizarModoAutomatico === "function") {
        roteirizarModoAutomatico(); 
    } else {
        alert("O motor automático ainda não foi carregado.");
    }
}

function iniciarModoManual() {
    esconderTodasTelas();
    if (typeof iniciarMapeamentoManual === "function") {
        iniciarMapeamentoManual(); 
    } else {
        alert("O motor manual ainda não foi carregado.");
    }
}
