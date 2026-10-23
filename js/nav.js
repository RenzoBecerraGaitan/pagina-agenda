// Menú hamburguesa móvil - script clásico, sin dependencias
(function () {
  var toggle = document.querySelector(".nav-toggle");
  var menu = document.querySelector(".nav-links");
  var links = menu ? menu.querySelectorAll("a") : [];
  var header = document.querySelector("header");

  if (!toggle || !menu) return;

  function cerrarMenu() {
    menu.classList.remove("is-open");
    toggle.setAttribute("aria-expanded", "false");
    var icon = toggle.querySelector("i");
    if (icon) {
      icon.classList.remove("fa-xmark");
      icon.classList.add("fa-bars");
    }
    toggle.setAttribute("aria-label", "Abrir menú");
    toggle.focus();
  }

  function alternarMenu() {
    var estaAbierto = menu.classList.contains("is-open");
    if (estaAbierto) {
      cerrarMenu();
    } else {
      menu.classList.add("is-open");
      toggle.setAttribute("aria-expanded", "true");
      var icon = toggle.querySelector("i");
      if (icon) {
        icon.classList.remove("fa-bars");
        icon.classList.add("fa-xmark");
      }
      toggle.setAttribute("aria-label", "Cerrar menú");
    }
  }

  toggle.addEventListener("click", alternarMenu);

  links.forEach(function (link) {
    link.addEventListener("click", cerrarMenu);
  });

  // Tecla Escape
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      cerrarMenu();
    }
  });

  // Clic fuera del header
  document.addEventListener("click", function (e) {
    if (!header.contains(e.target)) {
      cerrarMenu();
    }
  });

  // Al pasar a tablet/escritorio, cerrar menú
  var media = window.matchMedia("(min-width: 768px)");
  media.addEventListener("change", cerrarMenu);
})();
