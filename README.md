# Reparto — dashboard para transportistas

Aplicación web instalable (PWA) que le muestra a cada transportista los
pedidos que tiene asignados hoy, en el orden más eficiente, y le deja
marcarlos como entregados. **Funciona sin cobertura.**

Los datos salen de un Google Sheet y vuelven a él: la oficina sigue
trabajando exactamente igual que hasta ahora.

---

## Cómo funciona

```
Google Sheet ──lee──▶ API (Next.js) ──manifiesto──▶ IndexedDB ──▶ Pantalla
     ▲                                                   │
     └──────── escribe entregas ◀──── cola de salida ◀────┘
```

Una sola regla gobierna todo el diseño:

> **La pantalla lee siempre de IndexedDB, nunca de la red.**

La red solo alimenta IndexedDB en segundo plano. Por eso el modo offline no
es un caso especial que haya que probar aparte: es el único modo que existe.
Si la app funciona con cobertura, funciona sin ella.

Cuando el transportista pulsa **Entregado** sin cobertura, la acción se
guarda en una cola local con un identificador único y se sube sola en cuanto
hay red. Reenviar el mismo registro reescribe las mismas celdas con los
mismos valores, así que un reintento nunca duplica nada.

### Qué hay en cada sitio

| Archivo | Qué hace |
|---|---|
| `lib/sheet-schema.ts` | **Mapeo de columnas del Sheet.** El único archivo a tocar si cambian los nombres de las columnas. |
| `lib/sheets.ts` | Lee y escribe en el Google Sheet. |
| `lib/routing.ts` | Geocoding y cálculo de la ruta óptima. |
| `lib/manifest.ts` | Junta ambas cosas en el paquete que se descarga. |
| `lib/db.ts` | Base de datos local (IndexedDB). |
| `lib/sync.ts` | Motor de sincronización en las dos direcciones. |
| `app/sw.ts` | Service worker: hace que la app arranque sin red. |

---

## ¿Solo quieres ver la interfaz?

Sin configurar nada de Google:

```bash
npm install
echo "DEMO_MODE=true" > .env.local
npm run dev
```

Entra con **`demo` / `1234`**. Verás la app entera con pedidos de ejemplo y
una franja "MODO DEMO" para que nadie los confunda con los de verdad. El
botón Entregado funciona; las entregas se guardan en memoria del servidor en
vez de en el Sheet.

---

## Puesta en marcha

### 1. Google Cloud

👉 **[Guía paso a paso con todos los clics](docs/GOOGLE-SETUP.md)** (15 min)

En resumen: creas un proyecto, habilitas **Google Sheets API**, **Geocoding
API** y **Routes API**, creas una **cuenta de servicio** con su clave JSON, y
una **clave de API** para Maps.

### 2. El Google Sheet

Comparte el Sheet con el email de la cuenta de servicio (el campo
`client_email` del JSON), **con permiso de Editor** — la app escribe el
estado de las entregas, así que Lector no vale.

Google avisará de que no puede notificar a esa dirección. Es normal: es un
robot, no una persona.

La hoja necesita al menos estas columnas, con la cabecera en la fila 1:

| Columna | Obligatoria | Para qué |
|---|:---:|---|
| `ID Pedido` | ✅ | Identificador único e inmutable |
| `Transportista` | ✅ | Debe coincidir con el código de `DRIVERS` |
| `Fecha` | ✅ | Fecha de reparto |
| `Direccion` | ✅ | Se geocodifica para calcular la ruta |
| `Prioridad` | | Menor número = antes |
| `Cliente`, `Telefono`, `Observaciones` | | Se muestran en la ficha |

Los nombres admiten variantes (mayúsculas, acentos, sinónimos). Si en tu
hoja se llaman de otra forma, añádela a `lib/sheet-schema.ts`.

Las columnas donde la app **escribe** (`Estado`, `Hora Entrega`,
`Incidencia`) y las de caché de coordenadas (`_lat`, `_lng`) **se crean
solas** la primera vez si no existen. Las de coordenadas se pueden ocultar.

### 3. Variables de entorno

```bash
cp .env.example .env.local
```

Rellena `.env.local` siguiendo los comentarios del propio archivo.

> ⚠️ `GOOGLE_PRIVATE_KEY` va en **una sola línea, entre comillas dobles, con
> los `\n` literales** tal y como vienen en el JSON. Pegar saltos de línea
> reales es el fallo número uno y da un `invalid_grant` que no explica nada.

### 4. Comprobar la conexión

```bash
npm run check
```

Verifica la cadena entera —credenciales, acceso al documento, pestaña,
columnas— y se para en el primer punto que falla explicando qué hacer.
También lista los códigos de transportista que ha encontrado en el Sheet,
para que puedas contrastarlos con los de `DRIVERS`.

### 5. Arrancar

```bash
npm install && npm run dev
```

---

## Despliegue en Vercel

`.env.local` **nunca se sube** (está en `.gitignore`, y así debe seguir: son
credenciales). En producción las variables se configuran aparte, en Vercel.

1. Sube el repositorio a GitHub.
2. En [vercel.com](https://vercel.com) → **Add New → Project** → importa el
   repositorio.
3. Antes de pulsar **Deploy**, despliega la sección **Environment
   Variables** y añade **una por una** las mismas que tienes en
   `.env.local`, con los mismos nombres y valores.
   - `GOOGLE_PRIVATE_KEY`: pega el valor **sin las comillas exteriores**,
     manteniendo los `\n` literales.
   - `DEMO_MODE`: **no la pongas** (o ponla a `false`).
4. **Deploy**.

A partir de ahí, cada `git push` despliega solo.

**Si ya has desplegado y quieres cambiar una variable:** *Project →
Settings → Environment Variables* → editas → y luego *Deployments → ⋯ →
Redeploy*, porque las variables se aplican en el momento del build.

**Atajo desde la terminal**, si prefieres no ir pegando a mano:

```bash
npx vercel link
npx vercel env pull    # trae las de Vercel a .env.local
npx vercel env add GOOGLE_SHEET_ID production
```

> El build usa webpack (`next build --webpack`) porque Serwist, la
> librería del service worker, todavía no soporta Turbopack. Vercel respeta
> el script `build` del `package.json`, así que no hay que configurar nada.

---

## Cómo lo instala el transportista

1. Le mandas el enlace por WhatsApp.
2. Entra una vez con su código y su PIN. **La sesión dura un año**, así que
   no vuelve a ver esa pantalla.
3. En el menú del navegador: **Añadir a pantalla de inicio**.

A partir de ahí tiene un icono como cualquier otra app, se abre sin barra
de navegador y funciona sin cobertura.

---

## Decisiones de diseño que conviene conocer

**No hay base de datos propia.** El Sheet es la única fuente de verdad.
Para una flota pequeña sobra, y evita mantener dos sistemas sincronizados.
Si algún día hay muchos transportistas escribiendo a la vez, o hace falta
histórico y estadísticas, el sitio natural para meter Postgres es entre
`lib/sheets.ts` y `lib/manifest.ts`.

**No hay mapa dentro de la app.** Los términos de servicio de Google
prohíben cachear las teselas del mapa, así que un mapa embebido se quedaría
en blanco justo cuando más falta hace. En su lugar, cada parada tiene un
botón que abre Google Maps: si el transportista se ha descargado el área
una vez, la navegación con voz funciona offline de verdad.

**La ruta se calcula en el servidor.** Así el móvil no necesita red para
consultarla y la clave de Maps nunca sale del servidor.

**Las coordenadas se cachean en el Sheet.** Cada dirección se geocodifica
una sola vez en su vida, no una vez al día.

---

## Pendiente de definir

- ¿Se puede deshacer un "Entregado" pulsado por error?
- ¿La ruta vuelve a la central al terminar?
- ¿Los transportistas se gestionan desde el Sheet en vez de por variable de entorno?
