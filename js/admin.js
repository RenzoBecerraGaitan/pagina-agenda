// Panel de Control y Administración de Eventos (/admin)
import { db, storage, auth, firebaseConfig } from "./firebase-config.js";
import { googleProvider } from "./auth.js";
import {
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  collection,
  doc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import {
  ref,
  deleteObject,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";

// Configuración explícita de persistencia en localStorage para evitar bucles o pérdida de sesión
setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.warn("Aviso al inicializar browserLocalPersistence en admin:", err);
});

let pestañaActiva = "pendientes";
let todosLosEventos = [];
// Mapa de autores por ID de evento: { [eventoId]: { uid, email, nombre, fechaCreacion } }
let mapaAutores = {};
// Mapa de autores bloqueados por UID: { [uid]: { email, motivo, bloqueadoPor, fecha } }
export let mapaBloqueados = {};

// Función auxiliar para garantizar un token de autenticación fresco
async function obtenerTokenValido() {
  const user = auth.currentUser;
  if (!user) {
    const error = new Error(
      "No hay una sesión de usuario activa. Volvé a iniciar sesión.",
    );
    error.code = "auth/no-user";
    throw error;
  }

  // Forzar actualización del token para que las reglas de Firestore reciban request.auth.token.email
  try {
    await user.getIdToken(true);
  } catch (tokenError) {
    console.error(
      "[admin] Error al renovar el token:",
      tokenError.code,
      tokenError.message,
    );
    throw tokenError;
  }

  // Diagnóstico temporal: email del perfil, uid y email del claim del token
  try {
    const tokenResult = await user.getIdTokenResult();
    console.log("[admin] Diagnóstico de sesión", {
      emailPerfil: user.email,
      uid: user.uid,
      emailEnToken: tokenResult.claims.email,
      emailCoincide: tokenResult.claims.email === user.email,
      esAdminSegunReglas:
        tokenResult.claims.email === "renzobecerragaitan@gmail.com" ||
        tokenResult.claims.email === "cerezoli387@gmail.com",
      mismaInstanciaApp: auth.app.name === db.app.name,
      appName: auth.app.name,
    });
  } catch (diagError) {
    console.warn("[admin] No se pudo leer getIdTokenResult():", diagError);
  }

  return user;
}

/**
 * Traduce los errores de Firebase a un mensaje entendible para el admin.
 * Distingue permission-denied, not-found y los errores de autenticación (auth/*).
 */
function describirErrorAdmin(error, accion) {
  const code = error && error.code ? error.code : "desconocido";
  const message = error && error.message ? error.message : String(error);

  let explicacion;
  if (code === "permission-denied") {
    explicacion =
      "Permiso denegado por las reglas de Firestore. " +
      "Verificá que el correo con el que iniciaste sesión sea uno de los administradores " +
      "(renzobecerragaitan@gmail.com o cerezoli387@gmail.com) y que las reglas publicadas " +
      "incluyan ese correo.";
  } else if (code === "not-found") {
    explicacion =
      "El evento no existe en Firestore. Probablemente el listado mostrado provenía de los " +
      "datos de demostración locales (IDs ev_adm_*). Recargá el panel para traer los eventos reales.";
  } else if (code === "unauthenticated") {
    explicacion =
      "No hay una sesión de autenticación válida o el token expiró. Volvé a iniciar sesión.";
  } else if (typeof code === "string" && code.startsWith("auth/")) {
    explicacion = "Error de autenticación.";
  } else if (code === "failed-precondition" || code === "aborted") {
    explicacion =
      "La operación fue rechazada por el servidor. Probablemente un problema de App Check " +
      "o de concurrencia. Reintentá en unos segundos.";
  } else if (code === "unavailable") {
    explicacion = "Firestore no está disponible en este momento. Revisá tu conexión.";
  } else if (code === "deadline-exceeded") {
    explicacion = "La operación superó el tiempo de espera. Reintentá.";
  } else {
    explicacion = "Revisá la consola del navegador para más detalle.";
  }

  console.error(`[admin] Error al ${accion}:`, code, message, error);
  return `Error al ${accion} [${code}]: ${explicacion}\n\nDetalle: ${message}`;
}

/**
 * 1. Aprobar evento: cambia el estado del evento a 'aprobado'
 */
export async function aprobarEvento(id) {
  try {
    if (firebaseConfig.apiKey) {
      await obtenerTokenValido(); // Valida y renueva el token antes de escribir
      await updateDoc(doc(db, "eventos", id), { estado: "aprobado" });
    } else {
      actualizarEventoLocal(id, { estado: "aprobado" });
    }
    await cargarYRenderizarEventos();
  } catch (error) {
    alert(describirErrorAdmin(error, "aprobar el evento"));
  }
}

/**
 * 2. Rechazar evento: cambia el estado a 'rechazado'
 */
export async function rechazarEvento(id) {
  try {
    if (firebaseConfig.apiKey) {
      await obtenerTokenValido();
      await updateDoc(doc(db, "eventos", id), { estado: "rechazado" });
    } else {
      actualizarEventoLocal(id, { estado: "rechazado" });
    }
    await cargarYRenderizarEventos();
  } catch (error) {
    alert(describirErrorAdmin(error, "rechazar el evento"));
  }
}

/**
 * 3. Destacar evento: alterna la propiedad destacado entre true y false
 */
export async function alternarDestacado(id, valorActual) {
  const nuevoValor = !valorActual;
  try {
    if (firebaseConfig.apiKey) {
      await obtenerTokenValido();
      await updateDoc(doc(db, "eventos", id), { destacado: nuevoValor });
    } else {
      actualizarEventoLocal(id, { destacado: nuevoValor });
    }
    await cargarYRenderizarEventos();
  } catch (error) {
    alert(describirErrorAdmin(error, "cambiar el destacado"));
  }
}

/**
 * Extrae el path real del objeto en Storage a partir de una URL de descarga.
 * `ref(storage, "https://.../o/eventos%2Fimg.jpg")` es inválido en Firebase Storage
 * (error storage/invalid-argument), hay que pasar solo "eventos/img.jpg".
 */
function extraerPathStorage(imagenUrl) {
  if (!imagenUrl || typeof imagenUrl !== "string") return null;
  if (imagenUrl.startsWith("gs://")) {
    const resto = imagenUrl.slice("gs://".length);
    const slashIndex = resto.indexOf("/");
    return slashIndex === -1 ? null : resto.slice(slashIndex + 1);
  }
  const match = imagenUrl.match(/\/o\/(.+)$/);
  if (match) {
    // Se descarta el query string (?alt=media&token=...) que no forma parte del path
    const path = match[1].split("?")[0];
    try {
      return decodeURIComponent(path);
    } catch (e) {
      return path;
    }
  }
  return null;
}

/**
 * 4. Eliminar permanentemente: borra el documento de Firestore y su imagen en Storage
 */
export async function eliminarEvento(id, imagenUrl) {
  const confirmar = confirm(
    "¿Estás seguro de eliminar permanentemente este evento y su imagen asociada? Esta acción no se puede deshacer.",
  );
  if (!confirmar) return;

  try {
    if (firebaseConfig.apiKey) {
      await obtenerTokenValido();
      const pathStorage = extraerPathStorage(imagenUrl);
      if (pathStorage) {
        try {
          await deleteObject(ref(storage, pathStorage));
        } catch (storageErr) {
          console.warn(
            `[admin] No se pudo eliminar la imagen de Storage (${pathStorage}):`,
            storageErr.code,
            storageErr.message,
          );
        }
      }
      await deleteDoc(doc(db, "eventos", id));
      // Mejor esfuerzo: borrar el registro del autor asociado, sin romper si falla
      try {
        await deleteDoc(doc(db, "autores", id));
      } catch (autorErr) {
        console.warn(
          `[admin] No se pudo eliminar el registro del autor (autores/${id}):`,
          autorErr.code,
          autorErr.message
        );
      }
    } else {
      eliminarEventoLocal(id);
    }

    alert("Evento eliminado permanentemente.");
    await cargarYRenderizarEventos();
  } catch (error) {
    alert(describirErrorAdmin(error, "eliminar el evento"));
  }
}

/**
 * Bloquea o desbloquea a un autor de eventos.
 * - Si el autor ya está bloqueado: lo desbloquea (deleteDoc en bloqueados/{uid}).
 * - Si no está bloqueado: pide confirmación y motivo opcional, luego lo bloquea
 *   (setDoc en bloqueados/{uid} con email, motivo, bloqueadoPor y fecha).
 */
export async function bloquearAutor(uid, email, nombre) {
  try {
    await obtenerTokenValido();

    const yaBloqueado = !!mapaBloqueados[uid];

    if (yaBloqueado) {
      const confirmar = confirm(
        `¿Deseás desbloquear al autor "${nombre}" (${email}) para que vuelva a publicar eventos?`
      );
      if (!confirmar) return;
      await deleteDoc(doc(db, "bloqueados", uid));
      alert("Autor desbloqueado. Puede volver a publicar eventos.");
    } else {
      const confirmar = confirm(
        `¿Deseás bloquear al autor "${nombre}" (${email})? No podrá publicar más eventos.`
      );
      if (!confirmar) return;
      const motivo = prompt("Motivo del bloqueo (opcional):") || "";
      await setDoc(doc(db, "bloqueados", uid), {
        email,
        motivo,
        bloqueadoPor: auth.currentUser.email,
        fecha: serverTimestamp(),
      });
      alert("Autor bloqueado. No podrá publicar más eventos.");
    }

    await cargarYRenderizarEventos();
  } catch (error) {
    alert(describirErrorAdmin(error, yaBloqueado ? "desbloquear al autor" : "bloquear al autor"));
  }
}

/**
 * Renderiza la lista de autores bloqueados en la pestaña "Bloqueados".
 */
export function renderizarBloqueados(contenedor) {
  const entradas = Object.entries(mapaBloqueados);
  if (entradas.length === 0) {
    contenedor.innerHTML = `
      <div class="no-events" style="text-align: center; padding: 2.5rem; background: var(--surface); border: 1px dashed var(--border-color); border-radius: var(--radius);">
        <i class="fa-solid fa-user-slash" style="font-size: 2.5rem; margin-bottom: 0.75rem; color: var(--text-muted);"></i>
        <h3 style="margin-bottom: 0.25rem;">No hay autores bloqueados</h3>
        <p style="color: var(--text-muted); font-size: 0.9rem;">Los autores bloqueados aparecerán aquí.</p>
      </div>
    `;
    return;
  }

  contenedor.innerHTML = `
    <div class="admin-list-bloqueados">
      ${entradas
        .map(([uid, data]) => {
          const fecha = data.fecha ? new Date(data.fecha).toLocaleString("es-AR") : "-";
          const idLiteral = literalAtributo(uid);
          return `
            <div class="admin-item" style="border-left: 4px solid var(--danger); padding: 1rem; margin-bottom: 0.75rem; background: var(--surface); border-radius: var(--radius);">
              <div>
                <div style="display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.25rem;">
                  <span class="badge" style="background: rgba(239, 68, 68, 0.15); color: var(--danger); text-transform: uppercase; font-weight: 700; font-size: 0.75rem;">
                    Bloqueado
                  </span>
                </div>
                <p style="font-size: 0.9rem; margin-bottom: 0.25rem;">
                  <strong>Autor:</strong> ${data.nombre || data.email} (${data.email || "-"})
                </p>
                <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.25rem;">
                  <strong>Motivo:</strong> ${data.motivo || "Sin motivo especificado"}
                </p>
                <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.25rem;">
                  <strong>Bloqueado por:</strong> ${data.bloqueadoPor || "-"} | <strong>Fecha:</strong> ${fecha}
                </p>
                <button
                  class="btn btn-outline btn-sm"
                  style="color: var(--accent); border-color: var(--accent);"
                  onclick="bloquearAutor(${idLiteral}, ${literalAtributo(data.email || "")}, ${literalAtributo(data.nombre || "")})"
                >
                  <i class="fa-solid fa-unlock"></i> Desbloquear
                </button>
              </div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

window.aprobarEvento = aprobarEvento;
window.rechazarEvento = rechazarEvento;
window.alternarDestacado = alternarDestacado;
window.eliminarEvento = eliminarEvento;
window.bloquearAutor = bloquearAutor;

/**
 * Muestra un error visible dentro del listado del panel admin
 */
function mostrarErrorEnPanel(adminList, mensaje) {
  if (!adminList) return;
  adminList.innerHTML = `
    <div class="no-events" style="text-align: center; padding: 2.5rem; background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.35); border-radius: var(--radius);">
      <i class="fa-solid fa-triangle-exclamation" style="font-size: 2.5rem; margin-bottom: 0.75rem; color: var(--danger);"></i>
      <h3 style="margin-bottom: 0.25rem;">No se pudieron cargar los eventos</h3>
      <p style="color: var(--text-muted); font-size: 0.9rem; white-space: pre-line;">${mensaje}</p>
    </div>
  `;
}

/**
 * Carga eventos desde Firestore (o fallback local) y actualiza contadores y render
 */
export async function cargarYRenderizarEventos() {
  const adminList = document.getElementById("admin-events-list");
  if (!adminList) return;

  try {
    if (firebaseConfig.apiKey) {
      const snapshot = await getDocs(collection(db, "eventos"));
      todosLosEventos = [];
      snapshot.forEach((docSnap) => {
        todosLosEventos.push({ id: docSnap.id, ...docSnap.data() });
      });

      // Leer autores (indexados por ID de evento). Nunca rompe el panel si falla.
      try {
        mapaAutores = {};
        const autoresSnap = await getDocs(collection(db, "autores"));
        autoresSnap.forEach((d) => {
          mapaAutores[d.id] = d.data();
        });
      } catch (autoresErr) {
        console.error("[admin] Error al leer la colección 'autores':", autoresErr);
      }

      // Leer autores bloqueados (mapa por UID). Nunca rompe el panel si falla.
      try {
        mapaBloqueados = {};
        const bloqueadosSnap = await getDocs(collection(db, "bloqueados"));
        bloqueadosSnap.forEach((d) => {
          const data = d.data();
          if (data && data.uid) mapaBloqueados[data.uid] = data;
        });
      } catch (bloqueadosErr) {
        console.error("[admin] Error al leer la colección 'bloqueados':", bloqueadosErr);
      }
    } else {
      todosLosEventos = obtenerEventosLocales();
    }
  } catch (err) {
    console.error("[admin] Error al obtener eventos de Firestore:", err);
    if (firebaseConfig.apiKey) {
      // Con credenciales configuradas NO se usan datos de demostración:
      // sus IDs (ev_adm_*) no existen en Firestore y provocaban errores not-found al aprobar.
      const code = err && err.code ? err.code : "desconocido";
      const detalle = err && err.message ? err.message : String(err);
      todosLosEventos = [];
      mostrarErrorEnPanel(
        adminList,
        `No se pudo leer la colección "eventos" de Firestore.\n` +
          `Código: ${code}\n${detalle}\n\n` +
          `Revisá las reglas de Firestore y tu conexión, luego recargá el panel.`,
      );
      const countPendientes = document.getElementById("count-pendientes");
      const countActivos = document.getElementById("count-activos");
      const countHistorial = document.getElementById("count-historial");
      if (countPendientes) countPendientes.textContent = 0;
      if (countActivos) countActivos.textContent = 0;
      if (countHistorial) countHistorial.textContent = 0;
      return;
    }
    todosLosEventos = obtenerEventosLocales();
  }

  const hoy = new Date().toISOString().split("T")[0];

  // Clasificación en las 3 pestañas solicitadas
  const pendientes = todosLosEventos.filter((ev) => ev.estado === "pendiente");
  const activos = todosLosEventos.filter(
    (ev) => ev.estado === "aprobado" && (!ev.fecha || ev.fecha >= hoy),
  );
  const historial = todosLosEventos.filter(
    (ev) => (ev.fecha && ev.fecha < hoy) || ev.estado === "rechazado",
  );

  const countPendientes = document.getElementById("count-pendientes");
  const countActivos = document.getElementById("count-activos");
  const countHistorial = document.getElementById("count-historial");
  const countBloqueados = document.getElementById("count-bloqueados");

  if (countPendientes) countPendientes.textContent = pendientes.length;
  if (countActivos) countActivos.textContent = activos.length;
  if (countHistorial) countHistorial.textContent = historial.length;
  if (countBloqueados) countBloqueados.textContent = Object.keys(mapaBloqueados).length;

  let listaFiltrada = pendientes;
  if (pestañaActiva === "activos") listaFiltrada = activos;
  if (pestañaActiva === "historial") listaFiltrada = historial;

  if (pestañaActiva === "bloqueados") {
    renderizarBloqueados(adminList);
    return;
  }

  renderizarListadoAdmin(listaFiltrada, adminList, pestañaActiva);
}

/**
 * Convierte un valor en un literal JS de comillas simples apto para embeberlo
 * dentro de un atributo HTML onclick.
 * Primero se escapa para JS (backslash, comilla simple, saltos de línea) y luego
 * se escapan las entidades HTML (& " < >), porque dentro de un atributo delimitado
 * por comillas dobles un \" NO protege la comilla: cortaría el atributo.
 */
function literalAtributo(valor) {
  const texto = valor === null || valor === undefined ? "" : String(valor);
  const escapadoJs = texto
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
  const escapadoHtml = escapadoJs
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `'${escapadoHtml}'`;
}

function renderizarListadoAdmin(eventos, contenedor, tab) {
  if (eventos.length === 0) {
    contenedor.innerHTML = `
      <div class="no-events" style="text-align: center; padding: 2.5rem; background: var(--surface); border: 1px dashed var(--border-color); border-radius: var(--radius);">
        <i class="fa-solid fa-folder-open" style="font-size: 2.5rem; margin-bottom: 0.75rem; color: var(--text-muted);"></i>
        <h3 style="margin-bottom: 0.25rem;">No hay eventos en esta sección</h3>
        <p style="color: var(--text-muted); font-size: 0.9rem;">Los eventos clasificados en "${tab}" aparecerán aquí.</p>
      </div>
    `;
    return;
  }

  eventos.sort((a, b) => {
    const destA = Boolean(a.destacado);
    const destB = Boolean(b.destacado);
    if (destA !== destB) return destA ? -1 : 1;
    return (a.fecha || "").localeCompare(b.fecha || "");
  });

  contenedor.innerHTML = eventos
    .map((ev) => {
      let badgeClass = "badge-pending";
      let statusText = "Pendiente";
      if (ev.estado === "aprobado") {
        badgeClass = "badge-approved";
        statusText = "Aprobado";
      } else if (ev.estado === "rechazado") {
        badgeClass = "badge-rejected";
        statusText = "Rechazado";
      }

      const imagen =
        ev.imagenUrl ||
        "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=600&q=80";
      const esDestacado = Boolean(ev.destacado);
      const autor = mapaAutores[ev.id];
      const autorBloqueado = autor && !!mapaBloqueados[autor.uid];
      const uidLiteral = autor ? literalAtributo(autor.uid) : "null";
      const emailLiteral = autor ? literalAtributo(autor.email) : "null";
      const nombreLiteral = autor ? literalAtributo(autor.nombre || "") : "null";
      // Serialización segura para embeber IDs/URLs dentro de atributos onclick:
      // se escapan las entidades HTML y se usan comillas simples para el literal JS.
      const idLiteral = literalAtributo(ev.id);
      const imagenLiteral = literalAtributo(ev.imagenUrl || "");

      return `
        <div class="admin-item" style="border-left: 4px solid ${
          esDestacado ? "var(--warning)" : "var(--primary)"
        };">
          <div class="admin-item-info">
            <img src="${imagen}" alt="${ev.nombre || "Evento"}" class="admin-item-img">
            <div>
              <div style="display: flex; gap: 0.5rem; align-items: center; margin-bottom: 0.35rem; flex-wrap: wrap;">
                <span class="badge ${badgeClass}">${statusText}</span>
                ${
                  esDestacado
                    ? '<span class="badge" style="background: rgba(245, 158, 11, 0.15); color: var(--warning);"><i class="fa-solid fa-star"></i> Destacado</span>'
                    : ""
                }
                <span style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 700;">
                  📍 ${ev.ubicacion || "general"}
                </span>
              </div>
              <h4 style="font-size: 1.05rem; font-weight: 700; margin-bottom: 0.25rem;">
                ${ev.nombre || ev.title || "Sin título"}
              </h4>
              <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.25rem;">
                📅 <strong>Fecha:</strong> ${ev.fecha || "-"} a las ${ev.hora || "--:--"}hs | 
                🏛️ <strong>Lugar:</strong> ${ev.lugar || "-"} (${ev.direccion || "-"})
              </p>
              <p style="font-size: 0.82rem; color: var(--text-muted); margin-bottom: 0.25rem;">
                🏘️ <strong>Localidad:</strong> ${ev.localidad || "-"}
              </p>
              <p style="font-size: 0.82rem; color: var(--text-muted);">
                📞 <strong>Contacto:</strong> ${ev.contacto || "No especificado"}
              </p>
              ${autor
                ? `<p style="font-size: 0.82rem; color: var(--text-muted); margin-bottom: 0.25rem;">
                      👤 <strong>Autor:</strong> ${autor.nombre || autor.email} (${autor.email})
                      ${autorBloqueado ? ' <span class="badge" style="background: var(--danger); color: #fff;">Autor bloqueado</span>' : ""}
                    </p>`
                : `<p style="font-size: 0.82rem; color: var(--text-muted); margin-bottom: 0.25rem;">
                      👤 <strong>Autor:</strong> sin datos
                    </p>`
              }
            </div>
          </div>

          <div class="admin-actions">
            <!-- Botón Destacar (alterna true/false) -->
            <button
              class="btn btn-sm ${esDestacado ? "btn-primary" : "btn-outline"}"
              style="${esDestacado ? "background-color: var(--warning); border-color: var(--warning);" : ""}"
              onclick="alternarDestacado(${idLiteral}, ${esDestacado})"
              title="Alternar evento destacado"
            >
              <i class="fa-${esDestacado ? "solid" : "regular"} fa-star"></i>
              ${esDestacado ? "Destacado" : "Destacar"}
            </button>

            <!-- Botón Aprobar -->
            ${
              ev.estado !== "aprobado"
                ? `
              <button
                class="btn btn-primary btn-sm"
                onclick="aprobarEvento(${idLiteral})"
              >
                <i class="fa-solid fa-check"></i> Aprobar
              </button>
            `
                : ""
            }

            <!-- Botón Rechazar -->
            ${
              ev.estado !== "rechazado"
                ? `
              <button
                class="btn btn-outline btn-sm"
                style="color: var(--warning); border-color: var(--warning);"
                onclick="rechazarEvento(${idLiteral})"
              >
                <i class="fa-solid fa-ban"></i> Rechazar
              </button>
            `
                : ""
            }

            <!-- Botón Bloquear / Desbloquear autor (solo si se conoce el autor) -->
            ${
              autor
                ? `
              <button
                class="btn btn-sm ${autorBloqueado ? "btn-outline" : "btn-danger"}"
                style="${autorBloqueado ? "color: var(--accent); border-color: var(--accent);" : ""}"
                onclick="bloquearAutor(${uidLiteral}, ${emailLiteral}, ${nombreLiteral})"
                title="${autorBloqueado ? "Desbloquear autor" : "Bloquear autor"}"
              >
                <i class="fa-solid fa-${autorBloqueado ? "unlock" : "user-slash"}"></i>
                ${autorBloqueado ? "Desbloquear" : "Bloquear autor"}
              </button>
            `
                : ""
            }

            <!-- Botón Eliminar permanentemente -->
            <button
              class="btn btn-danger btn-sm"
              onclick="eliminarEvento(${idLiteral}, ${imagenLiteral})"
            >
              <i class="fa-solid fa-trash"></i> Eliminar
            </button>
          </div>
        </div>
      `;
    })
    .join("");
}
// Métodos de respaldo para entorno local de prueba sin API keys
function obtenerEventosLocales() {
  const datos = localStorage.getItem("agenda_events_admin");
  if (datos) {
    try {
      return JSON.parse(datos);
    } catch (e) {}
  }
  const iniciales = [
    {
      id: "ev_adm_1",
      nombre: "Concierto Acústico bajo las Estrellas",
      ubicacion: "sanrafael",
      fecha: "2026-11-08",
      hora: "20:30",
      lugar: "Parque Hipólito Yrigoyen",
      direccion: "Montes de Oca y Ameghino",
      localidad: "San Rafael",
      contacto: "+54 9 260 4555555",
      estado: "pendiente",
      destacado: false,
      imagenUrl:
        "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=600&q=80",
    },
    {
      id: "ev_adm_2",
      nombre: "Peña Folklórica Tradicional",
      ubicacion: "sanrafael",
      fecha: "2026-11-15",
      hora: "21:00",
      lugar: "Club Español",
      direccion: "Av. Mitre 550",
      localidad: "San Rafael",
      contacto: "+54 9 260 4111111",
      estado: "aprobado",
      destacado: true,
      imagenUrl:
        "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=600&q=80",
    },
    {
      id: "ev_adm_3",
      nombre: "Festival de Indie Rock Mendocino",
      ubicacion: "mendoza",
      fecha: "2026-11-20",
      hora: "19:00",
      lugar: "Nave Cultural",
      direccion: "España y Maza",
      localidad: "Ciudad de Mendoza",
      contacto: "+54 9 261 4333333",
      estado: "aprobado",
      destacado: true,
      imagenUrl:
        "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=600&q=80",
    },
    {
      id: "ev_adm_4",
      nombre: "Encuentro de Ceramistas de Cuyo",
      ubicacion: "mendoza",
      fecha: "2026-09-10",
      hora: "16:00",
      lugar: "Espacio Le Parc",
      direccion: "Mitre y Godoy Cruz",
      localidad: "Godoy Cruz",
      contacto: "+54 9 261 4000111",
      estado: "aprobado",
      destacado: false,
      imagenUrl:
        "https://images.unsplash.com/photo-1565193566173-7a0ee3dbe261?auto=format&fit=crop&w=600&q=80",
    },
  ];
  localStorage.setItem("agenda_events_admin", JSON.stringify(iniciales));
  return iniciales;
}

function actualizarEventoLocal(id, campos) {
  const eventos = obtenerEventosLocales();
  const index = eventos.findIndex((ev) => ev.id === id);
  if (index !== -1) {
    eventos[index] = { ...eventos[index], ...campos };
    localStorage.setItem("agenda_events_admin", JSON.stringify(eventos));
  }
}

function eliminarEventoLocal(id) {
  const eventos = obtenerEventosLocales().filter((ev) => ev.id !== id);
  localStorage.setItem("agenda_events_admin", JSON.stringify(eventos));
}

// Lista de correos autorizados con permisos de administrador
export const ADMIN_EMAILS = [
  "renzobecerragaitan@gmail.com",
  "cerezoli387@gmail.com",
];

/**
 * Valida si un correo electrónico pertenece a la lista de administradores
 */
export function esUsuarioAdmin(email) {
  if (!email || typeof email !== "string") return false;
  const normalizado = email.toLowerCase().trim();
  return ADMIN_EMAILS.some(
    (admin) => admin.toLowerCase().trim() === normalizado,
  );
}

function mostrarAlertaAuth(mensaje) {
  const alertBox = document.getElementById("admin-auth-alert");
  const alertMsg = document.getElementById("admin-auth-alert-msg");
  if (alertBox && alertMsg) {
    alertMsg.textContent = mensaje;
    alertBox.style.display = "flex";
  }
}

function limpiarAlertaAuth() {
  const alertBox = document.getElementById("admin-auth-alert");
  const alertMsg = document.getElementById("admin-auth-alert-msg");
  if (alertBox) alertBox.style.display = "none";
  if (alertMsg) alertMsg.textContent = "";
}

/**
 * Manejador del click directo del botón de inicio de sesión de Google
 * Usa signInWithPopup y maneja auth/popup-blocked
 */
async function handleAdminLoginClick() {
  limpiarAlertaAuth();
  const btnLogin = document.getElementById("btn-admin-login");
  const originalHtml = btnLogin ? btnLogin.innerHTML : "";

  try {
    if (btnLogin) {
      btnLogin.disabled = true;
      btnLogin.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Conectando...`;
    }

    if (!firebaseConfig.apiKey) {
      const simular = confirm(
        "Aviso: Las credenciales de Firebase en js/firebase-config.js están vacías.\n\n" +
          "¿Deseas iniciar sesión como 'renzobecerragaitan@gmail.com' en modo prueba para ver el panel?",
      );
      if (simular) {
        localStorage.setItem(
          "agenda_admin_demo_user",
          "renzobecerragaitan@gmail.com",
        );
        await actualizarVistaAdminParaUsuario({
          displayName: "Renzo Becerra (Demo)",
          email: "renzobecerragaitan@gmail.com",
        });
        return;
      } else {
        mostrarAlertaAuth(
          "Debes completar las credenciales de Firebase en js/firebase-config.js para usar Google Auth.",
        );
        if (btnLogin) {
          btnLogin.disabled = false;
          btnLogin.innerHTML = originalHtml;
        }
        return;
      }
    }

    // Asegurar persistencia local y abrir ventana emergente directamente en el gesto del usuario
    await setPersistence(auth, browserLocalPersistence);
    await signInWithPopup(auth, googleProvider);
    // onAuthStateChanged es el único encargado de alternar la visibilidad entre Login y Dashboard
  } catch (error) {
    console.error("Error al autenticar con Google:", error.code, error.message);
    if (error.code === "auth/popup-blocked") {
      mostrarAlertaAuth(
        "La ventana emergente de inicio de sesión fue bloqueada por tu navegador. Por favor habilita los popups para este sitio en la configuración de tu navegador y vuelve a intentarlo.",
      );
      alert(
        "Tu navegador bloqueó la ventana emergente. Por favor habilita los popups para continuar con Google.",
      );
    } else if (error.code === "auth/popup-closed-by-user") {
      mostrarAlertaAuth(
        "Inicio de sesión cancelado al cerrar la ventana emergente.",
      );
    } else if (error.code !== "auth/cancelled-popup-request") {
      mostrarAlertaAuth(`Error al iniciar sesión: ${error.message}`);
    }
  } finally {
    if (btnLogin) {
      btnLogin.disabled = false;
      btnLogin.innerHTML = originalHtml;
    }
  }
}

async function actualizarVistaAdminParaUsuario(user) {
  const authGuard = document.getElementById("admin-auth-guard");
  const dashboard = document.getElementById("admin-dashboard");
  const userEmailSpan = document.getElementById("admin-user-email");

  limpiarAlertaAuth();
  if (authGuard) authGuard.style.display = "none";
  if (dashboard) dashboard.style.display = "block";
  if (userEmailSpan) {
    userEmailSpan.textContent = user.displayName
      ? `${user.displayName} (${user.email})`
      : user.email;
  }
  await cargarYRenderizarEventos();
}

/**
 * Inicialización del panel de administración
 */
function initAdmin() {
  const authGuard = document.getElementById("admin-auth-guard");
  const dashboard = document.getElementById("admin-dashboard");
  const btnLogin = document.getElementById("btn-admin-login");
  const btnLogout = document.getElementById("btn-admin-logout");
  const tabButtons = document.querySelectorAll(".tab-btn");

  // 4. Vinculación del evento de inicio de sesión al botón únicamente mediante listener 'click' directo
  if (btnLogin) {
    btnLogin.addEventListener("click", handleAdminLoginClick);
  }

  // Vinculación al botón de cerrar sesión
  if (btnLogout) {
    btnLogout.addEventListener("click", async () => {
      try {
        localStorage.removeItem("agenda_admin_demo_user");
        await signOut(auth);
      } catch (e) {
        console.error("Error al cerrar sesión:", e);
      }
    });
  }

  // 3. onAuthStateChanged como el ÚNICO listener encargado de alternar la visibilidad
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      const email = user.email || "";
      if (esUsuarioAdmin(email)) {
        // Usuario activo y ES administrador
        await actualizarVistaAdminParaUsuario(user);
      } else {
        // Usuario autenticado pero NO es administrador
        if (dashboard) dashboard.style.display = "none";
        if (authGuard) authGuard.style.display = "block";

        const mensaje = `Acceso denegado: El correo "${email}" no cuenta con permisos de administrador.`;
        mostrarAlertaAuth(mensaje);
        alert(mensaje + "\nCerrando sesión por seguridad.");

        try {
          await signOut(auth);
        } catch (e) {
          console.warn("Error al cerrar sesión no autorizada:", e);
        }
      }
    } else {
      // No hay usuario activo: muestra la pantalla/botón de login
      const demoEmail = localStorage.getItem("agenda_admin_demo_user");
      if (!firebaseConfig.apiKey && demoEmail && esUsuarioAdmin(demoEmail)) {
        await actualizarVistaAdminParaUsuario({
          displayName: "Renzo Becerra (Demo)",
          email: demoEmail,
        });
      } else {
        if (authGuard) authGuard.style.display = "block";
        if (dashboard) dashboard.style.display = "none";
      }
    }
  });

  // Cambio de pestañas (Pendientes / Activos / Historial)
  tabButtons.forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const targetBtn = e.currentTarget;
      pestañaActiva = targetBtn.getAttribute("data-tab");

      tabButtons.forEach((b) => {
        b.classList.remove("btn-primary");
        b.classList.add("btn-outline");
      });
      targetBtn.classList.remove("btn-outline");
      targetBtn.classList.add("btn-primary");

      cargarYRenderizarEventos();
    });
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAdmin);
} else {
  initAdmin();
}
