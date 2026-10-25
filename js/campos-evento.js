// Campos de precio del formulario de eventos (carga pública y edición del admin).
import { parsearMonto, MAX_DETALLE_PRECIO, construirPrecio } from "./utils.js";

/**
 * Muestra/oculta el valor y el detalle según el tipo de precio elegido y
 * formatea el monto mientras se escribe ("5000" -> "5.000").
 * @param {{tipo: HTMLSelectElement, grupoValor: HTMLElement, valor: HTMLInputElement,
 *          etiquetaValor?: HTMLElement, grupoDetalle: HTMLElement, detalle: HTMLInputElement}} el
 */
export function configurarCamposPrecio(el) {
  function actualizar() {
    const t = el.tipo.value;
    const pideValor = t === "fijo" || t === "desde";
    el.grupoValor.hidden = !pideValor;
    el.valor.required = pideValor;
    el.grupoDetalle.hidden = t !== "colaboracion";
    if (el.etiquetaValor) {
      el.etiquetaValor.textContent =
        t === "desde"
          ? "Precio más bajo (desde cuánto)"
          : "Valor de la entrada";
    }
  }
  el.tipo.addEventListener("change", actualizar);
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
  const precioTipo = el.tipo.value;
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
  } else if (precioTipo === "colaboracion") {
    precioDetalle = el.detalle.value.trim().slice(0, MAX_DETALLE_PRECIO);
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
  el.tipo.value = ev.precioTipo || "";
  el.valor.value = ev.precioValor ? Number(ev.precioValor).toLocaleString("es-AR") : "";
  el.detalle.value = ev.precioDetalle || "";
  if (controlador && controlador.actualizar) controlador.actualizar();
}
