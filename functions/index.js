const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const axios = require("axios");

admin.initializeApp();
const db = admin.firestore();

// Pega aquí la URL de tu Webhook de Make
const WEBHOOK_MAKE = "https://hook.us1.make.com/TU_WEBHOOK_AQUI";

// 1. EVENTOS DESTACADOS
exports.onEventoAprobado = functions
  .region("us-central1")
  .firestore.document("eventos/{eventoId}")
  .onUpdate(async (change, context) => {
    const antes = change.before.data();
    const despues = change.after.data();

    if (
      antes.estado !== "aprobado" &&
      despues.estado === "aprobado" &&
      despues.destacado === true
    ) {
      await enviarAMake(context.params.eventoId, despues);
    }
  });

// 2. EVENTOS NORMALES
exports.publicarEventosDelDia = functions
  .region("us-central1")
  .pubsub.schedule("0 8 * * *")
  .timeZone("America/Argentina/Mendoza")
  .onRun(async (context) => {
    const hoyStr = new Date().toISOString().split("T")[0];

    const snapshot = await db
      .collection("eventos")
      .where("estado", "==", "aprobado")
      .where("destacado", "==", false)
      .where("fecha", "==", hoyStr)
      .where("publicado", "==", false)
      .get();

    if (snapshot.empty) {
      console.log("No hay eventos normales pendientes para hoy.");
      return null;
    }

    for (const doc of snapshot.docs) {
      await enviarAMake(doc.id, doc.data());
      await doc.ref.update({ publicado: true });
    }
  });

async function enviarAMake(id, data) {
  try {
    await axios.post(WEBHOOK_MAKE, {
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
      imagenUrl: data.imagenUrl || "",
      destacado: data.destacado || false,
    });
    console.log(`Evento ${id} enviado a Make correctamente.`);
  } catch (error) {
    console.error(`Error enviando el evento ${id} a Make:`, error);
  }
}
