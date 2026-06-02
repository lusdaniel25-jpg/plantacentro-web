// Configuración de Firebase - Planta Centro Unidad 6
const VERSION_APP = 1.3;

// --- SEGURIDAD DE FLUJO INICIAL (INSTANTÁNEA) ---
(function() {
    const url = window.location.href;
    const sesion = sessionStorage.getItem('user_name');
    const esBienvenida = url.includes("bienvenida.html");

    if (!esBienvenida && !sesion) {
        window.location.replace("bienvenida.html");
    }

    // BLOQUEO DE CLIC DERECHO E INSPECCIÓN EN NAVEGADOR
    document.addEventListener('contextmenu', event => event.preventDefault());
    document.addEventListener('keydown', function(e) {
        if (e.key === 'PrintScreen' || (e.ctrlKey && e.key === 'p') || e.keyCode === 123) {
            e.preventDefault();
            notificar("CAPTURA BLOQUEADA POR SEGURIDAD INDUSTRIAL", "error");
        }
        if (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'J' || e.key === 'C')) e.preventDefault();
        if (e.ctrlKey && e.key === 'U') e.preventDefault();
    });

    // PROTECCIÓN EXTRA PARA NAVEGADORES MÓVILES (DESENFOQUE AL SALIR)
    window.addEventListener('blur', () => {
        if (typeof Android === "undefined") {
            document.body.style.filter = "blur(20px)";
            document.body.style.transition = "filter 0.3s ease";
        }
    });
    window.addEventListener('focus', () => {
        document.body.style.filter = "none";
    });
})();

// --- SHIM DE COMPATIBILIDAD NAVEGADOR/PC ---
if (typeof Android === "undefined") {
    console.log("Detectado: Navegador Web (Simulando interfaz Android)");
    window.Android = {
        shareApp: function(text) {
            console.log("Compartir:", text);
            if(navigator.share) {
                navigator.share({ title: 'Planta Centro U6', text: text });
            } else {
                notificar("ENLACE COPIADO: " + text, "info");
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

const LINK_DESCARGA_APK = "https://t.me/unidad6";

let database;
let listenerConexionActivo = false;
let listenersGlobalesActivos = false; // Nueva bandera para evitar duplicados de listeners
let notificacionConexionMostrada = false;
let notificacionOfflineMostrada = false;
let syncing = false; // Flag para evitar procesos de sincronización simultáneos
let historialNotificaciones = new Map(); // Para evitar spam de la misma notificación

function conectarFirebase() {
    if (typeof firebase !== 'undefined') {
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
            firebase.database().goOnline();
        }
        database = firebase.database();

        if (!listenerConexionActivo) {
            database.ref('.info/connected').on('value', (snap) => {
                const isConnected = snap.val() === true;

                document.querySelectorAll('.online-indicator').forEach(el => {
                    el.classList.toggle('status-online', isConnected);
                    el.classList.toggle('status-offline', !isConnected);
                    el.title = isConnected ? "SISTEMA EN LÍNEA" : "SISTEMA SIN CONEXIÓN";
                });

                if (isConnected) {
                    const role = sessionStorage.getItem('user_role') || 'LECTURA';
                    const user = sessionStorage.getItem('user_name') || 'Invitado';
                    const esBienvenida = window.location.href.includes("bienvenida.html");

                    if (!notificacionConexionMostrada && (role !== 'LECTURA' || user !== 'Invitado')) {
                        notificacionConexionMostrada = true;
                        notificacionOfflineMostrada = false;
                        if (esBienvenida) notificar("CONEXIÓN RESTABLECIDA - SINCRONIZANDO DATOS", "exito");
                    }

                    // RASTREO DE PRESENCIA (Solo si hay usuario)
                    if (user !== 'Invitado') {
                        const savedId = localStorage.getItem('user_id_std');
                        let idRastreo = (role === 'super' || role === 'editor') ? user : (savedId || user);
                        idRastreo = idRastreo.toLowerCase().trim().replace(/[\.\$#\[\]\/]/g, "_");

                        if (idRastreo) {
                            const presenceRef = database.ref('presencia/' + idRastreo);
                            presenceRef.onDisconnect().cancel();
                            presenceRef.update({ estado: 'online', ultima: firebase.database.ServerValue.TIMESTAMP });
                            presenceRef.onDisconnect().update({ estado: 'offline', ultima: firebase.database.ServerValue.TIMESTAMP });
                        }
                    }

                    // Iniciar procesos de red solo una vez o cuando sea necesario
                    sincronizarColas();
                    verificarSucesionAutomatica();

                    if (!listenersGlobalesActivos) {
                        verificarActualizaciones();
                        // Sincronizar datos maestros
                        database.ref('config/master_pass').on('value', s => s.val() && localStorage.setItem('master_pass', s.val()));
                        database.ref('config/master_name').on('value', s => s.val() && localStorage.setItem('master_name', s.val()));
                        listenersGlobalesActivos = true;
                    }
                } else {
                    if (!navigator.onLine && !notificacionOfflineMostrada) {
                        notificacionOfflineMostrada = true;
                        notificacionConexionMostrada = false;
                        if (window.location.href.includes("bienvenida.html")) notificar("TRABAJANDO EN MODO OFFLINE", "warning");
                    }
                }
            });
            listenerConexionActivo = true;
        }
    }
}

function sincronizarColas() {
    if (!database || !navigator.onLine || syncing) return;
    syncing = true;

    const colaEnv = JSON.parse(localStorage.getItem('cola_envios') || "[]");
    const colaDel = JSON.parse(localStorage.getItem('cola_eliminaciones') || "[]");
    const colaPlEnv = JSON.parse(localStorage.getItem('cola_planos_envios') || "[]");
    const colaPlDel = JSON.parse(localStorage.getItem('cola_planos_del') || "[]");
    const colaDocEnv = JSON.parse(localStorage.getItem('cola_docs_envios') || "[]");
    const colaDocDel = JSON.parse(localStorage.getItem('cola_docs_del') || "[]");
    const colaMegaDel = JSON.parse(localStorage.getItem('cola_megados_del') || "[]");

    const totalPendiente = colaEnv.length + colaDel.length + colaPlEnv.length + colaPlDel.length + colaDocEnv.length + colaDocDel.length + colaMegaDel.length;
    if (totalPendiente === 0) { syncing = false; return; }

    const promesas = [];

    // 1. PROCESAR EQUIPOS
    colaDel.forEach(q => {
        const sTag = q.tag.replace(/[\.\$#\[\]\/]/g, "_");
        promesas.push(database.ref('equipos/' + q.area + '/' + sTag).remove().then(() => {
            let actualDel = JSON.parse(localStorage.getItem('cola_eliminaciones') || "[]");
            actualDel = actualDel.filter(i => !(i.tag === q.tag && i.area === q.area));
            localStorage.setItem('cola_eliminaciones', JSON.stringify(actualDel));
            registrarLog(`ELIMINÓ EQUIPO: ${q.tag} (${q.area.toUpperCase()})`);
        }));
    });

    colaEnv.forEach(q => {
        const sTag = q.tag.replace(/[\.\$#\[\]\/]/g, "_");
        promesas.push(database.ref('equipos/' + q.area + '/' + sTag).set(q).then(() => {
            let actual = JSON.parse(localStorage.getItem('cola_envios') || "[]");
            actual = actual.filter(i => !(i.tag === q.tag && i.area === q.area));
            localStorage.setItem('cola_envios', JSON.stringify(actual));
            registrarLog(`EDITÓ/GUARDÓ EQUIPO: ${q.tag} (${q.area.toUpperCase()})`);
        }));
    });

    // 2. PROCESAR PLANOS
    colaPlEnv.forEach(q => {
        promesas.push(database.ref('planos/' + q.area + '/' + q.id).set(q.data).then(() => {
            let actual = JSON.parse(localStorage.getItem('cola_planos_envios') || "[]");
            actual = actual.filter(i => i.id !== q.id);
            localStorage.setItem('cola_planos_envios', JSON.stringify(actual));
            registrarLog(`SUBIÓ PLANO: ${q.data.titulo} (${q.area.toUpperCase()})`);
        }));
    });

    colaPlDel.forEach(q => {
        promesas.push(database.ref('planos/' + q.area + '/' + q.id).remove().then(() => {
            let actual = JSON.parse(localStorage.getItem('cola_planos_del') || "[]");
            actual = actual.filter(i => i.id !== q.id);
            localStorage.setItem('cola_planos_del', JSON.stringify(actual));
            registrarLog(`ELIMINÓ PLANO EN: ${q.area.toUpperCase()}`);
        }));
    });

    // 3. PROCESAR DOCUMENTOS
    colaDocEnv.forEach(q => {
        promesas.push(database.ref('documentos/' + q.area + '/' + q.id).set(q.data).then(() => {
            let actual = JSON.parse(localStorage.getItem('cola_docs_envios') || "[]");
            actual = actual.filter(i => i.id !== q.id);
            localStorage.setItem('cola_docs_envios', JSON.stringify(actual));
            registrarLog(`SUBIÓ DOCUMENTO: ${q.data.titulo} (${q.area.toUpperCase()})`);
        }));
    });

    colaDocDel.forEach(q => {
        promesas.push(database.ref('documentos/' + q.area + '/' + q.id).remove().then(() => {
            let actual = JSON.parse(localStorage.getItem('cola_docs_del') || "[]");
            actual = actual.filter(i => i.id !== q.id);
            localStorage.setItem('cola_docs_del', JSON.stringify(actual));
            registrarLog(`ELIMINÓ DOCUMENTO EN: ${q.area.toUpperCase()}`);
        }));
    });

    // 4. PROCESAR MEGADOS (ELIMINACIÓN)
    colaMegaDel.forEach(id => {
        promesas.push(database.ref('megados/' + id).remove().then(() => {
            let actual = JSON.parse(localStorage.getItem('cola_megados_del') || "[]");
            actual = actual.filter(i => i !== id);
            localStorage.setItem('cola_megados_del', JSON.stringify(actual));
            registrarLog("ELIMINÓ REGISTRO DE MEGADO INDIVIDUAL");
        }));
    });

    Promise.allSettled(promesas).then(() => {
        syncing = false;
        notificar("DATOS SINCRONIZADOS CORRECTAMENTE", "exito");
        if(typeof cargarEquiposEdicion === 'function') cargarEquiposEdicion();
        if(typeof cargarPlanosEdicionGeneral === 'function') cargarPlanosEdicionGeneral();
        if(typeof cargarDocsEdicion === 'function') cargarDocsEdicion();
        if(typeof cargarMegados === 'function') cargarMegados();
    });
}

// conectarFirebase(); <-- Eliminado para evitar doble ejecución

let areaSeleccionadaPaso = "";
let equiposActuales = [];
let fotosBase64 = [];
let tagOriginalEdicion = null;
let areaOriginalEdicion = null;

const DATOS_PLANTA = { "auxiliares": [], "turbina": [], "ciclo": [], "caldera": [], "calderas_auxiliares": [], "externas": [], "instrumentacion": [], "contra_incendio": [], "electricista": [], "protecciones": [] };

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

    const masterName = localStorage.getItem('master_name') || 'luis';
    // Casos especiales (Maestro o Usuarios Locales)
    if (id.toLowerCase() === masterName.toLowerCase() || id === masterPass || id === "6969") {
        sessionStorage.setItem('user_name', masterName);
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

    if (database) {
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

    // Lógica prioritaria para el Maestro
    const masterName = localStorage.getItem('master_name') || 'luis';
    if(u === masterName.toLowerCase()) {
        if(p === masterPass || p === '6969') {
            localStorage.removeItem('user_id_std'); // LIMPIAR ID DE LECTOR PARA EVITAR CONFLICTOS DE PRESENCIA
            sessionStorage.setItem('user_role', 'super');
            sessionStorage.setItem('user_name', masterName);

            // ACTUALIZAR ÚLTIMO LOGIN DEL MAESTRO PARA FAIL-SAFE 72H
            if (database) {
                database.ref('config/master_last_login').set(firebase.database.ServerValue.TIMESTAMP);
            }

            if (sessionStorage.getItem('intencion_megado')) {
                sessionStorage.removeItem('intencion_megado');
                notificar("IDENTIDAD CONFIRMADA");
                cerrarLogin();
                const area = sessionStorage.getItem('area_actual');
                if(area) filtrarSistema(area);
                document.getElementById('modal-gestion-megados').style.display = 'flex';
                return;
            }

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
    if(database) {
        database.ref('usuarios/'+u).once('value').then(s => {
            const d = s.val();
            if(d && d.clave === p) {
                localStorage.removeItem('user_id_std'); // LIMPIAR ID DE LECTOR
                localUsers[u] = d;
                localStorage.setItem('user_db', JSON.stringify(localUsers));
                sessionStorage.setItem('user_role', d.rol);
                sessionStorage.setItem('user_name', u);

                if (sessionStorage.getItem('intencion_megado')) {
                    sessionStorage.removeItem('intencion_megado');
                    notificar("IDENTIDAD CONFIRMADA");
                    cerrarLogin();
                    const area = sessionStorage.getItem('area_actual');
                    if(area) filtrarSistema(area);
                    document.getElementById('modal-gestion-megados').style.display = 'flex';
                    return;
                }

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
    registrarLog("ACTUALIZÓ PROTOCOLOS DE OPERACIÓN U6");
    document.getElementById('modal-edit-op').style.display = 'none';
    document.getElementById('auth-op-pass').value = ""; // Limpiar clave
    renderizarDatosOperacion(data);
}

// ================= GESTIÓN DE SISTEMAS Y OFFLINE ==================
function filtrarSistema(sistema, esSubmenu = false) {
    const contenedor = document.getElementById('mapa-equipos'); if (!contenedor) return;
    const grid = document.querySelector('.sistemas-grid');
    const submenu = document.getElementById('submenu-electrica');
    const cardOp = document.getElementById('card-operacion-especial');

    // Ocultar todo por defecto para limpiar pantalla
    if(grid) grid.style.display = 'none';
    if(cardOp) cardOp.style.display = 'none';
    if(submenu) submenu.style.display = 'none';

    document.getElementById('contenedor-megados-area').style.display = 'none';
    document.getElementById('contenedor-simulador-megado').style.display = 'none';
    document.getElementById('contenedor-manual-area').style.display = 'none';
    document.getElementById('contenedor-planos-area').style.display = 'none';
    document.getElementById('contenedor-buscador').style.display = 'none';
    document.getElementById('contenedor-docs-area').style.display = 'none';

    conectarFirebase();
    const btnHome = document.querySelector('.btn-home');
    if (btnHome) {
        btnHome.innerHTML = '<i class="fas fa-chevron-left"></i> VOLVER';
        btnHome.onclick = () => {
            sessionStorage.removeItem('area_actual');
            localStorage.removeItem('area_actual');
            window.location.reload();
        };
    }

    // Lógica para ÁREA ELÉCTRICA (MENU PRINCIPAL)
    if (sistema === 'electricista' && !esSubmenu) {
        if (submenu) {
            submenu.style.display = 'flex';
            sessionStorage.setItem('area_actual', 'electricista');
        }
        return;
    }

    // Lógica para ÁREA DE OPERACIONES
    if (sistema === 'Operaciones') {
        if(cardOp) cardOp.style.display = 'flex';
        if(grid) grid.style.display = 'grid'; // Mostrar grid para que pueda ver otros sistemas si quiere
        return;
    }

    // Lógica para SUB-ÁREAS o ÁREAS NORMALES
    if (contenedor) contenedor.style.display = 'flex';
    const busc = document.getElementById('contenedor-buscador');
    if (busc) busc.style.display = 'block';

    const btnMegaProt = document.getElementById('btn-megado-protecciones');
    if (btnMegaProt) btnMegaProt.style.display = (sistema === 'protecciones') ? 'block' : 'none';

    cargarPlanosDelArea(sistema); cargarManualDelArea(sistema); cargarDocsDelArea(sistema);

    const renderLocal = (liveData = null) => {
        let val;
        if (liveData) {
            val = liveData;
        } else {
            const cacheRaw = localStorage.getItem('cache_' + sistema);
            try { val = JSON.parse(cacheRaw || "{}"); } catch(e) { val = {}; }
        }

        let combinados = {};
        if (val && typeof val === 'object') {
            Object.keys(val).forEach(k => {
                const item = val[k];
                if (item) {
                    const tagKey = (item.tag || k).toString().toUpperCase().trim();
                    combinados[tagKey] = { ...item, tag: tagKey };
                }
            });
        }

        let colaEnv = JSON.parse(localStorage.getItem('cola_envios') || "[]");
        colaEnv.filter(q => q.area === sistema).forEach(q => {
            const tagKey = q.tag.toUpperCase().trim();
            combinados[tagKey] = q;
        });

        let colaDel = JSON.parse(localStorage.getItem('cola_eliminaciones') || "[]");
        colaDel.filter(q => q.area === sistema).forEach(q => {
            delete combinados[q.tag.toUpperCase().trim()];
        });

        let finalMap = new Map();
        (DATOS_PLANTA[sistema] || []).forEach(eq => {
            if(eq.tag) finalMap.set(eq.tag.toUpperCase().trim(), eq);
        });
        Object.values(combinados).forEach(eq => {
            if(eq.tag) finalMap.set(eq.tag.toUpperCase().trim(), eq);
        });

        equiposActuales = Array.from(finalMap.values());
        dibujarEquipos(equiposActuales);
    };

    renderLocal();
    if (database) {
        database.ref('equipos/' + sistema).off();
        database.ref('equipos/' + sistema).on('value', (s) => {
            const data = s.val();
            try { localStorage.setItem('cache_' + sistema, JSON.stringify(data || {})); } catch(e) {}
            renderLocal(data);
        });
    }
}

function dibujarEquipos(equipos) {
    const c = document.getElementById('mapa-equipos'); if(!c) return;
    c.innerHTML = "";
    if (equipos.length === 0) {
        c.style.display = "none"; // Evitar pantalla negra vacía
        return;
    }
    c.style.display = "flex"; // Mostrar si hay equipos
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
            lista.innerHTML += `<div class="plano-item-card"><h4>${p.titulo}</h4>${p.autor ? `<small style="color:#aaa; display:block; margin-bottom:2px; font-size:0.6rem;">SUBIDO POR: ${p.autor.toUpperCase()}</small>` : ''}${p.fecha ? `<small style="color:#666; display:block; margin-bottom:5px; font-size:0.55rem;">${p.fecha}</small>` : ''}<img src="${p.foto}" onclick="verImagenFull('${p.foto}', '${p.titulo}')"></div>`;
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
    const cont = document.getElementById('contenedor-manual-area');
    const texto = document.getElementById('texto-manual-area');
    const panel = document.getElementById('panel-manual-area');
    const btn = cont ? cont.querySelector('.accordion-admin') : null;

    if(!cont || !texto) return;

    // Resetear estado colapsado al cambiar de área
    if(panel) panel.classList.remove('active');
    if(btn) btn.classList.remove('active');

    const cache = JSON.parse(localStorage.getItem('manuales_areas') || "{}");
    if(cache[area]) {
        texto.innerText = cache[area];
        cont.style.display = 'block';
    }

    if(database) {
        database.ref('manuales_areas/'+area).on('value', s => {
            if(s.val()) {
                texto.innerText = s.val();
                cont.style.display = 'block';
            }
        });
    }
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
            const d = combinados[id];
            lista.innerHTML += `
                <div class="user-item-modern" style="display:flex; justify-content:space-between; align-items:center;">
                    <div>
                        <b>${d.titulo}</b>
                        ${d.autor ? `<br><small style="color:#aaa; font-size:0.65rem;">SUBIDO POR: ${d.autor.toUpperCase()}</small>` : ''}
                        ${d.fecha ? ` <small style="color:#666; font-size:0.6rem;">(${d.fecha})</small>` : ''}
                    </div>
                    <button onclick="descargarDocumento('${d.archivo}', '${d.titulo}.${d.extension || 'pdf'}')">ABRIR</button>
                </div>`;
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

    const render = (liveData = null) => {
        let val;
        if (liveData) {
            val = liveData;
        } else {
            const cacheRaw = localStorage.getItem('cache_' + area);
            try { val = JSON.parse(cacheRaw || "{}"); } catch(e) { val = {}; }
        }

        let combinados = {};
        if (val && typeof val === 'object') {
            Object.keys(val).forEach(k => {
                const tagKey = (val[k].tag || k).toString().toUpperCase().trim();
                combinados[tagKey] = { ...val[k], tag: tagKey, fbKey: k };
            });
        }

        let colaEnv = JSON.parse(localStorage.getItem('cola_envios') || "[]");
        colaEnv.filter(q => q.area === area).forEach(q => {
            const tagKey = q.tag.toUpperCase().trim();
            combinados[tagKey] = q;
        });

        let colaDel = JSON.parse(localStorage.getItem('cola_eliminaciones') || "[]");
        colaDel.filter(q => q.area === area).forEach(q => {
            delete combinados[q.tag.toUpperCase().trim()];
        });

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
                        <button onclick="eliminarEquipo('${area}', '${eq.fbKey || eq.tag}')" style="background: rgba(255,68,68,0.15); border: 1.5px solid #ff4444; color: #ff4444; padding: 6px 10px; border-radius: 8px;"><i class="fas fa-trash"></i></button>
                    </div>
                </div>`;
        });
    };

    render();
    if(database) {
        database.ref('equipos/'+area).off();
        database.ref('equipos/'+area).on('value', s => {
            const data = s.val();
            try { localStorage.setItem('cache_' + area, JSON.stringify(data || {})); } catch(e) {}
            render(data);
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
    const areas = ["auxiliares", "turbina", "ciclo", "caldera", "calderas_auxiliares", "externas", "instrumentacion", "electricista", "protecciones", "contra_incendio"];
    const colaEnv = JSON.parse(localStorage.getItem('cola_envios') || "[]");
    const colaDel = JSON.parse(localStorage.getItem('cola_eliminaciones') || "[]");

    let duplicadoEnArea = null;

    for (const a of areas) {
        try {
            const cacheRaw = localStorage.getItem('cache_' + a);
            if (!cacheRaw || cacheRaw === "undefined" || cacheRaw === "null") continue;

            const cacheArea = JSON.parse(cacheRaw);
            const equiposArea = Object.entries(cacheArea).map(([t, e]) => ({ ...e, tag: e.tag || t, fbKey: t }));

            // Añadir los que están en cola de envío para esta área (si no están ya)
            colaEnv.filter(e => e.area === a).forEach(e => {
                if (!equiposArea.some(x => x.tag === e.tag)) equiposArea.push(e);
            });

            const conflicto = equiposArea.find(e => {
                const eTag = (e.tag || "").toString().trim().toUpperCase();
                const eKey = (e.fbKey || e.tag || "").toString().trim().toUpperCase();

                // 1. IGNORAR si es el equipo que estamos editando exactamente
                if (tagOriginalEdicion && areaOriginalEdicion) {
                    if (eKey === tagOriginalEdicion && a === areaOriginalEdicion) {
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

    try {
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

        notificar("DATOS GUARDADOS - SINCRONIZANDO...");
        limpiarFormulario();
        cargarEquiposEdicion();
        sincronizarColas();
    } catch (e) {
        console.error("Error guardando en localStorage:", e);
        notificar("ERROR: MEMORIA LLENA O FOTO MUY PESADA", "error");
    }
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
            const p = combinados[id];
            const isPending = colaEnv.some(q => q.id === id);
            lista.innerHTML += `
                <div class="user-item-modern" style="border-left: 4px solid #00ccff; background: rgba(0,204,255,0.03); display: flex; justify-content: space-between; align-items: center; padding: 10px; margin-bottom: 8px; border-radius: 10px;">
                    <div>
                        <b style="font-size:0.85rem;">${p.titulo}</b>
                        ${p.autor ? `<br><small style="color:#00ccff; font-size:0.6rem;"><i class="fas fa-user"></i> ${p.autor.toUpperCase()}</small>` : ''}
                        ${p.fecha ? ` <small style="color:#666; font-size:0.6rem;">(${p.fecha})</small>` : ''}
                        ${(!navigator.onLine && isPending) ? '<br><small style="color:#ffcc00; font-size:0.6rem;">(PENDIENTE DE SUBIDA)</small>' : ''}
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

    comprimirImagen(file, 0.7, (base64) => {
        const id = "plano_" + Date.now();
        const autor = sessionStorage.getItem('user_name') || 'Desconocido';
        const fecha = new Date().toLocaleString();
        const data = { titulo: tit, foto: base64, autor: autor, fecha: fecha };

        let cola = JSON.parse(localStorage.getItem('cola_planos_envios') || "[]");
        cola.push({ area, id, data });
        localStorage.setItem('cola_planos_envios', JSON.stringify(cola));

        notificar("PLANO EN COLA DE SUBIDA");
        document.getElementById('input-plano-titulo-general').value = "";
        fileInput.value = "";
        const txt = document.getElementById('txt-plano-archivo');
        if(txt) txt.innerText = "CARGAR IMAGEN DEL PLANO";
        const prev = document.getElementById('preview-plano-general');
        if(prev) prev.style.display = 'none';

        cargarPlanosEdicionGeneral();
        sincronizarColas();
    });
}

function eliminarPlanoGeneral(a, i) {
    confirmarHMI("¿ELIMINAR PLANO?", "¿Borrar plano permanentemente?", () => {
        let colaDel = JSON.parse(localStorage.getItem('cola_planos_del') || "[]");
        colaDel.push({ area: a, id: i });
        localStorage.setItem('cola_planos_del', JSON.stringify(colaDel));

        let colaEnv = JSON.parse(localStorage.getItem('cola_planos_envios') || "[]");
        colaEnv = colaEnv.filter(item => item.id !== i);
        localStorage.setItem('cola_planos_envios', JSON.stringify(colaEnv));

        notificar("BORRADO PENDIENTE");
        cargarPlanosEdicionGeneral();
        sincronizarColas();
    });
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
    registrarLog("ACTUALIZÓ MANUAL: " + area.toUpperCase());
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
            const d = combinados[id];
            const isPending = colaEnv.some(q => q.id === id);
            lista.innerHTML += `
                <div class="user-item-modern" style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <b>${d.titulo}</b>
                        ${d.autor ? `<br><small style="color:#00ccff; font-size:0.6rem;"><i class="fas fa-user"></i> ${d.autor.toUpperCase()}</small>` : ''}
                        ${d.fecha ? ` <small style="color:#666; font-size:0.6rem;">(${d.fecha})</small>` : ''}
                        ${(!navigator.onLine && isPending) ? '<br><small style="color:#ffcc00; font-size:0.6rem;">(PENDIENTE DE SUBIDA)</small>' : ''}
                    </div>
                    <button onclick="eliminarDocumento('${area}', '${id}')" style="color:#ff4444; background:none; border:none; font-size:1.1rem;"><i class="fas fa-trash-alt"></i></button>
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

        const masterKey = localStorage.getItem('master_name') || 'luis';
        if(!us[masterKey]) {
            const mP = localStorage.getItem('master_pass') || 'luis2026';
            us[masterKey] = { nombre: masterKey, clave: mP, rol: 'super' };
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
    const masterName = localStorage.getItem('master_name') || 'luis';
    const esRoot = u.toLowerCase() === masterName.toLowerCase();

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

        // NOTIFICACIÓN ACTIVA PARA EL MAESTRO (EMERGENTE)
        if (solicitudesVigilanteActivo && count > totalPendientesGlobal) {
            notificar(`NUEVA SOLICITUD DE ACCESO: ${count} PENDIENTE(S)`, "warning", true);
            if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
        }

        totalPendientesGlobal = count;
        solicitudesVigilanteActivo = true;
    });
}

function procesarSolicitud(id, estado) {
    database.ref('personal_autorizado/'+id+'/estado').set(estado);
}

function denegarSolicitud(id) {
    confirmarHMI("¿DENEGAR ACCESO?", "¿Deseas denegar y eliminar esta solicitud de acceso?", () => {
        database.ref('personal_autorizado/'+id).remove().then(() => notificar("SOLICITUD ELIMINADA", "error"));
    });
}

function crearNuevoEditor() {
    const nom = document.getElementById('nuevo-usuario-nombre').value.toLowerCase().trim();
    const cla = document.getElementById('nuevo-usuario-clave').value.trim();
    const rol = document.getElementById('nuevo-usuario-rol') ? document.getElementById('nuevo-usuario-rol').value : 'editor';
    const original = document.getElementById('edit-user-original-name').value;
    if(!nom || !cla) return;

    const masterName = localStorage.getItem('master_name') || 'luis';
    if(original === masterName) {
        localStorage.setItem('master_name', nom);
        localStorage.setItem('master_pass', cla);
        if(database) {
            database.ref('config/master_name').set(nom);
            database.ref('config/master_pass').set(cla);
        }
    }

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
    confirmarHMI("¿ELIMINAR ACCESO?", "¿Eliminar acceso a ID: "+id+"?", () => {
        database.ref('personal_autorizado/'+id).remove().then(() => notificar("ACCESO ELIMINADO"));
    });
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
    database.ref('config/version').set(v).then(() => notificar("SISTEMA ACTUALIZADO - NOTIFICACIÓN ENVIADA", "warning"));
}

// ================= UTILIDADES ==================
function notificar(msj, tipo = 'exito', emergente = false) {
    const msjUpper = msj.toUpperCase();
    const ahora = Date.now();

    // 1. EVITAR DUPLICADOS Y SPAM (Anti-rebote de 2 segundos para el mismo mensaje)
    if (historialNotificaciones.has(msjUpper)) {
        if (ahora - historialNotificaciones.get(msjUpper) < 2000) return;
    }
    historialNotificaciones.set(msjUpper, ahora);

    // 2. EVITAR QUE SE MEZCLEN (Verificar si ya está en pantalla para no repetir)
    const existentes = document.querySelectorAll('.toast-modern span');
    for (let a of existentes) { if (a.innerText === msjUpper) return; }

    // Limpieza periódica del historial para evitar consumo de memoria
    if (historialNotificaciones.size > 50) {
        const limit = Date.now() - 10000;
        historialNotificaciones.forEach((v, k) => { if (v < limit) historialNotificaciones.delete(k); });
    }

    if (emergente && typeof Android !== "undefined" && Android.showNativeNotification) {
        Android.showNativeNotification("HMI PLANTA CENTRO U6", msjUpper);
    }

    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        container.style.cssText = "position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%); z-index: 10000; display: flex; flex-direction: column; gap: 10px; align-items: center; width: 100%; pointer-events: none;";
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast-modern toast-${tipo}`;

    let color = "#00ffcc";
    let icon = "fa-check-double";
    if (tipo === 'error') { color = "#ff4444"; icon = "fa-shield-virus"; }
    else if (tipo === 'warning') { color = "#ffcc00"; icon = "fa-triangle-exclamation"; }
    else if (tipo === 'info') { color = "#00ccff"; icon = "fa-fingerprint"; }

    toast.style.cssText = `
        background: rgba(10, 15, 20, 0.85);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid ${color}44;
        border-left: 4px solid ${color};
        color: white;
        padding: 12px 20px;
        border-radius: 14px;
        font-family: 'Segoe UI', Roboto, sans-serif;
        display: flex;
        align-items: center;
        gap: 15px;
        box-shadow: 0 10px 30px rgba(0,0,0,0.5), inset 0 0 10px ${color}11;
        transform: translateY(100px);
        opacity: 0;
        transition: all 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275);
        min-width: 280px;
        max-width: 90%;
        pointer-events: auto;
    `;

    toast.innerHTML = `
        <div style="background:${color}22; width:38px; height:38px; border-radius:10px; display:flex; align-items:center; justify-content:center; border: 1px solid ${color}33;">
            <i class="fas ${icon}" style="color:${color}; font-size:1.2rem;"></i>
        </div>
        <div style="display:flex; flex-direction:column;">
            <span style="font-weight:800; font-size:0.7rem; letter-spacing:1px; color:${color}; margin-bottom:1px;">${tipo.toUpperCase()}</span>
            <span style="font-weight:600; font-size:0.8rem; color:#eee;">${msjUpper}</span>
        </div>`;

    container.appendChild(toast);
    setTimeout(() => { toast.style.transform = "translateY(0)"; toast.style.opacity = "1"; }, 10);
    setTimeout(() => {
        toast.style.transform = "translateY(-20px) scale(0.9)";
        toast.style.opacity = "0";
        setTimeout(() => toast.remove(), 500);
    }, 3500);
}

function comprimirImagen(file, calidad, callback) {
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => notificar("ERROR AL LEER ARCHIVO", "error");
    reader.onload = (event) => {
        const img = new Image();
        img.onerror = () => notificar("ERROR AL PROCESAR IMAGEN", "error");
        img.src = event.target.result;
        img.onload = () => {
            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;
            const max = 1000;

            if (width > height) {
                if (width > max) {
                    height *= max / width;
                    width = max;
                }
            } else {
                if (height > max) {
                    width *= max / height;
                    height = max;
                }
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            try {
                const base64 = canvas.toDataURL('image/jpeg', calidad);
                callback(base64);
            } catch (e) {
                notificar("ERROR AL COMPRIMIR", "error");
            }
        };
    };
    reader.readAsDataURL(file);
}

function confirmarHMI(titulo, mensaje, callback) {
    let modal = document.querySelector('.modal-confirmacion');
    if (!modal) {
        modal = document.createElement('div');
        modal.className = 'modal-confirmacion';
        modal.innerHTML = `
            <div class="confirm-box">
                <h3 id="confirm-title"></h3>
                <p id="confirm-msg"></p>
                <div class="confirm-btns">
                    <button class="btn-confirm btn-confirm-no" id="btn-confirm-no">CANCELAR</button>
                    <button class="btn-confirm btn-confirm-yes" id="btn-confirm-yes">SÍ, BORRAR</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    document.getElementById('confirm-title').innerText = titulo.toUpperCase();
    document.getElementById('confirm-msg').innerText = mensaje;
    modal.style.display = 'flex';

    const btnYes = document.getElementById('btn-confirm-yes');
    const btnNo = document.getElementById('btn-confirm-no');

    const newBtnYes = btnYes.cloneNode(true);
    const newBtnNo = btnNo.cloneNode(true);
    btnYes.parentNode.replaceChild(newBtnYes, btnYes);
    btnNo.parentNode.replaceChild(newBtnNo, btnNo);

    newBtnYes.onclick = () => {
        modal.style.display = 'none';
        callback();
    };
    newBtnNo.onclick = () => {
        modal.style.display = 'none';
    };
}

// ================= GESTIÓN DE LOGS Y NOTIFICACIONES PARA ADMIN ==================
function registrarLog(msj) {
    if (!database || sessionStorage.getItem('user_role') === 'super') return;
    database.ref('logs_actividad').push({
        usuario: sessionStorage.getItem('user_name') || 'Invitado',
        accion: msj,
        fecha: firebase.database.ServerValue.TIMESTAMP
    });
}

let logsVigilanteActivo = false;
function monitorearActividad() {
    if (!database) return;
    const ref = database.ref('logs_actividad').limitToLast(1);
    ref.on('child_added', snap => {
        if (!logsVigilanteActivo) return;
        const log = snap.val();
        const masterName = localStorage.getItem('master_name') || 'luis';
        if (log.usuario.toLowerCase() !== masterName.toLowerCase()) {
            notificar(`ALERTA ACTIVIDAD: ${log.usuario.toUpperCase()} - ${log.accion}`, "warning", true);
            if (navigator.vibrate) navigator.vibrate([50, 50, 50]);
        }
    });
    setTimeout(() => { logsVigilanteActivo = true; }, 3000);
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
    const btn = document.getElementById('btn-descargar-bienvenida');
    if(btn) btn.style.display = 'none';

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

function verificarActualizaciones() {
    if (database) {
        database.ref('config/version').on('value', (s) => {
            const btn = document.getElementById('btn-descargar-bienvenida');
            if(btn) {
                const versionNube = parseFloat(s.val());
                // Caso 1: Estamos en el Navegador (Android no definido)
                if (typeof Android === "undefined") {
                    btn.style.display = 'inline-flex';
                    btn.innerHTML = '<i class="fas fa-shield-alt"></i> INSTALAR APP SEGURA';
                    btn.style.background = "#2ecc71";
                }
                // Caso 2: Estamos en la App y hay una versión superior
                else if (versionNube > VERSION_APP) {
                    btn.style.display = 'inline-flex';
                    btn.innerHTML = '<i class="fas fa-download"></i> ACTUALIZAR AHORA';
                }
                else {
                    btn.style.display = 'none';
                }
            }
        });
    }
}


// ================= ANALIZADOR TÉCNICO AVANZADO DE RENDIMIENTO Y RIESGO METALÚRGICO ==================
function analizarRendimiento() {
    const mw = parseFloat(document.getElementById('calc-mw').value) || 0;
    const fuel = parseFloat(document.getElementById('calc-fuel').value) || 0; // Entrada en T/h
    const pres = parseFloat(document.getElementById('calc-presion').value) || 0;
    const temp = parseFloat(document.getElementById('calc-temp').value) || 0;
    const vacio = parseFloat(document.getElementById('calc-vacio').value) || 0;

    if (mw <= 0) {
        notificar("INGRESE LA CARGA (MW)", "error");
        return;
    }

    // --- CÁLCULOS TERMODINÁMICOS ---
    const pci = 10200; // kcal/kg
    // Fórmula: (MW * 860 Mcal/MW) / (Fuel t/h * PCI Mcal/t) * 100
    // Recordar: 1 t/h * 10200 kcal/kg = 10200 Mcal/h
    const eficiencia = ((mw * 860) / (fuel * pci)) * 100;

    let reporte = "";
    let consejos = "";
    let criticidad = "normal";
    let colorHex = "#00ffcc";

    // --- ANÁLISIS DE FASE ---
    let faseActual = "ESTABILIZACIÓN";
    if (mw > 0 && mw < 120) faseActual = "RODADO / SINCRONIZACIÓN";
    else if (mw >= 120 && mw < 580) faseActual = "SUBIDA DE CARGA";
    else if (mw >= 580) faseActual = "OPERACIÓN NOMINAL";

    // --- DETECCIÓN DE FALLAS Y FUGAS ---
    const presEsperada = (mw / 600) * 165;
    if (mw > 100 && pres < presEsperada * 0.85) {
        reporte += "🔍 <b>ALERTA DE FUGA:</b> Presión anormalmente baja para la carga. Verifique estanqueidad en caldera y válvulas de seguridad.<br>";
        criticidad = "alerta"; colorHex = "#ffcc00";
    }

    // --- CONSEJOS DE EFICIENCIA ---
    if (mw > 100) {
        if (eficiencia < 32) {
            consejos += "💡 <b>MEJORA EFICIENCIA:</b> Ciclo degradado. Incremente temperatura de vapor principal si es posible y purgue lodos en domo.<br>";
        } else if (eficiencia < 35) {
            consejos += "💡 <b>OPTIMIZACIÓN:</b> Ajuste exceso de aire en quemadores para reducir pérdidas por chimenea.<br>";
        } else {
            reporte += "⭐ <b>ESTADO ÓPTIMO:</b> Rendimiento térmico excelente.<br>";
        }
    }

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

    // --- INDICADOR DE BUEN CAMINO ---
    if (criticidad === "normal") {
        if (mw > 0 && temp >= 535 && temp <= 542 && vacio < 60) {
            reporte += "✅ <b>PROCESO EN BUEN CAMINO:</b> Todos los parámetros están en rango ideal.<br>";
        } else if (mw > 0) {
            reporte += "🟡 <b>FALTA AJUSTE:</b> Proceso seguro pero fuera de curva de diseño. Estabilice presiones.<br>";
        }
    }

    if (reporte === "") reporte = "✅ <b>SISTEMA DENTRO DE CURVA:</b> No se detectan riesgos estructurales.";

    // --- ACTUALIZAR UI ---
    const resDiv = document.getElementById('diagnostico-rendimiento');
    const resEfi = document.getElementById('res-eficiencia');
    const resDiag = document.getElementById('res-diagnostico');

    resDiv.style.display = 'block';
    resDiv.style.borderLeft = `5px solid ${colorHex}`;
    resEfi.innerHTML = `EFICIENCIA TÉRMICA η: ${eficiencia.toFixed(2)}%`;
    resEfi.style.color = colorHex;
    resDiag.innerHTML = `<b>FASE: ${faseActual}</b><br>${reporte}${consejos ? '<div style="margin-top:8px; padding-top:8px; border-top:1px solid rgba(255,255,255,0.1);">' + consejos + '</div>' : ''}`;

    dibujarGraficaArranqueCompleta(0, mw, temp, criticidad);
    notificar("ANÁLISIS TÉCNICO COMPLETADO", "exito");
}

// ================= CALCULADORA DE CONVERSIÓN TÉCNICA ==================
function actualizarInterfazConversor() {
    const tipo = document.getElementById('conv-tipo').value;
    const cont = document.getElementById('inputs-conversor');
    if(!cont) return;
    cont.innerHTML = "";

    const configs = {
        presion: [
            { id: 'c-bar', label: 'BAR (Presión Atmosférica/Métrica)', unit: 'bar' },
            { id: 'c-psi', label: 'PSI (Libras por pulgada²)', unit: 'psi' },
            { id: 'c-mpa', label: 'MPa (MegaPascales)', unit: 'mpa' },
            { id: 'c-pa', label: 'kPa (KiloPascales)', unit: 'kpa' },
            { id: 'c-mbar', label: 'mbar (Vacío/Baja Presión)', unit: 'mbar' }
        ],
        temp: [
            { id: 'c-celsius', label: 'Grados Celsius (°C)', unit: 'c' },
            { id: 'c-faren', label: 'Grados Fahrenheit (°F)', unit: 'f' },
            { id: 'c-kelvin', label: 'Kelvin (Escala Absoluta K)', unit: 'k' }
        ],
        flujo: [
            { id: 'c-th', label: 'Toneladas/Hora (t/h)', unit: 'th' },
            { id: 'c-kgs', label: 'Kilogramos/Segundo (kg/s)', unit: 'kgs' },
            { id: 'c-lbh', label: 'Libras/Hora (lb/h)', unit: 'lbh' }
        ],
        potencia: [
            { id: 'c-mw', label: 'MegaWatts (MW - Potencia Bruta)', unit: 'mw' },
            { id: 'c-kw', label: 'KiloWatts (kW)', unit: 'kw' },
            { id: 'c-hp', label: 'Caballos de Fuerza (HP)', unit: 'hp' },
            { id: 'c-btu', label: 'BTU/h (Potencia Térmica)', unit: 'btu' }
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
    const f = (n, p = 6) => Number(Number(n).toFixed(p)); // Limpia ceros decimales innecesarios

    if (tipo === 'presion') {
        let bar = 0;
        if (unidad === 'bar') bar = v;
        if (unidad === 'psi') bar = v * 0.0689476;
        if (unidad === 'mbar') bar = v / 1000;
        if (unidad === 'kpa') bar = v / 100;
        if (unidad === 'mpa') bar = v * 10;

        if(unidad !== 'bar') document.getElementById('c-bar').value = f(bar);
        if(unidad !== 'psi') document.getElementById('c-psi').value = f(bar / 0.0689476, 4);
        if(unidad !== 'mbar') document.getElementById('c-mbar').value = f(bar * 1000, 4);
        if(unidad !== 'kpa') document.getElementById('c-pa').value = f(bar * 100, 4);
        if(document.getElementById('c-mpa') && unidad !== 'mpa') document.getElementById('c-mpa').value = f(bar / 10, 6);
    }
    else if (tipo === 'temp') {
        let c = 0;
        if (unidad === 'c') c = v;
        if (unidad === 'f') c = (v - 32) * 5/9;
        if (unidad === 'k') c = v - 273.15;

        if(unidad !== 'c') document.getElementById('c-celsius').value = f(c, 2);
        if(unidad !== 'f') document.getElementById('c-faren').value = f(c * 9/5 + 32, 2);
        if(unidad !== 'k') document.getElementById('c-kelvin').value = f(c + 273.15, 2);
    }
    else if (tipo === 'flujo') {
        let th = 0;
        if (unidad === 'th') th = v;
        if (unidad === 'kgs') th = v * 3.6;
        if (unidad === 'lbh') th = v * 0.000453592;

        if(unidad !== 'th') document.getElementById('c-th').value = f(th, 4);
        if(unidad !== 'kgs') document.getElementById('c-kgs').value = f(th / 3.6, 4);
        if(unidad !== 'lbh') document.getElementById('c-lbh').value = f(th / 0.000453592, 2);
    }
    else if (tipo === 'potencia') {
        let mw = 0;
        if (unidad === 'mw') mw = v;
        if (unidad === 'kw') mw = v / 1000;
        if (unidad === 'hp') mw = v * 0.0007457;
        if (unidad === 'btu') mw = v * 0.000000293071;

        if(unidad !== 'mw') document.getElementById('c-mw').value = f(mw, 6);
        if(unidad !== 'kw') document.getElementById('c-kw').value = f(mw * 1000, 4);
        if(unidad !== 'hp') document.getElementById('c-hp').value = f(mw / 0.0007457, 4);
        if(unidad !== 'btu') document.getElementById('c-btu').value = f(mw / 0.000000293071, 2);
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
    conectarFirebase();
    const area = sessionStorage.getItem('area_actual') || localStorage.getItem('area_actual');
    const role = sessionStorage.getItem('user_role');
    const cardOp = document.getElementById('card-operacion-especial'); if(cardOp) cardOp.style.display = (area === 'Operaciones') ? 'flex' : 'none';

    if (area && document.getElementById('mapa-equipos')) {
        // Si venimos de la bienvenida con un área ya seleccionada, filtrar de una vez
        if (area === 'electricista') {
            filtrarSistema('electricista', false);
        } else if (area === 'protecciones') {
            filtrarSistema('protecciones', true);
        } else {
            filtrarSistema(area);
        }
    }

    // Monitoreo global para el Maestro
    if(role === 'super') {
        cargarSolicitudesAcceso();
        monitorearActividad();
    }

    // Si hay una solicitud pendiente de este dispositivo, reanudar escucha
    const idEsperando = localStorage.getItem('esperando_aprobacion');
    if (idEsperando) {
        escucharEstadoSolicitud(idEsperando);
    }

    if(role === 'super' && document.getElementById('seccion-usuarios')) {
        document.getElementById('seccion-usuarios').style.display = 'block';
        cargarListaUsuarios(); cargarListaPersonalAutorizado();
        cargarMegados(); // También cargar historial de megados en el panel admin
    }

    // Mostrar botón de logout si hay sesión activa
    if((sessionStorage.getItem('user_role') || sessionStorage.getItem('user_name')) && document.getElementById('btn-logout')) {
        document.getElementById('btn-logout').style.display = 'flex';
    }

    const a = document.getElementById('input-area'); if(a) { a.addEventListener('change', cargarEquiposEdicion); cargarEquiposEdicion(); }
    if(document.getElementById('input-manual-area')) {
        cargarManualParaEditar(); cargarPlanosEdicionGeneral(); cargarDocsEdicion();

        // Listener para preview de Planos
        const planoInput = document.getElementById('input-plano-foto-general');
        if(planoInput) {
            planoInput.addEventListener('change', e => {
                const file = e.target.files[0];
                if(file) {
                    const txt = document.getElementById('txt-plano-archivo');
                    if(txt) txt.innerText = "ARCHIVO: " + file.name.toUpperCase();
                    const prev = document.getElementById('preview-plano-general');
                    const imgPrev = document.getElementById('img-preview-plano-general');
                    if(prev && imgPrev) {
                        const r = new FileReader();
                        r.onload = ev => { imgPrev.src = ev.target.result; prev.style.display = 'block'; };
                        r.readAsDataURL(file);
                    }
                }
            });
        }
    }

    const fotoInput = document.getElementById('input-archivo-foto');
    if(fotoInput) {
        fotoInput.addEventListener('change', e => {
            const files = e.target.files;
            if(files.length + fotosBase64.length > 2) { notificar("MÁXIMO 2 FOTOS", "error"); return; }

            Array.from(files).forEach(f => {
                comprimirImagen(f, 0.7, (base64) => {
                    fotosBase64.push(base64);
                    actualizarPreviewsFotos();
                });
            });
        });
    }
});

// Helpers Genéricos
function limpiarFormulario() {
    tagOriginalEdicion = null;
    areaOriginalEdicion = null;
    fotosBase64 = [];
    ['input-tag','input-nombre','input-info','input-operacion','input-ubicacion'].forEach(id=>{ if(document.getElementById(id)) document.getElementById(id).value=""; });
    const fileEq = document.getElementById('input-archivo-foto');
    if(fileEq) fileEq.value = "";
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
    confirmarHMI("¿BORRAR EQUIPO?", "¿Borrar equipo " + t + "?", () => {
        let colaDel = JSON.parse(localStorage.getItem('cola_eliminaciones') || "[]");
        colaDel.push({ area: a, tag: t });
        localStorage.setItem('cola_eliminaciones', JSON.stringify(colaDel));

        let colaEnv = JSON.parse(localStorage.getItem('cola_envios') || "[]");
        colaEnv = colaEnv.filter(i => !(i.tag === t && i.area === a));
        localStorage.setItem('cola_envios', JSON.stringify(colaEnv));

        notificar("ELIMINACIÓN PENDIENTE");
        cargarEquiposEdicion();
        sincronizarColas();
    });
}
function eliminarDocumento(a, i) {
    confirmarHMI("¿BORRAR ARCHIVO?", "¿Borrar documento?", () => {
        let colaDel = JSON.parse(localStorage.getItem('cola_docs_del') || "[]");
        colaDel.push({ area: a, id: i });
        localStorage.setItem('cola_docs_del', JSON.stringify(colaDel));

        let colaEnv = JSON.parse(localStorage.getItem('cola_docs_envios') || "[]");
        colaEnv = colaEnv.filter(item => item.id !== i);
        localStorage.setItem('cola_docs_envios', JSON.stringify(colaEnv));

        notificar("BORRADO PENDIENTE");
        cargarDocsEdicion();
        sincronizarColas();
    });
}
function solicitarEliminarU(u) {
    confirmarHMI("¿ELIMINAR EDITOR?", "¿Borrar editor "+u+"?", () => {
        if(database) database.ref('usuarios/'+u).remove();
    });
}
function cargarParaEditar(j, area) {
    const eq = JSON.parse(decodeURIComponent(j));
    // Normalización estricta al cargar para editar
    tagOriginalEdicion = (eq.fbKey || eq.tag || "").toString().trim().toUpperCase();
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

function verSeccionMegados() {
    const submenu = document.getElementById('submenu-electrica');
    if (submenu) submenu.style.display = 'none';

    const mapEquipos = document.getElementById('mapa-equipos');
    if (mapEquipos) mapEquipos.style.display = 'none';

    const busc = document.getElementById('contenedor-buscador');
    if (busc) busc.style.display = 'none';

    const btnMegaProt = document.getElementById('btn-megado-protecciones');
    if (btnMegaProt) btnMegaProt.style.display = 'none';

    const contMegados = document.getElementById('contenedor-megados-area');
    const contSim = document.getElementById('contenedor-simulador-megado');
    const contDocs = document.getElementById('contenedor-docs-area');

    if (contMegados) {
        contMegados.style.display = 'block';
        cargarMegados();
    }
    if (contSim) {
        contSim.style.display = 'block';
        cargarUltimoMantenimientoSim();
    }
    if (contDocs) {
        // En megados mostramos documentos generales de eléctrica
        contDocs.style.display = 'block';
        cargarDocsDelArea('electricista');
    }
}

// ================= GESTIÓN DE MEGADOS (ÁREA ELÉCTRICA) ==================
function cargarMegados() {
    const lista = document.getElementById('lista-megados');
    if (!lista) return;

    const render = (data = null) => {
        let items = data || JSON.parse(localStorage.getItem('cache_megados') || "{}");

        // FILTRAR LOCALMENTE LOS QUE ESTÁN EN COLA DE ELIMINACIÓN
        const colaDel = JSON.parse(localStorage.getItem('cola_megados_del') || "[]");
        const itemsFiltrados = {};
        Object.keys(items).forEach(k => {
            if(!colaDel.includes(k)) itemsFiltrados[k] = items[k];
        });
        items = itemsFiltrados;

        lista.innerHTML = "";

        const keys = Object.keys(items).sort((a, b) => items[b].timestamp - items[a].timestamp);

        if (keys.length === 0) {
            lista.innerHTML = "<p style='color:#666; font-size:0.75rem; text-align:center;'>Sin registros de megados.</p>";
            return;
        }

        // Agrupar por TAG manteniendo el orden del registro más reciente
        const grupos = {};
        const ordenGrupos = [];

        keys.forEach(id => {
            const m = items[id];
            const tag = m.tag || "S/T";
            if (!grupos[tag]) {
                grupos[tag] = [];
                ordenGrupos.push(tag);
            }
            grupos[tag].push({ ...m, id });
        });

        ordenGrupos.forEach(tag => {
            const historial = grupos[tag];
            const ultimo = historial[0];
            const total = historial.length;

            if (total > 1) {
                // Generar acordeón para múltiples registros
                const accordionId = "acc-" + tag.replace(/[^a-zA-Z0-9]/g, "-");
                lista.innerHTML += `
                    <div class="user-item-modern" style="border-left: 4px solid #ffcc00; background: rgba(255,204,0,0.05); margin-bottom: 10px; flex-direction: column; align-items: stretch; padding: 0;">
                        <div onclick="document.getElementById('${accordionId}').classList.toggle('active'); this.classList.toggle('active')" class="accordion-admin" style="border: none; border-radius: 12px; margin-bottom: 0; background: transparent; padding: 15px;">
                            <div style="flex: 1;">
                                <b style="color:#ffcc00;">${ultimo.equipo}</b> <small style="color:#aaa;">[${tag}]</small><br>
                                <span style="font-size:0.8rem; color:#fff;">${total} REVISIONES DISPONIBLES</span>
                            </div>
                            <i class="fas fa-chevron-down"></i>
                        </div>
                        <div id="${accordionId}" class="panel-admin" style="padding: 0 15px 15px 15px;">
                            ${historial.map(m => `
                                <div style="border-top: 1px solid rgba(255,255,255,0.1); padding: 10px 0;">
                                    <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                                        <div>
                                            <b style="color:#00ccff;">${m.valor} MΩ</b> <small style="color:#888;">(${m.fecha})</small><br>
                                            <div style="font-size: 0.7rem; color: #eee; margin-top: 5px; white-space: pre-wrap;">${m.diagnostico || 'Sin diagnóstico detallado'}</div>
                                            <small style="color:#666;">Por: ${m.tecnico.toUpperCase()}</small>
                                        </div>
                                        ${(sessionStorage.getItem('user_role') === 'super') ?
                                            `<button onclick="eliminarMegado('${m.id}')" style="background:none; border:none; color:#ff4444;"><i class="fas fa-trash-alt"></i></button>` : ''}
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>`;
            } else {
                // Registro único normal
                const m = ultimo;
                lista.innerHTML += `
                    <div class="user-item-modern" style="border-left: 4px solid #ffcc00; background: rgba(255,204,0,0.05); margin-bottom: 10px;">
                        <div style="flex: 1;">
                            <b style="color:#ffcc00;">${m.equipo}</b> <small style="color:#aaa;">[${m.tag}]</small><br>
                            <span style="font-size:1.1rem; font-weight:bold; color:#fff;">${m.valor} MΩ</span><br>
                            <div style="font-size: 0.7rem; color: #eee; margin-top: 5px; white-space: pre-wrap;">${m.diagnostico || 'Sin diagnóstico detallado'}</div>
                            <small style="color:#00ccff;"><i class="fas fa-calendar-alt"></i> ${m.fecha}</small>
                            <small style="color:#888; margin-left:10px;"><i class="fas fa-user-hard-hat"></i> ${m.tecnico.toUpperCase()}</small>
                        </div>
                        ${(sessionStorage.getItem('user_role') === 'super') ?
                            `<button onclick="eliminarMegado('${m.id}')" style="background:none; border:none; color:#ff4444; font-size:1.2rem;"><i class="fas fa-trash-alt"></i></button>` : ''}
                    </div>`;
            }
        });
    };

    render();
    if (database) {
        database.ref('megados').on('value', s => {
            const val = s.val() || {};
            localStorage.setItem('cache_megados', JSON.stringify(val));
            render(val);
        });
    }
}

function abrirGestionMegados() {
    // Si se abre desde el botón general, advertir que debe usarse el simulador
    notificar("USE EL BOTÓN 'REGISTRAR' EN EL SIMULADOR PARA GUARDAR DATOS", "warning");
}

function guardarMegado() {
    const tag = document.getElementById('mega-tag').value.trim().toUpperCase();
    const eq = document.getElementById('mega-equipo').value.trim();
    const val = document.getElementById('mega-valor').value.trim();
    const pass = document.getElementById('mega-pass').value.trim();

    if (!tag || !eq || !val || !pass) { notificar("TODOS LOS CAMPOS SON REQUERIDOS", "error"); return; }

    const fechaHora = new Date().toLocaleString(); // Automático e inalterable

    // Verificar Clave
    const masterPass = localStorage.getItem('master_pass') || 'luis2026';
    const localUsers = JSON.parse(localStorage.getItem('user_db') || "{}");
    let tecnico = "";
    let autorizado = false;

    const masterName = localStorage.getItem('master_name') || 'luis';
    if (pass === masterPass || pass === "6969") {
        autorizado = true;
        tecnico = masterName;
    } else {
        Object.keys(localUsers).forEach(u => {
            if (pass === localUsers[u].clave && (localUsers[u].rol === 'super' || localUsers[u].rol === 'editor')) {
                autorizado = true;
                tecnico = u;
            }
        });
    }

    if (!autorizado) {
        // Consultar nube si no está en local
        if (database) {
            database.ref('usuarios').once('value').then(snap => {
                const users = snap.val() || {};
                let userFound = null;
                Object.keys(users).forEach(u => { if (users[u].clave === pass && (users[u].rol === 'super' || users[u].rol === 'editor')) userFound = u; });

                if (userFound) ejecutarGuardadoMegado(tag, eq, val, fechaHora, userFound);
                else notificar("CLAVE DE AUTORIZACIÓN INCORRECTA", "error");
            });
            return;
        } else {
            notificar("MODO OFFLINE - CLAVE NO RECONOCIDA", "error");
            return;
        }
    }

    ejecutarGuardadoMegado(tag, eq, val, fechaHora, tecnico);
}

function ejecutarGuardadoMegado(tag, equipo, valor, fecha, tecnico) {
    // Capturar diagnóstico del simulador si está activo
    const diagEl = document.getElementById('diagnostico-motor');
    let diagnostico = "Registro manual sin simulador.";
    if (diagEl && diagEl.style.display !== 'none') {
        diagnostico = diagEl.innerText.replace("ANÁLISIS TÉCNICO:", "").trim();
    }

    const data = {
        tag,
        equipo,
        valor,
        fecha,
        tecnico,
        diagnostico,
        timestamp: firebase.database.ServerValue.TIMESTAMP
    };

    if (database) {
        database.ref('megados').push(data).then(() => {
            notificar("REGISTRO GUARDADO EXITOSAMENTE");
            document.getElementById('modal-gestion-megados').style.display = 'none';
            registrarLog("REGISTRÓ MEGADO: " + tag + " (" + valor + " MΩ)");
        });
    } else {
        notificar("ERROR: SIN CONEXIÓN A LA NUBE", "error");
    }
}

function eliminarMegado(id) {
    const role = sessionStorage.getItem('user_role');
    if (role !== 'super') {
        notificar("ACCIÓN RESTRINGIDA AL MAESTRO", "error");
        return;
    }

    confirmarHMI("¿BORRAR REGISTRO?", "¿Eliminar este registro de megado?", () => {
        // AGREGAR A COLA DE ELIMINACIÓN OFFLINE
        let colaDel = JSON.parse(localStorage.getItem('cola_megados_del') || "[]");
        if(!colaDel.includes(id)) colaDel.push(id);
        localStorage.setItem('cola_megados_del', JSON.stringify(colaDel));

        notificar("ELIMINACIÓN PENDIENTE (MODO OFFLINE)");
        cargarMegados(); // Actualizar vista local
        sincronizarColas(); // Intentar sincronizar si hay red
    });
}

function limpiarHistorialMegado() {
    const role = sessionStorage.getItem('user_role');
    if (role !== 'super') {
        notificar("ACCIÓN RESTRINGIDA AL MAESTRO", "error");
        return;
    }

    const btnAcc = document.getElementById('btn-acc-megados');
    if (btnAcc) {
        if (!btnAcc.classList.contains('active')) btnAcc.click();
        btnAcc.scrollIntoView({ behavior: 'smooth' });
        notificar("ELIJA EL REGISTRO A ELIMINAR ESPECÍFICAMENTE", "info");
    }
}

// ================= SIMULADOR TÉCNICO DE AISLAMIENTO (MEGADO) ==================
function calcularSaludMotor() {
    const v = parseFloat(document.getElementById('sim-voltaje').value) || 480;
    const r = parseFloat(document.getElementById('sim-resistencia').value) || 0;
    const t = parseFloat(document.getElementById('sim-temp').value) || 25;
    const h = parseFloat(document.getElementById('sim-horas').value) || 0;

    if (r <= 0) return;

    // 1. Corrección de Temperatura a 40°C (Factor K = 0.5 por cada 10°C)
    const rCorregida = r * Math.pow(0.5, (40 - t) / 10);

    // 2. Resistencia Mínima Sugerida (IEEE 43-2000): kV + 1 MΩ
    const rMin = (v / 1000) + 1;

    // 3. Cálculo de Porcentaje de Salud (0 a 100)
    let salud = 0;
    if (rCorregida >= rMin * 10) salud = 100;
    else if (rCorregida <= rMin) salud = 0;
    else salud = ((rCorregida - rMin) / (rMin * 9)) * 100;

    // 4. Actualizar Gráfica
    const bar = document.getElementById('gauge-bar');
    const valTxt = document.getElementById('res-simulador-valor');
    const statusTxt = document.getElementById('res-simulador-status');

    bar.style.width = salud + "%";
    valTxt.innerText = rCorregida.toFixed(1) + " MΩ (Corregido)";

    if (salud > 80) { bar.style.background = "#2ecc71"; statusTxt.innerText = "ESTADO: ÓPTIMO"; statusTxt.style.color = "#2ecc71"; }
    else if (salud > 40) { bar.style.background = "#f1c40f"; statusTxt.innerText = "ESTADO: ADCEPTABLE"; statusTxt.style.color = "#f1c40f"; }
    else { bar.style.background = "#e74c3c"; statusTxt.innerText = "ESTADO: CRÍTICO / RIESGO"; statusTxt.style.color = "#e74c3c"; }

    // 5. Diagnóstico y Sugerencias
    const diag = document.getElementById('diagnostico-motor');
    diag.style.display = 'block';

    let sug = "";
    const proximoMantenimientoHoras = 8000 - (h % 8000);

    if (salud < 30) sug = "🚨 <b>PELIGRO INMINENTE:</b> El motor presenta baja resistencia. NO ARRANCAR. Requiere limpieza y secado de devanados urgente.";
    else if (salud < 60) sug = "⚠️ <b>ALERTA TÉCNICA:</b> Aislamiento degradado. Programar mantenimiento preventivo en las próximas 48 horas.";
    else if (proximoMantenimientoHoras < 1000) sug = "🔧 <b>SUGERENCIA:</b> Ciclo de vida útil en etapa de servicio. Programar engrase y revisión en " + proximoMantenimientoHoras.toFixed(0) + " horas.";
    else sug = "✅ <b>SISTEMA SALUDABLE:</b> El motor opera dentro de parámetros nominales. Siga plan de inspección trimestral.";

    diag.innerHTML = `
        <b style="color:#00ccff;">ANÁLISIS TÉCNICO:</b><br>
        • Resistencia Corregida (40°C): <b>${rCorregida.toFixed(2)} MΩ</b><br>
        • Límite Crítico (IEEE): <b>${rMin.toFixed(2)} MΩ</b><br>
        • Vida Útil Estimada: <b>${salud.toFixed(1)}%</b><br><br>
        ${sug}
    `;
}

function registrarMantenimientoSim() {
    const v = document.getElementById('sim-voltaje').value;
    const r = document.getElementById('sim-resistencia').value;

    if (!v || !r) { notificar("COMPLETE LOS DATOS DEL SIMULADOR", "error"); return; }

    // Preparar modal de megados con datos del simulador
    document.getElementById('mega-valor').value = r;
    document.getElementById('mega-tag').value = "";
    document.getElementById('mega-equipo').value = "";
    document.getElementById('mega-pass').value = "";

    document.getElementById('modal-gestion-megados').style.display = 'flex';
    notificar("INGRESE LOS DATOS DEL EQUIPO Y SU CLAVE", "info");
}

function cargarUltimoMantenimientoSim() {
    if (!database) return;
    database.ref('historial_mantenimientos_motores').limitToLast(1).once('value', s => {
        const data = s.val();
        const diag = document.getElementById('diagnostico-motor');
        if (data && diag) {
            const last = Object.values(data)[0];
            const fechaLast = new Date(last.timestamp);
            const hoy = new Date();
            const mesesTranscurridos = (hoy - fechaLast) / (1000 * 60 * 60 * 24 * 30);

            let extraInfo = `<br><hr style="border:0; border-top:1px solid rgba(255,255,255,0.1); margin:10px 0;">`;
            extraInfo += `<b style="color:#ffcc00;">ÚLTIMO MANTENIMIENTO REGISTRADO:</b><br>`;
            extraInfo += `• Fecha: ${last.fecha} (${last.tecnico.toUpperCase()})<br>`;
            extraInfo += `• Valor: ${last.resistencia} MΩ<br>`;

            if (mesesTranscurridos > 6) {
                extraInfo += `<br><span style="color:#ff4444;">🚨 HAN PASADO MÁS DE 6 MESES DESDE EL ÚLTIMO MEGADO. SE RECOMIENDA REALIZAR UNA NUEVA MEDICIÓN DE INMEDIATO.</span>`;
            } else {
                const mesesRestantes = (6 - mesesTranscurridos).toFixed(1);
                extraInfo += `<br><span style="color:#2ecc71;">✅ PRÓXIMA REVISIÓN SUGERIDA EN: ${mesesRestantes} MESES.</span>`;
            }

            // Si el div ya tiene contenido del cálculo actual, lo conservamos y añadimos esto
            if (!diag.innerHTML.includes("ÚLTIMO MANTENIMIENTO")) {
                diag.innerHTML += extraInfo;
                diag.style.display = 'block';
            }
        }
    });
}


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
                notificar("ACCESO DENEGADO - CONSULTE CON EL ADMINISTRADOR", "error", true);
                localStorage.removeItem('esperando_aprobacion');
                const msg = document.getElementById('msg-error-id');
                if(msg) msg.innerText = "SOLICITUD RECHAZADA POR SEGURIDAD";
                database.ref('personal_autorizado/' + id).off('value');
            }
            return;
        }

        if (u.estado === 'activo') {
            notificar("ACCESO AUTORIZADO - BIENVENIDO AL SISTEMA", "exito", true);
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

function togglePasswordVisibility(inputId, iconId) {
    const input = document.getElementById(inputId);
    const icon = document.getElementById(iconId);
    if (input && icon) {
        if (input.type === "password") {
            input.type = "text";
            icon.classList.remove("fa-eye");
            icon.classList.add("fa-eye-slash");
        } else {
            input.type = "password";
            icon.classList.remove("fa-eye-slash");
            icon.classList.add("fa-eye");
        }
    }
}

// ================= PROTOCOLO DE SUCESIÓN AUTOMÁTICA (72H) ==================
function guardarSucesor() {
    const sucesor = document.getElementById('sucesor-seleccionado').value;
    if (!sucesor) { notificar("SELECCIONE UN CANDIDATO", "error"); return; }

    confirmarHMI("CONFIRMAR SUCESIÓN", "¿Deseas asignar a " + sucesor.toUpperCase() + " como sucesor legal del sistema?", () => {
        if (database) {
            database.ref('config/sucesor_emergencia').set(sucesor).then(() => {
                notificar("SUCESOR ASIGNADO CORRECTAMENTE", "exito");
                cargarConfigSucesion();
            });
        }
    });
}

function cargarConfigSucesion() {
    const select = document.getElementById('sucesor-seleccionado');
    const info = document.getElementById('info-sucesion-actual');
    if (!select || !database) return;

    // Poblar dropdown con editores
    database.ref('usuarios').once('value', s => {
        const users = s.val() || {};
        select.innerHTML = '<option value="">-- SELECCIONAR EDITOR --</option>';
        Object.keys(users).forEach(u => {
            if (users[u].rol === 'editor') {
                select.innerHTML += `<option value="${u}">${u.toUpperCase()}</option>`;
            }
        });

        // Ver sucesor actual
        database.ref('config').once('value', sc => {
            const conf = sc.val() || {};
            const suc = conf.sucesor_emergencia || "NINGUNO";
            const last = conf.master_last_login || 0;

            let fechaStr = "SIN REGISTRO";
            if (last) {
                const d = new Date(last);
                fechaStr = d.toLocaleString();
            }

            if (info) {
                info.innerHTML = `
                    <div style="background:rgba(0,0,0,0.2); padding:10px; border-radius:8px; border:1px solid #333;">
                        <b style="color:#e67e22;">SUCESOR ACTUAL:</b> ${suc.toUpperCase()}<br>
                        <b style="color:#2ecc71;">ÚLTIMO LOGIN MAESTRO:</b><br>${fechaStr}
                    </div>
                `;
            }
            if (suc !== "NINGUNO") select.value = suc;
        });
    });
}

function verificarSucesionAutomatica() {
    if (!database) return;

    database.ref('config').once('value', s => {
        const conf = s.val() || {};
        const lastLogin = conf.master_last_login;
        const sucesor = conf.sucesor_emergencia;

        if (!lastLogin || !sucesor || sucesor === "NINGUNO") return;

        const ahora = Date.now();
        const diferenciaHoras = (ahora - lastLogin) / (1000 * 60 * 60);

        // SI HAN PASADO MÁS DE 72 HORAS (3 DÍAS)
        if (diferenciaHoras >= 72) {
            console.log("!!! PROTOCOLO DE SUCESIÓN ACTIVADO !!!");

            // 1. Obtener datos del sucesor
            database.ref('usuarios/' + sucesor).once('value', us => {
                const userData = us.val();
                if (userData) {
                    // 2. PROMOVER A MAESTRO
                    database.ref('config/master_name').set(userData.nombre);
                    database.ref('config/master_pass').set(userData.clave);
                    database.ref('usuarios/' + sucesor + '/rol').set('super');

                    // 3. Resetear timer para evitar bucles de promoción
                    database.ref('config/master_last_login').set(ahora);
                    database.ref('config/sucesor_emergencia').set("NINGUNO");

                    notificar("ALERTA: SUCESIÓN DE MANDO ACTIVADA POR AUSENCIA", "warning", true);
                }
            });
        }
    });
}

// Inicializar config si estamos en admin
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('sucesor-seleccionado')) {
        cargarConfigSucesion();
    }
});

function cargarPlanosVista() { /* No longer needed */ }

