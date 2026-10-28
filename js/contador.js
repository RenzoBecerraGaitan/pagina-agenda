// Contador animado de miembros de la comunidad (portada).
//
// Cómo funciona:
//  1. El número final viene en el HTML (data-target), así que la animación
//     arranca al instante, sin esperar a ninguna petición de red.
//  2. Recién cuando la página terminó de cargar y el navegador está libre, se
//     lee Firestore (config/community -> memberCount) en segundo plano. Si el
//     valor es distinto al del HTML, el contador se actualiza con suavidad.
//
// Este archivo NO importa Firebase de forma estática: Firebase se carga con
// import() dinámico después, para no retrasar el render (LCP).

const COLECCION = "config";
const DOCUMENTO = "community";
const DURACION_INICIAL = 1900; // ms
const DURACION_ACTUALIZACION = 900; // ms

const contador = document.getElementById("member-counter");
const textoLector = document.getElementById("member-counter-sr");
const formato = new Intl.NumberFormat("es-AR"); // 10000 -> "10.000"
const sinMovimiento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let objetivo = 0; // valor final vigente
let valorActual = 0; // valor mostrado en este momento
let frame = 0;

const suavizado = (t) => 1 - Math.pow(1 - t, 3); // easeOutCubic

function mostrar(valor) {
  valorActual = valor;
  contador.textContent = formato.format(valor);
}

// Los lectores de pantalla leen el valor final, no cada paso de la animación.
function actualizarTextoAccesible() {
  if (textoLector) {
    textoLector.textContent = `¡Ya somos una comunidad de ${formato.format(objetivo)} personas!`;
  }
}

/** Anima desde el valor mostrado hasta `hasta`. */
function animar(hasta, duracion) {
  cancelAnimationFrame(frame);
  const desde = valorActual;
  objetivo = hasta;
  if (sinMovimiento || desde === hasta) {
    mostrar(hasta);
    actualizarTextoAccesible();
    return;
  }
  const inicio = performance.now();
  const paso = (ahora) => {
    const t = Math.min((ahora - inicio) / duracion, 1);
    mostrar(Math.round(desde + (hasta - desde) * suavizado(t)));
    if (t < 1) {
      frame = requestAnimationFrame(paso);
    } else {
      actualizarTextoAccesible();
    }
  };
  frame = requestAnimationFrame(paso);
}

/** Lee Firestore sin bloquear nada y actualiza si el valor cambió. */
async function sincronizarConFirestore() {
  try {
    const [{ db }, { doc, getDoc }] = await Promise.all([
      import("./firebase-config.js?v=202610280010"),
      import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js"),
    ]);
    const snap = await getDoc(doc(db, COLECCION, DOCUMENTO));
    if (!snap.exists()) return;
    const nuevo = Number(snap.data().memberCount);
    if (!Number.isInteger(nuevo) || nuevo < 0 || nuevo === objetivo) return;
    contador.dataset.target = String(nuevo);
    animar(nuevo, DURACION_ACTUALIZACION);
  } catch (err) {
    // Sin conexión o sin permisos: se conserva el número del HTML.
    console.warn("[contador] No se pudo leer el contador de Firestore:", err);
  }
}

function programarSincronizacion() {
  const iniciar = () =>
    "requestIdleCallback" in window
      ? requestIdleCallback(sincronizarConFirestore, { timeout: 3000 })
      : setTimeout(sincronizarConFirestore, 200);
  if (document.readyState === "complete") iniciar();
  else window.addEventListener("load", iniciar, { once: true });
}

if (contador) {
  const inicial = Number.parseInt(contador.dataset.target, 10);
  if (Number.isInteger(inicial) && inicial >= 0) {
    objetivo = inicial;
    mostrar(0);
    animar(inicial, DURACION_INICIAL);
  }
  programarSincronizacion();
}
