/* ========================================= */
/* motor-gps.js - Navegação com Rotação      */
/* ========================================= */

let mapaGPS = null;
let markerCarro = null;
let polylineAzul = null;  // Caminho até o alvo atual
let polylineRoxa = null;  // Prévia do próximo alvo
let polylinePreta = null; // Visão geral restante
let watchIdGPS = null;

// --- VARIÁVEIS DA NOVA CÂMERA INTELIGENTE ---
let ultimaLatCamera = null;
let ultimaLonCamera = null;
let anguloAtual = 0;
window.isCameraTravada = true; // Sempre inicia focada e travada

// Função matemática para calcular o azimute (ângulo) entre 2 pontos
function calcularBearing(lat1, lon1, lat2, lon2) {
    const toRad = Math.PI / 180;
    const toDeg = 180 / Math.PI;
    const dLon = (lon2 - lon1) * toRad;
    const y = Math.sin(dLon) * Math.cos(lat2 * toRad);
    const x = Math.cos(lat1 * toRad) * Math.sin(lat2 * toRad) - Math.sin(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.cos(dLon);
    const bearing = Math.atan2(y, x) * toDeg;
    return (bearing + 360) % 360;
}

function iniciarInterfaceGPS() {
    if (!mapaGPS) {
        mapaGPS = L.map('mapa-gps', { zoomControl: false, attributionControl: false }).setView([-23.5505, -46.6333], 15);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(mapaGPS);
        
        let iconeCarro = L.divIcon({
            className: 'icone-carro-gps',
            html: '🏎️', // Símbolo de posição
            iconSize: [30, 30],
            iconAnchor: [15, 15]
        });
        markerCarro = L.marker([-23.5505, -46.6333], {icon: iconeCarro, zIndexOffset: 1000}).addTo(mapaGPS);
    }
    
    // Garante que o motor de rota comece de onde parou
    if (typeof window.destinoSalvo === 'undefined') window.destinoSalvo = 0;

    if (navigator.geolocation) {
        watchIdGPS = navigator.geolocation.watchPosition(atualizarGPS, erroGPS, {
            enableHighAccuracy: true,
            maximumAge: 1000, 
            timeout: 5000
        });
    } else {
        alert("GPS não suportado neste navegador.");
    }

    atualizarPainelTopo();
    desenharRotaRestante();
}

function atualizarGPS(pos) {
    let lat = pos.coords.latitude;
    let lon = pos.coords.longitude;
    
    // 1. Move o pino do carro no mapa
    markerCarro.setLatLng([lat, lon]);

    // 2. LÓGICA DE ROTAÇÃO E CÂMERA (A MÁGICA)
    let containerMapa = document.getElementById('mapa-gps');
    
    if (window.isCameraTravada) {
        // Centraliza o mapa na tela do celular
        mapaGPS.setView([lat, lon], 18, {animate: true, duration: 0.5});
        
        // Se já andamos pelo menos um pouco, calcula para onde o "bico" do carro aponta
        if (ultimaLatCamera !== null && ultimaLonCamera !== null) {
            let distMovida = dist(ultimaLatCamera, ultimaLonCamera, lat, lon);
            
            // Só engatilha cálculo de ângulo se o carro realmente andou (evita tremedeira parado no farol)
            if (distMovida > 3) {
                let novoAngulo = calcularBearing(ultimaLatCamera, ultimaLonCamera, lat, lon);
                
                let diferenca = Math.abs(novoAngulo - anguloAtual);
                if (diferenca > 180) diferenca = 360 - diferenca; // Correção da virada 360 -> 0
                
                // ZONA MORTA: Só gira a tela de fato se a curva for brusca (>= 45 graus) ou se for o primeiríssimo movimento
                if (diferenca >= 45 || anguloAtual === 0) {
                    anguloAtual = novoAngulo;
                }
                // Atualiza a memória de movimento
                ultimaLatCamera = lat;
                ultimaLonCamera = lon;
            }
        } else {
            ultimaLatCamera = lat;
            ultimaLonCamera = lon;
        }

        // Aplica o giro suave na caixa inteira via CSS (transform: rotate)
        // Usamos sinal negativo para manter o bico do carro apontado para o "norte" da tela do celular
        if(containerMapa) {
            containerMapa.style.transform = `rotate(${-anguloAtual}deg)`;
        }
        mapaGPS.dragging.disable(); // Impede o "bug do dedo invertido"

    } else {
        // MODO LIVRE (Motorista destravou a tela para ver o mapa geral)
        if(containerMapa) {
            containerMapa.style.transform = `rotate(0deg)`; // Volta pro Norte real
        }
        mapaGPS.dragging.enable(); // Libera o dedo
    }

    // 3. Atualiza os botões e linhas do Alvo
    if (window.destinoSalvo < rotaSpx.length) {
        let alvo = rotaSpx[window.destinoSalvo];
        let d = dist(lat, lon, alvo.lat, alvo.lon);
        
        document.getElementById('rodape-dist').innerText = d > 1000 ? (d/1000).toFixed(1) + " km" : Math.round(d) + " m";
        
        desenharLinhasNavegacao(lat, lon);

        // Radar Inteligente: Geofence de baixa automática de 30 metros
        let painelAcoes = document.getElementById('painel-acoes');
        if (d < 30) {
            painelAcoes.style.display = 'flex';
        } else {
            painelAcoes.style.display = 'none';
        }
    }
}

// Controle do Botão de Visão Geral (Que faremos no HTML)
window.alternarModoCamera = function() {
    window.isCameraTravada = !window.isCameraTravada;
    if (window.isCameraTravada) {
        mapaGPS.setView(markerCarro.getLatLng(), 18);
        document.getElementById('btn-trava-camera').innerText = "📍 FOCAR ROTA";
        document.getElementById('btn-trava-camera').style.background = "#007AFF";
    } else {
        document.getElementById('btn-trava-camera').innerText = "🗺️ MODO LIVRE";
        document.getElementById('btn-trava-camera').style.background = "#FF8C00";
    }
}

function desenharRotaRestante() {
    if (!mapaGPS || !rotaSpx || rotaSpx.length === 0) return;
    if (polylinePreta) mapaGPS.removeLayer(polylinePreta);
    
    let pontos = rotaSpx.slice(window.destinoSalvo).map(p => [p.lat, p.lon]);
    polylinePreta = L.polyline(pontos, {color: '#555', weight: 4, dashArray: '5, 10'}).addTo(mapaGPS);
}

function desenharLinhasNavegacao(carLat, carLon) {
    if (!mapaGPS || !rotaSpx || window.destinoSalvo >= rotaSpx.length) return;
    
    if (polylineAzul) mapaGPS.removeLayer(polylineAzul);
    if (polylineRoxa) mapaGPS.removeLayer(polylineRoxa);

    let alvoAtual = rotaSpx[window.destinoSalvo];
    polylineAzul = L.polyline([[carLat, carLon], [alvoAtual.lat, alvoAtual.lon]], {color: '#007AFF', weight: 6}).addTo(mapaGPS);

    if (window.destinoSalvo + 1 < rotaSpx.length) {
        let proxAlvo = rotaSpx[window.destinoSalvo + 1];
        polylineRoxa = L.polyline([[alvoAtual.lat, alvoAtual.lon], [proxAlvo.lat, proxAlvo.lon]], {color: '#9d00ff', weight: 5, dashArray: '10, 5'}).addTo(mapaGPS);
    }
}

function atualizarPainelTopo() {
    if (window.destinoSalvo >= rotaSpx.length) return;
    let alvo = rotaSpx[window.destinoSalvo];
    document.getElementById('stop-badge').innerText = `STOP ${window.destinoSalvo + 1} (${alvo.Volume || 1} vol)`;
    
    let conteudoRua = "";
    if (alvo.isVaga) {
        conteudoRua = `VAGA: ${alvo.sugados.length} PACOTES A PÉ`;
        document.getElementById('rodape-rua').innerText = "ESTACIONE (COMBO A PÉ)";
        montarChecklistVaga(alvo);
    } else {
        conteudoRua = typeof extrairRuaPadrao === 'function' ? extrairRuaPadrao(alvo.Endereco) : alvo.Endereco;
        document.getElementById('rodape-rua').innerText = conteudoRua;
        document.getElementById('combo-checklist-container').innerHTML = ''; 
    }
    document.getElementById('lista-enderecos').innerHTML = `<div style="font-weight:bold; font-size:18px;">${conteudoRua}</div>`;
}

function montarChecklistVaga(alvo) {
    let html = '<div style="text-align:left; max-height:100px; overflow-y:auto; margin-bottom:10px; background:#222; padding:5px; border-radius:5px;">';
    html += '<strong style="color:#007AFF;">🛒 Sacar do carro:</strong><br>';
    alvo.sugados.forEach((sId, i) => {
        let pctEnd = "Pacote " + (i+1);
        if(typeof planilhaStopsData !== 'undefined') {
            let p = planilhaStopsData.find(x => x.spxId === sId);
            if(p && typeof extrairRuaPadrao === 'function') pctEnd = extrairRuaPadrao(p.Endereco);
        }
        html += `<div style="font-size:12px; border-bottom:1px solid #333; padding:3px 0;">${pctEnd}</div>`;
    });
    html += '</div>';
    document.getElementById('combo-checklist-container').innerHTML = html;
}

function finalizarParadaAtual(status) {
    if (window.destinoSalvo >= rotaSpx.length) return;
    
    let alvo = rotaSpx[window.destinoSalvo];
    alvo.statusEntrega = status;
    if(typeof historicoParadas !== 'undefined') historicoParadas.push(alvo);
    
    window.destinoSalvo++;
    if(typeof salvarEstadoRota === 'function') salvarEstadoRota();
    
    if (window.destinoSalvo >= rotaSpx.length) {
        finalizarExpediente();
    } else {
        document.getElementById('painel-acoes').style.display = 'none';
        atualizarPainelTopo();
        desenharRotaRestante();
        
        // Zera o cálculo da câmera para não dar solavanco de giro no próximo cliente
        ultimaLatCamera = null;
        ultimaLonCamera = null;
    }
}

function finalizarExpediente() {
    if (watchIdGPS) navigator.geolocation.clearWatch(watchIdGPS);
    if(typeof esconderTodasTelas === 'function') esconderTodasTelas();
    
    let relatorio = document.getElementById('modal-relatorio');
    if(relatorio) relatorio.style.display = 'block';
}

function abrirMenuStops() { 
    let menu = document.getElementById('modal-menu-stops');
    if(menu) menu.style.display = 'block'; 
    renderizarListaStops(); 
}

function fecharMenuStops() { 
    let menu = document.getElementById('modal-menu-stops');
    if(menu) menu.style.display = 'none'; 
}

function erroGPS(err) { 
    console.warn("Sinal GPS Perdido/Atrasado:", err); 
}

function renderizarListaStops() {
    let html = '';
    rotaSpx.forEach((alvo, idx) => {
        let cor = (idx < window.destinoSalvo) ? 'green' : (idx === window.destinoSalvo ? '#007AFF' : '#333');
        let textoEnd = alvo.isVaga ? '🚙 Estacionamento (Vaga)' : (typeof extrairRuaPadrao === 'function' ? extrairRuaPadrao(alvo.Endereco) : alvo.Endereco);
        html += `<div style="padding: 15px; margin: 10px; background: ${cor}; border-radius: 8px;" onclick="forcarPuloPara(${idx})">
            <strong>Stop ${idx + 1}</strong><br>${textoEnd}
        </div>`;
    });
    let container = document.getElementById('conteudo-lista-stops');
    if(container) container.innerHTML = html;
}

function forcarPuloPara(idx) {
    window.destinoSalvo = idx;
    if(typeof salvarEstadoRota === 'function') salvarEstadoRota();
    fecharMenuStops();
    atualizarPainelTopo();
    desenharRotaRestante();
    
    // Zera o cálculo de câmera no pulo manual
    ultimaLatCamera = null;
    ultimaLonCamera = null;
}
