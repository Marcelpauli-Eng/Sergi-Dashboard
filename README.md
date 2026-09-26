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
| `lib/sheet-tab.ts` | Elige la pestaña del mes en curso cuando hay una por mes. |
| `lib/sheet-cells.ts` | Cómo se interpreta **una** celda (estados, importes, prioridades). |
| `lib/importes.ts` | El registro privado de precios: qué fila se actualiza y cuál se añade. |
| `lib/sheets.ts` | Lee y escribe en el Google Sheet. Las facturas van a su propio documento (ver `GOOGLE_SHEET_ID_FACTURAS`). |
| `lib/outbox.ts` | Cómo se ve en pantalla lo que aún no ha llegado al Sheet. |
| `lib/routing.ts` | Geocoding y cálculo de la ruta óptima. |
| `lib/manifest.ts` | Junta ambas cosas en el paquete que se descarga. |
| `lib/db.ts` | Base de datos local (IndexedDB). |
| `lib/sync.ts` | Motor de sincronización en las dos direcciones. |
| `app/sw.ts` | Service worker: hace que la app arranque sin red. |

---

## Comprobaciones

```bash
npm test
```

No hay framework de tests: son scripts que se ejecutan con Node y usan
`node:assert`. Cada uno cubre una pieza de lógica pura y **explica en el
mensaje qué se rompe si falla**, que es lo que hace falta a los seis meses.

| Comprobación | Qué protege |
|---|---|
| `check:dates` | Que las semanas y los meses del calendario cuadren. |
| `check:format` | Fechas del Sheet (las cuatro formas en que llegan), distancias, tiempos y la geometría de la ruta. |
| `check:cells` | Que una celda escrita a mano se lea como toca: "Entregat", "x", "Urgent"… |
| `check:schema` | Qué columna es cuál y de qué pestaña se lee. |
| `check:factura` | Los números de la factura, al céntimo, y a qué cliente va. |
| `check:ajustes` | Que los datos guardados en el móvil sobrevivan a una versión nueva. |
| `check:outbox` | Que lo que se hace sin cobertura se vea bien en pantalla. |
| `check:importes` | Que los precios acaben en el documento privado, una fila por comanda. |
| `check:pdf` | Que el PDF que se exporta sea un PDF válido. |

Aparte está `npm run check` (`scripts/check-sheet.mts`), que sí habla con
Google: comprueba contra la hoja de verdad que las columnas están y que se
puede escribir.

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

👉 **[Guía paso a paso con todos los clics](docs/GOOGLE-SETUP.md)** (20 min)

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
| `Direccion` | ✅ | Se geocodifica para calcular la ruta |
| `Estado` | | Lo que decide qué se enseña. La app **escribe** aquí |
| `Fecha` | | Informativa. No decide nada |
| `Poblacion` | | Municipio y CP, si van aparte de la calle. Se concatenan antes de geocodificar |
| `Transportista` | | Código del repartidor. **Si no existe, hay uno solo y ve todos los pedidos** |
| `Prioridad` | | Menor número = antes. Admite también `Urgent`/`Normal`/`Baixa` |
| `Cliente`, `Telefono`, `Observaciones` | | Se muestran en la ficha |

Los nombres admiten variantes (mayúsculas, acentos, sinónimos, y las formas
catalanas: `Data`, `Adreça`, `Població`, `Nº Comanda`, `Client`, `Telèfon`,
`Prioritat`, `Estat de l'entrega`…). Si en tu hoja se llaman de otra forma,
añádela a `lib/sheet-schema.ts`.

#### El dinero va en otro documento

`GOOGLE_SHEET_ID_FACTURAS` apunta al documento privado del transportista, con
dos pestañas:

| Pestaña | Qué guarda |
|---|---|
| `Factures` | Las facturas emitidas, con sus líneas y su número de serie. |
| `Imports` | Lo que se cobra por cada comanda, por número de comanda. |

El motivo: el documento de repartos lo comparte la empresa —lo necesita, es
su hoja de pedidos— y **Google Sheets no sabe ocultar una pestaña a quien
tiene acceso al documento**. Esconderla es cosmético (Ver → Hojas ocultas) y
la protección de hojas limita la edición, no la lectura. Lo que factura el
transportista no es asunto de la empresa, así que la única separación real es
otro archivo, compartido solo con la cuenta de servicio (Editor).

La app ya **no escribe** en la columna `Import` de la hoja de repartos, ni la
crea. La sigue *leyendo* como respaldo mientras queden importes viejos sin
mudar; el documento privado siempre manda.

Sin esa variable el resto de la app funciona igual, pero la pantalla de
Factures dice que falta por configurar, y una entrega con importe queda «sin
enviar» hasta que se ponga —el estado sí se escribe; lo que no se puede
guardar en ninguna parte es el precio. Antes caían en el documento de
repartos: un olvido al desplegar y la empresa se encontraba las facturas y
los precios en su hoja, justo lo que esta separación evita.

> **Al cambiarla con facturas ya emitidas:** la serie se calcula a partir de
> la última factura que haya en *ese* documento. O copias la pestaña
> `Factures` al nuevo, o pones en Ajustes → Facturació un «primer número» por
> encima de la última emitida. Si no, se repetirían números.

**Mudar los importes que ya estén en la hoja de la empresa:**

```bash
npm run migrar:imports              # solo copia, no toca nada
npm run migrar:imports -- --borrar  # y vacía la columna original
```

Por defecto solo copia. Vaciar la columna borra un dato que hasta ese momento
no está en ningún otro sitio, así que va aparte y con la copia ya comprobada.

**Qué ve el transportista.** Todo lo que no esté marcado como entregado, sin
filtrar por fecha. En esta hoja no hay ninguna columna que diga qué día toca
entregar cada pedido —la fecha que traen es la de alta— y quién decide el
orden y el día es el propio transportista. Las incidencias siguen apareciendo,
al final y fuera de la ruta, porque quedan pendientes de resolver.

Por eso la app **escribe el estado con la misma palabra que ya usa tu hoja**:
lee las opciones del desplegable de esa columna y responde en su idioma
(`Entregat`, `Incidència`…). Escribir un término de fuera dejaría la celda en
un valor que el desplegable no reconoce.

**Sobre `Transportista`:** con un único repartidor la columna sobra — quien
entre verá todos los pedidos del día. En cuanto la añadas con el código de
cada uno, el filtro se activa solo, sin tocar código.

**Una pestaña por mes.** Si la hoja tiene una pestaña por mes
(`Agost 2026`, `08/2026`, `ago-26`…), no definas `GOOGLE_SHEET_TAB`: la app
pregunta a Google qué pestañas hay y elige la del mes en curso cada vez, así
que el día 1 no hay que tocar nada. Ver `lib/sheet-tab.ts`. Define la
variable solo para forzar una pestaña concreta.

Si la pestaña del mes nuevo **aún no está creada**, la app no se cae: sigue
con la más reciente anterior y lo avisa en los logs, así que el transportista
ve los pedidos que quedaran sin entregar allí. En cuanto se cree la nueva la
coge sola, sin redesplegar.

#### Un segundo documento de comandas (opcional)

Si otra empresa también te pasa portes en su propia hoja, pon su ID en
`GOOGLE_SHEET_ID_2` y compártela como Editor con la cuenta de servicio.

- **Calendario:** sale una bossa por documento (`Bossa · <nombre>`). Cada
  una se asigna a los días igual que siempre; en el calendario las del
  segundo llevan un filo de color a la izquierda.
- **Ruta y entregas:** van juntas. La app escribe cada entrega en el
  documento del que salió.
- **Factura:** todas las entregas en la misma factura, agrupadas por
  documento con su nombre como separador, en pantalla, en el papel y en el
  PDF. El separador se guarda con la factura (columna `Grups` de
  `Factures`), así que una reimpresión sale igual.
- **Pestañas:** del full que tengas elegido solo se aprovecha el mes; en la
  segunda hoja se busca la pestaña de ese mes por su cuenta. Si no la tiene,
  **se crea sola al crear la primera comanda** desde su bossa: con el mismo
  nombre que la tuya (`SET 26`) y la misma fila de cabecera (la de su mes
  anterior si tiene alguno; si no, la tuya). Solo la cabecera: tus comandas
  no pasan a su hoja. Si esa hoja no va por meses, fija la pestaña con
  `GOOGLE_SHEET_TAB_2` y no se crea nada.
- Los nombres de las bosses: `GOOGLE_SHEET_NOM` y `GOOGLE_SHEET_NOM_2`.

Las comandas del segundo llevan `2:` delante de su identificador interno
(no del número que se enseña ni del que va a la factura), para que un `748`
de cada empresa no se pisen. Si no se puede leer, el primero sigue
funcionando y su bossa dice por qué; Ajustes → Diagnòstic también lo
comprueba.

Las columnas donde la app **escribe** (`Estado`, `Hora Entrega`,
`Incidencia`) y las de caché de coordenadas (`_lat`, `_lng`) **se crean
solas** la primera vez si no existen. Las de coordenadas se pueden ocultar.

Se buscan por el nombre de la cabecera, nunca por posición: puedes moverlas
y reordenarlas donde te convenga. Si tu hoja ya tiene una columna para la
hora de entrega —`Data entrega`, por ejemplo— la app escribe en esa y no
crea ninguna nueva.

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
También resume los estados que ha encontrado en la hoja, para que veas de un
vistazo cuántos pedidos se le van a enseñar al transportista.

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
   `.env.local`, con los mismos nombres.

   > ⚠️ **En Vercel los valores van SIN comillas.** En un archivo `.env` las
   > comillas son sintaxis; en el formulario de Vercel se guardarían como
   > parte del valor y nada funcionaría. Esto vale para todas, no solo para
   > la clave privada.

   - `GOOGLE_PRIVATE_KEY`: pega desde `-----BEGIN` hasta `KEY-----\n`,
     manteniendo los `\n` literales, sin las comillas de fuera.
   - `DEMO_MODE`: **no la pongas** (o ponla a `false`).
   - Marca los tres entornos (Production, Preview, Development).
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
