// Enlaces de WhatsApp configurables desde Firestore (documento config/whatsapp).
// Solo se aceptan URLs de invitación de grupo (chat.whatsapp.com) o wa.me.
import { db } from "./firebase-config.js";
import {
  doc,
  getDoc,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const WA_PATTERN = /^https:\/\/(chat\.whatsapp\.com\/|wa\.me\/)/;

function esUrlValida(url) {
  return typeof url === "string" && WA_PATTERN.test(url.trim());
}

function deshabilitarBoton(btn) {
  if (!btn) return;
  btn.removeAttribute("href");
  btn.setAttribute("aria-disabled", "true");
  const icono = btn.querySelector("i");
  if (icono) icono.remove();
  const titulo = btn.querySelector(".wa-titulo");
  const desc = btn.querySelector(".wa-desc");
  if (titulo) titulo.textContent = "Próximamente";
  if (desc) desc.textContent = "";
}

/**
 * Lee config/whatsapp de Firestore y asigna los href a los botones de la landing.
 * Si no hay documento, falla la lectura o el link es inválido, deja el botón
 * deshabilitado (sin href, aria-disabled) con el texto "Próximamente".
 */
export async function cargarLinksWhatsApp() {
  const btnSanRafael = document.getElementById("wa-sanrafael");
  const btnMendoza = document.getElementById("wa-mendoza");
  if (!btnSanRafael && !btnMendoza) return;

  try {
    const snap = await getDoc(doc(db, "config", "whatsapp"));
    const data = snap.exists() ? snap.data() : null;

    const sanrafaelValido = data && esUrlValida(data.sanrafael);
    const mendozaValido = data && esUrlValida(data.mendoza);

    if (!sanrafaelValido) {
      deshabilitarBoton(btnSanRafael);
    } else {
      btnSanRafael.href = data.sanrafael;
      btnSanRafael.removeAttribute("aria-disabled");
    }

    if (!mendozaValido) {
      deshabilitarBoton(btnMendoza);
    } else {
      btnMendoza.href = data.mendoza;
      btnMendoza.removeAttribute("aria-disabled");
    }
  } catch (err) {
    console.error("[whatsapp] Error al cargar links de WhatsApp:", err);
    if (btnSanRafael) deshabilitarBoton(btnSanRafael);
    if (btnMendoza) deshabilitarBoton(btnMendoza);
  }
}

cargarLinksWhatsApp();
