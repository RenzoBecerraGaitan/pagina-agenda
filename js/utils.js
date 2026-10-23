/**
 * Funciones puras compartidas entre módulos (eventos.js y admin.js).
 * Se separaron en su propio archivo para evitar efectos secundarios al
 * importar eventos.js desde admin.js (eventos.js registra listeners de DOM
 * propios de la página pública).
 */

/**
 * Normaliza un teléfono de contacto argentino a formato 549 + 10 dígitos.
 * Devuelve el número limpio o null si no es un móvil válido.
 * @param {string|null|undefined} contacto
 * @returns {string|null}
 */
export function normalizarTelefonoAR(contacto) {
  if (!contacto) return null;
  let digitos = String(contacto).replace(/\D/g, "");
  if (digitos.startsWith("00")) {
    digitos = digitos.slice(2);
  }
  if (digitos.startsWith("549") && digitos.length === 13) {
    return digitos;
  }
  if (digitos.startsWith("54") && digitos.length === 12) {
    return "549" + digitos.slice(2);
  }
  if (!digitos.startsWith("54")) {
    if (digitos.startsWith("0")) {
      digitos = digitos.slice(1);
    }
    if (digitos.length === 10) {
      return "549" + digitos;
    }
  }
  if (/^549\d{10}$/.test(digitos)) {
    return digitos;
  }
  return null;
}

/**
 * Escapa HTML para prevenir XSS al insertar texto de usuario con innerHTML.
 * @param {string|null|undefined} texto
 * @returns {string}
 */
export function escapeHtml(texto) {
  if (texto === null || texto === undefined) return "";
  return String(texto)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
