// Manejo de autenticación con Firebase (Google Auth)
import {
  GoogleAuthProvider,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { auth } from "./firebase-config.js";

// Instancia del proveedor de Google con selector de cuenta
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({
  prompt: "select_account"
});

/**
 * 1. Iniciar sesión con Google mediante redirección (signInWithRedirect)
 * Funciona de forma óptima en navegadores móviles y de escritorio evitando bloqueos de popups
 */
export async function loginWithGoogle() {
  try {
    await signInWithRedirect(auth, googleProvider);
  } catch (error) {
    console.error("Error al iniciar sesión con Google:", error.code, error.message);
    alert(`Error al iniciar sesión con Google: ${error.message}`);
    throw error;
  }
}

/**
 * 2. Captura el resultado de la redirección cuando el usuario regresa tras autenticarse
 * @param {Function} [callback] Función adicional opcional con los datos del usuario
 * @returns {Promise<object|null>} Objeto de usuario autenticado o null
 */
export async function handleRedirectResult(callback) {
  try {
    const result = await getRedirectResult(auth);
    if (result && result.user) {
      console.log("Inicio de sesión por redirección exitoso:", result.user);
      updateAuthDOM(result.user);
      if (typeof callback === "function") {
        callback(result.user);
      }
      return result.user;
    }
    return null;
  } catch (error) {
    console.error("Error al procesar getRedirectResult:", error.code, error.message);
    alert(`Error al procesar la autenticación de Google: ${error.message}`);
    throw error;
  }
}

/**
 * 3. Cerrar sesión del usuario actual
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
  const authStep = document.getElementById("auth-step");
  const eventForm = document.getElementById("event-form");
  const userLoggedEmail = document.getElementById("user-logged-email");

  if (user) {
    if (authStep) authStep.style.display = "none";
    if (eventForm) eventForm.style.display = "block";
    if (userLoggedEmail) {
      userLoggedEmail.textContent = `Autenticado: ${user.displayName || user.email}`;
    }
  } else {
    if (authStep) authStep.style.display = "block";
    if (eventForm) eventForm.style.display = "none";
    if (userLoggedEmail) {
      userLoggedEmail.textContent = "";
    }
  }
}

/**
 * 4. Listener del estado de autenticación (onAuthStateChanged)
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

// Exponer en window para enlaces directos
window.loginWithGoogle = loginWithGoogle;
window.handleRedirectResult = handleRedirectResult;
window.logout = logout;

async function initAuthDOM() {
  // Capturar retorno de redirección de Google
  await handleRedirectResult();

  // Configurar listener de estado de autenticación
  initAuthListener();

  // Enlazar botón de Google Auth si existe
  const btnGoogleAuth = document.getElementById("btn-google-auth");
  if (btnGoogleAuth) {
    btnGoogleAuth.addEventListener("click", () => {
      loginWithGoogle();
    });
  }

  // Enlazar botón de Logout si existe
  const btnLogout = document.getElementById("btn-logout");
  if (btnLogout) {
    btnLogout.addEventListener("click", () => {
      logout();
    });
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initAuthDOM);
} else {
  initAuthDOM();
}


