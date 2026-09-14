# Cercador d'adreces dins del Google Sheet

Esto es para la **copia de pruebas** de la hoja. No lo pegues en la hoja de
la oficina hasta que lo hayas probado allí.

## Por qué existe

La oficina escribe la dirección a mano. Una dirección escrita es texto, y el
texto hay que adivinarlo después: cuando Google no encuentra el número
contesta el centro del pueblo, y allí acaba el transportista. Eligiendo la
dirección de la lista de Google se guarda el portal con su identificador, y
ya no queda nada por adivinar el día del reparto.

En la app pasa lo mismo desde "Nova comanda" y "Editar comanda" (ver
`components/camp-adreca.tsx`). Esto es lo mismo para quien trabaja dentro de
la hoja.

## Qué escribe, exactamente

Solo en la fila donde está el cursor, y solo estas columnas:

| Columna | Qué pone |
|---|---|
| `Adreça` | Calle y número tal como los da Google. Un negocio, con su nombre delante. |
| `Població` | Código postal y pueblo: "08500 Vic". |
| `_lat`, `_lng` | El punto. |
| `_placeId` | El identificador del portal en Google. |
| `_geo` | `portal` — lo eligió una persona, la app ya no lo vuelve a buscar. |

Nada más. No borra filas, no ordena, no toca ninguna otra columna.

Las columnas `_lat`, `_lng`, `_placeId` y `_geo` las crea la app sola la
primera vez que calcula una ruta. Si en la copia de pruebas no están, o las
añades a mano al final, o abres la app una vez contra esa copia.

## Cómo probarlo

1. **Haz una copia de la hoja**: Archivo → Hacer una copia. Trabaja en la
   copia.
2. En la copia: Extensiones → Apps Script.
3. Pega `Codi.gs` en el archivo `Código.gs` que sale por defecto.
4. Archivo nuevo → HTML, llámalo `Barra` (sin `.html`), y pega `Barra.html`.
5. Configuración del proyecto → Propiedades del script → añade
   `PLACES_API_KEY` con una clave de Google Cloud que tenga activada la
   **Places API (New)**.
   - Que sea **otra clave** que la de la app, restringida a Places: así, si
     un día hay que revocarla, no se cae la app.
6. Activadores (el reloj de la izquierda) → Añadir activador:
   - Función: `alEditar`
   - Evento: *En editar* (de hoja de cálculo)
   - Esto es lo que marca en ámbar las direcciones escritas a mano.
7. Recarga la hoja. Sale el menú **Adreces**.

La primera vez pedirá permisos: son para leer y escribir en esa hoja y para
llamar a Google Maps.

## Cómo se usa

1. Pon el cursor en la fila de la comanda.
2. Menú **Adreces → Cercar adreça…**
3. Escribe y **elige de la lista**. La fila queda con la dirección buena y el
   punto exacto.

Si se escribe la dirección a mano, la celda se marca en ámbar con una nota:
es un aviso de que eso todavía no es un punto. Al elegirla del panel, la
marca desaparece.

## Qué revisar en las pruebas

- Que la columna de dirección de tu hoja se reconoce (la busca por cabecera:
  "Adreça", "Direccion"…). Si no, sale un aviso al guardar.
- Una dirección de un particular con número.
- Una nave o un polígono sin número: tiene que quedar con el nombre delante.
- Una fila con varios bultos: el cursor tiene que estar en la primera, que es
  la que lleva la dirección.
- Escribir a mano y ver que se marca en ámbar y que se vacía el punto viejo.

Cuando esto esté probado, pegarlo en la hoja de verdad es repetir los pasos
3 a 7 allí.
