import type { ICONS } from "../../model";
export type IconName = typeof ICONS[number];
export const ICON_LABELS: Record<IconName, string> = {
  heart: "Corazón", users: "Equipo", rocket: "Cohete", target: "Objetivo", lightbulb: "Idea", shield: "Protección",
  leaf: "Naturaleza", globe: "Mundo", "graduation-cap": "Aprendizaje", briefcase: "Trabajo", laptop: "Computadora",
  clock: "Tiempo", calendar: "Calendario", coffee: "Café", dumbbell: "Ejercicio", stethoscope: "Salud", "piggy-bank": "Ahorro",
  gift: "Regalo", plane: "Viajes", home: "Casa", sparkles: "Inspiración", handshake: "Colaboración", trophy: "Reconocimiento", smile: "Bienestar",
  star: "Estrella", award: "Distinción", medal: "Medalla", crown: "Corona", flag: "Bandera", compass: "Brújula", "map-pin": "Ubicación",
  mountain: "Montaña", sun: "Sol", moon: "Luna", zap: "Energía", flame: "Pasión", gem: "Diamante", puzzle: "Rompecabezas",
  brain: "Conocimiento", "book-open": "Libro abierto", pencil: "Lápiz", palette: "Paleta de arte", music: "Música", camera: "Cámara",
  code: "Código", terminal: "Terminal", cpu: "Procesador", database: "Base de datos", cloud: "Nube", wifi: "Conexión inalámbrica",
  smartphone: "Celular", monitor: "Pantalla", headphones: "Audífonos", "message-circle": "Conversación", mail: "Correo", phone: "Teléfono",
  megaphone: "Comunicación", bell: "Notificación", "trending-up": "Crecimiento", "chart-bar": "Gráfica de barras", "chart-pie": "Gráfica circular",
  "dollar-sign": "Dinero", wallet: "Cartera", "credit-card": "Tarjeta", banknote: "Billete", "shopping-bag": "Compras",
  car: "Auto", bike: "Bicicleta", bus: "Autobús", "train-front": "Tren", baby: "Bebé", dog: "Perro", cat: "Gato",
  utensils: "Comida", pizza: "Pizza", apple: "Manzana", salad: "Ensalada", "heart-handshake": "Confianza", "hand-heart": "Cuidado",
  "hand-helping": "Apoyo", "thumbs-up": "Aprobación", "party-popper": "Celebración", cake: "Pastel", "gamepad-2": "Videojuegos",
  "tree-pine": "Árbol", recycle: "Reciclaje", sprout: "Brote", "flower-2": "Flor", umbrella: "Paraguas", "shield-check": "Seguridad",
  lock: "Candado", key: "Llave", scale: "Justicia", "building-2": "Edificio", factory: "Fábrica", store: "Tienda", wrench: "Herramienta",
  hammer: "Martillo", "hard-hat": "Casco", truck: "Camión", package: "Paquete", infinity: "Infinito", accessibility: "Accesibilidad",
  languages: "Idiomas", "calendar-check": "Fecha confirmada", timer: "Cronómetro", bot: "Robot", microscope: "Investigación",
  paintbrush: "Pincel", film: "Cine", mic: "Micrófono",
};
export const ICON_GROUPS: { label: string; icons: IconName[] }[] = [
  { label: "Cultura y equipo", icons: ["heart", "users", "rocket", "target", "lightbulb", "sparkles", "handshake", "trophy", "smile", "star", "award", "medal", "crown", "flag", "gem", "puzzle", "heart-handshake", "hand-heart", "hand-helping", "thumbs-up", "infinity", "accessibility", "languages"] },
  { label: "Trabajo y aprendizaje", icons: ["graduation-cap", "briefcase", "brain", "book-open", "pencil", "trending-up", "chart-bar", "chart-pie", "building-2", "factory", "store", "wrench", "hammer", "hard-hat", "package", "microscope"] },
  { label: "Tecnología y comunicación", icons: ["laptop", "code", "terminal", "cpu", "database", "cloud", "wifi", "smartphone", "monitor", "headphones", "message-circle", "mail", "phone", "megaphone", "bell", "bot"] },
  { label: "Bienestar y beneficios", icons: ["clock", "calendar", "coffee", "dumbbell", "stethoscope", "piggy-bank", "gift", "home", "dollar-sign", "wallet", "credit-card", "banknote", "shopping-bag", "baby", "dog", "cat", "utensils", "pizza", "apple", "salad", "calendar-check", "timer"] },
  { label: "Naturaleza y viajes", icons: ["leaf", "globe", "plane", "compass", "map-pin", "mountain", "sun", "moon", "zap", "flame", "car", "bike", "bus", "train-front", "tree-pine", "recycle", "sprout", "flower-2", "umbrella", "truck"] },
  { label: "Creatividad y celebraciones", icons: ["palette", "music", "camera", "party-popper", "cake", "gamepad-2", "paintbrush", "film", "mic"] },
  { label: "Confianza y seguridad", icons: ["shield", "shield-check", "lock", "key", "scale"] },
];
export const searchText = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("es-MX").trim();
const emojiGroup = (label: string, entries: string) => ({ label, items: entries.split(";").map(entry => {
  const [emoji, name, keywords = ""] = entry.split("|");
  return { emoji, label: name, keywords: `${label} ${name} ${keywords}` };
}) });
// 120 curated choices; arbitrary valid sequences remain available via paste.
export const EMOJI_GROUPS = [
  emojiGroup("Equipo y colaboración", "🤝|Acuerdo|colaboración confianza;🫶|Manos con corazón|cuidado;🙌|Manos arriba|equipo logro;👏|Aplausos|reconocimiento;👍🏽|Pulgar arriba|aprobación;💪|Fuerza|apoyo;👥|Personas|equipo;🧑‍🤝‍🧑|Compañerismo|inclusión;🫂|Abrazo|apoyo;🤲|Manos abiertas|ayuda;✋|Mano levantada|participación;✌️|Paz|convivencia"),
  emojiGroup("Trabajo y tecnología", "👩‍💻|Tecnóloga|programación código;👨‍💻|Tecnólogo|programación;💻|Laptop|computadora;🖥️|Monitor|pantalla;⌨️|Teclado|escritura;🖱️|Mouse|computación;📱|Celular|móvil;🤖|Robot|automatización;⚙️|Engrane|procesos;🛠️|Herramientas|construcción;🔧|Llave mecánica|reparación;💼|Portafolio|trabajo"),
  emojiGroup("Aprendizaje e ideas", "💡|Foco|idea;🧠|Cerebro|conocimiento;📚|Libros|estudio;📖|Lectura|libro;🎓|Graduación|capacitación;✏️|Lápiz|escritura;📝|Notas|documentación;🔬|Microscopio|investigación;🔭|Telescopio|descubrimiento;🧩|Rompecabezas|soluciones;🎯|Meta|objetivo;🚀|Cohete|innovación"),
  emojiGroup("Reconocimiento y logros", "⭐|Estrella|excelencia;🌟|Estrella brillante|talento;✨|Brillos|inspiración;🏆|Trofeo|premio;🥇|Oro|medalla;🥈|Plata|medalla;🥉|Bronce|medalla;🏅|Medalla deportiva|logro;🎖️|Distinción|mérito;👑|Corona|liderazgo;💎|Diamante|valor;📈|Crecimiento|avance"),
  emojiGroup("Bienestar y salud", "❤️|Corazón rojo|salud;💚|Corazón verde|bienestar;💙|Corazón azul|confianza;💜|Corazón morado|empatía;😊|Sonrisa|felicidad;😌|Calma|descanso;🧘|Meditación|equilibrio;🏃|Correr|ejercicio;🚴|Ciclismo|deporte;🏋️|Pesas|gimnasio;🩺|Estetoscopio|salud;🌈|Arcoíris|diversidad"),
  emojiGroup("Beneficios y vida", "🏠|Hogar|remoto;🏡|Casa con jardín|familia;👶|Bebé|maternidad paternidad;🐶|Perrito|mascotas;🐱|Gatito|mascotas;🎁|Regalo|beneficios;💰|Ahorros|dinero;💳|Tarjeta de pago|finanzas;🏖️|Playa|vacaciones;✈️|Avión|viajes;🗓️|Agenda|flexibilidad;⏰|Despertador|horario"),
  emojiGroup("Naturaleza y sostenibilidad", "🌱|Plántula|crecimiento;🌿|Hierba|naturaleza;🌳|Árbol frondoso|ambiente;🌲|Pino|bosque;🌻|Girasol|alegría;🌷|Tulipán|flor;🍃|Hojas|aire;🌍|Planeta|mundo;♻️|Reciclaje|sostenibilidad;☀️|Sol|energía;🌙|Luna|descanso;⛰️|Montaña|aventura"),
  emojiGroup("Comida y convivencia", "☕|Taza de café|pausa;🍵|Té|descanso;🧉|Mate|convivencia;🥤|Bebida|refresco;🍎|Manzana roja|fruta;🥗|Ensalada|alimentación;🍕|Rebanada de pizza|comida;🌮|Taco|comida;🥑|Aguacate|nutrición;🍪|Galleta|convivencia;🍩|Dona|reunión;🍰|Rebanada de pastel|celebración"),
  emojiGroup("Creatividad y celebración", "🎉|Confeti|fiesta;🎊|Celebración|fiesta;🎂|Cumpleaños|pastel;🎈|Globo|fiesta;🎨|Arte|diseño;🖌️|Pincel artístico|creatividad;🎵|Nota musical|música;🎸|Guitarra|música;🎤|Micrófono musical|voz;🎬|Claqueta|cine;📷|Cámara fotográfica|foto;🎮|Control de videojuegos|juegos"),
  emojiGroup("Comunicación y confianza", "💬|Diálogo|conversación;📣|Altavoz|comunicación;📢|Anuncio|noticias;✉️|Carta|correo;📞|Llamada|teléfono;🔔|Campana|avisos;🛡️|Escudo|protección;🔒|Seguridad|privacidad;🔑|Llave|acceso;⚖️|Balanza|justicia;🌐|Red global|conexión;🇲🇽|México|bandera"),
];
