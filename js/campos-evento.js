// Campos de precio del formulario de eventos (carga pública y edición del admin).
import { parsearMonto, MAX_DETALLE_PRECIO, construirPrecio } from "./utils.js?v=202610280003";

function tipoElegido(el) {
  const marcado = el.tipos.find((r) => r.checked);
  return marcado ? marcado.value : "";
}

/**
 * Opciones de precio como botones visibles (radios): fijo, desde, gratuita y
 * otro. Muestra el campo que corresponde a cada una y formatea el monto
 * mientras se escribe ("5000" -> "5.000").
 * @param {{tipos: HTMLInputElement[], grupoValor: HTMLElement, valor: HTMLInputElement,
 *          etiquetaValor?: HTMLElement, grupoDetalle: HTMLElement, detalle: HTMLInputElement}} el
 */
export function configurarCamposPrecio(el) {
  function actualizar() {
    const t = tipoElegido(el);
    const pideValor = t === "fijo" || t === "desde";
    const pideDetalle = t === "otro";
    el.grupoValor.hidden = !pideValor;
    el.valor.required = pideValor;
    el.grupoDetalle.hidden = !pideDetalle;
    el.detalle.required = pideDetalle;
    if (el.etiquetaValor) {
      el.etiquetaValor.textContent =
        t === "desde"
          ? "¿Desde cuánto? (el precio más bajo)"
          : "¿Cuánto cuesta la entrada?";
    }
  }
  el.tipos.forEach((r) => r.addEventListener("change", actualizar));
  el.valor.addEventListener("input", () => {
    const digitos = el.valor.value.replace(/\D/g, "").slice(0, 8);
    el.valor.value = digitos ? Number(digitos).toLocaleString("es-AR") : "";
  });
  el.detalle.setAttribute("maxlength", String(MAX_DETALLE_PRECIO));
  actualizar();
  return { actualizar };
}

/**
 * Lee y valida los campos de precio.
 * @returns {{ok: boolean, error?: string, precioTipo?: string,
 *            precioValor?: number|null, precioDetalle?: string, precio?: string}}
 */
export function leerPrecio(el) {
  const precioTipo = tipoElegido(el);
  if (!precioTipo) {
    return { ok: false, error: "Elegí el precio de la entrada (puede ser gratuita)." };
  }
  let precioValor = null;
  let precioDetalle = "";
  if (precioTipo === "fijo" || precioTipo === "desde") {
    precioValor = parsearMonto(el.valor.value);
    if (!precioValor) {
      return { ok: false, error: "Ingresá el valor en pesos. Ejemplo: 5.000" };
    }
  } else if (precioTipo === "otro") {
    precioDetalle = el.detalle.value.trim().slice(0, MAX_DETALLE_PRECIO);
    if (!precioDetalle) {
      return {
        ok: false,
        error: "Escribí qué precio tiene. Ejemplo: alimento no perecedero, a la gorra.",
      };
    }
  }
  return {
    ok: true,
    precioTipo,
    precioValor,
    precioDetalle,
    precio: construirPrecio({ tipo: precioTipo, valor: precioValor, detalle: precioDetalle }),
  };
}

/** Carga valores existentes en los campos de precio (edición). */
export function fijarPrecio(el, ev, controlador) {
  let tipo = ev.precioTipo || "";
  let detalle = ev.precioDetalle || "";
  if (tipo === "colaboracion") {
    // Tipo anterior: se edita como "Otro" conservando el texto.
    tipo = "otro";
    detalle = detalle ? `A colaboración: ${detalle}` : "A colaboración";
  }
  el.tipos.forEach((r) => {
    r.checked = r.value === tipo;
  });
  el.valor.value = ev.precioValor ? Number(ev.precioValor).toLocaleString("es-AR") : "";
  el.detalle.value = detalle;
  if (controlador && controlador.actualizar) controlador.actualizar();
}

/** Desmarca las opciones de precio (al reiniciar el formulario). */
export function limpiarPrecio(el, controlador) {
  el.tipos.forEach((r) => {
    r.checked = false;
  });
  if (controlador && controlador.actualizar) controlador.actualizar();
}
