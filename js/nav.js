// Menú hamburguesa móvil - script clásico, sin dependencias
(function () {
  var toggle = document.querySelector(".nav-toggle");
  var menu = document.querySelector(".nav-links");
  var header = document.querySelector("header");

  if (!toggle || !menu || !header) return;

  var links = menu.querySelectorAll("a");

  function menuAbierto() {
    return menu.classList.contains("is-open");
  }

  function abrirMenu() {
    menu.classList.add("is-open");
    toggle.setAttribute("aria-expanded", "true");
    var icon = toggle.querySelector("i");
    if (icon) {
      icon.classList.remove("fa-bars");
      icon.classList.add("fa-xmark");
    }
    toggle.setAttribute("aria-label", "Cerrar menú");
  }

  // Si el menú ya está cerrado no hace nada (ni toca el foco), para no
  // interferir con otros campos de la página, como los del formulario.
  function cerrarMenu(devolverFoco) {
    if (!menuAbierto()) return;
    menu.classList.remove("is-open");
    toggle.setAttribute("aria-expanded", "false");
    var icon = toggle.querySelector("i");
    if (icon) {
      icon.classList.remove("fa-xmark");
      icon.classList.add("fa-bars");
    }
    toggle.setAttribute("aria-label", "Abrir menú");
    if (devolverFoco === true) toggle.focus();
  }

  toggle.addEventListener("click", function () {
    if (menuAbierto()) {
      cerrarMenu(false);
    } else {
      abrirMenu();
    }
  });

  links.forEach(function (link) {
    link.addEventListener("click", function () {
      cerrarMenu(false);
    });
  });

  // Tecla Escape: cierra y devuelve el foco al botón
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") cerrarMenu(true);
  });

  // Clic o toque fuera del header: cierra sin tocar el foco
  document.addEventListener("click", function (e) {
    if (!header.contains(e.target)) cerrarMenu(false);
  });

  // Al pasar a tablet/escritorio, cerrar el menú
  var media = window.matchMedia("(min-width: 768px)");
  media.addEventListener("change", function () {
    cerrarMenu(false);
  });
})();
