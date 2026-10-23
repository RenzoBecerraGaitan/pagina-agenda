// Core Application Logic for Public Location Pages (/sanrafael and /mendoza)

document.addEventListener("DOMContentLoaded", () => {
  const bodyLocation = document.body.getAttribute("data-location");
  if (!bodyLocation) return; // Not a location page

  // Initialize LocalStorage with sample data if empty
  initializeStorage();

  // Render events for current location
  renderLocationEvents(bodyLocation);

  // Modal elements
  const modalOverlay = document.getElementById("upload-modal");
  const btnOpenUpload = document.getElementById("btn-open-upload");
  const modalClose = document.querySelector(".modal-close");

  // Auth & Form elements
  const authStep = document.getElementById("auth-step");
  const eventForm = document.getElementById("event-form");
  const btnGoogleAuth = document.getElementById("btn-google-auth");
  const btnLogout = document.getElementById("btn-logout");
  const userLoggedEmail = document.getElementById("user-logged-email");

  // Open modal
  if (btnOpenUpload) {
    btnOpenUpload.addEventListener("click", () => {
      modalOverlay.classList.add("active");
      // Always show the planes step first, regardless of auth state
      // The plan selection logic in eventos.js will navigate to auth/form later
      if (plansStep) plansStep.style.display = "block";
      if (authStep) authStep.style.display = "none";
      if (eventForm) eventForm.style.display = "none";
      if (exitoStep) exitoStep.style.display = "none";
      // Request plan selection from eventos module
      if (typeof window.mostrarPaso === "function") {
        window.mostrarPaso("planes");
      }
      // Still update UI elements like user display
      checkAuthState();
    });
  }

  // Close modal
  if (modalClose) {
    modalClose.addEventListener("click", () => {
      modalOverlay.classList.remove("active");
    });
  }

  if (modalOverlay) {
    modalOverlay.addEventListener("click", (e) => {
      if (e.target === modalOverlay) {
        modalOverlay.classList.remove("active");
      }
    });
  }

  // Simulate Google Auth
  if (btnGoogleAuth) {
    btnGoogleAuth.addEventListener("click", () => {
      const simulatedUser = "creador.cultural@gmail.com";
      localStorage.setItem("agenda_user", simulatedUser);
      checkAuthState();
    });
  }

  // Logout simulation
  if (btnLogout) {
    btnLogout.addEventListener("click", () => {
      localStorage.removeItem("agenda_user");
      checkAuthState();
    });
  }

  function checkAuthState() {
    const user = localStorage.getItem("agenda_user");
    if (user) {
      // Usuario logueado: dispata evento para que eventos.js navegue al formulario
      // Esto respetará la lógica de planElegido y mostrará el paso correcto
      document.dispatchEvent(new CustomEvent("agenda:auth", { detail: { user } }));
    } else {
      // Usuario deslogueado: volver al paso de planes si hay plan elegido
      document.dispatchEvent(new CustomEvent("agenda:auth", { detail: { user: null } }));
    }
  }

  // Handle Event Form Submission
  if (eventForm) {
    eventForm.addEventListener("submit", (e) => {
      e.preventDefault();

      const imageInput = document.getElementById("event-image");
      const title = document.getElementById("event-title").value;
      const desc = document.getElementById("event-desc").value;
      const date = document.getElementById("event-date").value;
      const time = document.getElementById("event-time").value;
      const place = document.getElementById("event-place").value;
      const address = document.getElementById("event-address").value;
      const contact = document.getElementById("event-contact").value;
      const captchaChecked = document.getElementById("captcha-check").checked;

      if (!captchaChecked) {
        alert("Por favor complete la verificación del Captcha.");
        return;
      }

      // Handle Image File conversion to Base64 for LocalStorage
      const file = imageInput.files[0];
      const reader = new FileReader();

      reader.onload = function (uploadEvent) {
        const imageUrl = uploadEvent.target.result;

        const newEvent = {
          id: "ev_" + Date.now(),
          location: bodyLocation,
          title,
          desc,
          date,
          time,
          place,
          address,
          contact,
          image: imageUrl,
          status: "pending", // pending, approved, rejected
          featured: false,
          createdAt: new Date().toISOString(),
        };

        saveEvent(newEvent);

        // Reset form & close modal
        eventForm.reset();
        modalOverlay.classList.remove("active");

        alert(
          "¡Evento enviado con éxito! Quedará pendiente de aprobación por el administrador.",
        );
      };

      if (file) {
        reader.readAsDataURL(file);
      } else {
        // Fallback default image if none provided
        proceedEventSave(
          "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=600&q=80",
        );
      }

      function proceedEventSave(fallbackImg) {
        const newEvent = {
          id: "ev_" + Date.now(),
          location: bodyLocation,
          title,
          desc,
          date,
          time,
          place,
          address,
          contact,
          image: fallbackImg,
          status: "pending",
          featured: false,
          createdAt: new Date().toISOString(),
        };

        saveEvent(newEvent);
        eventForm.reset();
        modalOverlay.classList.remove("active");
        alert(
          "¡Evento enviado con éxito! Quedará pendiente de aprobación por el administrador.",
        );
      }
    });
  }
});

// Helper functions for LocalStorage
function getEvents() {
  const events = localStorage.getItem("agenda_events");
  return events ? JSON.parse(events) : [];
}

function saveEvent(event) {
  const events = getEvents();
  events.push(event);
  localStorage.setItem("agenda_events", JSON.stringify(events));
}

function initializeStorage() {
  if (!localStorage.getItem("agenda_events")) {
    const sampleEvents = [
      {
        id: "ev_1",
        location: "sanrafael",
        title: "Peña Folklórica Tradicional",
        desc: "Música en vivo, ballets locales y excelente gastronomía regional.",
        date: "2026-11-15",
        time: "21:00",
        place: "Club Español",
        address: "Av. Mitre 550",
        contact: "+54 9 260 4111111",
        image:
          "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=600&q=80",
        status: "approved",
        featured: true,
        createdAt: new Date().toISOString(),
      },
      {
        id: "ev_2",
        location: "sanrafael",
        title: "Obra de Teatro: Comedia Local",
        desc: "Divertida obra dirigida por el elenco municipal de teatro.",
        date: "2026-10-25",
        time: "20:30",
        place: "Teatro Roma",
        address: "Hipólito Yrigoyen 280",
        contact: "+54 9 260 4222222",
        image:
          "https://images.unsplash.com/photo-1460723237483-7a6dc9d0b212?auto=format&fit=crop&w=600&q=80",
        status: "approved",
        featured: false,
        createdAt: new Date().toISOString(),
      },
      {
        id: "ev_3",
        location: "mendoza",
        title: "Festival de Indie Rock Mendocino",
        desc: "Las mejores bandas emergentes de la escena cuyana en concierto.",
        date: "2026-11-20",
        time: "19:00",
        place: "Nave Cultural",
        address: "España y Maza",
        contact: "+54 9 261 4333333",
        image:
          "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=600&q=80",
        status: "approved",
        featured: true,
        createdAt: new Date().toISOString(),
      },
      {
        id: "ev_4",
        location: "mendoza",
        title: "Muestra de Arte Contemporáneo",
        desc: "Exposición de artistas plásticos de Cuyo con entrada libre y gratuita.",
        date: "2026-10-28",
        time: "18:00",
        place: "Espacio Le Parc",
        address: "Mitre y Godoy Cruz",
        contact: "+54 9 261 4444444",
        image:
          "https://images.unsplash.com/photo-1536924940846-227afb31e2a5?auto=format&fit=crop&w=600&q=80",
        status: "approved",
        featured: false,
        createdAt: new Date().toISOString(),
      },
    ];
    localStorage.setItem("agenda_events", JSON.stringify(sampleEvents));
  }
}

function renderLocationEvents(locationName) {
  const grid = document.getElementById("events-grid");
  if (!grid) return;

  const events = getEvents();
  const today = new Date().toISOString().split("T")[0];

  // Filter: Only approved AND date >= today
  const filteredEvents = events.filter((ev) => {
    return (
      ev.location === locationName &&
      ev.status === "approved" &&
      ev.date >= today
    );
  });

  // Sort: Featured events first, then by date ascending
  filteredEvents.sort((a, b) => {
    if (a.featured === b.featured) {
      return a.date.localeCompare(b.date);
    }
    return a.featured ? -1 : 1;
  });

  if (filteredEvents.length === 0) {
    grid.innerHTML = `
      <div class="no-events">
        <i class="fa-solid fa-calendar-xmark" style="font-size: 2.5rem; margin-bottom: 1rem; color: var(--text-muted);"></i>
        <h3>No hay eventos futuros programados</h3>
        <p>Sé el primero en cargar un evento cultural haciendo clic en "Cargar Evento".</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = filteredEvents
    .map(
      (ev) => `
    <div class="event-card ${ev.featured ? "featured" : ""}">
      ${ev.featured ? '<span class="featured-badge"><i class="fa-solid fa-star"></i> Destacado</span>' : ""}
      <img src="${ev.image}" alt="${ev.title}" class="event-img">
      <div class="event-body">
        <span class="event-date-badge"><i class="fa-regular fa-calendar"></i> ${formatDate(ev.date)} - ${ev.time}hs</span>
        <h3 class="event-title">${ev.title}</h3>
        <p class="event-desc">${ev.desc}</p>
        <div class="event-details">
          <div><i class="fa-solid fa-location-dot"></i> <strong>Lugar:</strong> ${ev.place} (${ev.address})</div>
          <div><i class="fa-solid fa-phone"></i> <strong>Contacto:</strong> ${ev.contact}</div>
        </div>
      </div>
    </div>
  `,
    )
    .join("");
}

function formatDate(dateString) {
  const [year, month, day] = dateString.split("-");
  return `${day}/${month}/${year}`;
}
