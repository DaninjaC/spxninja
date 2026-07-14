/* ========================================= */
/* motor-gps.js - GPS Dinâmico (OSRM + Rotação)*/
/* ========================================= */

let mapaGPS = null;
let markerCarro = null;
let polylineAzul = null;
let polylineRoxa = null;
let polylinePreta = null;
let watchIdGPS = null;

// Variáveis da Câmera e OSRM
let ultimaLatCamera = null;
let ultimaLonCamera = null;
let anguloAtual = 0;
window.isCameraTravada = true; 

let cacheOSRMCoords = null;
let alvoCacheIndex = -1;
let estaBuscandoOSRM = false;

function calcularBearing(lat1, lon1, lat2, lon2) {
    const toRad = Math.PI / 180;
    const toDeg = 180 / Math.PI;
    const dLon = (lon2 - lon1) * toRad;
    const y = Math.sin(dLon) * Math.cos(lat2 * toRad);
    const x = Math.cos(lat1 * toRad) * Math.sin(lat2 * toRad) - Math.sin(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.cos(dLon);
    return ((Math.atan2(y, x) * toDeg) + 360) % 360;
}

// Bate no servidor de mapas de asfalto
async function buscarRotaOSRM(lat1, lon1, lat2, lon2) {
    try {
        let url = `https://router.project-osrm.org/route/v1/driving/${lon1},${lat1};${lon2},${lat2}?overview=full&geometries=geojson`;
        let resp = await fetch(url);
        let data = await resp.json();
        if (data.routes && data.routes.length > 0) {
            // OSRM devolve [Lon, Lat], o Leaflet usa [Lat, Lon]
            return data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
        }
    } catch(e) { console.warn("Erro ao buscar contorno de rua", e); }
    return [[lat1, lon1], [lat2, lon2]]; // Se falhar, volta pra reta
}

function iniciarInterfaceGPS() {
    if (!mapaGPS) {
        mapaGPS = L.map('mapa-gps', { zoomControl: false, attributionControl: false }).setView([-23.5505, -46.6333], 15);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png').addTo(mapaGPS);
        
        // Ponto Azul Estável
        let iconeCarro = L.divIcon({
            className: 'icone-carro-gps',
            html: '<div style="font-size:24px; text-align:center; filter: drop-shadow(0 0 8px #007AFF);">🔵</div>', 
            iconSize: [30, 30],
            iconAnchor: [15, 15]
        });
        markerCarro = L.marker([-23.5505, -46.6333], {icon: iconeCarro, zIndexOffset: 1000}).addTo(mapaGPS);
    }
    
    if (typeof window.destinoSalvo === 'undefined') window.destinoSalvo = 0;

    if (navigator.geolocation) {
        watchIdGPS = navigator.geolocation.watchPosition(atualizarGPS, erroGPS, {
            enableHighAccuracy: true,
            maximumAge: 1000, 
            timeout: 5000
        });
    } else {
        alert("GPS não suportado.");
    }

    atualizarPainelTopo();
    desenharRotaRestante();
}

function atualizarGPS(pos) {
    let lat = pos.coords.latitude;
    let lon = pos.coords.longitude;
    
    markerCarro.setLatLng([lat, lon]);

    let containerMapa = document.getElementById('mapa-gps');

    if (window.isCameraTravada) {
        mapaGPS.setView([lat, lon], 18, {animate: true, duration: 0.5});
        
        if (ultimaLatCamera !== null && ultimaLonCamera !== null) {
            let distMovida = dist(ultimaLatCamera, ultimaLonCamera, lat, lon);
            
            // FILTRO DE RUÍDO: Só roda se o carro andou de verdade (6 metros), mata o "Bêbado"
            if (distMovida > 6) {
                let novoAngulo = calcularBearing(ultimaLatCamera, ultimaLonCamera, lat, lon);
                let diferenca = Math.abs(novoAngulo - anguloAtual);
                if (diferenca > 180) diferenca = 360 - diferenca;
                
                // Zona Morta: Só ajusta a câmera se mudar mais de 10 graus
                if (diferenca > 10) {
                    anguloAtual = novoAngulo;
                }
                ultimaLatCamera = lat;
                ultimaLonCamera = lon;
            }
        } else {
            ultimaLatCamera = lat;
            ultimaLonCamera = lon;
        }

        if(containerMapa) containerMapa.style.transform = `rotate(${-anguloAtual}deg)`;
        mapaGPS.dragging.disable(); 
    } else {
        if(containerMapa) containerMapa.style.transform = `rotate(0deg)`; 
        mapaGPS.dragging.enable(); 
    }

    if (window.destinoSalvo < rotaSpx.length) {
        let alvo = rotaSpx[window.destinoSalvo];
        let d = dist(lat, lon, alvo.lat, alvo.lon);
        
        document.getElementById('rodape-dist').innerText = d > 1000 ? (d/1000).toFixed(1) + " km" : Math.round(d) + " m";
        
        // Chamada Inteligente do OSRM (Só bate no servidor 1x por alvo)
        if (alvoCacheIndex !== window.destinoSalvo && !estaBuscandoOSRM) {
            estaBuscandoOSRM = true;
            buscarRotaOSRM(lat, lon, alvo.lat, alvo.lon).then(coords => {
                cacheOSRMCoords = coords;
                alvoCacheIndex = window.destinoSalvo;
                estaBuscandoOSRM = false;
                desenharLinhasNavegacao(lat, lon); // Redesenha a linha nova do asfalto
            });
        } else {
            desenharLinhasNavegacao(lat, lon);
        }

        let painelAcoes = document.getElementById('painel-acoes');
        if (d < 30) {
            painelAcoes.style.display = 'flex';
        } else {
            painelAcoes.style.display = 'none';
        }
    }
}

window.alternarModoCamera = function() {
    window.isCameraTravada = !window.isCameraTravada;
    let btn = document.getElementById('btn-trava-camera');
    
    if (window.isCameraTravada) {
        mapaGPS.setView(markerCarro.getLatLng(), 18);
        btn.innerText = "📍 FOCAR ROTA";
        btn.style.background = "#007AFF";
    } else {
        btn.innerText = "🗺️ MODO LIVRE";
        btn.style.background = "#FF8C00";
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
    
    // Liga o carro à linha do OSRM
    let coordsAzul = cacheOSRMCoords && cacheOSRMCoords.length > 0 
                     ? [[carLat, carLon], ...cacheOSRMCoords] 
                     : [[carLat, carLon], [alvoAtual.lat, alvoAtual.lon]];

    polylineAzul = L.polyline(coordsAzul, {color: '#007AFF', weight: 6}).addTo(mapaGPS);

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
        // BLINDAGEM CONTRA O "DESCONHECIDO"
        let enderecoBruto = alvo.Endereço || alvo.Endereco || alvo.endereco || alvo.Rua || alvo.rua || alvo.Logradouro || "";
        conteudoRua = typeof extrairRuaPadrao === 'function' && enderecoBruto !== "" ? extrairRuaPadrao(enderecoBruto) : enderecoBruto;
        
        if (!conteudoRua || conteudoRua === "DESCONHECIDO" || conteudoRua.trim() === "") {
            conteudoRua = "Siga a Linha Azul 📍";
        }

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
            if(p) {
                let endP = p.Endereço || p.Endereco || p.endereco || p.Rua || "";
                if(typeof extrairRuaPadrao === 'function' && endP !== "") pctEnd = extrairRuaPadrao(endP);
            }
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
        
        // Zera tudo para a câmera e o OSRM rodarem do zero na próxima parada
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
        
        let enderecoBruto = alvo.Endereço || alvo.Endereco || alvo.endereco || alvo.Rua || alvo.rua || alvo.Logradouro || "";
        let textoEnd = alvo.isVaga ? '🚙 Estacionamento (Vaga)' : (typeof extrairRuaPadrao === 'function' && enderecoBruto !== "" ? extrairRuaPadrao(enderecoBruto) : enderecoBruto);
        if (!textoEnd || textoEnd === "DESCONHECIDO" || textoEnd.trim() === "") textoEnd = "Siga a Linha Azul 📍";

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
    
    ultimaLatCamera = null;
    ultimaLonCamera = null;
}
