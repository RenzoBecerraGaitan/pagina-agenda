// Manejo de autenticación con Firebase (Google Auth)
import {
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { auth } from "./firebase-config.js?v=202610251319";

// Configuración explícita de persistencia local en el almacenamiento del navegador
setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.warn("Aviso al inicializar browserLocalPersistence:", err);
});

// Instancia del proveedor de Google con selector de cuenta
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: "select_account"
});

/**
 * 1. Iniciar sesión con Google mediante ventana emergente (signInWithPopup)
 * Evita la pérdida de estado y recarga completa de página.
 * @returns {Promise<object>} Objeto de usuario autenticado
 */
export async function loginWithGoogle() {
  try {
    // La persistencia local ya se configura al cargar este módulo. No se espera
    // nada antes de abrir el popup: algunos navegadores de celular lo bloquean
    // si no se abre directamente dentro del toque del usuario.
    const result = await signInWithPopup(auth, googleProvider);
    console.log("Inicio de sesión exitoso:", result.user);
    return result.user;
  } catch (error) {
    console.error("Error al autenticar con Google:", error.code, error.message);
    if (error.code === "auth/popup-blocked") {
      alert(
        "La ventana emergente de inicio de sesión fue bloqueada por tu navegador. Por favor habilita los popups para este sitio y vuelve a intentarlo."
      );
    } else if (
      error.code !== "auth/popup-closed-by-user" &&
      error.code !== "auth/cancelled-popup-request"
    ) {
      alert(`Error al iniciar sesión con Google: ${error.message}`);
    }
    throw error;
  }
}

/**
 * 2. Cerrar sesión del usuario actual
 * @returns {Promise<void>}
 */
export async function logout() {
  try {
    await signOut(auth);
    console.log("Sesión cerrada correctamente");
  } catch (error) {
    console.error("Error al cerrar sesión:", error.code, error.message);
    alert(`Error al cerrar sesión: ${error.message}`);
    throw error;
  }
}

/**
 * Actualiza la visibilidad de los elementos del DOM según el estado de autenticación
 * @param {object|null} user Objeto del usuario o null si no está autenticado
 */
export function updateAuthDOM(user) {
  const userLoggedEmail = document.getElementById("user-logged-email");

  // Guarda el usuario actual para que otros módulos (eventos.js) lo consulten.
  window.usuarioLogueado = user;

  if (user) {
    if (userLoggedEmail) {
      userLoggedEmail.textContent = `Autenticado: ${user.displayName || user.email}`;
    }
  } else {
    if (userLoggedEmail) {
      userLoggedEmail.textContent = "";
    }
  }

  // Notifica a eventos.js para que decida qué paso del modal mostrar.
  // updateAuthDOM ya no muestra u oculta pasos por sí solo.
  document.dispatchEvent(new CustomEvent("agenda:auth", { detail: { user } }));
}

/**
 * 3. Listener del estado de autenticación (onAuthStateChanged)
 * Escucha los cambios de sesión y actualiza el DOM automáticamente
 * @param {Function} [callback] Función adicional opcional a ejecutar cuando cambia el estado
 * @returns {Function} Función para cancelar la suscripción
 */
export function initAuthListener(callback) {
  return onAuthStateChanged(auth, (user) => {
    updateAuthDOM(user);
    if (typeof callback === "function") {
      callback(user);
    }
  });
}

// Exponer en window para compatibilidad
window.loginWithGoogle = loginWithGoogle;
window.logout = logout;

function initAuthDOM() {
  // Configurar listener de estado de autenticación para páginas públicas
  initAuthListener();

  // Enlazar botón de Google Auth directamente mediante evento click
  const btnGoogleAuth = document.getElementById("btn-google-auth");
  if (btnGoogleAuth) {
    btnGoogleAuth.addEventListener("click", () => {
      loginWithGoogle().catch((err) => {
        console.warn("Fallo o cancelación en login público:", err.message);
      });
    });
  }

  // Enlazar botón de Logout si existe
  const btnLogout = document.getElementById("btn-logout");
  if (btnLogout) {
    btnLogout.addEventListener("click", () => {
      logout().catch((err) => {
        console.warn("Error en logout público:", err.message);
      });
    });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAuthDOM);
} else {
  initAuthDOM();
}



