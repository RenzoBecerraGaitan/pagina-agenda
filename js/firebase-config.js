// Integración del SDK Modular de Firebase (v10) mediante CDN
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// Configuración de Firebase (completar con las credenciales de Firebase Console)
export const firebaseConfig = {
  apiKey: "AIzaSyBuiJ4NZRaBFPmNS-0iNFyCIUP47gWs6mY",
  authDomain: "agenda-d6621.firebaseapp.com",
  projectId: "agenda-d6621",
  storageBucket: "agenda-d6621.firebasestorage.app",
  messagingSenderId: "904335370441",
  appId: "1:904335370441:web:510ca7ac610dea305e4518",
};

// Inicializar la aplicación de Firebase
export const app = initializeApp(firebaseConfig);

// Inicializar y exportar servicios de Firebase
export const auth = getAuth(app);
export const db = getFirestore(app);

// Firebase Storage se descarga SOLO cuando hace falta (subir, reemplazar o
// borrar una imagen), no al abrir la página. Las demás páginas no lo necesitan
// para mostrar eventos.
const URL_STORAGE =
  "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";
let storageCargado = null;

export function cargarStorage() {
  if (!storageCargado) {
    storageCargado = import(URL_STORAGE)
      .then((sdk) => ({ ...sdk, storage: sdk.getStorage(app) }))
      .catch((err) => {
        storageCargado = null; // permite reintentar si falló la descarga
        throw err;
      });
  }
  return storageCargado;
}

export default app;
