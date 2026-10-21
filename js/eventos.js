// Lógica de carga, consulta y renderizado de eventos con Firebase Firestore y Storage
import { db, storage, firebaseConfig } from "./firebase-config.js";
import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import {
  ref,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

/**
 * 1. Función para subir evento:
 * - Valida que la imagen no supere los 2 MB y la sube a Firebase Storage.
 * - Guarda los datos en la colección 'eventos' en Firestore con:
 *   nombre, descripcion, fecha, hora, lugar, direccion, contacto, imagenUrl,
 *   ubicacion ('sanrafael' o 'mendoza'), estado ('pendiente'), destacado (false) y fechaCreacion.
 */
export async function subirEvento({
  nombre,
  descripcion,
  fecha,
  hora,
  lugar,
  direccion,
  contacto,
  ubicacion,
  imagenArchivo
}) {
  if (!imagenArchivo) {
    throw new Error("Debe seleccionar una imagen para el evento.");
  }

  const MAX_SIZE_MB = 2;
  const MAX_SIZE_BYTES = MAX_SIZE_MB * 1024 * 1024;
  if (imagenArchivo.size > MAX_SIZE_BYTES) {
    const tamanoMB = (imagenArchivo.size / (1024 * 1024)).toFixed(2);
    throw new Error(
      `La imagen supera el límite de ${MAX_SIZE_MB} MB (tamaño: ${tamanoMB} MB). Elija una imagen más liviana.`
    );
  }

  // Subir imagen a Storage
  const nombreLimpio = imagenArchivo.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const storageRef = ref(storage, `eventos/${Date.now()}_${nombreLimpio}`);
  const snapshot = await uploadBytes(storageRef, imagenArchivo);
  const imagenUrl = await getDownloadURL(snapshot.ref);

  // Guardar datos en Firestore
  const nuevoEvento = {
    nombre,
    descripcion,
    fecha,
    hora,
    lugar,
    direccion,
    contacto,
    imagenUrl,
    ubicacion, // 'sanrafael' o 'mendoza'
    estado: "pendiente",
    destacado: false,
    fechaCreacion: serverTimestamp()
  };

  const docRef = await addDoc(collection(db, "eventos"), nuevoEvento);
  return { id: docRef.id, ...nuevoEvento };
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
      where("fecha", ">=", hoy)
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
      console.warn("Aviso: Configuración de Firebase en blanco. Usando datos locales de muestra.");
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
      const imagen =
        ev.imagenUrl ||
        "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=600&q=80";

      return `
        <div class="event-card ${esDestacado ? "featured" : ""}">
          ${
            esDestacado
              ? '<span class="featured-badge"><i class="fa-solid fa-star"></i> Destacado</span>'
              : ""
          }
          <img src="${imagen}" alt="${ev.nombre || "Evento"}" class="event-img" loading="lazy">
          <div class="event-body">
            <span class="event-date-badge">
              <i class="fa-regular fa-calendar"></i> ${fechaFormateada} - ${ev.hora || ""}hs
            </span>
            <h3 class="event-title">${ev.nombre || ""}</h3>
            <p class="event-desc">${ev.descripcion || ""}</p>
            <div class="event-details">
              <div>
                <i class="fa-solid fa-location-dot"></i>
                <strong>Lugar:</strong> ${ev.lugar || ""} (${ev.direccion || ""})
              </div>
              <div>
                <i class="fa-solid fa-phone"></i>
                <strong>Contacto:</strong> ${ev.contacto || ""}
              </div>
            </div>
          </div>
        </div>
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
      contacto: "+54 9 260 4111111",
      imagenUrl: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=600&q=80",
      estado: "aprobado",
      destacado: true
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
      contacto: "+54 9 261 4333333",
      imagenUrl: "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=600&q=80",
      estado: "aprobado",
      destacado: true
    }
  ];

  return muestra
    .filter((ev) => ev.ubicacion === ubicacion && ev.estado === "aprobado" && ev.fecha >= fechaHoy)
    .sort((a, b) => {
      if (a.destacado !== b.destacado) return a.destacado ? -1 : 1;
      return (a.fecha || "").localeCompare(b.fecha || "");
    });
}


/**
 * 3. Inicialización en el ciclo de vida del DOM:
 * - Carga y renderiza eventos para la página actual (sanrafael / mendoza)
 * - Gestiona el modal de carga y el envío del formulario con subirEvento()
 */
document.addEventListener("DOMContentLoaded", async () => {
  const ubicacionActual = document.body.getAttribute("data-location");
  if (!ubicacionActual) return;

  const eventsGrid = document.getElementById("events-grid");

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

  if (modalOverlay) {
    modalOverlay.addEventListener("click", (e) => {
      if (e.target === modalOverlay) modalOverlay.classList.remove("active");
    });
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

      const MAX_SIZE_MB = 2;
      if (imagenArchivo.size > MAX_SIZE_MB * 1024 * 1024) {
        alert(`La imagen supera el límite de ${MAX_SIZE_MB} MB. Elige una imagen más liviana.`);
        return;
      }

      const nombre = document.getElementById("event-title").value.trim();
      const descripcion = document.getElementById("event-desc").value.trim();
      const fecha = document.getElementById("event-date").value;
      const hora = document.getElementById("event-time").value;
      const lugar = document.getElementById("event-place").value.trim();
      const direccion = document.getElementById("event-address").value.trim();
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
          contacto,
          ubicacion: ubicacionActual,
          imagenArchivo
        });

        alert("¡Evento enviado con éxito! Quedará pendiente de aprobación por el moderador.");
        eventForm.reset();

        if (modalOverlay) {
          modalOverlay.classList.remove("active");
        }
      } catch (error) {
        console.error("Error al subir el evento:", error);
        alert(`Hubo un error al guardar el evento: ${error.message}`);
      } finally {
        if (btnSubmit) {
          btnSubmit.disabled = false;
          btnSubmit.innerHTML = originalBtnText;
        }
      }
    });
  }
});

