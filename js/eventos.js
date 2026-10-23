// Lógica de carga, consulta y renderizado de eventos con Firebase Firestore y Storage
import { db, storage, auth, firebaseConfig } from "./firebase-config.js";
import {
  collection,
  doc,
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
 * Escapa HTML para prevenir XSS al insertar texto de usuario con innerHTML.
 * @param {string|null|undefined} texto
 * @returns {string}
 */
function escapeHtml(texto) {
  if (texto === null || texto === undefined) return "";
  return String(texto)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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
  // Detectar soporte de WebP
  let soportaWebP = false;
  try {
    await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = resolve;
      img.onerror = reject;
      img.src =
        "data:image/webp;base64,UklGRiQAAABXRUJQVlA4TAgAAAAvAAAAQwAAAA==";
    });
    soportaWebP = true;
  } catch (_) {
    soportaWebP = false;
  }

  const mime = soportaWebP ? "image/webp" : "image/jpeg";

  let bitmap;
  try {
    bitmap = await createImageBitmap(archivo);
  } catch (_) {
    throw new Error("No se pudo procesar la imagen, probá con otra");
  }

  const { width: ancho, height: alto } = bitmap;
  const ladoMayor = Math.max(ancho, alto);

  const toBlobPromise = (canvas, mimeType, calidad) =>
    new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error("toBlob devolvió null"));
        },
        mimeType,
        calidad,
      );
    });

  const crearBlob = async (maxLado, calidad) => {
    let w = ancho;
    let h = alto;
    if (ladoMayor > maxLado) {
      const escala = maxLado / ladoMayor;
      w = Math.round(ancho * escala);
      h = Math.round(alto * escala);
    }
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, w, h);
    return toBlobPromise(canvas, mime, calidad);
  };

  let blob;
  try {
    blob = await crearBlob(1280, 0.8);
  } catch (_) {
    bitmap.close();
    throw new Error("No se pudo procesar la imagen, probá con otra");
  }

  console.log(
    "[comprimirImagen] tamaño original:",
    archivo.size,
    "bytes | comprimido:",
    blob.size,
    "bytes | tipo:",
    blob.type,
  );

  if (blob.size >= 2 * 1024 * 1024) {
    try {
      blob = await crearBlob(1000, 0.7);
    } catch (_) {
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
export async function consultarEventosPublicos(ubicacion) {
  const hoy = new Date().toISOString().split("T")[0];

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
      return (a.fecha || "").localeCompare(b.fecha || "");
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
      const esLarga = descripcion.length > DESCRIPCION_CORTA;

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
                <strong>Lugar:</strong> ${escapeHtml(ev.lugar || "")} (${escapeHtml(ev.direccion || "")})
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
                <strong>Contacto:</strong> ${escapeHtml(ev.contacto || "")}
              </div>
            </div>
          </div>
        </article>
      `;
    })
    .join("");
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
      return (a.fecha || "").localeCompare(b.fecha || "");
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
      modalOverlay.classList.add("active");
    });
  }

  if (modalClose && modalOverlay) {
    modalClose.addEventListener("click", () => {
      modalOverlay.classList.remove("active");
    });
  }

  // Selector nativo de fecha y hora al hacer clic en el campo (incluido ícono)
  const dateInput = document.getElementById("event-date");
  const timeInput = document.getElementById("event-time");
  [dateInput, timeInput].forEach((input) => {
    if (input) {
      input.style.cursor = "pointer";
      input.addEventListener("click", () => {
        try {
          input.showPicker();
        } catch (_) {
          // Navegador no soporta showPicker: el navegador ya abre el selector nativo
        }
      });
    }
  });

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
        alert("Por favor verifica el Captcha antes de continuar.");
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
      const hora = document.getElementById("event-time").value;
      const lugar = document.getElementById("event-place").value.trim();
      const direccion = document.getElementById("event-address").value.trim();
      const selectLocalidad = document.getElementById("event-locality");
      const localidad = selectLocalidad ? selectLocalidad.value : "";
      const contacto = document.getElementById("event-contact").value.trim();

      const btnSubmit = eventForm.querySelector('button[type="submit"]');
      const originalBtnText = btnSubmit ? btnSubmit.innerHTML : "Enviar Evento";

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
        actualizarContadorDesc();

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
