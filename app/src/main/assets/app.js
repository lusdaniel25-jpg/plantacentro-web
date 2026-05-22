// Configuración de Firebase - Planta Centro Unidad 6
const VERSION_APP = 1.0;

// --- SHIM DE COMPATIBILIDAD NAVEGADOR/PC ---
if (typeof Android === "undefined") {
    console.log("Detectado: Navegador Web (Simulando interfaz Android)");
    window.Android = {
        shareApp: function(text) {
            console.log("Compartir:", text);
            if(navigator.share) {
                navigator.share({ title: 'Planta Centro U6', text: text });
            } else {
                alert("Enlace copiado: " + text);
            }
        },
        downloadUpdate: function(url) { window.open(url, '_blank'); },
        saveFile: function(base64, fileName) {
            const link = document.createElement('a');
            link.href = base64;
            link.download = fileName;
            link.click();
        },
        createShortcut: function() { console.log("Accesos directos no disponibles en Web"); }
    };
}

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
let notificacionConexionMostrada = false;
let notificacionOfflineMostrada = false;
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
                    const role = sessionStorage.getItem('user_role') || 'LECTURA';
                    const user = sessionStorage.getItem('user_name') || 'Invitado';

                    if ((sessionStorage.getItem('user_role') || sessionStorage.getItem('user_name')) && !notificacionConexionMostrada) {
                        notificacionConexionMostrada = true;
                        notificacionOfflineMostrada = false;
                    }

                    // Actualizar indicadores visuales globales
                    document.querySelectorAll('.online-indicator').forEach(el => {
                        el.classList.remove('status-offline');
                        el.classList.add('status-online');
                        el.title = "SISTEMA EN LÍNEA";
                    });

                    // RASTREO DE PRESENCIA CON ÚLTIMA CONEXIÓN (MAESTROS Y ESTÁNDAR)
                    if (user !== 'Invitado') {
                        const role = sessionStorage.getItem('user_role');
                        let idRastreo = "";

                        // Si es Lector, usamos su Cédula. Si es Admin/Editor, usamos su nombre de usuario.
                        if (role === 'super' || role === 'editor') {
                            idRastreo = user.toLowerCase().trim();
                        } else {
                            // Si no hay rol, comprobamos si tiene un ID de lector guardado
                            const savedId = localStorage.getItem('user_id_std');
                            idRastreo = (savedId || user).toLowerCase().trim();
                        }

                        if (idRastreo) {
                            const presenceRef = database.ref('presencia/' + idRastreo);

                            // Limpiar cualquier onDisconnect previo para evitar duplicados
                            presenceRef.onDisconnect().cancel();

                            // Establecer estado ONLINE con marca de tiempo actual del servidor
                            presenceRef.update({
                                estado: 'online',
                                ultima: firebase.database.ServerValue.TIMESTAMP
                            });

                            // Programar estado OFFLINE cuando se pierda la conexión
                            presenceRef.onDisconnect().update({
                                estado: 'offline',
                                ultima: firebase.database.ServerValue.TIMESTAMP
                            });
                        }
                    }

                    verificarActualizaciones();
                    sincronizarColas();

                    // Sincronizar clave maestra desde la nube
                    database.ref('config/master_pass').on('value', s => {
                        if(s.val()) localStorage.setItem('master_pass', s.val());
                    });
                } else {
                    // Actualizar indicadores visuales globales
                    document.querySelectorAll('.online-indicator').forEach(el => {
                        el.classList.remove('status-online');
                        el.classList.add('status-offline');
                        el.title = "SISTEMA SIN CONEXIÓN";
                    });

                    if (!navigator.onLine && !notificacionOfflineMostrada) {
                        notificacionOfflineMostrada = true;
                        notificacionConexionMostrada = false; // Resetear para que avise al volver
                    }
                }
            });
            listenerConexionActivo = true;
        }
    }
}

function sincronizarColas() {
    if (!database) return;

    // Si no hay internet, Firebase guardará los cambios internamente (Persistencia Offline)
    // Pero forzamos la sincronización manual de nuestras colas de localStorage
    if (!navigator.onLine) {
        console.log("Sincronización en espera: Sin internet");
        return;
    }

    let colaEnv = JSON.parse(localStorage.getItem('cola_envios') || "[]");
    let colaDel = JSON.parse(localStorage.getItem('cola_eliminaciones') || "[]");

    // 1. PRIMERO PROCESAR ELIMINACIONES para evitar borrar lo que acabamos de agregar
    colaDel.forEach(q => {
        database.ref('equipos/' + q.area + '/' + q.tag).remove().then(() => {
            let actual = JSON.parse(localStorage.getItem('cola_eliminaciones') || "[]");
            actual = actual.filter(i => !(i.tag === q.tag && i.area === q.area));
            localStorage.setItem('cola_eliminaciones', JSON.stringify(actual));
            if(typeof cargarEquiposEdicion === 'function') cargarEquiposEdicion();
        });
    });

    // 2. LUEGO PROCESAR ENVÍOS
    colaEnv.forEach(q => {
        database.ref('equipos/' + q.area + '/' + q.tag).set(q).then(() => {
            let actual = JSON.parse(localStorage.getItem('cola_envios') || "[]");
            actual = actual.filter(i => !(i.tag === q.tag && i.area === q.area));
            localStorage.setItem('cola_envios', JSON.stringify(actual));
            notificar("REGISTRO EXITOSO: " + q.tag);
            if(typeof cargarEquiposEdicion === 'function') cargarEquiposEdicion();
        });
    });

    // Sincronizar Planos y Documentos (Mantenemos el orden estándar)
    let colaPlEnv = JSON.parse(localStorage.getItem('cola_planos_envios') || "[]");
    let colaPlDel = JSON.parse(localStorage.getItem('cola_planos_del') || "[]");
    let colaDocEnv = JSON.parse(localStorage.getItem('cola_docs_envios') || "[]");
    let colaDocDel = JSON.parse(localStorage.getItem('cola_docs_del') || "[]");

    colaPlEnv.forEach(q => {
        database.ref('planos/' + q.area + '/' + q.id).set(q.data).then(() => {
            let actual = JSON.parse(localStorage.getItem('cola_planos_envios') || "[]");
            actual = actual.filter(i => i.id !== q.id);
            localStorage.setItem('cola_planos_envios', JSON.stringify(actual));
            notificar("PLANO SINCRONIZADO: " + q.data.titulo);
            if(typeof cargarPlanosEdicionGeneral === 'function') cargarPlanosEdicionGeneral();
        });
    });
    colaPlDel.forEach(q => {
        database.ref('planos/' + q.area + '/' + q.id).remove().then(() => {
            let actual = JSON.parse(localStorage.getItem('cola_planos_del') || "[]");
            actual = actual.filter(i => i.id !== q.id);
            localStorage.setItem('cola_planos_del', JSON.stringify(actual));
            if(typeof cargarPlanosEdicionGeneral === 'function') cargarPlanosEdicionGeneral();
        });
    });

    // Sincronizar Documentos
    colaDocEnv.forEach(q => {
        database.ref('documentos/' + q.area + '/' + q.id).set(q.data).then(() => {
            let actual = JSON.parse(localStorage.getItem('cola_docs_envios') || "[]");
            actual = actual.filter(i => i.id !== q.id);
            localStorage.setItem('cola_docs_envios', JSON.stringify(actual));
            notificar("DOC SINCRONIZADO: " + q.data.titulo);
            if(typeof cargarDocsEdicion === 'function') cargarDocsEdicion();
        });
    });
    colaDocDel.forEach(q => {
        database.ref('documentos/' + q.area + '/' + q.id).remove().then(() => {
            let actual = JSON.parse(localStorage.getItem('cola_docs_del') || "[]");
            actual = actual.filter(i => i.id !== q.id);
            localStorage.setItem('cola_docs_del', JSON.stringify(actual));
            if(typeof cargarDocsEdicion === 'function') cargarDocsEdicion();
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

    // Casos especiales (Maestro o Usuarios Locales)
    if (id.toLowerCase() === 'luis' || id === masterPass || id === "6969") {
        sessionStorage.setItem('user_name', 'Luis');
        entrarArea(areaSeleccionadaPaso);
        return;
    }

    let esAdminLocal = false;
    Object.keys(localUsers).forEach(u => { if (id.toLowerCase() === u || id === localUsers[u].clave) esAdminLocal = true; });
    if (esAdminLocal) {
        sessionStorage.setItem('user_name', id);
        entrarArea(areaSeleccionadaPaso);
        return;
    }

    if (database && navigator.onLine) {
        database.ref('personal_autorizado/' + id).once('value').then(s => {
            const u = s.val();
            if (u && u.estado === 'activo') {
                sessionStorage.setItem('user_name', u.nombre);
                localStorage.setItem('user_id_std', id); // Guardar ID para rastreo
                entrarArea(areaSeleccionadaPaso);
                return;
            }
            database.ref('usuarios').once('value').then(snap => {
                const users = snap.val() || {};
                let esAdminNube = false;
                Object.keys(users).forEach(uname => { if (id.toLowerCase() === uname || id === users[uname].clave) esAdminNube = true; });
                if (esAdminNube) {
                    sessionStorage.setItem('user_name', id);
                    entrarArea(areaSeleccionadaPaso);
                } else {
                    const msg = document.getElementById('msg-error-id');
                    if(msg) {
                        msg.innerText = (u && u.estado === 'pendiente') ? "ESPERA APROBACIÓN DEL ADMINISTRADOR" : "ID NO REGISTRADO EN EL SISTEMA";
                        msg.style.display = 'block';
                        msg.style.background = "rgba(255, 68, 68, 0.15)";
                        msg.style.borderColor = "#ff4444";
                        msg.style.color = "#ff4444";

                        if (u && u.estado === 'pendiente') {
                            msg.style.background = "rgba(255, 204, 0, 0.15)";
                            msg.style.borderColor = "#ffcc00";
                            msg.style.color = "#ffcc00";
                            localStorage.setItem('esperando_aprobacion', id);
                            escucharEstadoSolicitud(id);
                        }
                    }
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
            localStorage.removeItem('user_id_std'); // LIMPIAR ID DE LECTOR PARA EVITAR CONFLICTOS DE PRESENCIA
            sessionStorage.setItem('user_role', 'super');
            sessionStorage.setItem('user_name', 'Luis');
            setTimeout(() => { window.location.replace("admin.html"); }, 600);
            return;
        } else {
            notificar("CLAVE MAESTRA INCORRECTA", "error");
            return;
        }
    }

    // Lógica para usuarios locales (Caché offline)
    if (localUsers[u] && localUsers[u].clave === p) {
        localStorage.removeItem('user_id_std'); // LIMPIAR ID DE LECTOR
        sessionStorage.setItem('user_role', localUsers[u].rol);
        sessionStorage.setItem('user_name', u);
        window.location.replace("admin.html");
        return;
    }

    // Lógica para usuarios en la nube
    if(database && navigator.onLine) {
        database.ref('usuarios/'+u).once('value').then(s => {
            const d = s.val();
            if(d && d.clave === p) {
                localStorage.removeItem('user_id_std'); // LIMPIAR ID DE LECTOR
                localUsers[u] = d;
                localStorage.setItem('user_db', JSON.stringify(localUsers));
                sessionStorage.setItem('user_role', d.rol);
                sessionStorage.setItem('user_name', u);
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

function entrarArea(area) {
    localStorage.setItem('area_actual', area);
    sessionStorage.setItem('area_actual', area); // Sincronizar ambos para seguridad
    window.location.href = "index.html";
}

// ================= HMI OPERACIONES Y GRÁFICA ==================
function abrirSeccionOperacion() {
    document.getElementById('modal-operacion-especial').style.display = 'flex';
    cargarDatosOperacion();
    actualizarInterfazConversor(); // Inicializar calculadora
    setTimeout(() => dibujarCurvaArranque(0), 300);
}
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
        const cacheRaw = localStorage.getItem('cache_' + sistema);
        let cache = {};
        try {
            cache = JSON.parse(cacheRaw || "{}");
        } catch(e) { cache = {}; }

        let combinados = {};
        // Normalizar cache: asegurar que cada objeto tenga su tag
        if (cache && typeof cache === 'object') {
            Object.keys(cache).forEach(k => {
                const item = cache[k];
                if (item) {
                    combinados[k] = { ...item, tag: item.tag || k };
                }
            });
        }

        let colaEnv = JSON.parse(localStorage.getItem('cola_envios') || "[]");
        colaEnv.filter(q => q.area === sistema).forEach(q => { combinados[q.tag] = q; });
        let colaDel = JSON.parse(localStorage.getItem('cola_eliminaciones') || "[]");
        colaDel.filter(q => q.area === sistema).forEach(q => { delete combinados[q.tag]; });

        let finalMap = new Map();
        (DATOS_PLANTA[sistema] || []).forEach(eq => { if(eq.tag) finalMap.set(eq.tag, eq); });
        Object.values(combinados).forEach(eq => { if(eq.tag) finalMap.set(eq.tag, eq); });

        equiposActuales = Array.from(finalMap.values());
        dibujarEquipos(equiposActuales);
    };
    renderLocal();
    if (database && navigator.onLine) database.ref('equipos/' + sistema).on('value', (s) => {
        const val = s.val();
        localStorage.setItem('cache_' + sistema, JSON.stringify(val || {}));
        renderLocal();
    });
}

function dibujarEquipos(equipos) {
    const c = document.getElementById('mapa-equipos'); if(!c) return; c.innerHTML = "";
    if (equipos.length === 0) { c.innerHTML = "<p class='mensaje'>Sin registros.</p>"; return; }
    equipos.forEach(eq => { let n = document.createElement('div'); n.className = "equipo-nodo"; n.onclick = () => verFicha(eq); n.innerHTML = `<i class="fas ${eq.icono || 'fa-cog'} fa-2x"></i><br><span>${eq.nombre}</span>`; c.appendChild(n); });
}

function verFicha(eq) {
    let imgH = ""; let imgs = Array.isArray(eq.img) ? eq.img : (eq.img ? [eq.img] : []);
    imgs.forEach(i => imgH += `<img src="${i}" style="width:100%; border-radius:12px; border:2px solid #ffcc00; margin-top:15px; box-shadow: 0 4px 10px rgba(0,0,0,0.5);">`);

    const operacionH = eq.operacion ? `<div style="background:rgba(0,255,204,0.05); padding:12px; border-radius:10px; border-left:4px solid #00ffcc; margin-top:20px;"><h4 style="color:#00ffcc; margin-top:0; font-size:0.8rem; letter-spacing:1px;"><i class="fas fa-clipboard-check"></i> PROTOCOLO DE OPERACIÓN:</h4><p style="font-size:0.85rem; white-space:pre-wrap; color:#eee; margin-bottom:0; line-height:1.4;">${eq.operacion}</p></div>` : "";
    const infoH = eq.info ? `<div style="margin-top:15px; color:#ddd; font-size:0.9rem; line-height:1.5;">${eq.info}</div>` : "";
    const registroH = eq.editado_por ? `<p style="font-size:0.65rem; color:#666; margin-top:20px; border-top:1px solid #333; padding-top:12px; text-align:right;"><i class="fas fa-history"></i> ACTUALIZADO: ${eq.fecha_edicion} por ${eq.editado_por.toUpperCase()}</p>` : "";

    document.getElementById('info-tecnica').innerHTML = `
        <h2 style="color:#ffcc00; margin-bottom:5px;">${eq.nombre}</h2>
        <p style="color:#00ccff; font-family:monospace; font-size:0.9rem; margin-bottom:15px;">TAG: ${eq.tag}</p>
        <div style="background:rgba(255,255,255,0.03); padding:10px; border-radius:8px; margin-bottom:15px;">
            <p style="margin:0; font-size:0.8rem;"><b>UBICACIÓN:</b> <span style="color:#ffcc00;">${eq.ubicacion || 'Planta Centro'}</span></p>
        </div>
        ${infoH}
        ${operacionH}
        ${imgH}
        ${registroH}`;
    document.getElementById('modal-info').style.display = 'flex';
}

function filtrarPorTexto() {
    const txt = document.getElementById('input-busqueda').value.toLowerCase().trim();
    const filtrados = equiposActuales.filter(e =>
        (e.nombre && e.nombre.toLowerCase().includes(txt)) ||
        (e.tag && e.tag.toLowerCase().includes(txt))
    );
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
            const p = combinados[id];
            lista.innerHTML += `<div class="plano-item-card"><h4>${p.titulo}</h4>${p.autor ? `<small style="color:#aaa; display:block; margin-bottom:5px; font-size:0.6rem;">SUBIDO POR: ${p.autor.toUpperCase()}</small>` : ''}<img src="${p.foto}" onclick="verImagenFull('${p.foto}', '${p.titulo}')"></div>`;
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
        let combinados = {};

        // Normalizar cache asegurando que cada objeto tenga su tag (la llave)
        Object.keys(cache).forEach(k => {
            combinados[k] = { ...cache[k], tag: cache[k].tag || k };
        });

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
                            ${eq.editado_por ? `<br><small style="color:#00ccff; font-size:0.6rem;"><i class="fas fa-user"></i> ${eq.editado_por.toUpperCase()}</small> <small style="color:#666; font-size:0.6rem;">(${eq.fecha_edicion})</small>` : ''}
                            ${(!navigator.onLine && colaEnv.some(q=>q.tag===eq.tag && q.area===area)) ? '<br><small style="color:#ffcc00; font-size:0.6rem;">(PENDIENTE DE SUBIDA)</small>' : ''}
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

    // VALIDACIÓN DE DUPLICADOS GLOBAL
    const areas = ["auxiliares", "turbina", "ciclo", "caldera", "calderas_auxiliares", "externas", "instrumentacion", "contra_incendio"];
    const colaEnv = JSON.parse(localStorage.getItem('cola_envios') || "[]");
    const colaDel = JSON.parse(localStorage.getItem('cola_eliminaciones') || "[]");

    let duplicadoEnArea = null;

    for (const a of areas) {
        try {
            const cacheRaw = localStorage.getItem('cache_' + a);
            if (!cacheRaw || cacheRaw === "undefined" || cacheRaw === "null") continue;

            const cacheArea = JSON.parse(cacheRaw);
            const equiposArea = Object.entries(cacheArea).map(([t, e]) => ({ ...e, tag: e.tag || t }));

            // Añadir los que están en cola de envío para esta área (si no están ya)
            colaEnv.filter(e => e.area === a).forEach(e => {
                if (!equiposArea.some(x => x.tag === e.tag)) equiposArea.push(e);
            });

            const conflicto = equiposArea.find(e => {
                const eTag = (e.tag || "").toString().trim().toUpperCase();

                // 1. IGNORAR si es el equipo que estamos editando exactamente
                if (tagOriginalEdicion && areaOriginalEdicion) {
                    if (eTag === tagOriginalEdicion.toString().trim().toUpperCase() && a === areaOriginalEdicion) {
                        return false;
                    }
                }

                // 2. IGNORAR si este registro encontrado está marcado para ser eliminado
                if (colaDel.some(d => d.tag === eTag && d.area === a)) return false;

                // 3. COMPARAR TAG
                if (eTag === tag) return true;

                // 4. COMPARAR NOMBRE
                if (e.nombre && e.nombre.toLowerCase().trim() === nombre.toLowerCase().trim()) return true;

                return false;
            });

            if (conflicto) {
                duplicadoEnArea = a;
                break;
            }
        } catch (e) { console.error("Error validando área " + a, e); }
    }

    if (duplicadoEnArea) {
        notificar(`ERROR: EL EQUIPO YA EXISTE EN EL ÁREA: ${duplicadoEnArea.toUpperCase()}`, "error");
        return;
    }

    const autor = sessionStorage.getItem('user_name') || 'Desconocido';
    const fecha = new Date().toLocaleString();

    const equipo = {
        tag, nombre, info, operacion, ubicacion,
        img: fotosBase64, area: area,
        editado_por: autor,
        fecha_edicion: fecha
    };

    let colaActualizada = JSON.parse(localStorage.getItem('cola_envios') || "[]");
    colaActualizada = colaActualizada.filter(i => !(i.tag === tag && i.area === area));
    colaActualizada.push(equipo);
    localStorage.setItem('cola_envios', JSON.stringify(colaActualizada));

    // LIMPIAR DE LA COLA DE ELIMINACIÓN SI SE ESTÁ RE-AGREGANDO
    let colaDelActualizada = JSON.parse(localStorage.getItem('cola_eliminaciones') || "[]");
    colaDelActualizada = colaDelActualizada.filter(i => !(i.tag === tag && i.area === area));
    localStorage.setItem('cola_eliminaciones', JSON.stringify(colaDelActualizada));

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

    // VALIDACIÓN DE DUPLICADOS EN PLANOS
    const cachePl = JSON.parse(localStorage.getItem('cache_planos_' + area) || "{}");
    const colaPl = JSON.parse(localStorage.getItem('cola_planos_envios') || "[]");
    const existePl = Object.values(cachePl).find(p => p.titulo.toLowerCase() === tit.toLowerCase()) ||
                    colaPl.find(p => p.area === area && p.data.titulo.toLowerCase() === tit.toLowerCase());

    if (existePl) { notificar("YA EXISTE UN PLANO CON ESE TÍTULO EN ESTA ÁREA", "error"); return; }

    const reader = new FileReader();
    reader.onload = (e) => {
        const id = "plano_" + Date.now();
        const autor = sessionStorage.getItem('user_name') || 'Desconocido';
        const fecha = new Date().toLocaleString();
        const data = { titulo: tit, foto: e.target.result, autor: autor, fecha: fecha };

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
        const autor = sessionStorage.getItem('user_name') || 'Desconocido';
        const fecha = new Date().toLocaleString();
        const ext = file.name.split('.').pop();
        const data = { titulo: tit, archivo: e.target.result, extension: ext, autor: autor, fecha: fecha };

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

    let usuariosData = {};
    let presenciaData = {};

    const render = () => {
        l.innerHTML = "";
        const us = {...usuariosData};
        const pr = presenciaData;

        if(!us['luis']) {
            us['luis'] = { nombre: 'luis', clave: localStorage.getItem('master_pass') || 'luis2026', rol: 'super' };
        }

        const maestros = Object.keys(us).filter(u => us[u].rol === 'super');
        const editores = Object.keys(us).filter(u => us[u].rol !== 'super');

        if(maestros.length > 0) {
            l.innerHTML += "<h4 style='color:#ff4444; font-size:0.75rem; margin-bottom:10px; margin-top:15px;'><i class='fas fa-crown'></i> MAESTROS (ACCESO TOTAL):</h4>";
            maestros.forEach(u => {
                const searchKey = u.toLowerCase().trim();
                l.innerHTML += generarItemUsuario(u, us[u], pr[searchKey]);
            });
        }

        if(editores.length > 0) {
            l.innerHTML += "<h4 style='color:#2ecc71; font-size:0.75rem; margin-bottom:10px; margin-top:15px;'><i class='fas fa-user-edit'></i> EDITORES TÉCNICOS:</h4>";
            editores.forEach(u => {
                const searchKey = u.toLowerCase().trim();
                l.innerHTML += generarItemUsuario(u, us[u], pr[searchKey]);
            });
        }
    };

    database.ref('usuarios').on('value', s => {
        usuariosData = s.val() || {};
        render();
    });

    database.ref('presencia').on('value', s => {
        presenciaData = s.val() || {};
        render();
    });
}

function generarItemUsuario(u, data, presenceObj) {
    const esMaestro = data.rol === 'super';
    const colorBorde = esMaestro ? '#ff4444' : '#2ecc71';
    const colorFondo = esMaestro ? 'rgba(255,68,68,0.05)' : 'rgba(46,204,113,0.05)';
    const etiqueta = esMaestro ? 'MAESTRO / ADMINISTRADOR' : 'EDITOR TÉCNICO';
    const esRoot = u === 'luis';

    const estado = (presenceObj && presenceObj.estado) ? presenceObj.estado : 'offline';
    const ultima = (presenceObj && presenceObj.ultima) ? presenceObj.ultima : null;

    // Clase del punto según estado
    const statusClass = estado === 'online' ? 'status-online' : 'status-offline';

    let infoConexion = "";
    if (estado === 'online') {
        infoConexion = '<small style="color:#2ecc71; font-weight:bold;"><i class="fas fa-circle" style="font-size:0.5rem;"></i> EN LÍNEA AHORA</small>';
    } else if (ultima) {
        const d = new Date(ultima);
        const hoy = new Date();
        const esHoy = d.toDateString() === hoy.toDateString();

        const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const dateStr = esHoy ? "Hoy" : d.toLocaleDateString([], { day: '2-digit', month: '2-digit' });

        infoConexion = `<small style="color:#888;">Última vez: ${dateStr} ${timeStr}</small>`;
    } else {
        infoConexion = '<small style="color:#666;">Sin actividad reciente</small>';
    }

    return `
    <div class="user-item-modern" style="border-left:4px solid ${colorBorde}; background:${colorFondo}; display:flex; justify-content:space-between; align-items:center; padding:12px; margin-bottom:8px; border-radius:12px;">
        <div style="text-align:left; display: flex; align-items: center; gap: 10px;">
            <div class="status-dot ${statusClass}"></div>
            <div>
                <b style="color:#fff; font-size:0.85rem;">${u.toUpperCase()} ${esRoot ? '<small style="color:#ffcc00">(ROOT)</small>' : ''}</b><br>
                ${infoConexion}<br>
                <small style="color:${colorBorde}; font-size:0.65rem;">${etiqueta}</small>
            </div>
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

let totalPendientesGlobal = 0;
let solicitudesVigilanteActivo = false;

function cargarSolicitudesAcceso() {
    const c = document.getElementById('lista-solicitudes-acceso');
    if (!database) return;

    database.ref('personal_autorizado').on('value', s => {
        const data = s.val() || {};
        let count = 0;
        let html = "";

        Object.keys(data).forEach(id => {
            if(data[id].estado === 'pendiente') {
                count++;
                html += `
                <div class="user-item-modern" style="border-left-color:#f1c40f; display: flex; justify-content: space-between; align-items: center; padding: 12px; margin-bottom: 8px;">
                    <span><b>${data[id].nombre}</b> (${id})</span>
                    <div style="display: flex; gap: 8px;">
                        <button onclick="procesarSolicitud('${id}', 'activo')" style="background:#2ecc71; color:white; border:none; padding:8px 12px; border-radius:6px; font-weight:bold; cursor:pointer;">
                            <i class="fas fa-check"></i> OK
                        </button>
                        <button onclick="denegarSolicitud('${id}')" style="background:#ff4444; color:white; border:none; padding:8px 12px; border-radius:6px; font-weight:bold; cursor:pointer;">
                            <i class="fas fa-times"></i> NO
                        </button>
                    </div>
                </div>`;
            }
        });

        if(c) c.innerHTML = html || "<p style='color:#666; font-size:0.75rem; text-align:center;'>No hay solicitudes pendientes.</p>";

        // NOTIFICACIÓN ACTIVA PARA EL MAESTRO
        if (solicitudesVigilanteActivo && count > totalPendientesGlobal) {
            notificar(`NUEVA SOLICITUD: ${count} PENDIENTE(S)`, "warning");
            if (navigator.vibrate) navigator.vibrate([100, 50, 100]); // Vibración doble
        }

        totalPendientesGlobal = count;
        solicitudesVigilanteActivo = true;
    });
}

function procesarSolicitud(id, estado) {
    database.ref('personal_autorizado/'+id+'/estado').set(estado);
}

function denegarSolicitud(id) {
    if(confirm("¿Deseas denegar y eliminar esta solicitud de acceso?")) {
        database.ref('personal_autorizado/'+id).remove().then(() => notificar("SOLICITUD ELIMINADA", "error"));
    }
}

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

    let personalData = {};
    let presenciaData = {};

    const render = () => {
        const data = personalData;
        const pr = presenciaData;
        c.innerHTML = "<h4 style='color:#ffcc00; font-size:0.75rem; margin-bottom:10px; margin-top:15px;'>PERSONAL CON ACCESO (LECTURA):</h4>";
        let hayActivos = false;

        Object.keys(data).forEach(id => {
            if(data[id].estado === 'activo') {
                hayActivos = true;
                const searchKey = id.toString().toLowerCase().trim();
                const pres = (pr && pr[searchKey]) ? pr[searchKey] : { estado: 'offline', ultima: null };
                const statusClass = pres.estado === 'online' ? 'status-online' : 'status-offline';

                let infoConexion = "";
                if (pres.estado === 'online') {
                    infoConexion = '<small style="color:#2ecc71; font-weight:bold;"><i class="fas fa-circle" style="font-size:0.5rem;"></i> EN LÍNEA</small>';
                } else if (pres.ultima) {
                    const d = new Date(pres.ultima);
                    const hoy = new Date();
                    const esHoy = d.toDateString() === hoy.toDateString();
                    const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    const dateStr = esHoy ? "Hoy" : d.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
                    infoConexion = `<small style="color:#888;">Última vez: ${dateStr} ${timeStr}</small>`;
                } else {
                    infoConexion = '<small style="color:#666;">Sin registro</small>';
                }

                c.innerHTML += `
                <div class="user-item-modern" style="border-left:4px solid #2ecc71; background:rgba(46,204,113,0.05); display:flex; justify-content:space-between; align-items:center; padding:12px; margin-bottom:8px; border-radius:12px;">
                    <div style="text-align:left; display: flex; align-items: center; gap: 10px;">
                        <div class="status-dot ${statusClass}"></div>
                        <div>
                            <b style="color:#fff; font-size:0.85rem;">${data[id].nombre}</b><br>
                            ${infoConexion}<br>
                            <small style="color:#aaa; font-family:monospace; font-size:0.7rem;">CÉDULA: ${id}</small>
                        </div>
                    </div>
                    <div style="display:flex; gap:10px;">
                        <button onclick="prepararEdicionAutorizado('${id}', '${data[id].nombre}')" style="background:rgba(0,204,255,0.1); border:1px solid #00ccff; color:#00ccff; padding:5px 8px; border-radius:6px;"><i class="fas fa-edit"></i></button>
                        <button onclick="eliminarAutorizado('${id}')" style="background:rgba(255,68,68,0.1); border:1px solid #ff4444; color:#ff4444; padding:5px 8px; border-radius:6px;"><i class="fas fa-trash-alt"></i></button>
                    </div>
                </div>`;
            }
        });
        if(!hayActivos) c.innerHTML += "<p style='color:#666; font-size:0.7rem; text-align:center;'>No hay personal registrado.</p>";
    };

    database.ref('personal_autorizado').on('value', s => {
        personalData = s.val() || {};
        render();
    });

    database.ref('presencia').on('value', s => {
        presenciaData = s.val() || {};
        render();
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

    // Lanzar notificación nativa de Android si está disponible
    if (typeof Android !== "undefined" && Android.showNativeNotification) {
        Android.showNativeNotification("PLANTA CENTRO U6", msjUpper);
    }

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
    // Android
    if (typeof Android !== "undefined" && Android.shareApp) {
        Android.shareApp(msj);
    }
    // iOS (Capacitor/Native)
    else if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.share) {
        window.webkit.messageHandlers.share.postMessage(msj);
    }
    // Windows / Web Standard
    else if (navigator.share) {
        navigator.share({ title: 'App U6', text: msj, url: LINK_DESCARGA_APK });
    } else {
        notificar("LINK: " + LINK_DESCARGA_APK, "info");
    }
}

function descargarApp() {
    if (typeof Android !== "undefined" && Android.downloadUpdate) {
        Android.downloadUpdate(LINK_DESCARGA_APK);
    } else {
        window.open(LINK_DESCARGA_APK, '_blank');
    }
}

function cerrarSesion() {
    sessionStorage.clear();
    // Limpiamos también localStorage por si quedaron rastros antiguos
    localStorage.removeItem('user_role');
    localStorage.removeItem('user_name');
    notificar("SESIÓN CERRADA", "info");
    setTimeout(() => { window.location.replace("bienvenida.html"); }, 800);
}

function verificarActualizaciones() { if (database) database.ref('config/version').on('value', (s) => { if (parseFloat(s.val()) > VERSION_APP) { const btn = document.getElementById('btn-descargar-bienvenida'); if(btn) btn.style.display = 'inline-flex'; } }); }


// ================= ANALIZADOR TÉCNICO AVANZADO DE RENDIMIENTO Y RIESGO METALÚRGICO ==================
function analizarRendimiento() {
    const tiempo = parseFloat(document.getElementById('calc-tiempo').value) || 0;
    const mw = parseFloat(document.getElementById('calc-mw').value) || 0;
    const fuel = parseFloat(document.getElementById('calc-fuel').value) || 0;
    const pres = parseFloat(document.getElementById('calc-presion').value) || 0;
    const temp = parseFloat(document.getElementById('calc-temp').value) || 0;
    const vacio = parseFloat(document.getElementById('calc-vacio').value) || 0;

    if (tiempo === 0 && mw <= 0) {
        notificar("INGRESE TIEMPO O CARGA", "error");
        return;
    }

    // --- CÁLCULOS TERMODINÁMICOS ---
    const pci = 10200;
    const eficiencia = mw > 0 ? ((mw * 860) / (fuel * pci)) * 100 : 0;

    let reporte = "";
    let criticidad = "normal";
    let colorHex = "#00ffcc";

    // --- ANÁLISIS DE FASE DE ARRANQUE ---
    let faseActual = "ESTABILIZACIÓN";
    if (tiempo < 30) faseActual = "RODADO / CALENTAMIENTO";
    else if (tiempo >= 30 && tiempo < 60) faseActual = "PRE-SINCRONIZACIÓN";
    else if (mw > 0 && mw < 580) faseActual = "SUBIDA DE CARGA";
    else if (mw >= 580) faseActual = "OPERACIÓN NOMINAL";

    // --- EVALUACIÓN DE RIESGOS METALÚRGICOS ---
    if (temp > 545 && temp <= 555) {
        reporte += "⚠️ <b>FATIGA TÉRMICA:</b> Temperatura elevada. Estrés en sobrecalentadores.<br>";
        criticidad = "alerta"; colorHex = "#ffcc00";
    } else if (temp > 555) {
        reporte += "🚨 <b>PELIGRO CREEP:</b> Operación en zona de fluencia. Riesgo de rotura inminente.<br>";
        criticidad = "peligro"; colorHex = "#ff0000";
    }

    if (vacio > 85) {
        reporte += "☢️ <b>VIBRACIÓN TURBINA:</b> Vacío degradado. Peligro para álabes de LP.<br>";
        criticidad = "peligro"; colorHex = "#ff0000";
    }

    if (reporte === "") reporte = "✅ <b>SISTEMA DENTRO DE CURVA:</b> No se detectan riesgos estructurales.";

    // --- ACTUALIZAR UI ---
    const resDiv = document.getElementById('diagnostico-rendimiento');
    const resEfi = document.getElementById('res-eficiencia');
    const resDiag = document.getElementById('res-diagnostico');

    resDiv.style.display = 'block';
    resDiv.style.borderLeft = `5px solid ${colorHex}`;
    resEfi.innerHTML = mw > 0 ? `EFICIENCIA η: ${eficiencia.toFixed(2)}%` : `ARRANQUE EN PROGRESO`;
    resEfi.style.color = colorHex;
    resDiag.innerHTML = `<b>FASE: ${faseActual}</b><br>${reporte}`;

    dibujarGraficaArranqueCompleta(tiempo, mw, temp, criticidad);
    notificar("ANÁLISIS DE ARRANQUE REALIZADO", "exito");
}

// ================= CALCULADORA DE CONVERSIÓN TÉCNICA ==================
function actualizarInterfazConversor() {
    const tipo = document.getElementById('conv-tipo').value;
    const cont = document.getElementById('inputs-conversor');
    if(!cont) return;
    cont.innerHTML = "";

    const configs = {
        presion: [
            { id: 'c-bar', label: 'BAR (kg/cm²)', unit: 'bar' },
            { id: 'c-psi', label: 'PSI (lb/in²)', unit: 'psi' },
            { id: 'c-mpa', label: 'MegaPascales (MPa)', unit: 'mpa' },
            { id: 'c-pa', label: 'KiloPascales (kPa)', unit: 'kpa' },
            { id: 'c-mbar', label: 'mbar (Vacío)', unit: 'mbar' }
        ],
        temp: [
            { id: 'c-celsius', label: 'Celsius (°C)', unit: 'c' },
            { id: 'c-faren', label: 'Fahrenheit (°F)', unit: 'f' },
            { id: 'c-kelvin', label: 'Kelvin (K)', unit: 'k' }
        ],
        flujo: [
            { id: 'c-th', label: 'Toneladas/Hora (t/h)', unit: 'th' },
            { id: 'c-kgs', label: 'Kilogramos/Seg (kg/s)', unit: 'kgs' },
            { id: 'c-lbh', label: 'Libras/Hora (lb/h)', unit: 'lbh' }
        ],
        potencia: [
            { id: 'c-mw', label: 'MegaWatts (MW)', unit: 'mw' },
            { id: 'c-kw', label: 'KiloWatts (kW)', unit: 'kw' },
            { id: 'c-hp', label: 'Caballos (HP)', unit: 'hp' },
            { id: 'c-btu', label: 'BTU/h', unit: 'btu' }
        ]
    };

    configs[tipo].forEach(conf => {
        cont.innerHTML += `
            <div>
                <label style="font-size: 0.55rem; color: #aaa;">${conf.label}:</label>
                <input type="number" id="${conf.id}" placeholder="0" oninput="ejecutarConversion('${conf.unit}', this.value)" style="padding: 8px; font-size: 0.85rem; border-color: rgba(255,204,0,0.3);">
            </div>`;
    });
}

function ejecutarConversion(unidad, val) {
    const v = parseFloat(val);
    if (isNaN(v)) return;

    const tipo = document.getElementById('conv-tipo').value;

    if (tipo === 'presion') {
        let bar = 0;
        if (unidad === 'bar') bar = v;
        if (unidad === 'psi') bar = v * 0.0689476;
        if (unidad === 'mbar') bar = v / 1000;
        if (unidad === 'kpa') bar = v / 100;
        if (unidad === 'mpa') bar = v * 10;

        document.getElementById('c-bar').value = unidad === 'bar' ? val : bar.toFixed(4);
        document.getElementById('c-psi').value = unidad === 'psi' ? val : (bar / 0.0689476).toFixed(2);
        document.getElementById('c-mbar').value = unidad === 'mbar' ? val : (bar * 1000).toFixed(2);
        document.getElementById('c-pa').value = unidad === 'kpa' ? val : (bar * 100).toFixed(2);
        if(document.getElementById('c-mpa')) document.getElementById('c-mpa').value = unidad === 'mpa' ? val : (bar / 10).toFixed(4);
    }
    else if (tipo === 'temp') {
        let c = 0;
        if (unidad === 'c') c = v;
        if (unidad === 'f') c = (v - 32) * 5/9;
        if (unidad === 'k') c = v - 273.15;

        document.getElementById('c-celsius').value = unidad === 'c' ? val : c.toFixed(2);
        document.getElementById('c-faren').value = unidad === 'f' ? val : (c * 9/5 + 32).toFixed(2);
        document.getElementById('c-kelvin').value = unidad === 'k' ? val : (c + 273.15).toFixed(2);
    }
    else if (tipo === 'flujo') {
        let th = 0;
        if (unidad === 'th') th = v;
        if (unidad === 'kgs') th = v * 3.6;
        if (unidad === 'lbh') th = v * 0.000453592;

        document.getElementById('c-th').value = unidad === 'th' ? val : th.toFixed(3);
        document.getElementById('c-kgs').value = unidad === 'kgs' ? val : (th / 3.6).toFixed(3);
        document.getElementById('c-lbh').value = unidad === 'lbh' ? val : (th / 0.000453592).toFixed(2);
    }
    else if (tipo === 'potencia') {
        let mw = 0;
        if (unidad === 'mw') mw = v;
        if (unidad === 'kw') mw = v / 1000;
        if (unidad === 'hp') mw = v * 0.0007457;
        if (unidad === 'btu') mw = v * 0.000000293071;

        document.getElementById('c-mw').value = unidad === 'mw' ? val : mw.toFixed(4);
        document.getElementById('c-kw').value = unidad === 'kw' ? val : (mw * 1000).toFixed(2);
        document.getElementById('c-hp').value = unidad === 'hp' ? val : (mw / 0.0007457).toFixed(2);
        document.getElementById('c-btu').value = unidad === 'btu' ? val : (mw / 0.000000293071).toFixed(2);
    }
}

function dibujarGraficaArranqueCompleta(t, mw, temp, criticidad) {
    const canvas = document.getElementById('grafica-arranque');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr; canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);
    const w = rect.width; const h = rect.height;
    const padL = 50; const padB = 40;
    const gW = w - padL - 20; const gH = h - padB - 20;

    ctx.clearRect(0, 0, w, h);

    // 1. ZONAS DE SEGURIDAD (Background)
    ctx.fillStyle = "rgba(255, 0, 0, 0.1)"; // Zona de Peligro
    ctx.fillRect(padL, 20, gW, gH * 0.3);
    ctx.fillStyle = "rgba(255, 204, 0, 0.05)"; // Zona Alerta
    ctx.fillRect(padL, 20 + gH * 0.3, gW, gH * 0.3);
    ctx.fillStyle = "rgba(0, 255, 0, 0.03)"; // Zona Segura
    ctx.fillRect(padL, 20 + gH * 0.6, gW, gH * 0.4);

    // 2. CURVA DE ARRANQUE IDEAL (Referencia Técnica Principal)
    // Representa el camino esperado de MW según el Tiempo
    ctx.strokeStyle = "#00ffcc";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(padL, h - padB);

    // Hito: Rodado (Se mantiene en 0 MW durante los primeros 30 min de calentamiento)
    const xRodadoFin = padL + (30 / 180) * gW;
    ctx.lineTo(xRodadoFin, h - padB);

    // Hito: Sincronización (Inicia subida a los 45 min aprox)
    const xSincro = padL + (45 / 180) * gW;
    ctx.bezierCurveTo(xSincro, h - padB, xSincro + (gW * 0.2), h - padB - (gH * 0.5), w - 20, 30);
    ctx.stroke();

    // Etiquetas de hitos en la curva
    ctx.fillStyle = "#00ffcc"; ctx.font = "bold 9px Arial";
    ctx.fillText("CURVA IDEAL", w - 80, 25);

    // Marcador vertical de Sincronización
    ctx.setLineDash([3, 3]); ctx.strokeStyle = "rgba(255, 204, 0, 0.5)";
    ctx.beginPath(); ctx.moveTo(xSincro, h - padB); ctx.lineTo(xSincro, 20); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "#ffcc00";
    ctx.fillText("SINCRONIZACIÓN (45 min)", xSincro - 40, h - padB + 15);

    // 3. PUNTO DE OPERACIÓN ACTUAL (Seguimiento Real)
    const posX = padL + (Math.min(t, 180) / 180) * gW;
    const posY = (h - padB) - (Math.min(mw, 600) / 600) * gH;
    const color = criticidad === 'peligro' ? '#ff0000' : (criticidad === 'alerta' ? '#ffcc00' : '#00ffcc');

    // Cruceta de posición punteada
    ctx.setLineDash([2, 2]); ctx.strokeStyle = "rgba(255,255,255,0.2)";
    ctx.beginPath(); ctx.moveTo(posX, h-padB); ctx.lineTo(posX, 20); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(padL, posY); ctx.lineTo(posX, posY); ctx.stroke();
    ctx.setLineDash([]);

    // Punto radiante con radar si hay peligro
    if(criticidad === 'peligro') {
        ctx.strokeStyle = color; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(posX, posY, 15 + Math.sin(Date.now()/150)*5, 0, Math.PI*2); ctx.stroke();
    }
    ctx.shadowBlur = 15; ctx.shadowColor = color;
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(posX, posY, 8, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke();
    ctx.shadowBlur = 0;

    // 4. ETIQUETAS EXTERNAS (Ejes)
    ctx.fillStyle = "#fff"; ctx.font = "bold 10px Arial";
    ctx.fillText(`${t} min`, posX - 15, h - padB + 28);
    ctx.fillText(`${mw} MW`, padL - 45, posY + 5);
    ctx.fillStyle = "#ffcc00";
    ctx.fillText(`${temp}°C`, posX + 12, posY - 10);

    // 5. EJES PRINCIPALES
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(padL, 20); ctx.lineTo(padL, h - padB); ctx.lineTo(w - 20, h - padB); ctx.stroke();

    ctx.fillStyle = "#aaa"; ctx.fillText("TIEMPO (MIN) ->", w - 70, h - 5);
    ctx.save(); ctx.translate(15, 60); ctx.rotate(-Math.PI/2); ctx.fillText("CARGA (MW)", 0, 0); ctx.restore();

    // 6. ACTUALIZAR HEADER DE ESTADO
    const fase = document.getElementById('txt-fase-arranque');
    if (fase) {
        fase.innerHTML = `TIEMPO: <span style="color:#ffcc00">${t} MIN</span> | CARGA: <span style="color:#00ffcc">${mw} MW</span>`;
    }
}



// ================= INICIALIZACIÓN ==================
document.addEventListener('DOMContentLoaded', () => {
    conectarFirebase(); const area = sessionStorage.getItem('area_actual'); const role = sessionStorage.getItem('user_role');
    const cardOp = document.getElementById('card-operacion-especial'); if(cardOp) cardOp.style.display = (area === 'Operaciones') ? 'flex' : 'none';

    // Monitoreo global para el Maestro
    if(role === 'super') {
        cargarSolicitudesAcceso();
    }

    // Si hay una solicitud pendiente de este dispositivo, reanudar escucha
    const idEsperando = localStorage.getItem('esperando_aprobacion');
    if (idEsperando) {
        escucharEstadoSolicitud(idEsperando);
    }

    if(role === 'super' && document.getElementById('seccion-usuarios')) {
        document.getElementById('seccion-usuarios').style.display = 'block';
        cargarListaUsuarios(); cargarListaPersonalAutorizado();
    }

    // Mostrar botón de logout si hay sesión activa
    if((sessionStorage.getItem('user_role') || sessionStorage.getItem('user_name')) && document.getElementById('btn-logout')) {
        document.getElementById('btn-logout').style.display = 'flex';
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
function descargarDocumento(b64, n) {
    // Android bridge
    if (typeof Android !== "undefined" && Android.saveFile) {
        Android.saveFile(b64, n);
    }
    // iOS bridge
    else if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.saveFile) {
        window.webkit.messageHandlers.saveFile.postMessage({base64: b64, name: n});
    }
    // Windows/Web browser
    else {
        const l = document.createElement('a');
        l.href = b64;
        l.download = n;
        l.click();
    }
}
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
function eliminarDocumento(a, i) {
    if(confirm("¿Borrar documento?")) {
        let colaDel = JSON.parse(localStorage.getItem('cola_docs_del') || "[]");
        colaDel.push({ area: a, id: i });
        localStorage.setItem('cola_docs_del', JSON.stringify(colaDel));

        let colaEnv = JSON.parse(localStorage.getItem('cola_docs_envios') || "[]");
        colaEnv = colaEnv.filter(item => item.id !== i);
        localStorage.setItem('cola_docs_envios', JSON.stringify(colaEnv));

        notificar("BORRADO PENDIENTE");
        cargarDocsEdicion();
        sincronizarColas();
    }
}
function solicitarEliminarU(u) { if(confirm("¿Borrar editor "+u+"?")) { if(database) database.ref('usuarios/'+u).remove(); } }
function cargarParaEditar(j, area) {
    const eq = JSON.parse(decodeURIComponent(j));
    // Normalización estricta al cargar para editar
    tagOriginalEdicion = (eq.tag || "").toString().trim().toUpperCase();
    areaOriginalEdicion = (area || "").toString().trim();

    if (document.getElementById('input-area')) document.getElementById('input-area').value = area;
    if (document.getElementById('input-tag')) document.getElementById('input-tag').value = eq.tag || "";
    if (document.getElementById('input-nombre')) document.getElementById('input-nombre').value = eq.nombre || "";
    if (document.getElementById('input-info')) document.getElementById('input-info').value = eq.info || "";
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

// ================= GESTIÓN DE SOLICITUDES (BIENVENIDA) ==================
function mostrarFormSolicitud() {
    const w1 = document.getElementById('wrapper-verificar-id');
    const w2 = document.getElementById('wrapper-solicitar-acceso');
    if(w1) w1.style.display = 'none';
    if(w2) w2.style.display = 'block';
}

function enviarSolicitudAcceso() {
    const nom = document.getElementById('input-nombre-solicitud').value.trim();
    const id = document.getElementById('input-id-solicitud').value.trim();
    const msg = document.getElementById('msg-error-id');

    if (!nom || !id) { notificar("COMPLETE LOS CAMPOS", "error"); return; }

    if (database) {
        database.ref('personal_autorizado/' + id).once('value').then(s => {
            const u = s.val();
            if (u) {
                if (u.estado === 'activo') {
                    if(msg) {
                        msg.innerText = "ACCESO CONCEDIDO: YA ESTÁS AUTORIZADO";
                        msg.style.color = "#2ecc71";
                        msg.style.background = "rgba(46, 204, 113, 0.15)";
                        msg.style.borderColor = "#2ecc71";
                        msg.style.display = 'block';
                    }
                    volverAVerificar();
                    return;
                }
                if (u.estado === 'pendiente') {
                    if(msg) {
                        msg.innerText = "SISTEMA: TU SOLICITUD YA ESTÁ PENDIENTE DE APROBACIÓN";
                        msg.style.color = "#ffcc00";
                        msg.style.background = "rgba(255, 204, 0, 0.15)";
                        msg.style.borderColor = "#ffcc00";
                        msg.style.display = 'block';
                    }
                    localStorage.setItem('esperando_aprobacion', id);
                    escucharEstadoSolicitud(id);
                    volverAVerificar();
                    return;
                }
            }

            database.ref('personal_autorizado/' + id).set({
                nombre: nom,
                estado: 'pendiente',
                fecha: new Date().toLocaleString()
            }).then(() => {
                if(msg) {
                    msg.innerText = "¡EXITO! SOLICITUD ENVIADA. ESPERE APROBACIÓN DEL ADMINISTRADOR.";
                    msg.style.color = "#ffcc00";
                    msg.style.background = "rgba(255, 204, 0, 0.2)";
                    msg.style.borderColor = "#ffcc00";
                    msg.style.display = 'block';
                }
                localStorage.setItem('esperando_aprobacion', id);
                escucharEstadoSolicitud(id);
                volverAVerificar();

                // Limpiar campos de solicitud
                document.getElementById('input-nombre-solicitud').value = "";
                document.getElementById('input-id-solicitud').value = "";
            });
        });
    } else {
        notificar("ERROR: SIN CONEXIÓN", "error");
    }
}

function escucharEstadoSolicitud(id) {
    if (!database) return;
    // Evitar múltiples listeners
    database.ref('personal_autorizado/' + id).off('value');
    database.ref('personal_autorizado/' + id).on('value', snap => {
        const u = snap.val();
        const esperando = localStorage.getItem('esperando_aprobacion');

        if (!u) {
            if (esperando === id) {
                notificar("HMI U6: ACCESO DENEGADO - CONSULTE CON EL ADMINISTRADOR", "error");
                localStorage.removeItem('esperando_aprobacion');
                const msg = document.getElementById('msg-error-id');
                if(msg) msg.innerText = "SOLICITUD RECHAZADA POR SEGURIDAD";
                database.ref('personal_autorizado/' + id).off('value');
            }
            return;
        }

        if (u.estado === 'activo') {
            notificar("HMI U6: ACCESO AUTORIZADO - BIENVENIDO AL SISTEMA", "exito");
            localStorage.removeItem('esperando_aprobacion');
            const msg = document.getElementById('msg-error-id');
            if(msg) {
                msg.innerText = "ACCESO CONCEDIDO. ¡YA PUEDES INGRESAR!";
                msg.style.color = "#2ecc71";
            }
            database.ref('personal_autorizado/' + id).off('value');
        }
    });
}
function cargarPlanosVista() { /* No longer needed */ }
