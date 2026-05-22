// Configuración de Firebase - Planta Centro Unidad 6
const VERSION_APP = 1.0;

const firebaseConfig = {
  apiKey: "AIzaSyDil3ElPxLGRVWRXH4bAAKUIRqDrA_We6o",
  authDomain: "planta-centro-u6.firebaseapp.com",
  databaseURL: "https://planta-centro-u6-default-rtdb.firebaseio.com",
  projectId: "planta-centro-u6",
  storageBucket: "planta-centro-u6.firebasestorage.app",
  messagingSenderId: "269464703762",
  appId: "1:269464703762:web:7716249688c2567ff119cb"
};

const LINK_DESCARGA_APK = "https://drive.google.com/uc?export=download&id=1nKGa8WelX-toTzC_v-NldKf4NFTbHCDD";

let database;
let listenerConexionActivo = false;
let areaSeleccionadaPaso = "";
let equiposActuales = [];
let fotosBase64 = [];
let tagOriginalEdicion = null;
let areaOriginalEdicion = null;

function conectarFirebase() {
    if (typeof firebase !== 'undefined') {
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
            // Habilitar persistencia offline nativa de Firebase
            firebase.database().goOnline();
        }
        database = firebase.database();
        if (!listenerConexionActivo) {
            database.ref('.info/connected').on('value', (snap) => {
                if (snap.val() === true) {
                    notificar("SISTEMA CONECTADO", "exito");
                    verificarActualizaciones();
                    sincronizarColas();

                    // Sincronizar clave maestra desde la nube
                    database.ref('config/master_pass').on('value', s => {
                        if(s.val()) localStorage.setItem('master_pass', s.val());
                    });
                } else {
                    notificar("MODO OFFLINE", "info");
                }
            });
            listenerConexionActivo = true;
        }
    }
}

function sincronizarColas() {
    if (!database || !navigator.onLine) return;
    let colaEnv = JSON.parse(localStorage.getItem('cola_envios') || "[]");
    let colaDel = JSON.parse(localStorage.getItem('cola_eliminaciones') || "[]");
    let colaPlEnv = JSON.parse(localStorage.getItem('cola_planos_envios') || "[]");
    let colaPlDel = JSON.parse(localStorage.getItem('cola_planos_del') || "[]");
    let colaDocEnv = JSON.parse(localStorage.getItem('cola_docs_envios') || "[]");
    let colaDocDel = JSON.parse(localStorage.getItem('cola_docs_del') || "[]");

    // Sincronizar Equipos
    colaEnv.forEach(q => {
        database.ref('equipos/' + q.area + '/' + q.tag).set(q).then(() => {
            let actual = JSON.parse(localStorage.getItem('cola_envios') || "[]");
            actual = actual.filter(i => !(i.tag === q.tag && i.area === q.area));
            localStorage.setItem('cola_envios', JSON.stringify(actual));
            notificar("SINCRONIZADO: " + q.tag);
        });
    });
    colaDel.forEach(q => {
        database.ref('equipos/' + q.area + '/' + q.tag).remove().then(() => {
            let actual = JSON.parse(localStorage.getItem('cola_eliminaciones') || "[]");
            actual = actual.filter(i => !(i.tag === q.tag && i.area === q.area));
            localStorage.setItem('cola_eliminaciones', JSON.stringify(actual));
        });
    });

    // Sincronizar Planos
    colaPlEnv.forEach(q => {
        database.ref('planos/' + q.area + '/' + q.id).set(q.data).then(() => {
            let actual = JSON.parse(localStorage.getItem('cola_planos_envios') || "[]");
            actual = actual.filter(i => i.id !== q.id);
            localStorage.setItem('cola_planos_envios', JSON.stringify(actual));
            notificar("PLANO SINCRONIZADO: " + q.data.titulo);
        });
    });
    colaPlDel.forEach(q => {
        database.ref('planos/' + q.area + '/' + q.id).remove().then(() => {
            let actual = JSON.parse(localStorage.getItem('cola_planos_del') || "[]");
            actual = actual.filter(i => i.id !== q.id);
            localStorage.setItem('cola_planos_del', JSON.stringify(actual));
        });
    });

    // Sincronizar Documentos
    colaDocEnv.forEach(q => {
        database.ref('documentos/' + q.area + '/' + q.id).set(q.data).then(() => {
            let actual = JSON.parse(localStorage.getItem('cola_docs_envios') || "[]");
            actual = actual.filter(i => i.id !== q.id);
            localStorage.setItem('cola_docs_envios', JSON.stringify(actual));
            notificar("DOC SINCRONIZADO: " + q.data.titulo);
        });
    });
    colaDocDel.forEach(q => {
        database.ref('documentos/' + q.area + '/' + q.id).remove().then(() => {
            let actual = JSON.parse(localStorage.getItem('cola_docs_del') || "[]");
            actual = actual.filter(i => i.id !== q.id);
            localStorage.setItem('cola_docs_del', JSON.stringify(actual));
        });
    });
}
conectarFirebase();

const DATOS_PLANTA = { "auxiliares": [], "turbina": [], "ciclo": [], "caldera": [], "calderas_auxiliares": [], "externas": [], "instrumentacion": [], "contra_incendio": [] };

// ================= SEGURIDAD Y ACCESO ==================
function validarAccesoArea(area) {
    areaSeleccionadaPaso = area;
    const txt = document.getElementById('txt-rol-seleccionado');
    if(txt) txt.innerText = "Área: " + area.toUpperCase();
    if(document.getElementById('modal-id-acceso')) document.getElementById('modal-id-acceso').style.display = 'flex';
    volverAVerificar();
}

function verificarIdentidad() {
    const id = document.getElementById('input-id-acceso').value.trim();
    if (!id) return;
    const masterPass = localStorage.getItem('master_pass') || 'luis2026';
    const localUsers = JSON.parse(localStorage.getItem('user_db') || "{}");
    if (id.toLowerCase() === 'luis' || id === masterPass || id === "6969") { entrarArea(areaSeleccionadaPaso); return; }
    let esAdminLocal = false;
    Object.keys(localUsers).forEach(u => { if (id.toLowerCase() === u || id === localUsers[u].clave) esAdminLocal = true; });
    if (esAdminLocal) { entrarArea(areaSeleccionadaPaso); return; }
    if (database && navigator.onLine) {
        database.ref('personal_autorizado/' + id).once('value').then(s => {
            const u = s.val();
            if (u && u.estado === 'activo') { entrarArea(areaSeleccionadaPaso); return; }
            database.ref('usuarios').once('value').then(snap => {
                const users = snap.val() || {};
                let esAdminNube = false;
                Object.keys(users).forEach(uname => { if (id.toLowerCase() === uname || id === users[uname].clave) esAdminNube = true; });
                if (esAdminNube) entrarArea(areaSeleccionadaPaso);
                else {
                    const msg = document.getElementById('msg-error-id');
                    if(msg) { msg.innerText = (u && u.estado === 'pendiente') ? "ESPERA APROBACIÓN" : "ID NO REGISTRADO"; msg.style.display = 'block'; }
                }
            });
        });
    } else notificar("SIN SEÑAL - SOLO PERSONAL REGISTRADO", "error");
}

function confirmarAcceso() {
    const userField = document.getElementById('login-user');
    const passField = document.getElementById('login-pass');
    if(!userField || !passField) return;

    const u = userField.value.toLowerCase().trim();
    const p = passField.value.trim();
    const masterPass = localStorage.getItem('master_pass') || 'luis2026';
    const localUsers = JSON.parse(localStorage.getItem('user_db') || "{}");

    // Lógica prioritaria para el Maestro (Luis)
    if(u === 'luis') {
        if(p === masterPass || p === 'luis2026' || p === '6969') {
            localStorage.setItem('user_role', 'super');
            localStorage.setItem('user_name', 'Luis');
            notificar("ACCESO MAESTRO CONCEDIDO", "exito");
            setTimeout(() => { window.location.replace("admin.html"); }, 600);
            return;
        } else {
            notificar("CLAVE MAESTRA INCORRECTA", "error");
            return;
        }
    }

    // Lógica para usuarios locales (Caché offline)
    if (localUsers[u] && localUsers[u].clave === p) {
        localStorage.setItem('user_role', localUsers[u].rol);
        localStorage.setItem('user_name', u);
        window.location.replace("admin.html");
        return;
    }

    // Lógica para usuarios en la nube
    if(database && navigator.onLine) {
        database.ref('usuarios/'+u).once('value').then(s => {
            const d = s.val();
            if(d && d.clave === p) {
                localUsers[u] = d;
                localStorage.setItem('user_db', JSON.stringify(localUsers));
                localStorage.setItem('user_role', d.rol);
                localStorage.setItem('user_name', u);
                window.location.replace("admin.html");
            }
            else notificar("DATOS INCORRECTOS", "error");
        }).catch(err => {
            notificar("ERROR DE CONEXIÓN", "error");
        });
    } else {
        notificar("MODO OFFLINE - DATOS NO ENCONTRADOS", "error");
    }
}

function entrarArea(area) { localStorage.setItem('area_actual', area); window.location.replace("index.html"); }

// ================= HMI OPERACIONES Y GRÁFICA ==================
function abrirSeccionOperacion() { document.getElementById('modal-operacion-especial').style.display = 'flex'; cargarDatosOperacion(); setTimeout(() => dibujarCurvaArranque(0), 300); }
function cerrarSeccionOperacion() { document.getElementById('modal-operacion-especial').style.display = 'none'; }

function cargarDatosOperacion() {
    const cache = JSON.parse(localStorage.getItem('cache_operacion_u6') || "{}");
    renderizarDatosOperacion(cache);
    if (database && navigator.onLine) {
        database.ref('operacion/unidad6').on('value', (s) => {
            const data = s.val();
            if (data) { localStorage.setItem('cache_operacion_u6', JSON.stringify(data)); renderizarDatosOperacion(data); }
        });
    }
}

function renderizarDatosOperacion(d) {
    const lista = document.getElementById('op-pasos-arranque-lista'); if(!lista) return; lista.innerHTML = "";
    if (!d || !d.pasosArr) lista.innerHTML = `<div class='paso-item' style='text-align:center; color:#aaa;'>Sin pasos cargados.</div>`;
    else d.pasosArr.forEach((p, i) => lista.innerHTML += `<div class="paso-item" style="display:flex; gap:10px; background:rgba(0,255,204,0.05); border-left:3px solid #00ffcc; padding:10px; border-radius:8px; margin-bottom:5px;"><b>${i+1}:</b><span>${p}</span></div>`);
    const cond = document.getElementById('op-condiciones');
    if(cond) cond.innerHTML = `<div class="paso-item" style="padding:10px; background:rgba(0,255,204,0.02); border: 1px solid #333;"><small>PRESIÓN:</small> <b style="color:#00ffcc;">${d.presion || '--'} bar</b></div><div class="paso-item" style="padding:10px; background:rgba(0,255,204,0.02); border: 1px solid #333;"><small>FLUJO:</small> <b style="color:#00ffcc;">${d.flujo || '--'} t/h</b></div><div class="paso-item" style="padding:10px; background:rgba(0,255,204,0.02); border: 1px solid #333;"><small>DOMO:</small> <b style="color:#00ffcc;">${d.nivel || '--'} %</b></div><div class="paso-item" style="padding:10px; background:rgba(0,255,204,0.02); border: 1px solid #333;"><small>MW MAX:</small> <b style="color:#00ffcc;">${d.mw || '--'} MW</b></div>`;
}

function dibujarCurvaArranque(currentMW = 0) {
    const canvas = document.getElementById('grafica-arranque'); if (!canvas) return;
    const ctx = canvas.getContext('2d'); const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect(); canvas.width = rect.width * dpr; canvas.height = rect.height * dpr; ctx.scale(dpr, dpr);
    const w = rect.width; const h = rect.height; const pad = 35; ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(0, 255, 204, 0.05)";
    for(let i=1; i<=4; i++) {
        let y = (h-pad) - ((h-pad-10)*(i/4)); ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(w-10, y); ctx.stroke();
        let x = pad + ((w-pad-10)*(i/4)); ctx.beginPath(); ctx.moveTo(x, 10); ctx.lineTo(x, h-pad); ctx.stroke();
    }
    ctx.strokeStyle = "#00ffcc"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(pad, 10); ctx.lineTo(pad, h - pad); ctx.lineTo(w - 10, h - pad); ctx.stroke();
    const prog = Math.min(currentMW / 600, 1); const rx = pad + (w - pad - 10) * prog; const ry = (h - pad) - (h - pad - 20) * prog;
    if (currentMW > 0) { ctx.strokeStyle = "#00ffcc"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(pad, h - pad); ctx.quadraticCurveTo(pad + (rx - pad) * 0.5, h - pad, rx, ry); ctx.stroke(); ctx.fillStyle = "#ffcc00"; ctx.beginPath(); ctx.arc(rx, ry, 5, 0, Math.PI * 2); ctx.fill(); }
    const fase = document.getElementById('txt-fase-arranque');
    if (fase) {
        if (currentMW === 0) fase.innerHTML = "FASE: <span style='color:#aaa'>STANDBY</span>";
        else if (currentMW < 120) fase.innerHTML = "FASE: <span style='color:#ff4444'>SINCRONIZANDO</span>";
        else if (currentMW < 450) fase.innerHTML = "FASE: <span style='color:#ffcc00'>CARGANDO</span>";
        else fase.innerHTML = "FASE: <span style='color:#2ecc71'>NOMINAL</span>";
    }
}

// ================= CONFIGURACIÓN PROTOCOLOS OPERACIÓN ==================
function editarParametrosOperacion() {
    document.getElementById('modal-edit-op').style.display = 'flex';
    const d = JSON.parse(localStorage.getItem('cache_operacion_u6') || "{}");
    document.getElementById('edit-op-presion').value = d.presion || "";
    document.getElementById('edit-op-flujo').value = d.flujo || "";
    document.getElementById('edit-op-nivel').value = d.nivel || "";
    document.getElementById('edit-op-mw').value = d.mw || "";
    const cont = document.getElementById('contenedor-pasos-edit'); cont.innerHTML = "";
    if(d.pasosArr) d.pasosArr.forEach(p => agregarInputPaso(p));
}

function agregarInputPaso(val = "") {
    const cont = document.getElementById('contenedor-pasos-edit');
    const div = document.createElement('div'); div.style = "display:flex; gap:5px; margin-bottom:5px;";
    div.innerHTML = `<input type="text" class="input-paso-dinamico" value="${val}" style="flex:1;"><button onclick="this.parentElement.remove()" style="background:red; color:white; border:none; border-radius:5px; padding:0 10px;">X</button>`;
    cont.appendChild(div);
}

function guardarParametrosOperacion() {
    const pass = document.getElementById('auth-op-pass').value.trim();
    const masterPass = localStorage.getItem('master_pass') || 'luis2026';

    if(pass !== masterPass && pass !== "6969") {
        notificar("CLAVE DE AUTORIZACIÓN INCORRECTA", "error");
        return;
    }

    const pasos = Array.from(document.querySelectorAll('.input-paso-dinamico')).map(i => i.value).filter(v => v.trim() !== "");
    const data = { pasosArr: pasos, presion: document.getElementById('edit-op-presion').value, flujo: document.getElementById('edit-op-flujo').value, nivel: document.getElementById('edit-op-nivel').value, mw: document.getElementById('edit-op-mw').value };
    localStorage.setItem('cache_operacion_u6', JSON.stringify(data));
    if(database) database.ref('operacion/unidad6').set(data);
    notificar("PROTOCOLOS ACTUALIZADOS");
    document.getElementById('modal-edit-op').style.display = 'none';
    document.getElementById('auth-op-pass').value = ""; // Limpiar clave
    renderizarDatosOperacion(data);
}

// ================= GESTIÓN DE SISTEMAS Y OFFLINE ==================
function filtrarSistema(sistema) {
    const contenedor = document.getElementById('mapa-equipos'); if (!contenedor) return;
    const grid = document.querySelector('.sistemas-grid'); if(grid) grid.style.display = 'none';
    conectarFirebase();
    const btnHome = document.querySelector('.btn-home');
    if (btnHome) { btnHome.innerHTML = '<i class="fas fa-chevron-left"></i> VOLVER'; btnHome.onclick = () => { window.location.reload(); }; }
    const busc = document.getElementById('contenedor-buscador'); if(busc) busc.style.display = 'block';
    cargarPlanosDelArea(sistema); cargarManualDelArea(sistema); cargarDocsDelArea(sistema);
    const renderLocal = () => {
        const cache = JSON.parse(localStorage.getItem('cache_' + sistema) || "{}");
        let combinados = {...cache};
        let colaEnv = JSON.parse(localStorage.getItem('cola_envios') || "[]");
        colaEnv.filter(q => q.area === sistema).forEach(q => { combinados[q.tag] = q; });
        let colaDel = JSON.parse(localStorage.getItem('cola_eliminaciones') || "[]");
        colaDel.filter(q => q.area === sistema).forEach(q => { delete combinados[q.tag]; });
        let finalMap = new Map(); (DATOS_PLANTA[sistema] || []).forEach(eq => finalMap.set(eq.tag, eq)); Object.values(combinados).forEach(eq => finalMap.set(eq.tag, eq));
        equiposActuales = Array.from(finalMap.values()); dibujarEquipos(equiposActuales);
    };
    renderLocal();
    if (database && navigator.onLine) database.ref('equipos/' + sistema).on('value', (s) => { localStorage.setItem('cache_' + sistema, JSON.stringify(s.val() || {})); renderLocal(); });
}

function dibujarEquipos(equipos) {
    const c = document.getElementById('mapa-equipos'); if(!c) return; c.innerHTML = "";
    if (equipos.length === 0) { c.innerHTML = "<p class='mensaje'>Sin registros.</p>"; return; }
    equipos.forEach(eq => { let n = document.createElement('div'); n.className = "equipo-nodo"; n.onclick = () => verFicha(eq); n.innerHTML = `<i class="fas ${eq.icono || 'fa-cog'} fa-2x"></i><br><span>${eq.nombre}</span>`; c.appendChild(n); });
}

function verFicha(eq) {
    let imgH = ""; let imgs = Array.isArray(eq.img) ? eq.img : (eq.img ? [eq.img] : []);
    imgs.forEach(i => imgH += `<img src="${i}" style="width:100%; border-radius:12px; border:2px solid #ffcc00; margin-top:15px;">`);
    document.getElementById('info-tecnica').innerHTML = `<h2 style="color:#ffcc00;">${eq.nombre}</h2><p style="color:#00ccff; font-family:monospace;">[ ${eq.tag} ]</p><p>${eq.info || ''}</p><p><b>UBICACIÓN:</b> ${eq.ubicacion || 'Planta Centro'}</p>${imgH}`;
    document.getElementById('modal-info').style.display = 'flex';
}

function filtrarPorTexto() {
    const txt = document.getElementById('input-busqueda').value.toLowerCase().trim();
    const filtrados = equiposActuales.filter(e => e.nombre.toLowerCase().includes(txt) || e.tag.toLowerCase().includes(txt));
    dibujarEquipos(filtrados);
    const cont = document.getElementById('contador-resultados'); if(cont) cont.innerText = filtrados.length + " REGISTROS ENCONTRADOS";
}

function cargarPlanosDelArea(area) {
    const cont = document.getElementById('contenedor-planos-area'); const lista = document.getElementById('lista-planos-area'); if(!cont || !lista) return;
    const render = () => {
        const cache = JSON.parse(localStorage.getItem('cache_planos_' + area) || "{}");
        let combinados = {...cache};
        let colaEnv = JSON.parse(localStorage.getItem('cola_planos_envios') || "[]");
        colaEnv.filter(q => q.area === area).forEach(q => { combinados[q.id] = q.data; });
        let colaDel = JSON.parse(localStorage.getItem('cola_planos_del') || "[]");
        colaDel.filter(q => q.area === area).forEach(q => { delete combinados[q.id]; });

        lista.innerHTML = "";
        Object.keys(combinados).forEach(id => {
            lista.innerHTML += `<div class="plano-item-card"><h4>${combinados[id].titulo}</h4><img src="${combinados[id].foto}" onclick="verImagenFull('${combinados[id].foto}', '${combinados[id].titulo}')"></div>`;
        });
        cont.style.display = Object.keys(combinados).length > 0 ? 'block' : 'none';
    };
    render();
    if(database) database.ref('planos/'+area).on('value', s => {
        localStorage.setItem('cache_planos_' + area, JSON.stringify(s.val() || {}));
        render();
    });
}

function cargarManualDelArea(area) {
    const cont = document.getElementById('contenedor-manual-area'); const texto = document.getElementById('texto-manual-area'); if(!cont || !texto) return;
    const cache = JSON.parse(localStorage.getItem('manuales_areas') || "{}"); if(cache[area]) { texto.innerText = cache[area]; cont.style.display = 'block'; }
    if(database) database.ref('manuales_areas/'+area).on('value', s => { if(s.val()) { texto.innerText = s.val(); cont.style.display = 'block'; } });
}

function cargarDocsDelArea(area) {
    const cont = document.getElementById('contenedor-docs-area'); const lista = document.getElementById('lista-docs-area'); if(!cont || !lista) return;
    const render = () => {
        const cache = JSON.parse(localStorage.getItem('cache_docs_' + area) || "{}");
        let combinados = {...cache};
        let colaEnv = JSON.parse(localStorage.getItem('cola_docs_envios') || "[]");
        colaEnv.filter(q => q.area === area).forEach(q => { combinados[q.id] = q.data; });
        let colaDel = JSON.parse(localStorage.getItem('cola_docs_del') || "[]");
        colaDel.filter(q => q.area === area).forEach(q => { delete combinados[q.id]; });

        lista.innerHTML = "";
        Object.keys(combinados).forEach(id => {
            lista.innerHTML += `<div class="user-item-modern"><b>${combinados[id].titulo}</b><button onclick="descargarDocumento('${combinados[id].archivo}', '${combinados[id].titulo}')">ABRIR</button></div>`;
        });
        cont.style.display = Object.keys(combinados).length > 0 ? 'block' : 'none';
    };
    render();
    if(database) database.ref('documentos/'+area).on('value', s => {
        localStorage.setItem('cache_docs_' + area, JSON.stringify(s.val() || {}));
        render();
    });
}

// ================= GESTIÓN ADMIN COMPLETA ==================
function cargarEquiposEdicion() {
    const area = document.getElementById('input-area').value;

    const render = () => {
        const cache = JSON.parse(localStorage.getItem('cache_' + area) || "{}");
        let combinados = {...cache};

        let colaEnv = JSON.parse(localStorage.getItem('cola_envios') || "[]");
        colaEnv.filter(q => q.area === area).forEach(q => { combinados[q.tag] = q; });
        let colaDel = JSON.parse(localStorage.getItem('cola_eliminaciones') || "[]");
        colaDel.filter(q => q.area === area).forEach(q => { delete combinados[q.tag]; });

        const lista = document.getElementById('lista-edicion'); if(!lista) return; lista.innerHTML = "";
        Object.values(combinados).forEach(eq => {
            lista.innerHTML += `
                <div class="user-item-modern" style="border-left: 4px solid #ffcc00; background: rgba(255,204,0,0.03); display: flex; justify-content: space-between; align-items: center; padding: 12px; margin-bottom: 10px; border-radius: 12px;">
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <div style="width: 35px; height: 35px; background: #000; border-radius: 50%; display: flex; align-items: center; justify-content: center; border: 1px solid #ffcc00;">
                            <i class="fas fa-tools" style="color: #ffcc00; font-size: 0.9rem;"></i>
                        </div>
                        <div>
                            <b style="color: #ffcc00; font-size: 0.85rem;">${eq.nombre}</b><br>
                            <small style="color: #aaa; font-family: monospace; font-size: 0.7rem;">[ ${eq.tag} ]</small>
                            ${colaEnv.some(q=>q.tag===eq.tag && q.area===area) ? '<br><small style="color:#ffcc00; font-size:0.6rem;">(PENDIENTE)</small>' : ''}
                        </div>
                    </div>
                    <div style="display: flex; gap: 8px;">
                        <button onclick="cargarParaEditar('${encodeURIComponent(JSON.stringify(eq))}', '${area}')" style="background: rgba(0,204,255,0.15); border: 1.5px solid #00ccff; color: #00ccff; padding: 6px 10px; border-radius: 8px;"><i class="fas fa-edit"></i></button>
                        <button onclick="eliminarEquipo('${area}', '${eq.tag}')" style="background: rgba(255,68,68,0.15); border: 1.5px solid #ff4444; color: #ff4444; padding: 6px 10px; border-radius: 8px;"><i class="fas fa-trash"></i></button>
                    </div>
                </div>`;
        });
    };

    render();
    if(database) {
        database.ref('equipos/'+area).off();
        database.ref('equipos/'+area).on('value', s => {
            localStorage.setItem('cache_' + area, JSON.stringify(s.val() || {}));
            render();
        });
    }
}

function procesarCarga() {
    const area = document.getElementById('input-area').value;
    const tag = document.getElementById('input-tag').value.trim().toUpperCase();
    const nombre = document.getElementById('input-nombre').value.trim();
    const info = document.getElementById('input-info').value.trim();
    const operacion = document.getElementById('input-operacion').value.trim();
    const ubicacion = document.getElementById('input-ubicacion').value.trim();

    if (!tag || !nombre) { notificar("TAG Y NOMBRE REQUERIDOS", "error"); return; }
    const equipo = { tag, nombre, info, operacion, ubicacion, img: fotosBase64, area: area };

    let colaEnv = JSON.parse(localStorage.getItem('cola_envios') || "[]");
    colaEnv = colaEnv.filter(i => !(i.tag === tag && i.area === area));
    colaEnv.push(equipo);
    localStorage.setItem('cola_envios', JSON.stringify(colaEnv));

    if (tagOriginalEdicion && (areaOriginalEdicion !== area || tagOriginalEdicion !== tag)) {
        let colaDel = JSON.parse(localStorage.getItem('cola_eliminaciones') || "[]");
        colaDel.push({ area: areaOriginalEdicion, tag: tagOriginalEdicion });
        localStorage.setItem('cola_eliminaciones', JSON.stringify(colaDel));
    }

    notificar("CAMBIO EN COLA DE SINCRONIZACIÓN");
    limpiarFormulario();
    cargarEquiposEdicion();
    sincronizarColas();
}

function cargarPlanosEdicionGeneral() {
    const area = document.getElementById('input-plano-area').value;
    const render = () => {
        const cache = JSON.parse(localStorage.getItem('cache_planos_' + area) || "{}");
        let combinados = {...cache};
        let colaEnv = JSON.parse(localStorage.getItem('cola_planos_envios') || "[]");
        colaEnv.filter(q => q.area === area).forEach(q => { combinados[q.id] = q.data; });
        let colaDel = JSON.parse(localStorage.getItem('cola_planos_del') || "[]");
        colaDel.filter(q => q.area === area).forEach(q => { delete combinados[q.id]; });

        const lista = document.getElementById('lista-planos-edicion-general'); if(!lista) return; lista.innerHTML = "";
        Object.keys(combinados).forEach(id => {
            const isPending = colaEnv.some(q => q.id === id);
            lista.innerHTML += `
                <div class="user-item-modern" style="border-left: 4px solid #00ccff; background: rgba(0,204,255,0.03); display: flex; justify-content: space-between; align-items: center; padding: 10px; margin-bottom: 8px; border-radius: 10px;">
                    <div>
                        <span>${combinados[id].titulo}</span>
                        ${isPending ? '<br><small style="color:#ffcc00; font-size:0.6rem;">(PENDIENTE)</small>' : ''}
                    </div>
                    <button onclick="eliminarPlanoGeneral('${area}', '${id}')" style="color:#ff4444; background:none; border:none; font-size:1.2rem;"><i class="fas fa-times-circle"></i></button>
                </div>`;
        });
    };
    render();
    if(database) {
        database.ref('planos/'+area).off();
        database.ref('planos/'+area).on('value', s => {
            localStorage.setItem('cache_planos_' + area, JSON.stringify(s.val() || {}));
            render();
        });
    }
}

function guardarPlanoGeneral() {
    const area = document.getElementById('input-plano-area').value;
    const tit = document.getElementById('input-plano-titulo-general').value.trim();
    const fileInput = document.getElementById('input-plano-foto-general');
    const file = fileInput.files[0];
    if(!tit || !file) { notificar("TÍTULO E IMAGEN REQUERIDOS", "error"); return; }

    const reader = new FileReader();
    reader.onload = (e) => {
        const id = "plano_" + Date.now();
        const data = { titulo: tit, foto: e.target.result };

        let cola = JSON.parse(localStorage.getItem('cola_planos_envios') || "[]");
        cola.push({ area, id, data });
        localStorage.setItem('cola_planos_envios', JSON.stringify(cola));

        notificar("PLANO EN COLA DE SUBIDA");
        document.getElementById('input-plano-titulo-general').value = "";
        fileInput.value = "";
        const txt = document.getElementById('txt-plano-archivo');
        if(txt) txt.innerText = "CARGAR IMAGEN DEL PLANO";

        cargarPlanosEdicionGeneral();
        sincronizarColas();
    };
    reader.readAsDataURL(file);
}

function eliminarPlanoGeneral(a, i) {
    if(confirm("¿Borrar plano permanentemente?")) {
        let colaDel = JSON.parse(localStorage.getItem('cola_planos_del') || "[]");
        colaDel.push({ area: a, id: i });
        localStorage.setItem('cola_planos_del', JSON.stringify(colaDel));

        let colaEnv = JSON.parse(localStorage.getItem('cola_planos_envios') || "[]");
        colaEnv = colaEnv.filter(item => item.id !== i);
        localStorage.setItem('cola_planos_envios', JSON.stringify(colaEnv));

        notificar("BORRADO PENDIENTE");
        cargarPlanosEdicionGeneral();
        sincronizarColas();
    }
}

function cargarManualParaEditar() {
    const area = document.getElementById('input-manual-area').value;
    const cache = JSON.parse(localStorage.getItem('manuales_areas') || "{}");
    document.getElementById('input-manual-texto').value = cache[area] || "";
    if(database && navigator.onLine) database.ref('manuales_areas/'+area).once('value').then(s => { if(s.val()) document.getElementById('input-manual-texto').value = s.val(); });
}

function guardarManualArea() {
    const area = document.getElementById('input-manual-area').value;
    const texto = document.getElementById('input-manual-texto').value;
    if(database) database.ref('manuales_areas/'+area).set(texto);
    const cache = JSON.parse(localStorage.getItem('manuales_areas') || "{}"); cache[area] = texto; localStorage.setItem('manuales_areas', JSON.stringify(cache));
    notificar("MANUAL ACTUALIZADO");
}

function cargarDocsEdicion() {
    const area = document.getElementById('input-doc-area').value;
    const render = () => {
        const cache = JSON.parse(localStorage.getItem('cache_docs_'+area) || "{}");
        let combinados = {...cache};
        let colaEnv = JSON.parse(localStorage.getItem('cola_docs_envios') || "[]");
        colaEnv.filter(q => q.area === area).forEach(q => { combinados[q.id] = q.data; });
        let colaDel = JSON.parse(localStorage.getItem('cola_docs_del') || "[]");
        colaDel.filter(q => q.area === area).forEach(q => { delete combinados[q.id]; });

        const lista = document.getElementById('lista-docs-edicion'); if(!lista) return; lista.innerHTML = "";
        Object.keys(combinados).forEach(id => {
            const isPending = colaEnv.some(q => q.id === id);
            lista.innerHTML += `
                <div class="user-item-modern">
                    <div>
                        <span>${combinados[id].titulo}</span>
                        ${isPending ? '<br><small style="color:#ffcc00; font-size:0.6rem;">(PENDIENTE)</small>' : ''}
                    </div>
                    <button onclick="eliminarDocumento('${area}', '${id}')" style="color:red;">X</button>
                </div>`;
        });
    };
    render();
    if(database) {
        database.ref('documentos/'+area).off();
        database.ref('documentos/'+area).on('value', s => {
            localStorage.setItem('cache_docs_' + area, JSON.stringify(s.val() || {}));
            render();
        });
    }
}

function guardarDocumento() {
    const area = document.getElementById('input-doc-area').value;
    const tit = document.getElementById('input-doc-titulo').value.trim();
    const fileInput = document.getElementById('input-doc-archivo');
    const file = fileInput.files[0];
    if(!tit || !file) { notificar("TÍTULO Y ARCHIVO REQUERIDOS", "error"); return; }

    const reader = new FileReader();
    reader.onload = (e) => {
        const id = "doc_" + Date.now();
        const ext = file.name.split('.').pop();
        const data = { titulo: tit, archivo: e.target.result, extension: ext };

        let cola = JSON.parse(localStorage.getItem('cola_docs_envios') || "[]");
        cola.push({ area, id, data });
        localStorage.setItem('cola_docs_envios', JSON.stringify(cola));

        notificar("DOCUMENTO EN COLA DE SUBIDA");
        document.getElementById('input-doc-titulo').value = "";
        fileInput.value = "";
        const txt = document.getElementById('txt-doc-nombre');
        if(txt) txt.innerText = "SELECCIONAR EXCEL, WORD O PDF";

        cargarDocsEdicion();
        sincronizarColas();
    };
    reader.readAsDataURL(file);
}

function cargarListaUsuarios() {
    const l = document.getElementById('lista-usuarios'); if(!l) return;
    database.ref('usuarios').on('value', s => {
        const us = s.val() || {};
        l.innerHTML = "";

        // Asegurar que el Root (Luis) aparezca siempre para ser gestionado
        if(!us['luis']) {
            us['luis'] = { nombre: 'luis', clave: localStorage.getItem('master_pass') || 'luis2026', rol: 'super' };
        }

        const maestros = Object.keys(us).filter(u => us[u].rol === 'super');
        const editores = Object.keys(us).filter(u => us[u].rol !== 'super');

        if(maestros.length > 0) {
            l.innerHTML += "<h4 style='color:#ff4444; font-size:0.75rem; margin-bottom:10px; margin-top:15px;'><i class='fas fa-crown'></i> MAESTROS (ACCESO TOTAL):</h4>";
            maestros.forEach(u => l.innerHTML += generarItemUsuario(u, us[u]));
        }

        if(editores.length > 0) {
            l.innerHTML += "<h4 style='color:#2ecc71; font-size:0.75rem; margin-bottom:10px; margin-top:15px;'><i class='fas fa-user-edit'></i> EDITORES TÉCNICOS:</h4>";
            editores.forEach(u => l.innerHTML += generarItemUsuario(u, us[u]));
        }
    });
}

function generarItemUsuario(u, data) {
    const esMaestro = data.rol === 'super';
    const colorBorde = esMaestro ? '#ff4444' : '#2ecc71';
    const colorFondo = esMaestro ? 'rgba(255,68,68,0.05)' : 'rgba(46,204,113,0.05)';
    const etiqueta = esMaestro ? 'MAESTRO / ADMINISTRADOR' : 'EDITOR TÉCNICO';
    const esRoot = u === 'luis';

    return `
    <div class="user-item-modern" style="border-left:4px solid ${colorBorde}; background:${colorFondo}; display:flex; justify-content:space-between; align-items:center; padding:12px; margin-bottom:8px; border-radius:12px;">
        <div style="text-align:left;">
            <b style="color:#fff; font-size:0.85rem;">${u.toUpperCase()} ${esRoot ? '<small style="color:#ffcc00">(ROOT)</small>' : ''}</b><br>
            <small style="color:${colorBorde}; font-size:0.65rem;">${etiqueta}</small>
        </div>
        <div style="display:flex; gap:10px;">
            <button onclick="prepararEdicionEditor('${u}', '${data.clave}', '${data.rol}')" style="background:rgba(0,204,255,0.1); border:1px solid #00ccff; color:#00ccff; padding:5px 8px; border-radius:6px;"><i class="fas fa-edit"></i></button>
            ${!esRoot ? `<button onclick="solicitarEliminarU('${u}')" style="background:rgba(255,68,68,0.1); border:1px solid #ff4444; color:#ff4444; padding:5px 8px; border-radius:6px;"><i class="fas fa-trash-alt"></i></button>` : ''}
        </div>
    </div>`;
}

function prepararEdicionEditor(u, clave, rol = 'editor') {
    document.getElementById('nuevo-usuario-nombre').value = u;
    document.getElementById('nuevo-usuario-clave').value = clave;
    if(document.getElementById('nuevo-usuario-rol')) document.getElementById('nuevo-usuario-rol').value = rol;
    document.getElementById('edit-user-original-name').value = u;
    document.getElementById('btn-crear-user').innerHTML = '<i class="fas fa-save"></i> ACTUALIZAR USUARIO';

    // Forzar que la clave sea visible al editar para que el Maestro la vea
    const passInput = document.getElementById('nuevo-usuario-clave');
    const eyeIcon = document.getElementById('toggle-editor-pass');
    passInput.type = "text";
    if(eyeIcon) eyeIcon.className = "fas fa-eye-slash";

    notificar("EDITANDO USUARIO: " + u.toUpperCase(), "info");
    window.scrollTo({top: document.getElementById('nuevo-usuario-nombre').offsetTop - 100, behavior:'smooth'});
}

function cargarSolicitudesAcceso() {
    const c = document.getElementById('lista-solicitudes-acceso'); if(!c) return;
    database.ref('personal_autorizado').on('value', s => {
        c.innerHTML = ""; const data = s.val() || {};
        Object.keys(data).forEach(id => {
            if(data[id].estado === 'pendiente') c.innerHTML += `<div class="user-item-modern" style="border-left-color:#f1c40f;"><span><b>${data[id].nombre}</b> (${id})</span><button onclick="procesarSolicitud('${id}', 'activo')" style="background:#2ecc71; color:white; border:none; padding:5px 10px; border-radius:5px; font-weight:bold;">OK</button></div>`;
        });
    });
}

function procesarSolicitud(id, estado) { database.ref('personal_autorizado/'+id+'/estado').set(estado).then(() => notificar("ID AUTORIZADO")); }

function crearNuevoEditor() {
    const nom = document.getElementById('nuevo-usuario-nombre').value.toLowerCase().trim();
    const cla = document.getElementById('nuevo-usuario-clave').value.trim();
    const rol = document.getElementById('nuevo-usuario-rol') ? document.getElementById('nuevo-usuario-rol').value : 'editor';
    const original = document.getElementById('edit-user-original-name').value;
    if(!nom || !cla) return;

    if(original && original !== nom) { database.ref('usuarios/'+original).remove(); }

    database.ref('usuarios/'+nom).set({ nombre: nom, clave: cla, rol: rol }).then(() => {
        notificar(original ? "USUARIO ACTUALIZADO" : "USUARIO CREADO");
        document.getElementById('nuevo-usuario-nombre').value="";
        document.getElementById('nuevo-usuario-clave').value="";
        document.getElementById('edit-user-original-name').value="";
        if(document.getElementById('nuevo-usuario-rol')) document.getElementById('nuevo-usuario-rol').value = 'editor';
        document.getElementById('btn-crear-user').innerHTML = '<i class="fas fa-user-plus"></i> GUARDAR USUARIO';
    });
}

function cargarListaPersonalAutorizado() {
    const c = document.getElementById('lista-personal-completa'); if(!c) return;
    database.ref('personal_autorizado').on('value', s => {
        const data = s.val() || {};
        c.innerHTML = "<h4 style='color:#ffcc00; font-size:0.75rem; margin-bottom:10px; margin-top:15px;'>PERSONAL CON ACCESO (LECTURA):</h4>";
        let hayActivos = false;
        Object.keys(data).forEach(id => {
            if(data[id].estado === 'activo') {
                hayActivos = true;
                c.innerHTML += `
                <div class="user-item-modern" style="border-left:4px solid #2ecc71; background:rgba(46,204,113,0.05); display:flex; justify-content:space-between; align-items:center; padding:12px; margin-bottom:8px; border-radius:12px;">
                    <div style="text-align:left;">
                        <b style="color:#fff; font-size:0.85rem;">${data[id].nombre}</b><br>
                        <small style="color:#aaa; font-family:monospace; font-size:0.7rem;">CÉDULA: ${id}</small>
                    </div>
                    <div style="display:flex; gap:10px;">
                        <button onclick="prepararEdicionAutorizado('${id}', '${data[id].nombre}')" style="background:rgba(0,204,255,0.1); border:1px solid #00ccff; color:#00ccff; padding:5px 8px; border-radius:6px;"><i class="fas fa-edit"></i></button>
                        <button onclick="eliminarAutorizado('${id}')" style="background:rgba(255,68,68,0.1); border:1px solid #ff4444; color:#ff4444; padding:5px 8px; border-radius:6px;"><i class="fas fa-trash-alt"></i></button>
                    </div>
                </div>`;
            }
        });
        if(!hayActivos) c.innerHTML += "<p style='color:#666; font-size:0.7rem; text-align:center;'>No hay personal registrado.</p>";
    });
}

function prepararEdicionAutorizado(id, nombre) {
    document.getElementById('nuevo-autorizado-id').value = id;
    document.getElementById('nuevo-autorizado-nombre').value = nombre;
    document.getElementById('edit-autorizado-original-id').value = id;
    document.getElementById('btn-crear-autorizado').innerHTML = '<i class="fas fa-save"></i> ACTUALIZAR PERSONAL';
    notificar("EDITANDO PERSONAL: " + nombre.toUpperCase(), "info");
}

function eliminarAutorizado(id) {
    if(confirm("¿Eliminar acceso a ID: "+id+"?")) {
        database.ref('personal_autorizado/'+id).remove().then(() => notificar("ACCESO ELIMINADO"));
    }
}

function crearNuevoAutorizado() {
    const id = document.getElementById('nuevo-autorizado-id').value.trim();
    const nom = document.getElementById('nuevo-autorizado-nombre').value.trim();
    const original = document.getElementById('edit-autorizado-original-id').value;
    if(!id || !nom) return;

    if(original && original !== id) { database.ref('personal_autorizado/'+original).remove(); }

    database.ref('personal_autorizado/'+id).set({ nombre: nom, estado: 'activo' }).then(() => {
        notificar(original ? "DATOS ACTUALIZADOS" : "ID REGISTRADO");
        document.getElementById('nuevo-autorizado-id').value="";
        document.getElementById('nuevo-autorizado-nombre').value="";
        document.getElementById('edit-autorizado-original-id').value="";
        document.getElementById('btn-crear-autorizado').innerHTML = 'GUARDAR PERSONAL';
    });
}

function cambiarClaveMaestra() {
    const nv = document.getElementById('nueva-clave-maestra').value.trim();
    if(!nv) return;
    database.ref('config/master_pass').set(nv).then(() => { localStorage.setItem('master_pass', nv); notificar("CLAVE ACTUALIZADA"); document.getElementById('nueva-clave-maestra').value=""; });
}

function publicarNuevaVersion() {
    const v = (VERSION_APP + 0.1).toFixed(1);
    database.ref('config/version').set(v).then(() => notificar("AVISO ENVIADO", "warning"));
}

// ================= UTILIDADES ==================
function notificar(msj, tipo = 'exito') {
    const msjUpper = msj.toUpperCase();
    const existentes = document.querySelectorAll('.toast-modern span');
    for (let a of existentes) { if (a.innerText === msjUpper) return; }
    let container = document.querySelector('.toast-container');
    if (!container) { container = document.createElement('div'); container.className = 'toast-container'; document.body.appendChild(container); }
    const toast = document.createElement('div'); toast.className = `toast-modern toast-${tipo === 'exito' ? 'success' : tipo}`;
    toast.innerHTML = `<i class="fas fa-info-circle"></i> <span>${msjUpper}</span>`;
    container.appendChild(toast);
    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 400); }, 1500);
}

function compartirApp() {
    const msj = "Descarga App U6 Planta Centro: " + LINK_DESCARGA_APK;
    if (typeof Android !== "undefined" && Android.shareApp) Android.shareApp(msj);
    else if (navigator.share) navigator.share({ title: 'App U6', text: msj, url: LINK_DESCARGA_APK });
    else notificar("LINK: " + LINK_DESCARGA_APK, "info");
}

function descargarApp() { if (typeof Android !== "undefined" && Android.downloadUpdate) Android.downloadUpdate(LINK_DESCARGA_APK); else window.open(LINK_DESCARGA_APK, '_blank'); }

function verificarActualizaciones() { if (database) database.ref('config/version').on('value', (s) => { if (parseFloat(s.val()) > VERSION_APP) { const btn = document.getElementById('btn-descargar-bienvenida'); if(btn) btn.style.display = 'inline-flex'; } }); }

// ================= CHAT IA ==================
function abrirChatIA() { document.getElementById('modal-chat-ia').style.display='flex'; }
function cerrarChatIA() { document.getElementById('modal-chat-ia').style.display='none'; }
function enviarPreguntaIA() {
    const inp = document.getElementById('input-pregunta-ia'); const msg = inp.value.trim(); if(!msg) return;
    const chat = document.getElementById('chat-mensajes'); chat.innerHTML += `<div class="mensaje-usuario">${msg}</div>`;
    inp.value = ""; setTimeout(() => { chat.innerHTML += `<div class="mensaje-ia">Soy tu asistente. Para la Unidad 6, recuerda que el vapor principal opera a 540°C y 160 bar.</div>`; chat.scrollTop = chat.scrollHeight; }, 1000);
}

// ================= INICIALIZACIÓN ==================
document.addEventListener('DOMContentLoaded', () => {
    conectarFirebase(); const area = localStorage.getItem('area_actual'); const role = localStorage.getItem('user_role');
    const cardOp = document.getElementById('card-operacion-especial'); if(cardOp) cardOp.style.display = (area === 'Operaciones') ? 'flex' : 'none';
    const btnIA = document.getElementById('btn-ia-flotante'); if(btnIA && (area === 'mecanico' || area === 'electricista')) btnIA.style.display = 'block';

    if(role === 'super' && document.getElementById('seccion-usuarios')) {
        document.getElementById('seccion-usuarios').style.display = 'block';
        cargarListaUsuarios(); cargarSolicitudesAcceso(); cargarListaPersonalAutorizado();
    }

    const a = document.getElementById('input-area'); if(a) { a.addEventListener('change', cargarEquiposEdicion); cargarEquiposEdicion(); }
    if(document.getElementById('input-manual-area')) { cargarManualParaEditar(); cargarPlanosEdicionGeneral(); cargarDocsEdicion(); }

    const fotoInput = document.getElementById('input-archivo-foto');
    if(fotoInput) {
        fotoInput.addEventListener('change', e => {
            const files = e.target.files;
            if(files.length + fotosBase64.length > 2) { notificar("MÁXIMO 2 FOTOS", "error"); return; }

            Array.from(files).forEach(f => {
                const r = new FileReader();
                r.onload = ev => {
                    fotosBase64.push(ev.target.result);
                    actualizarPreviewsFotos();
                };
                r.readAsDataURL(f);
            });
        });
    }
});

// Helpers Genéricos
function togglePasswordVisibility(id, icon) { const i = document.getElementById(id); const ic = document.getElementById(icon); if (i.type === "password") { i.type = "text"; ic.className = "fas fa-eye-slash"; } else { i.type = "password"; ic.className = "fas fa-eye"; } }
function limpiarFormulario() {
    tagOriginalEdicion = null;
    areaOriginalEdicion = null;
    fotosBase64 = [];
    ['input-tag','input-nombre','input-info','input-operacion','input-ubicacion'].forEach(id=>{ if(document.getElementById(id)) document.getElementById(id).value=""; });
    const txt = document.getElementById('nombre-archivo-seleccionado');
    if(txt) txt.innerText = "SELECCIONAR DE GALERÍA";
    actualizarPreviewsFotos();
}
function cerrarModalID() { document.getElementById('modal-id-acceso').style.display = 'none'; }
function volverAVerificar() { if(document.getElementById('wrapper-verificar-id')) document.getElementById('wrapper-verificar-id').style.display = 'block'; if(document.getElementById('wrapper-solicitar-acceso')) document.getElementById('wrapper-solicitar-acceso').style.display = 'none'; }
function descargarDocumento(b64, n) { if (typeof Android !== "undefined" && Android.saveFile) Android.saveFile(b64, n); else { const l = document.createElement('a'); l.href = b64; l.download = n; l.click(); } }
function validarAcceso() { document.getElementById('modal-login').style.display = 'flex'; }
function cerrarLogin() { document.getElementById('modal-login').style.display = 'none'; }
function abrirManual() { document.getElementById('modal-manual').style.display = 'flex'; }
function cerrarManual() { document.getElementById('modal-manual').style.display = 'none'; }
function cerrarModal() { if(document.getElementById('modal-info')) document.getElementById('modal-info').style.display = 'none'; }
function eliminarEquipo(a, t) {
    if (confirm("¿Borrar equipo " + t + "?")) {
        let colaDel = JSON.parse(localStorage.getItem('cola_eliminaciones') || "[]");
        colaDel.push({ area: a, tag: t });
        localStorage.setItem('cola_eliminaciones', JSON.stringify(colaDel));

        let colaEnv = JSON.parse(localStorage.getItem('cola_envios') || "[]");
        colaEnv = colaEnv.filter(i => !(i.tag === t && i.area === a));
        localStorage.setItem('cola_envios', JSON.stringify(colaEnv));

        notificar("ELIMINACIÓN PENDIENTE");
        cargarEquiposEdicion();
        sincronizarColas();
    }
}
function solicitarEliminarU(u) { if(confirm("¿Borrar editor "+u+"?")) { if(database) database.ref('usuarios/'+u).remove(); } }
function cargarParaEditar(j, area) {
    const eq = JSON.parse(decodeURIComponent(j));
    tagOriginalEdicion = eq.tag;
    areaOriginalEdicion = area;
    document.getElementById('input-tag').value = eq.tag;
    document.getElementById('input-nombre').value = eq.nombre;
    document.getElementById('input-info').value = eq.info || "";
    document.getElementById('input-operacion').value = eq.operacion || "";
    document.getElementById('input-ubicacion').value = eq.ubicacion || "";
    fotosBase64 = Array.isArray(eq.img) ? eq.img : (eq.img ? [eq.img] : []);
    actualizarPreviewsFotos();
    window.scrollTo({top:0, behavior:'smooth'});
}
function actualizarPreviewsFotos() {
    const c = document.getElementById('preview-container');
    const txt = document.getElementById('nombre-archivo-seleccionado');
    if(c) {
        c.innerHTML = "";
        fotosBase64.forEach((d, i) => {
            c.innerHTML += `
                <div style="position:relative; width:80px; height:80px;">
                    <img src="${d}" style="width:80px; height:80px; object-fit:cover; border-radius:8px; border:2px solid #ffcc00;">
                    <button onclick="eliminarFotoDePrevio(${i})" style="position:absolute; top:-8px; right:-8px; background:#ff4444; color:white; border:none; border-radius:50%; width:22px; height:22px; font-weight:bold; cursor:pointer; display:flex; align-items:center; justify-content:center; box-shadow: 0 2px 5px rgba(0,0,0,0.5); z-index:10;">×</button>
                </div>`;
        });
    }
    if(txt) {
        if(fotosBase64.length > 0) txt.innerText = fotosBase64.length + " FOTO(S) SELECCIONADA(S)";
        else txt.innerText = "SELECCIONAR DE GALERÍA";
    }
}

function eliminarFotoDePrevio(index) {
    fotosBase64.splice(index, 1);
    actualizarPreviewsFotos();
    notificar("FOTO REMOVIDA", "info");
}
function verImagenFull(src, tit) { const m = document.getElementById('modal-info'); const i = document.getElementById('info-tecnica'); if(m && i) { i.innerHTML = `<h2 style="color:#ffcc00;">${tit}</h2><img src="${src}" style="width:100%; border:1px solid #333;">`; m.style.display='flex'; } }
function cargarPlanosVista() { /* No longer needed */ }
