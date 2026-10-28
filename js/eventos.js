// Lógica de carga, consulta y renderizado de eventos con Firebase Firestore y Storage
import { db, storage, auth, firebaseConfig } from "./firebase-config.js?v=202610280003";
import {
  normalizarTelefonoAR,
  escapeHtml,
  PRECIO_TIPOS,
  MAX_DETALLE_PRECIO,
  POR_PAGINA,
  parsearMonto,
  construirPrecio,
  formatearPrecioEvento,
  validarEntradas,
  urlSegura,
  paginar,
  renderPaginacion,
} from "./utils.js?v=202610280003";
import { procesarImagen4x5, crearControladorImagen } from "./imagen.js?v=202610280003";
import {
  configurarCamposPrecio,
  leerPrecio,
  limpiarPrecio,
} from "./campos-evento.js?v=202610280003";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  serverTimestamp,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import {
  ref,
  uploadBytes,
  getDownloadURL,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

/**
 * Única fuente de verdad de las localidades permitidas por zona (body[data-location]).
 * - La clave es la ZONA de la página: 'sanrafael' | 'mendoza'.
 * - Los valores son los nombres exactos de las localidades (con tildes) que se
 *   guardan en el campo 'localidad' del evento en Firestore.
 */
export const LOCALIDADES_POR_ZONA = {
  sanrafael: ["San Rafael", "General Alvear", "Malargüé"],
  mendoza: [
    "Ciudad de Mendoza",
    "Las Heras",
    "Godoy Cruz",
    "Guaymallén",
    "Maipú",
    "Luján de Cuyo",
  ],
};

export const MAX_DESCRIPCION = 300;
export const DESCRIPCION_CORTA = 140;

/**
 * Única fuente de verdad de los planes de publicación.
 * id: "gratuito" | "destacado" | "premium" | "personalizado" | "sponsor".
 * tipo: "gratuito" | "pago" | "whatsapp".
 */
export const PLANES = [
  {
    id: "gratuito",
    tipo: "gratuito",
    nombre: "Plan Gratuito",
    titulo: "🟢 Plan Gratuito",
    precio: null,
    beneficios: [
      "Publicación en la página web.",
      "Difusión el mismo día del evento en los grupos de WhatsApp de tu zona.",
    ],
    requisito:
      "⚠️ Requisito: Los eventos deben cargarse con un mínimo de 2 días de anticipación a su realización para garantizar su procesamiento.",
    btnTexto: "Continuar con Plan Gratuito",
  },
  {
    id: "destacado",
    tipo: "pago",
    nombre: "Plan Destacado",
    titulo: "⭐ Plan Destacado — $10.000",
    precio: 10000,
    beneficios: [
      "Publicación prioritaria en los grupos de WhatsApp de tu zona.",
      "Ubicación prioritaria en la web como Evento Destacado (ordenados por fecha más próxima).",
      "Difusión gratuita adicional el día del evento.",
    ],
    btnTexto: "Seleccionar Plan Destacado",
  },
  {
    id: "premium",
    tipo: "pago",
    nombre: "Plan Premium",
    titulo: "🚀 Plan Premium + Instagram — $15.000",
    precio: 15000,
    beneficios: [
      "Publicación prioritaria en grupos de WhatsApp e Instagram de tu zona.",
      "Ubicación prioritaria en la web como Evento Destacado (ordenados por fecha más próxima).",
      "Difusión gratuita adicional el día del evento.",
    ],
    btnTexto: "Seleccionar Plan Premium",
  },
  {
    id: "personalizado",
    tipo: "whatsapp",
    nombre: "Planes Personalizados",
    titulo: "📦 Planes Personalizados",
    precio: null,
    subtitulo:
      "Descuentos mensuales ideales para cartelera continua, productoras, teatros o múltiples publicaciones.",
    beneficios: [],
    btnTexto: "Consultar Planes Personalizados",
    waMensaje: "Hola! Quiero más información sobre los planes personalizados.",
  },
  {
    id: "sponsor",
    tipo: "whatsapp",
    nombre: "Sponsors",
    titulo: "🤝 Sponsors",
    precio: null,
    subtitulo:
      "Posiciona tu marca en toda nuestra red de difusión regional y provincial.",
    beneficios: [],
    btnTexto: "Quiero ser Sponsor",
    waMensaje: "Hola! Quiero ser sponsor de la agenda.",
  },
];

/**
 * Devuelve la fecha local de hoy sumada `dias` días, en formato "AAAA-MM-DD".
 * Usa la fecha LOCAL del navegador (misma lógica que fechaLocalHoy).
 * @param {number} dias
 * @returns {string}
 */
export function fechaLocalMasDias(dias) {
  const ahora = new Date();
  ahora.setDate(ahora.getDate() + dias);
  const año = ahora.getFullYear();
  const mes = String(ahora.getMonth() + 1).padStart(2, "0");
  const día = String(ahora.getDate()).padStart(2, "0");
  return `${año}-${mes}-${día}`;
}

/**
 * Arma la URL de Google Maps para un evento.
 * Une con ", " los datos no vacíos de [lugar, direccion, localidad, "Mendoza, Argentina"]
 * y devuelve el enlace de búsqueda.
 * @param {object} ev - Objeto del evento con campos lugar, direccion, localidad.
 * @returns {string}
 */
export function construirUrlMaps(ev) {
  const partes = [
    ev.lugar,
    ev.direccion,
    ev.localidad,
    "Mendoza, Argentina",
  ].filter((p) => p && String(p).trim() !== "");
  const consulta = partes.join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(consulta)}`;
}

/**
 * normalizarTelefonoAR y escapeHtml ahora viven en js/utils.js (se importan al
 * inicio de este módulo) para poder reusarlas desde admin.js sin efectos
 * secundarios de DOM.
 */

/**
 * Devuelve la fecha local de hoy en formato "AAAA-MM-DD".
 * Usa getFullYear/getMonth/getDate de la fecha LOCAL del navegador.
 * NO usar toISOString() porque usa UTC y desde las 21:00 en Argentina
 * devuelve el día siguiente.
 * @returns {string}
 */
export function fechaLocalHoy() {
  const ahora = new Date();
  const año = ahora.getFullYear();
  const mes = String(ahora.getMonth() + 1).padStart(2, "0");
  const día = String(ahora.getDate()).padStart(2, "0");
  return `${año}-${mes}-${día}`;
}

/**
 * 1. Función para subir evento:
 * - Exige que haya un usuario de Google autenticado (auth.currentUser).
 * - Valida la localidad (lista cerrada de la zona), la fecha, la hora, la
 *   descripción, el precio y los datos para conseguir la entrada (al menos uno
 *   entre teléfono, link de compra e Instagram) ANTES de subir la imagen.
 * - La imagen siempre se convierte a 4:5 (1080 x 1350 px), JPEG calidad 0.9, y
 *   se sube a Firebase Storage.
 * - Guarda los datos en la colección 'eventos' en Firestore y crea el registro
 *   del autor en 'autores/{eventoId}' de forma atómica con writeBatch (un único
 *   commit). El documento del evento NO guarda email ni uid.
 * - Campos: nombre, descripcion, fecha, hora, lugar, direccion, localidad,
 *   contacto, linkEntradas, redes, precioTipo, precioValor, precioDetalle,
 *   precio, imagenUrl, ubicacion, estado ('pendiente'), destacado (false),
 *   plan ('gratuito' | 'destacado' | 'premium'), fechaCreacion.
 */
export async function subirEvento({
  nombre,
  descripcion,
  fecha,
  hora,
  lugar,
  direccion,
  localidad,
  contacto,
  linkEntradas,
  redes,
  precioTipo,
  precioValor,
  precioDetalle,
  ubicacion,
  imagenArchivo,
  imagenProcesada,
  modoImagen,
  plan,
}) {
  // Exigir usuario autenticado
  const user = auth.currentUser;
  if (!user) {
    throw new Error(
      "Debes iniciar sesión con tu cuenta de Google para publicar un evento.",
    );
  }

  if (!imagenArchivo && !imagenProcesada) {
    throw new Error("Debe seleccionar una imagen para el evento.");
  }

  // Validación del plan elegido (los planes personalizados y sponsors no pasan
  // por este formulario).
  const PLANES_CON_FORMULARIO = ["gratuito", "destacado", "premium"];
  if (!PLANES_CON_FORMULARIO.includes(plan)) {
    throw new Error("Elegí un plan de publicación antes de enviar el evento.");
  }

  // Validación de la localidad contra la lista cerrada de la zona.
  // Se hace ANTES de subir la imagen a Storage para no dejar archivos huérfanos.
  const localidadesValidas = LOCALIDADES_POR_ZONA[ubicacion];
  if (!localidadesValidas) {
    throw new Error(
      `La zona "${ubicacion}" no es válida. Debe ser 'sanrafael' o 'mendoza'.`,
    );
  }
  if (!localidad || !localidadesValidas.includes(localidad)) {
    throw new Error(
      `Debe seleccionar una localidad válida para la zona "${ubicacion}". Localidades permitidas: ${localidadesValidas.join(", ")}.`,
    );
  }

  // Validación de fecha: no anterior a hoy
  const hoyStr = fechaLocalHoy();
  if (fecha && fecha < hoyStr) {
    throw new Error("La fecha no puede ser anterior a hoy.");
  }

  // Plan gratuito: el evento debe cargarse con al menos 2 días de anticipación
  if (plan === "gratuito" && fecha && fecha < fechaLocalMasDias(2)) {
    throw new Error(
      "Con el Plan Gratuito el evento debe cargarse con al menos 2 días de anticipación.",
    );
  }

  // Validación de hora: minutos 00, 15, 30 o 45
  const HORA_REGEX = /^([01]\d|2[0-3]):(00|15|30|45)$/;
  if (!hora || !HORA_REGEX.test(hora)) {
    throw new Error("Elegí la hora y los minutos del evento.");
  }

  const descripcionLimpia = (descripcion || "").trim();
  if (descripcionLimpia.length > MAX_DESCRIPCION) {
    throw new Error(
      `La descripción no puede exceder los ${MAX_DESCRIPCION} caracteres (actual: ${descripcionLimpia.length}).`,
    );
  }

  // Precio de la entrada
  if (!Object.prototype.hasOwnProperty.call(PRECIO_TIPOS, precioTipo)) {
    throw new Error("Elegí el precio de la entrada (puede ser gratuita).");
  }
  let valorPrecio = null;
  if (precioTipo === "fijo" || precioTipo === "desde") {
    valorPrecio = parsearMonto(precioValor);
    if (!valorPrecio) {
      throw new Error("Ingresá el valor de la entrada en pesos. Ejemplo: 5.000");
    }
  }
  const detallePrecio =
    precioTipo === "otro" || precioTipo === "colaboracion"
      ? String(precioDetalle || "").trim().slice(0, MAX_DETALLE_PRECIO)
      : "";
  if (precioTipo === "otro" && !detallePrecio) {
    throw new Error(
      "Escribí qué precio tiene el evento. Ejemplo: alimento no perecedero, a la gorra.",
    );
  }
  const precioTexto = construirPrecio({
    tipo: precioTipo,
    valor: valorPrecio,
    detalle: detallePrecio,
  });

  // Datos para conseguir la entrada: alcanza con que haya uno
  const entradas = validarEntradas({ contacto, linkEntradas, redes });
  if (!entradas.ok) {
    throw new Error(entradas.error);
  }

  const MAX_SIZE_MB = 15;
  const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;
  if (imagenArchivo && imagenArchivo.size > MAX_SIZE_BYTES) {
    const tamanoMB = (imagenArchivo.size / (1024 * 1024)).toFixed(2);
    throw new Error(
      `La imagen supera el límite de ${MAX_SIZE_MB} MB (tamaño: ${tamanoMB} MB). Elija una imagen más liviana.`,
    );
  }

  // Imagen: siempre 4:5, 1080 x 1350, JPEG calidad 0.9 (si falla el
  // procesado se lanza un Error y no se sube nada).
  const blobImagen =
    imagenProcesada ||
    (await procesarImagen4x5(imagenArchivo, modoImagen || "recortar"));
  const nombreBase =
    (imagenArchivo ? imagenArchivo.name : "evento")
      .replace(/\.[^/.]+$/, "")
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(0, 60) || "evento";

  const storageRef = ref(storage, `eventos/${Date.now()}_${nombreBase}.jpg`);
  const snapshot = await uploadBytes(storageRef, blobImagen, {
    contentType: "image/jpeg",
    cacheControl: "public,max-age=31536000,immutable",
  });
  const imagenUrl = await getDownloadURL(snapshot.ref);

  // Generar ID del documento del evento y construir los datos (sin email/uid)
  const eventoRef = doc(collection(db, "eventos"));
  const nuevoEvento = {
    nombre,
    descripcion: descripcionLimpia,
    fecha,
    hora,
    lugar,
    direccion,
    localidad,
    contacto: entradas.contacto,
    linkEntradas: entradas.linkEntradas,
    redes: entradas.redes,
    precioTipo,
    precioValor: valorPrecio,
    precioDetalle: detallePrecio,
    precio: precioTexto,
    imagenUrl,
    ubicacion, // 'sanrafael' o 'mendoza'
    estado: "pendiente",
    destacado: false,
    plan, // 'gratuito' | 'destacado' | 'premium' (el admin destaca tras el pago)
    fechaCreacion: serverTimestamp(),
  };

  // Escribir evento y autor de forma atómica en un único commit
  const batch = writeBatch(db);
  batch.set(eventoRef, nuevoEvento);
  batch.set(doc(db, "autores", eventoRef.id), {
    uid: user.uid,
    email: user.email,
    nombre: user.displayName || "",
    fechaCreacion: serverTimestamp(),
  });
  await batch.commit();

  return { id: eventoRef.id, ...nuevoEvento };
}

// ---------------------------------------------------------------------------
// Flujo del modal de carga: 1) login con Google -> 2) planes -> 3) formulario
// -> 4) éxito (solo planes pagos)
// ---------------------------------------------------------------------------

// Estado del flujo de carga dentro de la sesión actual del modal.
let planElegido = null; // objeto de PLANES o null
let usuarioLogueado = null; // usuario de Firebase o null
let pasoActual = "auth"; // "auth" | "planes" | "form" | "exito"
let numeroConsultasCache = null; // número de WhatsApp (549 + 10 dígitos) o null

function modalCargaActivo() {
  const modal = document.getElementById("upload-modal");
  return Boolean(modal && modal.classList.contains("active"));
}

/**
 * Listener del evento "agenda:auth" que despacha auth.js cada vez que cambia
 * la sesión de Google. Si el modal está abierto:
 * - con sesión iniciada pasa del login a la pantalla de planes;
 * - al cerrar sesión vuelve al login y olvida el plan elegido.
 */
export function initAuthListener() {
  document.addEventListener("agenda:auth", (e) => {
    const user = e.detail ? e.detail.user : null;
    usuarioLogueado = user || null;
    if (!modalCargaActivo()) return;
    if (user) {
      if (pasoActual === "auth") mostrarPaso("planes");
    } else {
      planElegido = null;
      mostrarPaso("auth");
    }
  });
}

/**
 * Abre el modal de carga. Primero el login; si ya hay sesión iniciada, va
 * directo a la pantalla de planes.
 */
export function abrirModalCarga() {
  const modal = document.getElementById("upload-modal");
  if (!modal) return;
  planElegido = null;
  const hayUsuario = usuarioLogueado || auth.currentUser;
  modal.classList.add("active");
  mostrarPaso(hayUsuario ? "planes" : "auth");
  // Precarga el número de WhatsApp que usan los botones de los planes.
  cargarNumeroConsultas();
}

/** Cierra el modal de carga y olvida el plan elegido. */
export function cerrarModalCarga() {
  const modal = document.getElementById("upload-modal");
  if (modal) modal.classList.remove("active");
  planElegido = null;
}

/**
 * Lee config/whatsapp de Firestore y guarda en memoria el número de consultas y
 * pagos (campo numeroConsultas). Si falta o falla la lectura, los botones que
 * dependen de WhatsApp quedan deshabilitados.
 * @returns {Promise<string|null>}
 */
async function cargarNumeroConsultas() {
  if (!numeroConsultasCache) {
    try {
      const snap = await getDoc(doc(db, "config", "whatsapp"));
      if (snap.exists()) {
        numeroConsultasCache =
          normalizarTelefonoAR(snap.data().numeroConsultas) || null;
      }
    } catch (error) {
      console.error("[eventos] Error al leer config de WhatsApp:", error);
    }
  }
  aplicarDisponibilidadWhatsapp();
  return numeroConsultasCache;
}

// Arma el enlace de WhatsApp al número de consultas con el mensaje codificado.
function construirUrlWhatsApp(mensaje) {
  return `https://wa.me/${numeroConsultasCache}?text=${encodeURIComponent(mensaje)}`;
}

// Genera el HTML de una tarjeta de plan.
// @param {object} plan
// @returns {string}
function generarPlanCard(plan) {
  const esPago = plan.tipo === "pago";
  // El título de PLANES incluye el precio; en la tarjeta se muestra aparte.
  const tituloCard = plan.titulo.split(" — ")[0];
  const precioHTML =
    plan.precio !== null
      ? `<span class="plan-precio">$${plan.precio.toLocaleString("es-AR")}</span>`
      : "";
  const beneficiosHTML = plan.beneficios
    .map((b) => `<li>${escapeHtml(b)}</li>`)
    .join("");
  const requisitoHTML = plan.requisito
    ? `<p class="plan-requisito">${escapeHtml(plan.requisito)}</p>`
    : "";
  const subtituloHTML = plan.subtitulo
    ? `<p class="plan-subtitulo">${escapeHtml(plan.subtitulo)}</p>`
    : "";
  const claseBtn = esPago
    ? "btn-plan pago"
    : plan.tipo === "whatsapp"
      ? "btn-plan whatsapp"
      : "btn-plan gratuito";

  return `
    <article class="plan-card${esPago ? " pago" : ""}">
      <div class="plan-titulo"><span>${escapeHtml(tituloCard)}</span>${precioHTML}</div>
      ${subtituloHTML}
      ${beneficiosHTML.length > 0 ? `<ul class="plan-beneficios">${beneficiosHTML}</ul>` : ""}
      ${requisitoHTML}
      <button type="button" id="btn-plan-${plan.id}" class="${claseBtn}">
        ${escapeHtml(plan.btnTexto)}
      </button>
    </article>
  `;
}

// Renderiza la pantalla de planes dentro de #plans-step y vincula los eventos.
function renderizarPlanesStep() {
  const contenedor = document.getElementById("plans-step");
  if (!contenedor) return;
  contenedor.innerHTML = `
    <div class="planes-header">
      <h3 class="planes-titulo">🎭 Elige el plan ideal para tu evento</h3>
      <p class="planes-subtitulo">Antes de completar los datos, selecciona la modalidad de publicación que mejor se adapte a tus necesidades:</p>
    </div>
    <div class="planes-lista" id="planes-lista">
      ${PLANES.map(generarPlanCard).join("")}
    </div>
  `;
  PLANES.forEach((plan) => {
    const btn = document.getElementById(`btn-plan-${plan.id}`);
    if (btn) {
      btn.addEventListener("click", () => seleccionarPlan(plan));
    }
  });
  aplicarDisponibilidadWhatsapp();
}

// Gratuito / Destacado / Premium: pasa al formulario. Personalizados y
// Sponsors: abre WhatsApp directo con su mensaje.
// @param {object} plan
function seleccionarPlan(plan) {
  if (plan.tipo === "whatsapp") {
    abrirWhatsAppDirecto(plan.waMensaje);
    return;
  }
  // El login se pide antes de los planes; por las dudas, se revalida.
  if (!(usuarioLogueado || auth.currentUser)) {
    mostrarPaso("auth");
    return;
  }
  planElegido = plan;
  mostrarPaso("form");
}

// Abre WhatsApp en pestaña nueva para planes personalizados / sponsors.
// @param {string} mensaje
function abrirWhatsAppDirecto(mensaje) {
  if (!numeroConsultasCache) {
    alert("El contacto no está disponible por el momento. Probá más tarde.");
    return;
  }
  window.open(construirUrlWhatsApp(mensaje), "_blank", "noopener");
}

// Habilita/deshabilita los botones que dependen del número de WhatsApp
// (planes pagos, personalizados y sponsors).
function aplicarDisponibilidadWhatsapp() {
  const disponible = Boolean(numeroConsultasCache);
  PLANES.filter((p) => p.tipo !== "gratuito").forEach((plan) => {
    const btn = document.getElementById(`btn-plan-${plan.id}`);
    if (!btn) return;
    btn.disabled = !disponible;
    btn.textContent = disponible
      ? plan.btnTexto
      : "Contacto no disponible por el momento";
  });
}

// Muestra un solo paso del modal: "auth" | "planes" | "form" | "exito".
// @param {"auth"|"planes"|"form"|"exito"} paso
function mostrarPaso(paso) {
  pasoActual = paso;
  const pasos = {
    auth: document.getElementById("auth-step"),
    planes: document.getElementById("plans-step"),
    form: document.getElementById("event-form"),
    exito: document.getElementById("exito-step"),
  };
  Object.values(pasos).forEach((el) => {
    if (el) el.style.display = "none";
  });
  if (pasos[paso]) pasos[paso].style.display = "block";

  if (paso === "form") {
    actualizarAvisoPlan();
    actualizarFechaMinPorPlan();
    actualizarBotonEnvio();
  }

  // El modal vuelve arriba al cambiar de paso
  const contenedor = document.querySelector("#upload-modal .modal-container");
  if (contenedor) contenedor.scrollTop = 0;
}

// Línea "Plan elegido: ... Cambiar plan" arriba del formulario.
function actualizarAvisoPlan() {
  const aviso = document.getElementById("plan-actual-aviso");
  if (!aviso) return;
  if (!planElegido) {
    aviso.style.display = "none";
    return;
  }
  aviso.style.display = "flex";
  aviso.innerHTML = `<span>Plan elegido: <strong>${escapeHtml(planElegido.titulo)}</strong></span><button type="button" id="btn-cambiar-plan" class="link-btn">Cambiar plan</button>`;
  const btnCambiar = document.getElementById("btn-cambiar-plan");
  if (btnCambiar) {
    // No se borra el formulario: al volver a elegir plan se conserva lo escrito
    btnCambiar.addEventListener("click", () => mostrarPaso("planes"));
  }
}

// Texto del botón de envío según el plan.
function actualizarBotonEnvio() {
  const form = document.getElementById("event-form");
  const btn = form ? form.querySelector('button[type="submit"]') : null;
  if (!btn || !planElegido) return;
  if (!btn.dataset.textoOriginal) btn.dataset.textoOriginal = btn.innerHTML;
  btn.innerHTML =
    planElegido.tipo === "pago"
      ? '<i class="fa-brands fa-whatsapp"></i> Enviar y consultar por WhatsApp'
      : btn.dataset.textoOriginal;
}

// Actualiza el min del campo fecha y el aviso según el plan elegido.
// Si la fecha ya elegida deja de ser válida, se limpia y se avisa.
function actualizarFechaMinPorPlan() {
  const campoFecha = document.getElementById("event-date");
  if (!campoFecha) return;
  const hint = document.getElementById("fecha-hint-gratuito");
  const esGratuito = Boolean(planElegido && planElegido.id === "gratuito");
  const minStr = esGratuito ? fechaLocalMasDias(2) : fechaLocalHoy();

  campoFecha.min = minStr;
  if (hint) hint.style.display = esGratuito ? "block" : "none";

  if (campoFecha.value && campoFecha.value < minStr) {
    campoFecha.value = "";
    alert(
      "La fecha elegida no es válida para el plan seleccionado. Elegí una nueva fecha.",
    );
  }
}

// Renderiza el paso "éxito" de los planes pagos.
// @param {string|null} urlWhatsApp
function renderizarExito(urlWhatsApp) {
  const exito = document.getElementById("exito-step");
  if (!exito) return;
  const botonWa = urlWhatsApp
    ? `<a href="${escapeHtml(urlWhatsApp)}" target="_blank" rel="noopener noreferrer" id="btn-exito-whatsapp" class="btn btn-primary" style="width: 100%; justify-content: center; margin-bottom: 0.75rem;">Continuar por WhatsApp</a>`
    : `<button type="button" id="btn-exito-whatsapp" class="btn btn-primary" style="width: 100%; justify-content: center; margin-bottom: 0.75rem;" disabled>Contacto no disponible por el momento</button>`;
  exito.innerHTML = `
    <div style="text-align: center; padding: 1rem 0;">
      <h3 style="margin-bottom: 0.5rem">¡Evento guardado!</h3>
      <p style="color: var(--text-muted); margin-bottom: 1rem; font-size: 0.95rem;">
        ¡Tu evento se guardó! Para activar el plan y coordinar el pago, continuá por WhatsApp.
      </p>
      ${botonWa}
      <button type="button" id="btn-exito-cerrar" class="btn btn-outline" style="width: 100%; justify-content: center;">Cerrar</button>
    </div>
  `;
  const btnCerrar = document.getElementById("btn-exito-cerrar");
  if (btnCerrar) {
    btnCerrar.addEventListener("click", cerrarModalCarga);
  }
}

/**
 * 2. Función para consultar eventos públicos:
 * - Trae eventos con estado == 'aprobado', ubicacion coincidente y fecha >= hoy.
 * - Ordena poniendo primero los que tengan destacado == true.
 */
export async function consultarEventosPublicos(ubicacion) {
  const hoy = fechaLocalHoy();

  try {
    const consulta = query(
      collection(db, "eventos"),
      where("estado", "==", "aprobado"),
      where("ubicacion", "==", ubicacion),
      where("fecha", ">=", hoy),
    );

    const snapshot = await getDocs(consulta);
    const eventos = [];
    snapshot.forEach((doc) => {
      eventos.push({ id: doc.id, ...doc.data() });
    });

    eventos.sort((a, b) => {
      const destA = Boolean(a.destacado);
      const destB = Boolean(b.destacado);
      if (destA !== destB) return destA ? -1 : 1;
      const fechaA = a.fecha || "";
      const fechaB = b.fecha || "";
      const comparacionFecha = fechaA.localeCompare(fechaB);
      if (comparacionFecha !== 0) return comparacionFecha;
      // Si las fechas son iguales, ordenar por hora (HH:MM)
      const horaA = a.hora || "";
      const horaB = b.hora || "";
      return horaA.localeCompare(horaB);
    });

    return eventos;
  } catch (error) {
    console.error("Error al consultar eventos desde Firestore:", error);
    if (!firebaseConfig.apiKey) {
      console.warn(
        "Aviso: Configuración de Firebase en blanco. Usando datos locales de muestra.",
      );
      return obtenerEventosDeMuestra(ubicacion, hoy);
    }
    throw error;
  }
}

const IMAGEN_POR_DEFECTO =
  "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=600&q=80";

const VACIO_POR_FILTRO = {
  hoy: "para hoy",
  manana: "para mañana",
  semana: "para esta semana",
};

/** URL que lleva directo a un evento dentro de la página de la zona. */
export function urlEvento(id) {
  const base = window.location.href.split(/[?#]/)[0];
  return `${base}?evento=${encodeURIComponent(id)}`;
}

/** Texto que acompaña al enlace cuando se comparte un evento. */
export function textoCompartir(ev) {
  const lineas = [`📅 ${ev.nombre || "Evento"}`];
  const cuando = [formatearFecha(ev.fecha), ev.hora ? `${ev.hora}hs` : ""]
    .filter(Boolean)
    .join(" - ");
  if (cuando) lineas.push(`🗓 ${cuando}`);
  const donde = [ev.lugar, ev.localidad].filter(Boolean).join(", ");
  if (donde) lineas.push(`📍 ${donde}`);
  const precio = formatearPrecioEvento(ev);
  if (precio) lineas.push(`🎟 ${precio}`);
  lineas.push("", "Más eventos en la Agenda Cultural:");
  return lineas.join("\n");
}

/**
 * Renderiza dinámicamente las tarjetas de eventos en el contenedor dado.
 * @param {object[]} eventos
 * @param {HTMLElement} contenedor
 * @param {{filtro?: string}} [opciones]
 */
export function renderizarTarjetas(eventos, contenedor, opciones = {}) {
  if (!contenedor) return;

  if (!eventos || eventos.length === 0) {
    const filtro = opciones.filtro;
    if (filtro && filtro !== "todos") {
      contenedor.innerHTML = `
        <div class="no-events">
          <i class="fa-solid fa-calendar-xmark" style="font-size: 2.5rem; margin-bottom: 1rem; color: var(--text-muted);"></i>
          <h3>No hay eventos ${VACIO_POR_FILTRO[filtro] || "en este período"}</h3>
          <p style="margin-bottom: 1rem;">Probá con otro filtro o mirá toda la cartelera.</p>
          <button type="button" class="btn btn-outline btn-sm" data-filtro-reset="todos">Ver todos los eventos</button>
        </div>
      `;
      return;
    }
    contenedor.innerHTML = `
      <div class="no-events">
        <i class="fa-solid fa-calendar-xmark" style="font-size: 2.5rem; margin-bottom: 1rem; color: var(--text-muted);"></i>
        <h3>No hay eventos futuros programados</h3>
        <p>Sé el primero en cargar un evento cultural haciendo clic en "Cargar Evento".</p>
      </div>
    `;
    return;
  }

  contenedor.innerHTML = eventos
    .map((ev) => {
      const esDestacado = Boolean(ev.destacado);
      const fechaFormateada = formatearFecha(ev.fecha);
      const nombre = ev.nombre || "Sin título";
      const descripcion = ev.descripcion || "";
      const imagen =
        ev.imagenUrl && ev.imagenUrl.startsWith("https://")
          ? ev.imagenUrl
          : IMAGEN_POR_DEFECTO;
      const esLarga = descripcion.length > (window.DESCRIPCION_CORTA || 120);
      const precio = formatearPrecioEvento(ev);
      const linkEntradas = urlSegura(ev.linkEntradas);
      const idAttr = escapeHtml(ev.id);

      const textoComp = textoCompartir(ev);
      const urlComp = urlEvento(ev.id);
      const urlWaComp = `https://wa.me/?text=${encodeURIComponent(`${textoComp}\n${urlComp}`)}`;

      return `
        <article class="event-card ${esDestacado ? "featured" : ""}" id="evento-${idAttr}" data-id="${idAttr}">
          ${
            esDestacado
              ? '<span class="featured-badge"><i class="fa-solid fa-star"></i> Destacado</span>'
              : ""
          }
          <img src="${escapeHtml(imagen)}" alt="${escapeHtml(nombre)}" class="event-img" loading="lazy">
          <div class="event-body">
            <span class="event-date-badge">
              <i class="fa-regular fa-calendar"></i>
              <time datetime="${escapeHtml(ev.fecha || "")}">${escapeHtml(fechaFormateada)}</time> - ${escapeHtml(ev.hora || "")}hs
            </span>
            <h3 class="event-title">${escapeHtml(nombre)}</h3>
            <p class="event-desc${esLarga ? " collapsed" : ""}">${escapeHtml(descripcion)}</p>
            ${
              esLarga
                ? '<button type="button" class="event-more" aria-expanded="false">Ver más</button>'
                : ""
            }
            <div class="event-details">
              <div>
                <i class="fa-solid fa-location-dot"></i>
                <strong>Lugar:</strong> ${obtenerHtmlLugar(ev)}
              </div>
              ${
                ev.localidad
                  ? `
              <div>
                <i class="fa-solid fa-city"></i>
                <strong>Localidad:</strong> ${escapeHtml(ev.localidad)}
              </div>`
                  : ""
              }
              ${
                precio
                  ? `
              <div class="event-precio">
                <i class="fa-solid fa-ticket"></i>
                <strong>Entrada:</strong> ${escapeHtml(precio)}
              </div>`
                  : ""
              }
              ${obtenerHtmlContacto(ev)}
              ${obtenerHtmlRedes(ev)}
            </div>
            <div class="event-actions">
              ${
                linkEntradas
                  ? `<a class="btn btn-primary btn-entradas" href="${escapeHtml(linkEntradas)}" target="_blank" rel="noopener noreferrer nofollow ugc"><i class="fa-solid fa-ticket"></i> Conseguir entradas</a>`
                  : ""
              }
              <button type="button" class="btn btn-outline btn-compartir" data-id="${idAttr}" aria-label="Compartir ${escapeHtml(nombre)}" aria-expanded="false">
                <i class="fa-solid fa-share-nodes"></i> Compartir
              </button>
            </div>
            <div class="share-menu" hidden>
              <a class="share-opcion" href="${escapeHtml(urlWaComp)}" target="_blank" rel="noopener noreferrer"><i class="fa-brands fa-whatsapp"></i> WhatsApp</a>
              <button type="button" class="share-opcion btn-copiar" data-url="${escapeHtml(urlComp)}"><i class="fa-regular fa-copy"></i> Copiar enlace</button>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
}

/**
 * Genera el HTML para el lugar y dirección del evento.
 */
function obtenerHtmlLugar(ev) {
  const partes = [];
  if (ev.lugar) partes.push(ev.lugar);
  if (ev.direccion) partes.push(`(${ev.direccion})`);

  const textoLugar = partes.join(" ");
  if (!textoLugar) return "A confirmar";

  const urlMaps = construirUrlMaps(ev);
  return `<a href="${escapeHtml(urlMaps)}" target="_blank" rel="noopener noreferrer" aria-label="Ver en Google Maps">${escapeHtml(textoLugar)}</a>`;
}

/**
 * Genera la fila de contacto (con enlace a WhatsApp si es un móvil válido).
 * Si el evento no tiene teléfono no se muestra la fila.
 */
function obtenerHtmlContacto(ev) {
  if (!ev.contacto) return "";

  const numLimpio = normalizarTelefonoAR(ev.contacto);
  let valor;
  if (numLimpio) {
    const nombreEvento = ev.nombre || "el evento";
    const mensaje = `Hola, me comunico desde la Agenda Cultural por el evento "${nombreEvento}", quisiera más información.`;
    const urlWa = `https://wa.me/${numLimpio}?text=${encodeURIComponent(mensaje)}`;
    valor = `<a href="${escapeHtml(urlWa)}" target="_blank" rel="noopener noreferrer" aria-label="Escribir por WhatsApp">${escapeHtml(ev.contacto)}</a>`;
  } else {
    valor = escapeHtml(ev.contacto);
  }
  return `
              <div>
                <i class="fa-solid fa-phone"></i>
                <strong>Contacto:</strong> ${valor}
              </div>`;
}

/** Fila con los usuarios de Instagram del evento (enlaces al perfil). */
function obtenerHtmlRedes(ev) {
  const usuarios = String(ev.redes || "")
    .split(/\s+/)
    .map((u) => u.replace(/^@/, ""))
    .filter((u) => /^[A-Za-z0-9._]{1,30}$/.test(u));
  if (usuarios.length === 0) return "";
  const enlaces = usuarios
    .map(
      (u) =>
        `<a href="https://www.instagram.com/${encodeURIComponent(u)}/" target="_blank" rel="noopener noreferrer nofollow ugc">@${escapeHtml(u)}</a>`,
    )
    .join(" ");
  return `
              <div>
                <i class="fa-brands fa-instagram"></i>
                <strong>Instagram:</strong> ${enlaces}
              </div>`;
}

function formatearFecha(fechaStr) {
  if (!fechaStr) return "";
  const partes = fechaStr.split("-");
  if (partes.length === 3) {
    return `${partes[2]}/${partes[1]}/${partes[0]}`;
  }
  return fechaStr;
}

function obtenerEventosDeMuestra(ubicacion, fechaHoy) {
  const muestra = [
    {
      id: "ev_sr_1",
      ubicacion: "sanrafael",
      nombre: "Peña Folklórica Tradicional",
      descripcion: "Música en vivo, ballets locales y gastronomía regional.",
      fecha: "2026-11-15",
      hora: "21:00",
      lugar: "Club Español",
      direccion: "Av. Mitre 550",
      localidad: "San Rafael",
      contacto: "+54 9 260 4111111",
      imagenUrl:
        "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=600&q=80",
      estado: "aprobado",
      destacado: true,
    },
    {
      id: "ev_mza_1",
      ubicacion: "mendoza",
      nombre: "Festival de Indie Rock Mendocino",
      descripcion: "Bandas emergentes de la escena cuyana en concierto.",
      fecha: "2026-11-20",
      hora: "19:00",
      lugar: "Nave Cultural",
      direccion: "España y Maza",
      localidad: "Ciudad de Mendoza",
      contacto: "+54 9 261 4333333",
      imagenUrl:
        "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=600&q=80",
      estado: "aprobado",
      destacado: true,
    },
  ];

  return muestra
    .filter(
      (ev) =>
        ev.ubicacion === ubicacion &&
        ev.estado === "aprobado" &&
        ev.fecha >= fechaHoy,
    )
    .sort((a, b) => {
      if (a.destacado !== b.destacado) return a.destacado ? -1 : 1;
      const fechaA = a.fecha || "";
      const fechaB = b.fecha || "";
      const comparacionFecha = fechaA.localeCompare(fechaB);
      if (comparacionFecha !== 0) return comparacionFecha;
      // Si las fechas son iguales, ordenar por hora (HH:MM)
      const horaA = a.hora || "";
      const horaB = b.hora || "";
      return horaA.localeCompare(horaB);
    });
}

/**
 * Carga en el <select id="event-locality"> las localidades permitidas para la
 * zona indicada, usando LOCALIDADES_POR_ZONA como única fuente de verdad.
 * La primera opción (deshabilitada y seleccionada) se deja como está en el HTML.
 */
export function poblarSelectLocalidades(zona, select) {
  if (!select) return;

  const localidades = LOCALIDADES_POR_ZONA[zona] || [];

  // Limpiamos cualquier carga previa para no duplicar opciones.
  select.innerHTML = "";

  const opcionInicial = document.createElement("option");
  opcionInicial.value = "";
  opcionInicial.textContent = "Seleccioná la localidad";
  opcionInicial.disabled = true;
  opcionInicial.selected = true;
  select.appendChild(opcionInicial);

  localidades.forEach((localidad) => {
    const opcion = document.createElement("option");
    opcion.value = localidad;
    opcion.textContent = localidad;
    select.appendChild(opcion);
  });
}

/**
 * Devuelve el domingo de la semana actual en formato "AAAA-MM-DD".
 * "Esta semana" = desde hoy hasta ese domingo (inclusive).
 */
export function fechaFinDeSemana() {
  const faltan = (7 - new Date().getDay()) % 7; // 0 = domingo
  return fechaLocalMasDias(faltan);
}

/**
 * Filtra los eventos por rango de fechas: "todos" | "hoy" | "manana" | "semana".
 */
export function filtrarEventosPorFecha(eventos, filtro) {
  const hoy = fechaLocalHoy();
  switch (filtro) {
    case "hoy":
      return eventos.filter((ev) => ev.fecha === hoy);
    case "manana": {
      const manana = fechaLocalMasDias(1);
      return eventos.filter((ev) => ev.fecha === manana);
    }
    case "semana": {
      const fin = fechaFinDeSemana();
      return eventos.filter((ev) => ev.fecha >= hoy && ev.fecha <= fin);
    }
    default:
      return eventos;
  }
}

/**
 * 3. Inicialización en el ciclo de vida del DOM:
 * - Carga y renderiza eventos para la página actual (sanrafael / mendoza)
 *   con filtros (todos / hoy / mañana / esta semana) y paginación de 15
 * - Carga el listado de localidades según la zona de la página
 * - Gestiona el modal de carga y el envío del formulario con subirEvento()
 */
document.addEventListener("DOMContentLoaded", async () => {
  const ubicacionActual = document.body.getAttribute("data-location");
  if (!ubicacionActual) return;

  const eventsGrid = document.getElementById("events-grid");
  const contenedorPaginacion = document.getElementById("events-pagination");
  const barraFiltros = document.getElementById("filtros-eventos");
  const chips = barraFiltros
    ? Array.from(barraFiltros.querySelectorAll("[data-filtro]"))
    : [];

  // Cargar las localidades de la zona en el formulario de carga de eventos.
  poblarSelectLocalidades(
    ubicacionActual,
    document.getElementById("event-locality"),
  );

  // Estado de la vista pública
  let eventosTodos = [];
  let filtroActual = "todos";
  let paginaActual = 1;

  function irAlInicioDelListado() {
    const destino = barraFiltros || eventsGrid;
    if (!destino) return;
    const reducido = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    destino.scrollIntoView({ behavior: reducido ? "auto" : "smooth", block: "start" });
  }

  function actualizarChips(cargado) {
    chips.forEach((chip) => {
      const activo = chip.dataset.filtro === filtroActual;
      chip.classList.toggle("activo", activo);
      chip.setAttribute("aria-pressed", String(activo));
      const cuenta = chip.querySelector(".chip-count");
      if (cuenta) {
        cuenta.textContent = cargado
          ? String(filtrarEventosPorFecha(eventosTodos, chip.dataset.filtro).length)
          : "";
      }
    });
  }

  function renderizarVista() {
    const filtrados = filtrarEventosPorFecha(eventosTodos, filtroActual);
    const { items, pagina } = paginar(filtrados, paginaActual, POR_PAGINA);
    paginaActual = pagina;
    actualizarChips(true);
    renderizarTarjetas(items, eventsGrid, { filtro: filtroActual });
    renderPaginacion(contenedorPaginacion, {
      total: filtrados.length,
      pagina,
      porPagina: POR_PAGINA,
      onCambiar: (nueva) => {
        paginaActual = nueva;
        renderizarVista();
        irAlInicioDelListado();
      },
    });
  }

  function cambiarFiltro(filtro) {
    filtroActual = filtro;
    paginaActual = 1;
    renderizarVista();
  }

  chips.forEach((chip) =>
    chip.addEventListener("click", () => cambiarFiltro(chip.dataset.filtro)),
  );

  // Si se llegó con un enlace compartido (?evento=ID), mostrar ese evento.
  // Evento que llegó por enlace compartido pero no está en el listado (por
  // ejemplo, ya pasó): se muestra aparte, arriba de los filtros.
  let eventoExtra = null;
  let contenedorExtra = null;

  function mostrarAvisoCompartido(texto, ev) {
    if (!barraFiltros) return;
    if (!contenedorExtra) {
      contenedorExtra = document.createElement("section");
      contenedorExtra.className = "evento-extra";
      barraFiltros.parentNode.insertBefore(contenedorExtra, barraFiltros);
      contenedorExtra.addEventListener("click", manejarClicTarjetas);
    }
    contenedorExtra.innerHTML = `<p class="aviso-compartido"><i class="fa-solid fa-circle-info" aria-hidden="true"></i> ${escapeHtml(texto)}</p><div class="events-grid evento-extra-grid"></div>`;
    if (ev) {
      renderizarTarjetas([ev], contenedorExtra.querySelector(".evento-extra-grid"));
    }
    contenedorExtra.scrollIntoView({ block: "start" });
  }

  async function mostrarEventoCompartido() {
    const id = new URLSearchParams(window.location.search).get("evento");
    if (!id) return;
    const indice = eventosTodos.findIndex((ev) => ev.id === id);
    if (indice === -1) {
      try {
        const snap = await getDoc(doc(db, "eventos", id));
        if (!snap.exists() || snap.data().estado !== "aprobado") {
          mostrarAvisoCompartido("Este evento ya no está disponible. Mirá los demás eventos de la agenda.");
          return;
        }
        eventoExtra = { id: snap.id, ...snap.data() };
        const pasado = eventoExtra.fecha && eventoExtra.fecha < fechaLocalHoy();
        mostrarAvisoCompartido(
          pasado
            ? "Este evento ya se realizó. Abajo tenés los próximos eventos."
            : "Evento compartido",
          eventoExtra,
        );
      } catch (err) {
        console.warn("[compartir] No se pudo cargar el evento compartido:", err);
      }
      return;
    }
    filtroActual = "todos";
    paginaActual = Math.floor(indice / POR_PAGINA) + 1;
    renderizarVista();
    const tarjeta = document.getElementById(`evento-${id}`);
    if (!tarjeta) return;
    tarjeta.classList.add("evento-compartido");
    tarjeta.scrollIntoView({ behavior: "auto", block: "center" });
    setTimeout(() => tarjeta.classList.remove("evento-compartido"), 3500);
  }

  async function cargarEventos() {
    if (eventsGrid) {
      eventsGrid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; color: var(--text-muted);">
          <i class="fa-solid fa-spinner fa-spin" style="font-size: 2rem; margin-bottom: 1rem;"></i>
          <p>Cargando eventos culturales...</p>
        </div>
      `;
    }

    try {
      eventosTodos = await consultarEventosPublicos(ubicacionActual);
      renderizarVista();
      mostrarEventoCompartido();
    } catch (err) {
      console.error("Error al cargar eventos:", err);
      if (eventsGrid) {
        eventsGrid.innerHTML = `
          <div class="no-events">
            <i class="fa-solid fa-triangle-exclamation" style="font-size: 2.5rem; margin-bottom: 1rem; color: var(--warning);"></i>
            <h3>No se pudieron cargar los eventos</h3>
            <p>Por favor verificá tu conexión o la configuración de Firebase.</p>
          </div>
        `;
      }
    }
  }

  // Flujo del modal (login -> planes -> formulario). Se prepara ANTES de cargar
  // los eventos, para que "Cargar evento" responda aunque la red tarde.
  renderizarPlanesStep();
  initAuthListener();

  // Los eventos se cargan en segundo plano, sin bloquear el resto de la página.
  cargarEventos();

  // Acciones delegadas dentro del listado: "Ver más", compartir, copiar enlace
  // y "Ver todos los eventos" (cuando un filtro no tiene resultados).
  if (eventsGrid) {
    eventsGrid.addEventListener("click", manejarClicTarjetas);
  }

  async function manejarClicTarjetas(e) {
    {
      const reset = e.target.closest("[data-filtro-reset]");
      if (reset) {
        cambiarFiltro(reset.dataset.filtroReset);
        return;
      }

      const btnMas = e.target.closest(".event-more");
      if (btnMas) {
        const card = btnMas.closest(".event-card");
        const desc = card ? card.querySelector(".event-desc") : null;
        if (!desc) return;
        const expanded = btnMas.getAttribute("aria-expanded") === "true";
        desc.classList.toggle("collapsed");
        btnMas.setAttribute("aria-expanded", String(!expanded));
        btnMas.textContent = !expanded ? "Ver menos" : "Ver más";
        return;
      }

      const btnCompartir = e.target.closest(".btn-compartir");
      if (btnCompartir) {
        const ev = [...eventosTodos, eventoExtra].find(
          (x) => x && x.id === btnCompartir.dataset.id,
        );
        if (!ev) return;
        if (navigator.share) {
          try {
            await navigator.share({
              title: ev.nombre || "Evento",
              text: textoCompartir(ev),
              url: urlEvento(ev.id),
            });
          } catch (err) {
            // AbortError = la persona cerró el panel de compartir; no es un error.
            if (err && err.name !== "AbortError") {
              console.warn("[compartir] No se pudo compartir:", err);
            }
          }
          return;
        }
        // Sin Web Share API (escritorio): se despliega el menú con opciones.
        const menu = btnCompartir.closest(".event-body").querySelector(".share-menu");
        if (menu) {
          const abrir = menu.hidden;
          menu.hidden = !abrir;
          btnCompartir.setAttribute("aria-expanded", String(abrir));
        }
        return;
      }

      const btnCopiar = e.target.closest(".btn-copiar");
      if (btnCopiar) {
        const url = btnCopiar.dataset.url;
        const original = btnCopiar.innerHTML;
        try {
          await navigator.clipboard.writeText(url);
          btnCopiar.innerHTML = '<i class="fa-solid fa-check"></i> ¡Enlace copiado!';
          setTimeout(() => {
            btnCopiar.innerHTML = original;
          }, 2000);
        } catch (_) {
          window.prompt("Copiá el enlace del evento:", url);
        }
      }
    }
  }

  // Gestión de Modal
  const modalOverlay = document.getElementById("upload-modal");
  const btnOpenUpload = document.getElementById("btn-open-upload");
  const modalClose = document.querySelector(".modal-close");

  // Orden del flujo: 1) login con Google, 2) elegir plan, 3) formulario.
  if (btnOpenUpload && modalOverlay) {
    btnOpenUpload.addEventListener("click", () => {
      establecerFechaMin();
      abrirModalCarga();
    });
  }

  if (modalClose && modalOverlay) {
    modalClose.addEventListener("click", cerrarModalCarga);
  }

  // Selector nativo de fecha al hacer clic en el campo (incluido ícono)
  const dateInput = document.getElementById("event-date");

  // Fecha: bloquear días anteriores a hoy (min). Se actualiza al cargar y al
  // abrir el modal por si la página queda abierta pasada la medianoche.
  function establecerFechaMin() {
    if (dateInput) {
      dateInput.min = fechaLocalHoy();
    }
  }
  establecerFechaMin();

  if (dateInput) {
    dateInput.style.cursor = "pointer";
    dateInput.addEventListener("click", () => {
      try {
        dateInput.showPicker();
      } catch (_) {
        // Navegador no soporta showPicker: el navegador ya abre el selector nativo
      }
    });
  }

  // Contador en vivo de la descripción
  const descTextarea = document.getElementById("event-desc");
  if (descTextarea) {
    descTextarea.setAttribute("maxlength", String(MAX_DESCRIPCION));
    const counter = document.createElement("span");
    counter.id = "desc-counter";
    counter.className = "desc-counter";
    counter.setAttribute("aria-live", "polite");
    descTextarea.parentNode.insertBefore(counter, descTextarea.nextSibling);
    function actualizarContadorDesc() {
      const len = descTextarea.value.length;
      counter.textContent = `${len}/${MAX_DESCRIPCION}`;
      counter.classList.remove("warn", "danger");
      if (len >= MAX_DESCRIPCION) {
        counter.classList.add("danger");
      } else if (len >= Math.round(MAX_DESCRIPCION * 0.9)) {
        counter.classList.add("warn");
      }
    }
    descTextarea.addEventListener("input", actualizarContadorDesc);
    actualizarContadorDesc();
  }

  // Imagen: vista previa 4:5 y encuadre (recortar / mostrar completa)
  const inputImagen = document.getElementById("event-image");
  const controladorImagen = inputImagen
    ? crearControladorImagen({
        input: inputImagen,
        caja: document.getElementById("image-preview-box"),
        img: document.getElementById("image-preview"),
        radios: Array.from(document.querySelectorAll('input[name="image-mode"]')),
        estado: document.getElementById("image-preview-status"),
      })
    : null;

  // Precio de la entrada
  const precioEls = {
    tipos: Array.from(document.querySelectorAll('input[name="event-price-type"]')),
    grupoValor: document.getElementById("price-value-group"),
    valor: document.getElementById("event-price-value"),
    etiquetaValor: document.getElementById("price-value-label"),
    grupoDetalle: document.getElementById("price-detail-group"),
    detalle: document.getElementById("event-price-detail"),
  };
  const controladorPrecio = precioEls.tipos.length
    ? configurarCamposPrecio(precioEls)
    : null;

  // Error visible de "al menos un dato para conseguir la entrada"
  const avisoEntradas = document.getElementById("entradas-error");
  function mostrarErrorEntradas(mensaje) {
    if (!avisoEntradas) return;
    avisoEntradas.textContent = mensaje || "";
    avisoEntradas.hidden = !mensaje;
  }
  ["event-contact", "event-link", "event-redes"].forEach((id) => {
    const campo = document.getElementById(id);
    if (campo) campo.addEventListener("input", () => mostrarErrorEntradas(""));
  });

  // Manejo del formulario de carga
  const eventForm = document.getElementById("event-form");
  if (eventForm) {
    eventForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      const captchaCheck = document.getElementById("captcha-check");
      if (captchaCheck && !captchaCheck.checked) {
        alert("Por favor verifica el checkbox antes de continuar.");
        return;
      }

      // Debe haber un plan elegido (se elige antes de ver el formulario)
      if (!planElegido) {
        alert("Elegí un plan de publicación para continuar.");
        mostrarPaso("planes");
        return;
      }

      const imagenArchivo = controladorImagen
        ? controladorImagen.getArchivo()
        : null;

      if (!imagenArchivo) {
        alert("Por favor selecciona una imagen para el evento.");
        return;
      }

      const MAX_SIZE_MB = 15;
      if (imagenArchivo.size > MAX_SIZE_MB * 1024 * 1024) {
        alert(
          `La imagen supera el límite de ${MAX_SIZE_MB} MB. Elige una imagen más liviana.`,
        );
        return;
      }

      const nombre = document.getElementById("event-title").value.trim();
      const descripcion = document.getElementById("event-desc").value.trim();
      const fecha = document.getElementById("event-date").value;
      const horaSelect = document.getElementById("event-hour");
      const minutoSelect = document.getElementById("event-minute");
      const hora = `${horaSelect.value}:${minutoSelect.value}`;
      const lugar = document.getElementById("event-place").value.trim();
      const direccion = document.getElementById("event-address").value.trim();
      const selectLocalidad = document.getElementById("event-locality");
      const localidad = selectLocalidad ? selectLocalidad.value : "";
      const contacto = document.getElementById("event-contact").value.trim();
      const linkEntradas = document.getElementById("event-link").value.trim();
      const redes = document.getElementById("event-redes").value.trim();

      const btnSubmit = eventForm.querySelector('button[type="submit"]');
      const originalBtnText = btnSubmit ? btnSubmit.innerHTML : "Enviar Evento";

      // Validación de fecha: no anterior a hoy y, en el plan gratuito, al menos
      // 2 días de anticipación
      const hoyStr = fechaLocalHoy();
      if (fecha && fecha < hoyStr) {
        alert("La fecha no puede ser anterior a hoy.");
        return;
      }
      if (
        planElegido.id === "gratuito" &&
        fecha &&
        fecha < fechaLocalMasDias(2)
      ) {
        alert(
          "Con el Plan Gratuito el evento debe cargarse con al menos 2 días de anticipación.",
        );
        return;
      }

      // Validación de hora: minutos 00, 15, 30 o 45
      const HORA_REGEX = /^([01]\d|2[0-3]):(00|15|30|45)$/;
      if (hora && !HORA_REGEX.test(hora)) {
        alert("Elegí la hora y los minutos del evento.");
        return;
      }

      // Precio de la entrada
      const precio = leerPrecio(precioEls);
      if (!precio.ok) {
        alert(precio.error);
        const destino = precioEls.tipos.find((r) => r.checked) || precioEls.tipos[0];
        if (destino) destino.focus();
        return;
      }

      // Al menos un dato para conseguir la entrada (teléfono, link o Instagram)
      const entradas = validarEntradas({ contacto, linkEntradas, redes });
      if (!entradas.ok) {
        mostrarErrorEntradas(entradas.error);
        if (avisoEntradas) {
          avisoEntradas.scrollIntoView({ block: "center" });
        }
        return;
      }
      mostrarErrorEntradas("");

      // Planes pagos: al terminar de guardar se abre WhatsApp. Se abre una pestaña
      // en blanco AHORA (dentro del toque del usuario) porque los celulares
      // bloquean las ventanas que se abren después de esperar el guardado.
      const planEnvio = planElegido;
      const esPago = planEnvio.tipo === "pago";
      let ventanaWa = null;
      if (esPago) {
        if (!numeroConsultasCache) {
          alert(
            "El contacto para coordinar el pago no está disponible por el momento. Probá más tarde.",
          );
          return;
        }
        try {
          ventanaWa = window.open("", "_blank");
          if (ventanaWa) {
            ventanaWa.document.title = "Guardando tu evento...";
            ventanaWa.document.body.textContent = "Guardando tu evento...";
          }
        } catch (_) {
          ventanaWa = null;
        }
      }

      try {
        if (btnSubmit) {
          btnSubmit.disabled = true;
          btnSubmit.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Subiendo imagen y guardando...`;
        }

        const imagenProcesada = await controladorImagen.getBlob();

        await subirEvento({
          nombre,
          descripcion,
          fecha,
          hora,
          lugar,
          direccion,
          localidad,
          contacto: entradas.contacto,
          linkEntradas: entradas.linkEntradas,
          redes: entradas.redes,
          precioTipo: precio.precioTipo,
          precioValor: precio.precioValor,
          precioDetalle: precio.precioDetalle,
          ubicacion: ubicacionActual,
          imagenArchivo,
          imagenProcesada,
          modoImagen: controladorImagen.getModo(),
          plan: planEnvio.id,
        });

        eventForm.reset();
        if (controladorImagen) controladorImagen.reset();
        limpiarPrecio(precioEls, controladorPrecio);
        const campoDesc = document.getElementById("event-desc");
        if (campoDesc) campoDesc.dispatchEvent(new Event("input"));

        if (esPago) {
          // Plan Destacado / Premium: continuar por WhatsApp para coordinar el pago
          const mensaje = `Hola! Quiero contratar el ${planEnvio.nombre} para el evento '${nombre}' y quisiera más información para proceder con el pago.`;
          const urlWa = construirUrlWhatsApp(mensaje);
          if (ventanaWa && !ventanaWa.closed) {
            try {
              ventanaWa.opener = null;
              ventanaWa.location.href = urlWa;
            } catch (_) {
              // Si falla, queda el botón "Continuar por WhatsApp" del paso de éxito
            }
          }
          renderizarExito(urlWa);
          mostrarPaso("exito");
        } else {
          alert(
            "¡Evento enviado con éxito! Quedará pendiente de aprobación por el moderador.",
          );
          cerrarModalCarga();
        }
      } catch (error) {
        if (ventanaWa && !ventanaWa.closed) ventanaWa.close();
        console.error("Error al subir el evento:", error);
        if (error && error.code === "permission-denied") {
          alert("No tenés permiso para publicar eventos con esta cuenta.");
        } else {
          alert(`Hubo un error al guardar el evento: ${error.message}`);
        }
      } finally {
        if (btnSubmit) {
          btnSubmit.disabled = false;
          btnSubmit.innerHTML = originalBtnText;
        }
      }
    });
  }
});
