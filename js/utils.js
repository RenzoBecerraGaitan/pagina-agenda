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

/* ==========================================================================
   Precio, datos de contacto/entradas y paginación (compartidos por la página
   pública, el formulario de carga y el panel de administración)
   ========================================================================== */

export const PRECIO_TIPOS = {
  fijo: "Precio fijo",
  desde: "Varios precios (desde...)",
  gratuito: "Entrada gratuita",
  colaboracion: "A colaboración",
};

export const MAX_MONTO = 99999999;
export const MAX_DETALLE_PRECIO = 80;

/**
 * Convierte un texto como "$5.000", "5000" o "5.000,50" en un entero de pesos.
 * Los decimales (1 o 2 dígitos tras la última coma/punto) se descartan.
 * @param {string|number|null|undefined} texto
 * @returns {number|null} entero positivo o null si no es válido
 */
export function parsearMonto(texto) {
  if (texto === null || texto === undefined) return null;
  let t = String(texto).trim().replace(/^\$\s*/, "");
  t = t.replace(/[,.]\d{1,2}$/, "");
  const digitos = t.replace(/\D/g, "");
  if (!digitos) return null;
  const n = parseInt(digitos, 10);
  if (!Number.isFinite(n) || n <= 0 || n > MAX_MONTO) return null;
  return n;
}

/** Formatea un monto en pesos argentinos: 5000 -> "$5.000". */
export function formatearMonto(n) {
  return `$${Number(n).toLocaleString("es-AR")}`;
}

/**
 * Arma el texto de precio que se muestra en la web y se envía a Make.
 * @param {{tipo?: string, valor?: number|null, detalle?: string}} p
 * @returns {string}
 */
export function construirPrecio({ tipo, valor, detalle } = {}) {
  switch (tipo) {
    case "fijo":
      return valor ? formatearMonto(valor) : "";
    case "desde":
      return valor ? `Desde ${formatearMonto(valor)}` : "";
    case "gratuito":
      return "Entrada gratuita";
    case "colaboracion": {
      const d = String(detalle || "").trim();
      return d ? `A colaboración: ${d}` : "A colaboración";
    }
    default:
      return "";
  }
}

/** Texto de precio de un evento (soporta eventos viejos sin los campos nuevos). */
export function formatearPrecioEvento(ev) {
  if (!ev) return "";
  if (ev.precioTipo) {
    return construirPrecio({
      tipo: ev.precioTipo,
      valor: ev.precioValor,
      detalle: ev.precioDetalle,
    });
  }
  return typeof ev.precio === "string" ? ev.precio : "";
}

/**
 * Normaliza uno o varios usuarios de Instagram ("@usuario", "usuario" o
 * "instagram.com/usuario"), separados por espacios o comas. Máximo 3.
 * @param {string} texto
 * @returns {{ok: boolean, valor?: string, error?: string}}
 */
export function normalizarRedes(texto) {
  const crudo = String(texto || "").trim();
  if (!crudo) return { ok: true, valor: "" };
  const partes = crudo.split(/[\s,;]+/).filter(Boolean);
  const usuarios = [];
  for (let p of partes) {
    p = p
      .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
      .replace(/^(www\.)?instagram\.com\//i, "")
      .replace(/[/?#].*$/, "")
      .replace(/^@+/, "");
    if (!/^[A-Za-z0-9._]{1,30}$/.test(p)) {
      return {
        ok: false,
        error:
          "El Instagram no es válido. Escribilo como @usuario (solo letras, números, puntos y guiones bajos).",
      };
    }
    const usuario = "@" + p.toLowerCase();
    if (!usuarios.includes(usuario)) usuarios.push(usuario);
  }
  if (usuarios.length > 3) {
    return { ok: false, error: "Podés mencionar hasta 3 usuarios de Instagram." };
  }
  return { ok: true, valor: usuarios.join(" ") };
}

/**
 * Normaliza el link de compra de entradas. Agrega https:// si falta y rechaza
 * esquemas peligrosos (javascript:, data:, etc.).
 * @param {string} texto
 * @returns {{ok: boolean, valor?: string, error?: string}}
 */
export function normalizarLinkEntradas(texto) {
  const crudo = String(texto || "").trim();
  if (!crudo) return { ok: true, valor: "" };
  const error = {
    ok: false,
    error: "El link de entradas no es válido. Ejemplo: https://www.tusentradas.com/evento",
  };
  if (crudo.length > 500 || /\s/.test(crudo)) return error;
  if (/^(javascript|data|vbscript|file|blob):/i.test(crudo)) return error;
  const conEsquema = /^https?:\/\//i.test(crudo) ? crudo : `https://${crudo}`;
  try {
    const url = new URL(conEsquema);
    if (!/^https?:$/.test(url.protocol) || !url.hostname.includes(".")) {
      return error;
    }
    return { ok: true, valor: url.href };
  } catch (_) {
    return error;
  }
}

/**
 * Valida y normaliza los tres datos para conseguir la entrada. Alcanza con que
 * haya al menos uno (teléfono, link de compra o Instagram).
 * @returns {{ok: boolean, error?: string, contacto?: string, linkEntradas?: string, redes?: string}}
 */
export function validarEntradas({ contacto, linkEntradas, redes } = {}) {
  const tel = String(contacto || "").trim();
  if (tel && tel.replace(/\D/g, "").length < 6) {
    return { ok: false, error: "El teléfono no parece válido. Revisalo o dejalo vacío." };
  }
  const link = normalizarLinkEntradas(linkEntradas);
  if (!link.ok) return link;
  const ig = normalizarRedes(redes);
  if (!ig.ok) return ig;
  if (!tel && !link.valor && !ig.valor) {
    return {
      ok: false,
      error:
        "Completá al menos uno: teléfono, link para comprar entradas o Instagram. Es donde la gente consigue su entrada.",
    };
  }
  return { ok: true, contacto: tel, linkEntradas: link.valor, redes: ig.valor };
}

/** Devuelve la URL solo si es http(s); si no, cadena vacía. */
export function urlSegura(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url.trim())
    ? url.trim()
    : "";
}

export const POR_PAGINA = 15;

/**
 * Recorta una lista a la página pedida (corrige la página si queda fuera de rango).
 * @returns {{items: any[], pagina: number, paginas: number}}
 */
export function paginar(lista, pagina, porPagina = POR_PAGINA) {
  const paginas = Math.max(1, Math.ceil(lista.length / porPagina));
  const actual = Math.min(Math.max(1, Number(pagina) || 1), paginas);
  const inicio = (actual - 1) * porPagina;
  return { items: lista.slice(inicio, inicio + porPagina), pagina: actual, paginas };
}

/**
 * Dibuja los controles de paginación dentro de `contenedor`.
 * En pantallas chicas muestra "Página X de Y"; desde 520px, los números.
 */
export function renderPaginacion(contenedor, { total, pagina, porPagina = POR_PAGINA, onCambiar }) {
  if (!contenedor) return;
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  if (paginas <= 1) {
    contenedor.innerHTML = "";
    contenedor.hidden = true;
    contenedor.onclick = null;
    return;
  }
  contenedor.hidden = false;

  const visibles = [];
  for (let p = 1; p <= paginas; p++) {
    if (p === 1 || p === paginas || Math.abs(p - pagina) <= 1) visibles.push(p);
  }
  let numeros = "";
  let anterior = 0;
  for (const p of visibles) {
    if (p - anterior > 1) numeros += `<span class="pag-puntos" aria-hidden="true">…</span>`;
    numeros += `<button type="button" class="pag-btn pag-num${p === pagina ? " actual" : ""}" data-p="${p}" ${p === pagina ? 'aria-current="page"' : ""} aria-label="Página ${p}">${p}</button>`;
    anterior = p;
  }

  contenedor.innerHTML = `
    <nav class="paginacion" aria-label="Paginación">
      <button type="button" class="pag-btn" data-p="${pagina - 1}" ${pagina <= 1 ? "disabled" : ""} aria-label="Página anterior"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i></button>
      <span class="pag-info">Página ${pagina} de ${paginas}</span>
      ${numeros}
      <button type="button" class="pag-btn" data-p="${pagina + 1}" ${pagina >= paginas ? "disabled" : ""} aria-label="Página siguiente"><i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>
    </nav>
  `;
  contenedor.onclick = (e) => {
    const btn = e.target.closest("[data-p]");
    if (!btn || btn.disabled) return;
    const destino = Number(btn.dataset.p);
    if (destino >= 1 && destino <= paginas && destino !== pagina) onCambiar(destino);
  };
}
