// Actualiza el número de versión de los archivos CSS/JS en todas las páginas.
// Cuándo usarlo: cada vez que cambies un archivo de css/ o js/ y lo publiques,
// así los navegadores descargan la versión nueva en lugar de usar la guardada.
//
//   node bump-version.mjs
//
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const version = new Date().toISOString().replace(/\D/g, "").slice(0, 12);
const patron = /(\.(?:js|css))\?v=[\w.-]+/g;
const ignorar = new Set(["node_modules", ".git", "functions"]);
let cambiados = 0;

function recorrer(dir) {
  for (const nombre of readdirSync(dir)) {
    if (ignorar.has(nombre)) continue;
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) {
      recorrer(ruta);
    } else if (/\.(html|js)$/.test(nombre)) {
      const texto = readFileSync(ruta, "utf8");
      const nuevo = texto.replace(patron, `$1?v=${version}`);
      if (nuevo !== texto) {
        writeFileSync(ruta, nuevo);
        cambiados++;
      }
    }
  }
}

recorrer(".");
console.log(`Versión ${version} aplicada en ${cambiados} archivo(s).`);
