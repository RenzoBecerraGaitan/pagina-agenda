// Textos de publicación (WhatsApp e Instagram) armados a partir de un evento.
// Las líneas opcionales (precio, contacto, entradas, Instagram) solo aparecen
// si el evento tiene ese dato, así no quedan líneas vacías.

const HASHTAGS = {
  mendoza: "#agendacultural #mendoza",
  sanrafael: "#agendacultural #sanrafael #malargue #generalalvear",
};

/** "2026-10-31" -> "31/10/2026" */
function fechaCorta(fecha) {
  const partes = String(fecha || "").split("-");
  return partes.length === 3 ? partes.reverse().join("/") : String(fecha || "");
}

function texto(valor) {
  return String(valor || "").trim();
}

/** "Lugar - Dirección, Localidad" (omite lo que falte). */
function dondeEs(d) {
  const sitio = [texto(d.lugar), texto(d.direccion)]
    .filter(Boolean)
    .join(" - ");
  return [sitio, texto(d.localidad)].filter(Boolean).join(", ");
}

/**
 * Texto del evento para el grupo de WhatsApp (admite *negrita*). Si se pasa
 * el link del grupo de esa zona, se agrega al final como invitación.
 */
function captionWhatsapp(d, linkGrupo) {
  const lineas = [`📅 *${texto(d.nombre)}*`];
  if (texto(d.descripcion)) lineas.push("", texto(d.descripcion));
  lineas.push("");
  if (texto(d.fecha)) lineas.push(`🗓 Fecha: ${fechaCorta(d.fecha)}`);
  if (texto(d.hora)) lineas.push(`🕐 Hora: ${texto(d.hora)} hs`);
  if (dondeEs(d)) lineas.push(`📍 ${dondeEs(d)}`);
  if (texto(d.precio)) {
    // "Entrada gratuita" ya dice "Entrada": no se repite la etiqueta.
    const yaDiceEntrada = /^entrada/i.test(texto(d.precio));
    lineas.push(`💲 ${yaDiceEntrada ? "" : "Entrada: "}${texto(d.precio)}`);
  }
  if (texto(d.contacto)) lineas.push(`📞 Contacto: ${texto(d.contacto)}`);
  if (texto(d.linkEntradas))
    lineas.push(`🎟 Entradas: ${texto(d.linkEntradas)}`);
  if (texto(d.redes)) lineas.push(`📸 Instagram: ${texto(d.redes)}`);
  if (texto(linkGrupo)) {
    lineas.push(
      "",
      " -------------------------------------------------------",
      "🎸LINK PARA INGRESAR AL GRUPO DE AGENDA WHATSAPP",
      "",
      texto(linkGrupo),
    );
  }
  return lineas.join("\n");
}

/** Texto del evento para el feed de Instagram (sin negrita; menciona a las redes). */
function captionInstagram(d) {
  const lineas = [`📅 ${texto(d.nombre)}`];
  if (texto(d.descripcion)) lineas.push("", texto(d.descripcion));
  lineas.push("");
  const cuando = [
    texto(d.fecha) ? `🗓 ${fechaCorta(d.fecha)}` : "",
    texto(d.hora) ? `🕐 ${texto(d.hora)} hs` : "",
  ].filter(Boolean);
  if (cuando.length) lineas.push(cuando.join(" · "));
  if (dondeEs(d)) lineas.push(`📍 ${dondeEs(d)}`);
  if (texto(d.precio)) lineas.push(`💲 ${texto(d.precio)}`);
  if (texto(d.contacto)) lineas.push(`📞 Contacto: ${texto(d.contacto)}`);
  if (texto(d.linkEntradas))
    lineas.push(`🎟 Entradas: ${texto(d.linkEntradas)}`);
  if (texto(d.redes)) lineas.push(`📸 Con: ${texto(d.redes)}`);
  const zona = texto(d.ubicacion).toLowerCase();
  lineas.push("", HASHTAGS[zona] || HASHTAGS.mendoza);
  return lineas.join("\n");
}

module.exports = { captionWhatsapp, captionInstagram, fechaCorta };
