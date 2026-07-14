/* ========================================= */
/* main.js - Variáveis Globais e Utilitários */
/* ========================================= */

let planilhaStopsData = []; 
let rotaSpx = []; 
let isRotaManual = false;
let horaInicioExpediente = null;
let historicoParadas = [];
let listaRadares = [];
let radarAtivo = null;
let audioCtx = null;
let wakeLock = null;
let globalKmPadrao = 0;
let globalKmOtimizada = 0;

// --- RECUPERAÇÃO DO ESTADO SALVO (AO ABRIR O APP) ---
window.addEventListener('load', function() {
    let estadoStr = localStorage.getItem('spx_ninja_estado');
    if (estadoStr) {
        let estado = JSON.parse(estadoStr);
        if (estado.data === new Date().toDateString()) {
            let btnCont = document.getElementById('btn-continuar');
            if (btnCont) btnCont.style.display = 'block';
        } else {
            localStorage.removeItem('spx_ninja_estado');
        }
    }
});

// --- SALVAMENTO E CARREGAMENTO DE ROTAS ---
function salvarEstadoRota() {
    if (!rotaSpx || rotaSpx.length === 0) return;
    
    // Tratamento para limpar as "Vagas" do Leaflet e não quebrar a memória
    let vagasLimpar = [];
    if (isRotaManual && typeof vagasCriadas !== 'undefined') {
        vagasLimpar = vagasCriadas.map(v => ({
            id: v.marker.spxId,
            lat: v.marker.getLatLng().lat,
            lon: v.marker.getLatLng().lng,
            sugados: v.sugados.map(m => m.spxId)
        }));
    }

    let estado = {
        data: new Date().toDateString(),
        isRotaManual: isRotaManual,
        horaInicioExpediente: horaInicioExpediente,
        idxDestino: (typeof idxDestino !== 'undefined' ? idxDestino : 0),
        globalKmPadrao: globalKmPadrao,
        globalKmOtimizada: globalKmOtimizada,
        historicoParadas: historicoParadas,
        planilha: planilhaStopsData.map(p => ({...p, gpsMarker: null, marker: null})),
        rotaSpx: rotaSpx.map(r => (typeof r === 'object' ? {...r, gpsMarker: null, marker: null} : r)),
        vagas: vagasLimpar
    };
    localStorage.setItem('spx_ninja_estado', JSON.stringify(estado));
}

function continuarRotaSalva() {
    let estadoStr = localStorage.getItem('spx_ninja_estado');
    if (!estadoStr) return;
    
    let estado = JSON.parse(estadoStr);
    
    // Restaura os dados para a memória
    isRotaManual = estado.isRotaManual;
    horaInicioExpediente = new Date(estado.horaInicioExpediente);
    window.destinoSalvo = estado.idxDestino; // Passa o índice pro GPS
    globalKmPadrao = estado.globalKmPadrao;
    globalKmOtimizada = estado.globalKmOtimizada;
    historicoParadas = estado.historicoParadas;
    planilhaStopsData = estado.planilha;
    rotaSpx = estado.rotaSpx;

    // Se for manual, reconstrói as vagas do asfalto
    if (isRotaManual) {
        window.vagasCriadas = estado.vagas.map(v => {
            return {
                marker: { spxId: v.id, getLatLng: () => ({lat: v.lat, lng: v.lon}) },
                sugados: v.sugados.map(sId => ({ spxId: sId }))
            };
        });
    }

    baixarRadaresDaRegiao(planilhaStopsData);
    
    esconderTodasTelas();
    mostrarTela('tela-navegacao');
    
    if (typeof iniciarInterfaceGPS === "function") {
        iniciarInterfaceGPS();
    }
}

// --- GERENCIAMENTO DE TELAS ---
function esconderTodasTelas() {
    const telas = ['controles-iniciais', 'modal-escolha-modo', 'modal-auditoria', 'modal-info-padrao', 'modal-info-otimizada', 'modal-desenho-manual', 'modal-doca', 'tela-navegacao', 'modal-menu-stops', 'modal-relatorio'];
    telas.forEach(id => { let el = document.getElementById(id); if(el) el.style.display = 'none'; });
}

function mostrarTela(id, displayType = 'flex') {
    let el = document.getElementById(id);
    if(el) el.style.display = displayType;
}

function toggleFaq(element) { element.classList.toggle('active'); }

function limparERecarregar() { localStorage.removeItem('spx_ninja_estado'); location.reload(); }

// --- UTILITÁRIOS MATEMÁTICOS E DE TEXTO ---
function dist(la1, lo1, la2, lo2) {
    const R = 6371000; const dLat = (la2-la1) * Math.PI/180; const dLon = (lo2-lo1) * Math.PI/180;
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
    let match = limpo.match(/^([^,0-9-]+)/); if (match) limpo = match[1].trim();
    limpo = limpo.replace(/^R\.\s|^R\s/, "RUA ").replace(/^AV\.\s|^AV\s/, "AVENIDA ");
    const abrevs = {'\\bGEN\\b': 'GENERAL', '\\bMAL\\b': 'MARECHAL', '\\bDR\\b': 'DOUTOR', '\\bPRES\\b': 'PRESIDENTE', '\\bSTO\\b': 'SANTO', '\\bSTA\\b': 'SANTA', '\\bPROF\\b': 'PROFESSOR', '\\bCEL\\b': 'CORONEL', '\\bCAP\\b': 'CAPITAO'};
    for (let p in abrevs) limpo = limpo.replace(new RegExp(p, 'g'), abrevs[p]);
    return limpo.trim();
}

function formatarEnderecos(listaEnderecos) {
    return listaEnderecos.map(end => `<div class="endereco-item">${end.toUpperCase().replace(/(\d+)/g, '<span class="num-box">$1</span>')}</div>`).join('');
}

// --- HARDWARE E APIS ---
async function requestWakeLock() { try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (err) {} }
function releaseWakeLock() { if (wakeLock !== null) { wakeLock.release(); wakeLock = null; } }

function initAudio() {
    try { window.AudioContext = window.AudioContext || window.webkitAudioContext; if (!audioCtx) audioCtx = new AudioContext(); if (audioCtx.state === 'suspended') audioCtx.resume(); } catch(e) {}
}

function playBipeRadar() {
    if (!audioCtx) return;
    try { let osc = audioCtx.createOscillator(); let gain = audioCtx.createGain(); osc.connect(gain); gain.connect(audioCtx.destination); osc.type = 'square'; osc.frequency.value = 880; gain.gain.setValueAtTime(0.2, audioCtx.currentTime); gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3); osc.start(audioCtx.currentTime); osc.stop(audioCtx.currentTime + 0.3); } catch(e) {}
}

async function baixarRadaresDaRegiao(rota) {
    if (!rota || rota.length === 0) return;
    try { let lats = rota.map(p => p.lat), lons = rota.map(p => p.lon); let minLat = Math.min(...lats) - 0.015, maxLat = Math.max(...lats) + 0.015, minLon = Math.min(...lons) - 0.015, maxLon = Math.max(...lons) + 0.015; let query = `[out:json][timeout:15];node["highway"="speed_camera"](${minLat},${minLon},${maxLat},${maxLon});out;`; let res = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`); let data = await res.json(); if (data && data.elements) listaRadares = data.elements.map(e => ({ lat: e.lat, lon: e.lon, speed: e.tags.maxspeed || "" })); } catch(e) {}
}

// --- TRANSIÇÃO DE MÓDULOS ---
function iniciarModoAutomatico() { esconderTodasTelas(); if (typeof roteirizarModoAutomatico === "function") roteirizarModoAutomatico(); else alert("O motor automático ainda não foi carregado."); }
function iniciarModoManual() { esconderTodasTelas(); if (typeof iniciarMapeamentoManual === "function") iniciarMapeamentoManual(); else alert("O motor manual ainda não foi carregado."); }
