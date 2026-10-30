const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");
const axios = require("axios");
const { captionWhatsapp, captionInstagram } = require("./captions");
const { crearObtenerLinkGrupo } = require("./grupos");

admin.initializeApp();
const db = admin.firestore();
const obtenerLinkGrupo = crearObtenerLinkGrupo(db);

// Región de Firestore (Santiago): triggers de base de datos y función del admin.
const REGION_FIRESTORE = "southamerica-west1";
// Cloud Scheduler no figura en la lista oficial para Santiago, por eso el
// programador de eventos del día corre en São Paulo. Solo lee Firestore y
// llama a Make, así que la región no cambia el resultado.
const REGION_SCHEDULER = "southamerica-east1";

// Webhook de Make que publica en WhatsApp (grupos).
const WEBHOOK_MAKE =
  "https://hook.us2.make.com/pvl27nf9jp6kp1268xvnoirxb81hr0yv";

// Webhook de Make que publica en Instagram. Se dispara SOLO desde el botón
// "Publicar en Instagram" del panel de administración.
// Pegá acá la URL del webhook del escenario de Instagram.
const WEBHOOK_MAKE_INSTAGRAM =
  "https://hook.us2.make.com/PEGAR_AQUI_EL_WEBHOOK_DE_INSTAGRAM";

const ADMIN_EMAILS = ["renzobecerragaitan@gmail.com", "cerezoli387@gmail.com"];

// Eventos del día (normales Y destacados/premium): se envían desde las 12:00
// (hora de Mendoza).
// Corre cada hora de 12 a 20: un evento aprobado a las 15:00 sale a las 16:00,
// y si Make falla se reintenta en la hora siguiente. Nunca se repite un evento
// porque se marca como publicado. Para que salga UNA sola vez al día,
// cambiar por "0 12 * * *".
const CRON_EVENTOS_DEL_DIA = "0 12-20 * * *";

// Fecha de hoy en Mendoza (AAAA-MM-DD). toISOString() usaría UTC.
function fechaHoyMendoza() {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "America/Argentina/Mendoza",
  });
}

// 1. EVENTOS DESTACADOS: salen a WhatsApp apenas se aprueban. Además, el día
// del evento reciben un segundo envío desde el programador (punto 2).
exports.onEventoAprobado = onDocumentUpdated(
  {
    document: "eventos/{eventoId}",
    region: REGION_FIRESTORE,
  },
  async (event) => {
    const antes = event.data.before.data();
    const despues = event.data.after.data();

    if (
      antes.estado !== "aprobado" &&
      despues.estado === "aprobado" &&
      despues.destacado === true
    ) {
      const { ok } = await enviarAMake(
        WEBHOOK_MAKE,
        event.params.eventoId,
        despues,
        { momento: "aprobacion" },
      );
      // Si el evento es para hoy, este envío ya cuenta como el del día: así el
      // programador de las 12:00 no lo repite a las pocas horas.
      if (ok && despues.fecha === fechaHoyMendoza()) {
        await event.data.after.ref.update({ publicado: true });
      }
    }
  },
);

// 2. EVENTOS DEL DÍA (normales y destacados/premium): WhatsApp, desde las 12:00.
exports.publicarEventosDelDia = onSchedule(
  {
    schedule: CRON_EVENTOS_DEL_DIA,
    timeZone: "America/Argentina/Mendoza",
    region: REGION_SCHEDULER,
  },
  async () => {
    const hoyStr = fechaHoyMendoza();

    // "publicado" no se consulta en Firestore: los eventos nuevos no traen ese
    // campo y un where("publicado", "==", false) los dejaría afuera.
    // Tampoco se filtra por "destacado": los destacados también salen el día
    // del evento.
    const snapshot = await db
      .collection("eventos")
      .where("estado", "==", "aprobado")
      .where("fecha", "==", hoyStr)
      .get();

    const pendientes = snapshot.docs.filter((d) => d.data().publicado !== true);

    if (pendientes.length === 0) {
      console.log(`No hay eventos pendientes para hoy (${hoyStr}).`);
      return;
    }

    console.log(`Enviando ${pendientes.length} evento(s) del día ${hoyStr}.`);
    for (const doc of pendientes) {
      const { ok } = await enviarAMake(WEBHOOK_MAKE, doc.id, doc.data(), {
        momento: "dia_del_evento",
      });
      // Solo se marca como publicado si Make respondió bien; si falló, se
      // reintenta en la próxima ejecución.
      if (ok) {
        await doc.ref.update({ publicado: true });
      }
    }
  },
);

// 3. INSTAGRAM: lo dispara el admin con el botón del panel, evento por evento.
exports.publicarEnInstagram = onCall(
  { region: REGION_FIRESTORE },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Iniciá sesión para continuar.");
    }
    const email = String(request.auth.token.email || "")
      .toLowerCase()
      .trim();
    if (!ADMIN_EMAILS.includes(email)) {
      throw new HttpsError(
        "permission-denied",
        "Solo los administradores pueden publicar en Instagram.",
      );
    }

    const eventoId = request.data && request.data.eventoId;
    if (typeof eventoId !== "string" || !eventoId) {
      throw new HttpsError("invalid-argument", "Falta el ID del evento.");
    }
    if (WEBHOOK_MAKE_INSTAGRAM.includes("PEGAR_AQUI")) {
      throw new HttpsError(
        "failed-precondition",
        "Falta configurar el webhook de Instagram en functions/index.js.",
      );
    }

    const ref = db.collection("eventos").doc(eventoId);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new HttpsError("not-found", "El evento no existe.");
    }
    const data = snap.data();
    if (data.estado !== "aprobado") {
      throw new HttpsError(
        "failed-precondition",
        "Solo se pueden publicar en Instagram los eventos aprobados.",
      );
    }
    if (!data.imagenUrl) {
      throw new HttpsError(
        "failed-precondition",
        "El evento no tiene imagen: Instagram la necesita para publicar.",
      );
    }

    const resultado = await enviarAMake(
      WEBHOOK_MAKE_INSTAGRAM,
      eventoId,
      data,
      {
        canal: "instagram",
      },
    );
    if (!resultado.ok) {
      throw new HttpsError(
        "internal",
        `Make no aceptó el envío (${resultado.detalle}). Revisá la URL del webhook y que el escenario de Instagram esté activo.`,
      );
    }

    await ref.update({
      instagramPublicado: true,
      instagramFecha: FieldValue.serverTimestamp(),
      instagramPor: email,
    });
    return { ok: true };
  },
);

/**
 * Explica por qué falló una llamada a Make, en palabras legibles.
 */
function describirErrorMake(error) {
  if (error.response) {
    const cuerpo =
      typeof error.response.data === "string"
        ? error.response.data
        : JSON.stringify(error.response.data || "");
    const texto = String(cuerpo || "")
      .trim()
      .slice(0, 200);
    return `HTTP ${error.response.status}${texto ? `: ${texto}` : ""}`;
  }
  if (error.code === "ECONNABORTED") {
    return "Make tardó más de 20 segundos en responder";
  }
  if (error.code === "ENOTFOUND" || error.code === "EAI_AGAIN") {
    return "no se encontró el servidor de Make: la URL del webhook está mal copiada";
  }
  return error.message;
}

/**
 * Envía un evento a un webhook de Make.
 * @returns {Promise<{ok: boolean, detalle?: string}>}
 */
async function enviarAMake(url, id, data, extra = {}) {
  try {
    const urlGrupo = await obtenerLinkGrupo(data.ubicacion);
    await axios.post(
      url,
      {
        id: id,
        nombre: data.nombre || "",
        descripcion: data.descripcion || "",
        fecha: data.fecha || "",
        hora: data.hora || "",
        lugar: data.lugar || "",
        direccion: data.direccion || "",
        localidad: data.localidad || "",
        ubicacion: data.ubicacion
          ? data.ubicacion.toLowerCase().trim()
          : "mendoza",
        contacto: data.contacto || "",
        precio: data.precio || "",
        linkEntradas: data.linkEntradas || "",
        redes: data.redes || "",
        imagenUrl: data.imagenUrl || "",
        destacado: data.destacado || false,
        plan: data.plan || "",
        linkGrupo: urlGrupo,
        captionWhatsapp: captionWhatsapp(data, urlGrupo),
        captionInstagram: captionInstagram(data),
        ...extra,
      },
      { timeout: 20000 },
    );
    console.log(`Evento ${id} enviado a Make correctamente.`);
    return { ok: true };
  } catch (error) {
    const detalle = describirErrorMake(error);
    console.error(`Error enviando el evento ${id} a Make: ${detalle}`);
    return { ok: false, detalle };
  }
}
