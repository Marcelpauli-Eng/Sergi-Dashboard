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

Las columnas `_lat`, `_lng`, `_placeId` y `_geo` las crea el script solo, al
final de la hoja, la primera vez que guardas una dirección desde el panel.
No hace falta prepararlas.

## Lo que ya se ha comprobado contra "Copia de Transports Winkaplast"

Sin escribir en ella: se exportó y se le pasó por encima la misma lógica que
corre dentro del script (14/09/2026, 1.259 filas).

- Las columnas se reconocen: `Adreça` (C), `Població` (D), `_lat` (M),
  `_lng` (N). **`_placeId` y `_geo` no existen** en esa hoja — por eso el
  script las crea ahora; antes se guardaba la dirección buena y se tiraba el
  punto exacto sin decir nada.
- De las 1.103 filas con dirección escrita, **220 no llevan número de
  portal**. Son exactamente las que acaban en el centro del pueblo, y las
  que más ganan con el panel.
- 13 llevan "S/N" y 93 llevan texto de más dentro de la dirección
  ("Camino particular, llamar entes", "es una finca rustica concretar
  dirección de entrega", coordenadas pegadas a mano). El geocodificador no
  entiende esa prosa; eligiendo del panel deja de importar lo que hubiera
  escrito.
- 1.037 filas no tienen `_lat`: el punto está por calcular en casi toda la
  hoja.

## ¿Y sin API?

Sí. El panel tiene dos vías y **la segunda no necesita ninguna clave**:

| | Necesita | Cuándo |
|---|---|---|
| Escribir y elegir de la lista | Places API (New) | Lo normal: es un campo y ya está. |
| **Pegar de Google Maps** | **Nada** | Siempre, y sobre todo cuando Google no encuentra el sitio. |

Pegar significa: abrir Google Maps como siempre, buscar el sitio, copiar el
enlace (o botón derecho sobre el mapa → copiar las coordenadas) y pegarlo en
el recuadro de abajo del panel. Se guarda `_lat`, `_lng` y `_geo = portal`.
**La dirección escrita no se toca**: quien pega un punto está diciendo dónde
está la casa, no cómo se llama la calle.

Lo único que el script le pide a Google en esta vía es seguir el enlace corto
(`maps.app.goo.gl`) hasta el largo, que es una visita normal a una página, no
una llamada a ninguna API.

Esto **ya se estaba haciendo a mano**: en la hoja hay filas con las
coordenadas escritas dentro de la columna de la dirección, donde no las lee
nadie. Ver `lib/coordenades.ts`, que también las sabe separar.

Si activas Places, ten en cuenta que ya tienes una clave de Google con
facturación —la app geocodifica y calcula rutas con ella—: activar Places es
marcar una API más en el mismo proyecto, no montar nada nuevo.

## Cómo probarlo

1. **Haz una copia de la hoja**: Archivo → Hacer una copia. Trabaja en la
   copia.
2. En la copia: Extensiones → Apps Script.
3. Pega `Codi.gs` en el archivo `Código.gs` que sale por defecto.
4. Archivo nuevo → HTML, llámalo `Barra` (sin `.html`), y pega `Barra.html`.
5. Archivo nuevo → Script, llámalo `Coordenades`, y pega `Coordenades.gs`.
   Esto es lo que lee lo que se pega de Maps: **sin esto, la vía sin API no
   funciona**.
6. *(Solo para la búsqueda con lista.)* Configuración del proyecto →
   Propiedades del script → añade `PLACES_API_KEY` con una clave de Google
   Cloud que tenga activada la **Places API (New)**.
   - Que sea **otra clave** que la de la app, restringida a Places: así, si
     un día hay que revocarla, no se cae la app.
   - Sin esta clave el panel sigue sirviendo: la lista avisa de que no está
     activada y se usa la vía de pegar.
7. Activadores (el reloj de la izquierda) → Añadir activador:
   - Función: `alEditar`
   - Evento: *En editar* (de hoja de cálculo)
   - Esto es lo que marca en ámbar las direcciones escritas a mano.
8. Recarga la hoja. Sale el menú **Adreces**.

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

- La vía de pegar, con un enlace corto (`maps.app.goo.gl`) y con unas
  coordenadas copiadas del mapa.

Cuando esto esté probado, pegarlo en la hoja de verdad es repetir los pasos
3 a 8 allí.
