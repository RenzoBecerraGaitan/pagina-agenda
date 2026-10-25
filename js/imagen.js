// Procesado de imágenes de eventos: siempre 4:5 (1080 x 1350 px), JPEG calidad 0.9.
// 4:5 es la proporción vertical más alta que acepta el feed de Instagram y se
// ve bien en los grupos de WhatsApp.

export const IMG_ANCHO = 1080;
export const IMG_ALTO = 1350;
export const IMG_CALIDAD = 0.9;
const MAX_BYTES_SUBIDA = 1.9 * 1024 * 1024; // margen bajo el límite de 2 MB de Storage

const MSG_ERROR =
  "No se pudo procesar la imagen. Probá con otra en formato JPG o PNG.";

async function abrirImagen(archivo) {
  try {
    return await createImageBitmap(archivo, { imageOrientation: "from-image" });
  } catch (_) {
    try {
      return await createImageBitmap(archivo);
    } catch (e) {
      console.error("[imagen] createImageBitmap falló:", e);
      throw new Error(MSG_ERROR);
    }
  }
}

// Dibuja `bmp` llenando todo el cuadro (recorta lo que sobra, centrado).
function dibujarCubriendo(ctx, bmp, w, h) {
  const escala = Math.max(w / bmp.width, h / bmp.height);
  const srcW = w / escala;
  const srcH = h / escala;
  const sx = (bmp.width - srcW) / 2;
  const sy = (bmp.height - srcH) / 2;
  ctx.drawImage(bmp, sx, sy, srcW, srcH, 0, 0, w, h);
}

/**
 * Sugiere cómo encuadrar según la proporción original: fotos casi verticales o
 * cuadradas se recortan; las muy apaisadas se muestran completas para no
 * cortar el texto del flyer.
 */
export function modoSugerido(ancho, alto) {
  const ratio = ancho / alto;
  return ratio >= 0.6 && ratio <= 1.0 ? "recortar" : "completa";
}

export async function leerDimensiones(archivo) {
  const bmp = await abrirImagen(archivo);
  const dim = { ancho: bmp.width, alto: bmp.height };
  bmp.close();
  return dim;
}

/**
 * Convierte la imagen a 4:5, 1080 x 1350 px, JPEG con calidad 0.9.
 * @param {File|Blob} archivo
 * @param {"recortar"|"completa"} modo
 *   - "recortar": llena el cuadro y corta lo que sobra (centrado).
 *   - "completa": muestra la imagen entera sobre un fondo difuso.
 * @returns {Promise<Blob>} Blob image/jpeg
 */
export async function procesarImagen4x5(archivo, modo = "recortar") {
  const bmp = await abrirImagen(archivo);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = IMG_ANCHO;
    canvas.height = IMG_ALTO;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    // JPEG no tiene transparencia: fondo blanco por si la imagen es PNG.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, IMG_ANCHO, IMG_ALTO);

    if (modo === "completa") {
      // Fondo difuso: se dibuja en miniatura y se estira (sin usar ctx.filter,
      // que Safari no soporta de forma confiable).
      const mini = document.createElement("canvas");
      mini.width = 24;
      mini.height = 30;
      const mctx = mini.getContext("2d");
      mctx.imageSmoothingQuality = "high";
      dibujarCubriendo(mctx, bmp, 24, 30);
      ctx.drawImage(mini, 0, 0, IMG_ANCHO, IMG_ALTO);
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fillRect(0, 0, IMG_ANCHO, IMG_ALTO);

      const escala = Math.min(IMG_ANCHO / bmp.width, IMG_ALTO / bmp.height);
      const dw = Math.round(bmp.width * escala);
      const dh = Math.round(bmp.height * escala);
      ctx.drawImage(bmp, Math.round((IMG_ANCHO - dw) / 2), Math.round((IMG_ALTO - dh) / 2), dw, dh);
    } else {
      dibujarCubriendo(ctx, bmp, IMG_ANCHO, IMG_ALTO);
    }

    const aBlob = (calidad) =>
      new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", calidad));

    // Calidad 0.9. Solo si el archivo se acerca al límite de 2 MB de las reglas
    // de Storage se baja la calidad (0.8 y luego 0.7) para que la subida no falle.
    let blob = await aBlob(IMG_CALIDAD);
    for (const calidad of [0.8, 0.7]) {
      if (blob && blob.size < MAX_BYTES_SUBIDA) break;
      blob = await aBlob(calidad);
    }
    if (!blob) throw new Error(MSG_ERROR);
    if (blob.size >= 2 * 1024 * 1024) {
      throw new Error(
        "La imagen es demasiado pesada incluso comprimida. Probá con otra más simple.",
      );
    }
    return blob;
  } catch (e) {
    console.error("[imagen] error al procesar:", e);
    throw e instanceof Error && e.message.startsWith("La imagen") ? e : e instanceof Error && e.message === MSG_ERROR ? e : new Error(MSG_ERROR);
  } finally {
    bmp.close();
  }
}

/**
 * Conecta un <input type="file"> con una vista previa 4:5 y el selector de
 * encuadre (radios "recortar" / "completa").
 * @returns {{getArchivo, getModo, getBlob, reset}}
 */
export function crearControladorImagen({ input, caja, img, radios, estado }) {
  let archivo = null;
  let modo = "recortar";
  let blob = null;
  let urlPrevia = null;
  let token = 0;

  function mostrarEstado(texto, esError = false) {
    if (!estado) return;
    estado.textContent = texto;
    estado.classList.toggle("error", esError);
  }

  function limpiarPrevia() {
    if (urlPrevia) URL.revokeObjectURL(urlPrevia);
    urlPrevia = null;
    if (img) img.removeAttribute("src");
  }

  function sincronizarRadios() {
    (radios || []).forEach((r) => {
      r.checked = r.value === modo;
    });
  }

  async function regenerar() {
    const mio = ++token;
    blob = null;
    if (!archivo) {
      limpiarPrevia();
      if (caja) caja.hidden = true;
      return;
    }
    if (caja) caja.hidden = false;
    mostrarEstado("Procesando imagen...");
    try {
      const resultado = await procesarImagen4x5(archivo, modo);
      if (mio !== token) return;
      blob = resultado;
      limpiarPrevia();
      urlPrevia = URL.createObjectURL(resultado);
      if (img) img.src = urlPrevia;
      mostrarEstado(
        `Así se publicará: formato 4:5 (${IMG_ANCHO}×${IMG_ALTO} px), JPEG, ${Math.round(resultado.size / 1024)} KB.`,
      );
    } catch (e) {
      if (mio !== token) return;
      limpiarPrevia();
      mostrarEstado(e.message, true);
      archivo = null;
      if (input) input.value = "";
    }
  }

  input.addEventListener("change", async () => {
    archivo = input.files && input.files[0] ? input.files[0] : null;
    blob = null;
    if (archivo) {
      try {
        const { ancho, alto } = await leerDimensiones(archivo);
        modo = modoSugerido(ancho, alto);
      } catch (_) {
        modo = "recortar";
      }
      sincronizarRadios();
    }
    regenerar();
  });

  (radios || []).forEach((r) =>
    r.addEventListener("change", () => {
      if (r.checked) {
        modo = r.value;
        regenerar();
      }
    }),
  );

  return {
    getArchivo: () => archivo,
    getModo: () => modo,
    async getBlob() {
      if (blob) return blob;
      if (!archivo) return null;
      blob = await procesarImagen4x5(archivo, modo);
      return blob;
    },
    reset() {
      archivo = null;
      blob = null;
      modo = "recortar";
      token++;
      limpiarPrevia();
      sincronizarRadios();
      if (caja) caja.hidden = true;
      if (input) input.value = "";
    },
  };
}
