const functions = require("firebase-functions/v1"); // para el scheduler
const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");
const axios = require("axios");

admin.initializeApp();
const db = admin.firestore();

// Pega la URL de tu Webhook de Make
const WEBHOOK_MAKE =
  "https://hook.us2.make.com/pvl27nf9jp6kp1268xvnoirxb81hr0yv";

// 1. EVENTOS DESTACADOS
exports.onEventoAprobado = onDocumentUpdated(
  {
    document: "eventos/{eventoId}",
    region: "southamerica-west1",
  },
  async (event) => {
    const antes = event.data.before.data();
    const despues = event.data.after.data();

    if (
      antes.estado !== "aprobado" &&
      despues.estado === "aprobado" &&
      despues.destacado === true
    ) {
      await enviarAMake(event.params.eventoId, despues);
    }
  },
);

// 2. EVENTOS NORMALES (Se envían a las 8 AM)
exports.publicarEventosDelDia = functions
  .region("us-central1") // El scheduler de PubSub puede quedarse en us-central1
  .pubsub.schedule("0 8 * * *")
  .timeZone("America/Argentina/Mendoza")
  .onRun(async (context) => {
    // Fecha de hoy en Mendoza (AAAA-MM-DD). toISOString() usaría UTC.
    const hoyStr = new Date().toLocaleDateString("en-CA", {
      timeZone: "America/Argentina/Mendoza",
    });

    // "publicado" no se consulta en Firestore: los eventos nuevos no traen ese
    // campo y un where("publicado", "==", false) los dejaría afuera.
    const snapshot = await db
      .collection("eventos")
      .where("estado", "==", "aprobado")
      .where("destacado", "==", false)
      .where("fecha", "==", hoyStr)
      .get();

    const pendientes = snapshot.docs.filter((d) => d.data().publicado !== true);

    if (pendientes.length === 0) {
      console.log("No hay eventos normales pendientes para hoy.");
      return null;
    }

    for (const doc of pendientes) {
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
      precio: data.precio || "",
      linkEntradas: data.linkEntradas || "",
      redes: data.redes || "",
      imagenUrl: data.imagenUrl || "",
      destacado: data.destacado || false,
    });
    console.log(`Evento ${id} enviado a Make correctamente.`);
  } catch (error) {
    console.error(`Error enviando el evento ${id} a Make:`, error);
  }
}
