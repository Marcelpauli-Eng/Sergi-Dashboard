# Configurar Google, paso a paso

Al terminar tendrás estos cinco datos para `.env.local`:

| Variable | Qué es |
|---|---|
| `GOOGLE_SERVICE_ACCOUNT_EMAIL` | El email del "usuario robot" |
| `GOOGLE_PRIVATE_KEY` | Su contraseña, en forma de clave |
| `GOOGLE_SHEET_ID` | Qué documento hay que leer |
| `GOOGLE_SHEET_TAB` | Qué pestaña dentro del documento |
| `GOOGLE_MAPS_API_KEY` | Para geocodificar y calcular rutas |

Tiempo estimado: 15 minutos.

---

## Paso 1 · Crear el proyecto

1. Entra en **[console.cloud.google.com](https://console.cloud.google.com)**
   con la cuenta de Google que quieras (puede ser la de la empresa).
2. Arriba a la izquierda, junto al logo, hay un **selector de proyecto**.
   Púlsalo → **Proyecto nuevo**.
3. Nombre: `Reparto`. Pulsa **Crear**.
4. Espera unos segundos y **asegúrate de que el selector de arriba muestra
   "Reparto"**. Es el error más típico: hacer el resto de pasos dentro de
   otro proyecto.

## Paso 2 · Activar las tres APIs

Menú ☰ → **APIs y servicios** → **Biblioteca**.

Busca y activa estas tres, una a una (buscar → clic en el resultado →
botón **Habilitar**):

- **Google Sheets API**
- **Geocoding API**
- **Routes API**

> ⚠️ Cuidado: existe una "Directions API" antigua. La que usamos es
> **Routes API**, la nueva.

## Paso 3 · Activar la facturación

Las APIs de Maps (Geocoding y Routes) exigen una tarjeta asociada aunque no
llegues a pagar nada.

Menú ☰ → **Facturación** → **Vincular una cuenta de facturación** → sigue el
asistente y añade una tarjeta.

Hay un nivel gratuito mensual que para una flota pequeña cubre de sobra el
consumo, sobre todo porque esta app **cachea las coordenadas en el propio
Sheet** y solo geocodifica cada dirección una vez en su vida.

**Recomendación:** en *Facturación → Presupuestos y alertas*, crea un
presupuesto de, por ejemplo, 5 € con aviso por email. Así te enteras si algo
se dispara.

## Paso 4 · Crear la cuenta de servicio (el "robot")

Menú ☰ → **APIs y servicios** → **Credenciales**.

1. Arriba: **+ Crear credenciales** → **Cuenta de servicio**.
2. Nombre: `reparto`. Pulsa **Crear y continuar**.
3. Te pedirá "Conceder acceso a este proyecto (opcional)" → **sáltalo**,
   pulsa **Continuar**.
   No necesita ningún rol: sus permisos vendrán de compartirle el Sheet.
4. Pulsa **Listo**.

Ya tienes el robot. En la lista verás su email, con esta forma:

```
reparto@reparto-123456.iam.gserviceaccount.com
```

## Paso 5 · Descargar su clave

1. En la lista de credenciales, **haz clic en la cuenta de servicio** que
   acabas de crear.
2. Pestaña **Claves**.
3. **Agregar clave** → **Crear clave nueva** → formato **JSON** → **Crear**.

Se te descarga un archivo tipo `reparto-123456-a1b2c3d4.json`.

> 🔒 Ese archivo es la contraseña de acceso a tu Sheet. No lo subas a GitHub
> ni lo mandes por email.

**Ahora, en la carpeta del proyecto, ejecuta:**

```bash
npm run env:json -- ~/Downloads/reparto-123456-a1b2c3d4.json
```

Te imprime las líneas de `GOOGLE_SERVICE_ACCOUNT_EMAIL`,
`GOOGLE_PRIVATE_KEY` y `SESSION_SECRET` ya con el formato correcto, listas
para pegar en `.env.local`. Esto evita el fallo más habitual de todos: pegar
la clave con saltos de línea reales en vez de con `\n` literales.

## Paso 6 · Crear la clave de API de Maps

Menú ☰ → **APIs y servicios** → **Credenciales**.

1. **+ Crear credenciales** → **Clave de API**.
2. Copia la clave que aparece → va en `GOOGLE_MAPS_API_KEY`.
3. Pulsa **Editar clave de API** para restringirla (importante: sin esto,
   quien la consiga puede gastar tu saldo):
   - **Restricciones de aplicación**: déjalo en **Ninguna**.
     La usa el servidor, y en Vercel la IP cambia, así que restringir por IP
     no funciona de forma fiable.
   - **Restricciones de API**: marca **Restringir clave** y selecciona
     únicamente **Geocoding API** y **Routes API**.
4. **Guardar**.

> La clave nunca sale del servidor: el navegador del transportista no la ve
> en ningún momento.

## Paso 7 · Compartir el Sheet con el robot

1. Abre tu Google Sheet.
2. Botón **Compartir** (arriba a la derecha).
3. Pega el email de la cuenta de servicio
   (`reparto@…iam.gserviceaccount.com`).
4. Cambia el permiso a **Editor** ← imprescindible, la app escribe el estado
   de las entregas. Con "Lector" no funciona.
5. **Enviar**.

Google te dirá que no ha podido enviar la notificación a esa dirección.
**Es normal**: es un robot, no tiene bandeja de entrada. El acceso queda
concedido igualmente.

## Paso 8 · Coger el ID del documento

Está en la URL del Sheet:

```
https://docs.google.com/spreadsheets/d/1a2B3cD4eF5gH6iJ7kL8mN9oP/edit#gid=0
                                       └────── GOOGLE_SHEET_ID ──────┘
```

Y `GOOGLE_SHEET_TAB` es el nombre de la pestaña de abajo, escrito **exacto**
(respetando mayúsculas y acentos).

## Paso 9 · Rellenar `.env.local`

```bash
cp .env.example .env.local
```

Debe quedar así:

```bash
GOOGLE_SERVICE_ACCOUNT_EMAIL="reparto@reparto-123456.iam.gserviceaccount.com"
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQ...\n-----END PRIVATE KEY-----\n"
GOOGLE_SHEET_ID="1a2B3cD4eF5gH6iJ7kL8mN9oP"
GOOGLE_SHEET_TAB="Pedidos"
GOOGLE_MAPS_API_KEY="AIzaSy..."

DEPOT_ADDRESS="Carrer de Mallorca 401, 08013 Barcelona"
BUSINESS_TIMEZONE="Europe/Madrid"

SESSION_SECRET="...32+ caracteres aleatorios..."
DRIVERS="sergi:4821:Sergi Pons,juan:9034:Juan Ruiz"
```

En `DRIVERS`, el **código** (`sergi`) tiene que coincidir con lo que ponga
la columna `Transportista` de tu Sheet. El PIN te lo inventas tú.

## Paso 10 · Comprobar que todo está bien

```bash
npm run check
```

Recorre la cadena entera y se para en el primer punto que falle explicando
qué hacer. Si sale todo en verde, ya puedes arrancar:

```bash
npm run dev
```

---

## Problemas frecuentes

**`invalid_grant: Invalid grant: account not found`**
El email de la cuenta de servicio está mal escrito. Cópialo del campo
`client_email` del JSON.

**`invalid_grant` sin más detalle**
La clave privada tiene saltos de línea reales. Vuelve a generar las líneas
con `npm run env:json`.

**`403` / "no tiene acceso"**
No has compartido el Sheet con el robot, o lo compartiste como Lector.
Repite el paso 7 con permiso de **Editor**.

**`404` / "no existe ningún documento"**
El `GOOGLE_SHEET_ID` está mal. Es solo el trozo entre `/d/` y `/edit`, sin
barras.

**"El documento no tiene ninguna pestaña llamada X"**
`npm run check` te lista las pestañas que sí existen. Copia el nombre exacto.

**`REQUEST_DENIED` al calcular la ruta**
Falta habilitar Geocoding API o Routes API (paso 2), o la clave de API está
restringida a otras APIs distintas (paso 6).

**Todo verde pero no aparecen pedidos**
El código de `DRIVERS` no coincide con el de la columna `Transportista`.
`npm run check` te enseña los códigos que ha encontrado en el Sheet.
