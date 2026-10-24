const functions = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");

admin.initializeApp();
const db = admin.firestore();
const WEBHOOK_MAKE =
  "https://hook.us2.make.com/pvl27nf9jp6kp1268xvnoirxb81hr0yv";

// 1. EVENTOS DESTACADOS (Envío Inmediato)
exports.onEventoAprobado = functions.firestore
  .document("eventos/{eventoId}")
  .onUpdate(async (change, context) => {
    const antes = change.before.data();
    const despues = change.after.data();

    // Si recién se aprueba Y ES DESTACADO
    if (
      antes.estado !== "aprobado" &&
      despues.estado === "aprobado" &&
      despues.destacado === true
    ) {
      await enviarAMake(context.params.eventoId, despues);
    }
  });

// 2. EVENTOS NORMALES (Se ejecutan todos los días a las 8:00 AM Hora Argentina)
exports.publicarEventosDelDia = functions.pubsub
  .schedule("0 8 * * *")
  .timeZone("America/Argentina/Mendoza")
  .onRun(async (context) => {
    const hoyStr = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

    const snapshot = await db
      .collection("eventos")
      .where("estado", "==", "aprobado")
      .where("destacado", "==", false)
      .where("fecha", "==", hoyStr)
      .where("publicado", "==", false)
      .get();

    if (snapshot.empty) return null;

    for (const doc of snapshot.docs) {
      await enviarAMake(doc.id, doc.data());
      await doc.ref.update({ publicado: true }); // Marcamos como publicado
    }
  });

// Función auxiliar para formatear y enviar el POST
async function enviarAMake(id, data) {
  try {
    await axios.post(WEBHOOK_MAKE, {
      id: id,
      nombre: data.nombre,
      descripcion: data.descripcion,
      fecha: data.fecha,
      hora: data.hora,
      lugar: data.lugar,
      direccion: data.direccion,
      localidad: data.localidad,
      ubicacion: data.ubicacion
        ? data.ubicacion.toLowerCase().trim()
        : "mendoza",
      contacto: data.contacto,
      imagenUrl: data.imagenUrl,
      destacado: data.destacado,
    });
  } catch (error) {
    console.error(`Error enviando evento ${id} a Make:`, error);
  }
}
