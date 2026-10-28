// Links de los grupos de WhatsApp: se leen de Firestore (config/whatsapp,
// campos "sanrafael" y "mendoza"), que es lo que se edita desde el panel de
// administración. Se guardan en memoria 200 segundos para no leer la base una
// vez por cada evento cuando salen varios juntos.

const DURACION_CACHE_MS = 200 * 1000;

function crearObtenerLinkGrupo(db) {
  let cache = { datos: null, hasta: 0 };

  return async function obtenerLinkGrupo(ubicacion) {
    try {
      if (!cache.datos || Date.now() > cache.hasta) {
        const snap = await db.collection("config").doc("whatsapp").get();
        cache = {
          datos: snap.exists ? snap.data() : {},
          hasta: Date.now() + DURACION_CACHE_MS,
        };
      }
      const zona = String(ubicacion || "mendoza")
        .toLowerCase()
        .trim();
      const link = String(cache.datos[zona] || "").trim();
      return /^https?:\/\//i.test(link) ? link : "";
    } catch (error) {
      // Si falla la lectura, el evento se envía igual, sin el link del grupo.
      console.error("No se pudo leer config/whatsapp:", error.message);
      return "";
    }
  };
}

module.exports = { crearObtenerLinkGrupo };
