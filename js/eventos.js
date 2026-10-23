// Lógica de carga, consulta y renderizado de eventos con Firebase Firestore y Storage
import { db, storage, auth, firebaseConfig } from "./firebase-config.js";
import { normalizarTelefonoAR, escapeHtml } from "./utils.js";
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
      "Difusión en los grupos de WhatsApp correspondientes a la zona del evento.",
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
      "Publicación prioritaria en los grupos de WhatsApp de la zona del evento.",
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
      "Publicación prioritaria en grupos de WhatsApp e Instagram.",
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
 * Comprime una imagen a WebP (o JPEG si el navegador no soporta WebP).
 * - Lado mayor <= 1280 px y calidad ~0.8.
 * - Usa createImageBitmap y canvas.toBlob.
 * - Si el Blob resultante pesa 2 MB o más, reintenta una vez con lado 1000 px
 *   y calidad 0.7. Si sigue pesando 2 MB o más, lanza un Error claro.
 * - No hay fallback silencioso al archivo original: si la compresión falla,
 *   se lanza un Error y no se sube nada.
 * @param {File} archivo
 * @returns {Promise<Blob>}
 */
async function comprimirImagen(archivo) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(archivo, {
      imageOrientation: "from-image",
    });
  } catch (e) {
    console.error("[comprimirImagen] createImageBitmap falló:", e);
    throw new Error("No se pudo procesar la imagen, probá con otra");
  }

  const ancho = bitmap.width;
  const alto = bitmap.height;
  const ladoMayor = Math.max(ancho, alto);

  const aBlob = (canvas, tipo, calidad) =>
    new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error("toBlob devolvió null")),
        tipo,
        calidad,
      );
    });

  // Dibuja la imagen escalada y la exporta. Intenta WebP; si el navegador no
  // lo soporta (devuelve otro tipo), usa JPEG con fondo blanco.
  const crearBlob = async (maxLado, calidad) => {
    let w = ancho;
    let h = alto;
    if (ladoMayor > maxLado) {
      const escala = maxLado / ladoMayor;
      w = Math.round(ancho * escala);
      h = Math.round(alto * escala);
    }
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, w, h);

    let blob = await aBlob(canvas, "image/webp", calidad);
    if (blob.type !== "image/webp") {
      // El JPEG no tiene transparencia: se pinta un fondo blanco detrás.
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, w, h);
      ctx.globalCompositeOperation = "source-over";
      blob = await aBlob(canvas, "image/jpeg", Math.min(calidad + 0.02, 0.9));
    }
    return blob;
  };

  let blob;
  try {
    blob = await crearBlob(1280, 0.8);
  } catch (e) {
    console.error("[comprimirImagen] error al comprimir:", e);
    bitmap.close();
    throw new Error("No se pudo procesar la imagen, probá con otra");
  }

  console.log(
    "[comprimirImagen] original:",
    archivo.size,
    "bytes | comprimido:",
    blob.size,
    "bytes | tipo:",
    blob.type,
  );

  if (blob.size >= 2 * 1024 * 1024) {
    try {
      blob = await crearBlob(1000, 0.7);
    } catch (e) {
      console.error("[comprimirImagen] error en el reintento:", e);
      bitmap.close();
      throw new Error("No se pudo procesar la imagen, probá con otra");
    }
    console.log(
      "[comprimirImagen] reintento | comprimido:",
      blob.size,
      "bytes | tipo:",
      blob.type,
    );
    if (blob.size >= 2 * 1024 * 1024) {
      bitmap.close();
      throw new Error(
        "La imagen comprimida sigue superando los 2 MB. Probá con una imagen más pequeña o de menor resolución.",
      );
    }
  }

  bitmap.close();
  return blob;
}

/**
 * 1. Función para subir evento:
 * - Exige que haya un usuario de Google autenticado (auth.currentUser).
 * - Valida que la imagen no supere los 15 MB y la sube a Firebase Storage.
 * - Si la imagen pesa 2 MB o más, la comprime (WebP/JPEG) antes de subirla.
 * - Valida que la localidad seleccionada pertenezca a la lista cerrada de la
 *   zona (ubicacion) ANTES de subir la imagen a Storage.
 * - Guarda los datos en la colección 'eventos' en Firestore y crea el registro
 *   del autor en 'autores/{eventoId}' de forma atómica con writeBatch (un único
 *   commit). El documento del evento NO guarda email ni uid.
 * - Campos: nombre, descripcion, fecha, hora, lugar, direccion, localidad,
 *   contacto, imagenUrl, ubicacion, estado ('pendiente'), destacado (false),
 *   fechaCreacion.
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
  ubicacion,
  imagenArchivo,
}) {
  // Exigir usuario autenticado
  const user = auth.currentUser;
  if (!user) {
    throw new Error(
      "Debes iniciar sesión con tu cuenta de Google para publicar un evento.",
    );
  }

  if (!imagenArchivo) {
    throw new Error("Debe seleccionar una imagen para el evento.");
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

  const MAX_SIZE_MB = 15;
  const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;
  if (imagenArchivo.size > MAX_SIZE_BYTES) {
    const tamanoMB = (imagenArchivo.size / (1024 * 1024)).toFixed(2);
    throw new Error(
      `La imagen supera el límite de ${MAX_SIZE_MB} MB (tamaño: ${tamanoMB} MB). Elija una imagen más liviana.`,
    );
  }

  // Subir imagen a Storage.
  // Si el original pesa 2 MB o más, se comprime antes de subir; si pesa menos,
  // se sube el original sin comprimir. Nunca se sube el original sin comprimir
  // cuando supera los 2 MB.
  const MAX_COMPRIMIR_BYTES = 2 * 1024 * 1024;
  let archivoSubir = imagenArchivo;
  let nombreLimpio = imagenArchivo.name.replace(/[^a-zA-Z0-9._-]/g, "_");

  if (imagenArchivo.size >= MAX_COMPRIMIR_BYTES) {
    const blobComprimido = await comprimirImagen(imagenArchivo);
    const ext = blobComprimido.type === "image/webp" ? ".webp" : ".jpg";
    const nombreBase = nombreLimpio.replace(/\.[^/.]+$/, "");
    nombreLimpio = `${nombreBase}${ext}`;
    archivoSubir = blobComprimido;
  }

  const storageRef = ref(storage, `eventos/${Date.now()}_${nombreLimpio}`);
  const snapshot = await uploadBytes(storageRef, archivoSubir, {
    contentType: archivoSubir.type,
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
    contacto,
    imagenUrl,
    ubicacion, // 'sanrafael' o 'mendoza'
    estado: "pendiente",
    destacado: false,
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

/**
 * 2. Función para consultar eventos públicos:
 * - Trae eventos con estado == 'aprobado', ubicacion coincidente y fecha >= hoy.
 * - Ordena poniendo primero los que tengan destacado == true.
 */
// Estado del flujo de carga dentro de la sesión actual del modal.
let planElegido = null; // objeto de PLANES o null
let usuarioLogueado = null; // usuario de Firebase o null
let numeroConsultasCache = null; // numero de WhatsApp para consultas/pagos
let cacheConfigWhatsapp = null; // cache en memoria de config/whatsapp

/**
 * Lee config/whatsapp de Firestore (con cache simple en memoria) para obtener
 * el numero de WhatsApp de consultas y pagos (numeroConsultas).
 * @returns {Promise<string|null>}
 */
async function obtenerNumeroConsultas() {
  if (cacheConfigWhatsapp) {
    return cacheConfigWhatsapp.numeroConsultas || null;
  }
  try {
    const snap = await getDoc(doc(db, "config", "whatsapp"));
    if (snap.exists()) {
      cacheConfigWhatsapp = snap.data();
      return cacheConfigWhatsapp.numeroConsultas || null;
    }
  } catch (error) {
    console.error("[eventos] Error al leer config de WhatsApp:", error);
  }
  return null;
}

// Genera el HTML de una tarjeta de plan.
// @param {object} plan
// @returns {string}
function generarPlanCard(plan) {
  const esPago = plan.tipo === "pago";
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
      <div class="plan-titulo">${escapeHtml(plan.titulo)}${precioHTML}</div>
      ${subtituloHTML}
      ${beneficiosHTML.length > 0 ? `<ul class="plan-beneficios">${beneficiosHTML}</ul>` : ""}
      ${requisitoHTML}
      <button
        type="button"
        id="btn-plan-${plan.id}"
        class="${claseBtn}"
        style="min-height: 48px;"
      >
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

// Selecciona un plan gratuito/pago o abre WhatsApp directo para planes tipo whatsapp.
// @param {object} plan
function seleccionarPlan(plan) {
  planElegido = plan;

  if (plan.tipo === "whatsapp") {
    abrirWhatsAppDirecto(plan.waMensaje);
    return;
  }

  // Gratuito, Destacado o Premium: si hay sesion se va al form, si no, al login.
  if (usuarioLogueado) {
    mostrarPaso("form");
  } else {
    mostrarPaso("auth");
  }
}

// Abre WhatsApp en pestaña nueva para planes personalizados / sponsors.
// @param {string} mensaje
function abrirWhatsAppDirecto(mensaje) {
  if (!numeroConsultasCache) return;
  const url = `https://wa.me/${numeroConsultasCache}?text=${encodeURIComponent(mensaje)}`;
  window.open(url, "_blank", "noopener");
}

// Habilita/deshabilita los botones de planes tipo WhatsApp segun si hay numero
// de contacto configurado. Cuando no hay, se deshabilitan con un texto claro.
function aplicarDisponibilidadWhatsapp() {
  const disponible = !!numeroConsultasCache;
  PLANES.filter((p) => p.tipo === "whatsapp").forEach((plan) => {
    const btn = document.getElementById(`btn-plan-${plan.id}`);
    if (!btn) return;
    if (!disponible) {
      btn.disabled = true;
      btn.textContent = "Contacto no disponible por el momento";
    } else {
      btn.disabled = false;
      btn.textContent = plan.btnTexto;
    }
  });
}

// Muestra un solo paso del modal: "planes" | "auth" | "form" | "exito".
// @param {"planes"|"auth"|"form"|"exito"} paso
function mostrarPaso(paso) {
  const plansStep = document.getElementById("plans-step");
  const authStep = document.getElementById("auth-step");
  const eventForm = document.getElementById("event-form");
  const exitoStep = document.getElementById("exito-step");
  const aviso = document.getElementById("plan-actual-aviso");

  [plansStep, authStep, eventForm, exitoStep].forEach((el) => {
    if (el) el.style.display = "none";
  });
  if (aviso) aviso.style.display = "none";

  switch (paso) {
    case "planes":
      if (plansStep) plansStep.style.display = "block";
      break;
    case "auth":
      if (authStep) authStep.style.display = "block";
      break;
    case "form":
      if (eventForm) eventForm.style.display = "block";
      if (aviso && planElegido) {
        aviso.style.display = "flex";
        aviso.innerHTML = `Plan elegido: <strong>${escapeHtml(
          planElegido.titulo,
        )}</strong> <a href="#" id="btn-cambiar-plan" style="color: var(--primary); text-decoration: underline; cursor: pointer; margin-left: 0.5rem;">Cambiar plan</a>`;
        const btnCambiar = document.getElementById("btn-cambiar-plan");
        if (btnCambiar) {
          btnCambiar.addEventListener("click", (e) => {
            e.preventDefault();
            mostrarPaso("planes");
          });
        }
      }
      actualizarFechaMinPorPlan();
      break;
    case "exito":
      if (exitoStep) exitoStep.style.display = "block";
      break;
  }
}

// Actualiza el min del campo fecha y el aviso segun el plan elegido.
// Si la fecha ya elegida deja de ser valida, se limpia y se avisa.
function actualizarFechaMinPorPlan() {
  if (!dateInput) return;
  const hint = document.getElementById("fecha-hint-gratuito");
  const esGratuito = planElegido && planElegido.id === "gratuito";
  const minStr = esGratuito ? fechaLocalMasDias(2) : fechaLocalHoy();

  dateInput.min = minStr;
  if (hint) hint.style.display = esGratuito ? "block" : "none";

  if (dateInput.value && dateInput.value < minStr) {
    dateInput.value = "";
    alert(
      "La fecha seleccionada no es valida para el plan elegido y se ha limpiado.",
    );
  }
}

// Renderiza el paso "exito" para planes pagos.
// @param {string|null} urlWhatsApp
function renderizarExito(urlWhatsApp) {
  const exito = document.getElementById("exito-step");
  if (!exito) return;
  const botonWa = urlWhatsApp
    ? `<a href="${urlWhatsApp}" target="_blank" rel="noopener noreferrer" id="btn-exito-whatsapp" class="btn btn-primary" style="width: 100%; justify-content: center; margin-bottom: 0.75rem;">Continuar por WhatsApp</a>`
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
    btnCerrar.addEventListener("click", () => {
      if (modalOverlay) modalOverlay.classList.remove("active");
      mostrarPaso("planes");
    });
  }
}

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

/**
 * Renderiza dinámicamente las tarjetas de eventos en el contenedor dado.
 */
/**
 * Renderiza dinámicamente las tarjetas de eventos en el contenedor dado.
 */
export function renderizarTarjetas(eventos, contenedor) {
  if (!contenedor) return;

  if (!eventos || eventos.length === 0) {
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
      const IMAGEN_POR_DEFECTO =
        "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=600&q=80";
      const imagen =
        ev.imagenUrl && ev.imagenUrl.startsWith("https://")
          ? ev.imagenUrl
          : IMAGEN_POR_DEFECTO;
      const esLarga = descripcion.length > (window.DESCRIPCION_CORTA || 120);

      const htmlLugar = obtenerHtmlLugar(ev);
      const htmlContacto = obtenerHtmlContacto(ev);

      return `
        <article class="event-card ${esDestacado ? "featured" : ""}">
          ${
            esDestacado
              ? '<span class="featured-badge"><i class="fa-solid fa-star"></i> Destacado</span>'
              : ""
          }
          <img src="${imagen}" alt="${escapeHtml(nombre)}" class="event-img" loading="lazy">
          <div class="event-body">
            <span class="event-date-badge">
              <i class="fa-regular fa-calendar"></i>
              <time datetime="${ev.fecha || ""}">${escapeHtml(fechaFormateada)}</time> - ${escapeHtml(ev.hora || "")}hs
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
                <strong>Lugar:</strong> ${htmlLugar}
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
              <div>
                <i class="fa-solid fa-phone"></i>
                <strong>Contacto:</strong> ${htmlContacto}
              </div>
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

  const urlMaps =
    typeof construirUrlMaps === "function" ? construirUrlMaps(ev) : null;

  if (urlMaps) {
    return `<a href="${urlMaps}" target="_blank" rel="noopener noreferrer" aria-label="Ver en Google Maps">${escapeHtml(textoLugar)}</a>`;
  }
  return escapeHtml(textoLugar);
}

/**
 * Genera el HTML para el contacto con enlace a WhatsApp si aplica.
 */
function obtenerHtmlContacto(ev) {
  if (!ev.contacto) return "No especificado";

  const numLimpio =
    typeof normalizarTelefonoAR === "function"
      ? normalizarTelefonoAR(ev.contacto)
      : null;

  if (numLimpio) {
    const nombreEvento = ev.nombre || "el evento";
    const mensaje = `Hola, me comunico desde la Agenda Cultural por el evento "${nombreEvento}", quisiera más información.`;
    const urlWa = `https://wa.me/${numLimpio}?text=${encodeURIComponent(mensaje)}`;
    return `<a href="${urlWa}" target="_blank" rel="noopener noreferrer" aria-label="Escribir por WhatsApp">${escapeHtml(ev.contacto)}</a>`;
  }

  return escapeHtml(ev.contacto);
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
 * 3. Inicialización en el ciclo de vida del DOM:
 * - Carga y renderiza eventos para la página actual (sanrafael / mendoza)
 * - Carga el listado de localidades según la zona de la página
 * - Gestiona el modal de carga y el envío del formulario con subirEvento()
 */
document.addEventListener("DOMContentLoaded", async () => {
  const ubicacionActual = document.body.getAttribute("data-location");
  if (!ubicacionActual) return;

  const eventsGrid = document.getElementById("events-grid");

  // Cargar las localidades de la zona en el formulario de carga de eventos.
  poblarSelectLocalidades(
    ubicacionActual,
    document.getElementById("event-locality"),
  );

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
      const eventos = await consultarEventosPublicos(ubicacionActual);
      renderizarTarjetas(eventos, eventsGrid);
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

  await cargarEventos();

  // Listener delegado para "Ver más" / "Ver menos" de descripciones largas

  if (eventsGrid) {
    eventsGrid.addEventListener("click", (e) => {
      const btn = e.target.closest(".event-more");
      if (!btn) return;
      const card = btn.closest(".event-card");
      const desc = card ? card.querySelector(".event-desc") : null;
      if (!desc) return;
      const expanded = btn.getAttribute("aria-expanded") === "true";
      desc.classList.toggle("collapsed");
      btn.setAttribute("aria-expanded", String(!expanded));
      btn.textContent = !expanded ? "Ver menos" : "Ver más";
    });
  }

  // Gestión de Modal
  const modalOverlay = document.getElementById("upload-modal");
  const btnOpenUpload = document.getElementById("btn-open-upload");
  const modalClose = document.querySelector(".modal-close");

  if (btnOpenUpload && modalOverlay) {
    btnOpenUpload.addEventListener("click", () => {
      establecerFechaMin();
      modalOverlay.classList.add("active");
    });
  }

  if (modalClose && modalOverlay) {
    modalClose.addEventListener("click", () => {
      modalOverlay.classList.remove("active");
    });
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

  // Al abrir el modal, refrescar el min de fecha (por si pasó la medianoche)

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

      const imageInput = document.getElementById("event-image");
      const imagenArchivo = imageInput ? imageInput.files[0] : null;

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

      const btnSubmit = eventForm.querySelector('button[type="submit"]');
      const originalBtnText = btnSubmit ? btnSubmit.innerHTML : "Enviar Evento";

      // Validación de fecha: no anterior a hoy
      const hoyStr = fechaLocalHoy();
      if (fecha && fecha < hoyStr) {
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = originalBtnText;
        alert("La fecha no puede ser anterior a hoy.");
        return;
      }

      // Validación de hora: minutos 00, 15, 30 o 45
      const HORA_REGEX = /^([01]\d|2[0-3]):(00|15|30|45)$/;
      if (hora && !HORA_REGEX.test(hora)) {
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = originalBtnText;
        alert("Elegí la hora y los minutos del evento.");
        return;
      }

      try {
        if (btnSubmit) {
          btnSubmit.disabled = true;
          btnSubmit.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Subiendo imagen y guardando...`;
        }

        await subirEvento({
          nombre,
          descripcion,
          fecha,
          hora,
          lugar,
          direccion,
          localidad,
          contacto,
          ubicacion: ubicacionActual,
          imagenArchivo,
        });

        alert(
          "¡Evento enviado con éxito! Quedará pendiente de aprobación por el moderador.",
        );
        eventForm.reset();
        const campoDesc = document.getElementById("event-desc");
        if (campoDesc) campoDesc.dispatchEvent(new Event("input"));

        if (modalOverlay) {
          modalOverlay.classList.remove("active");
        }
      } catch (error) {
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
