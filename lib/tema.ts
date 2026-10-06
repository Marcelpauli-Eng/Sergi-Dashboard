/**
 * El tema de la temporada.
 *
 * Del 1 de octubre al 1 de noviembre la app se viste de Halloween; el resto
 * del año es la de siempre. No hay que acordarse de quitarlo: el 2 de
 * noviembre vuelve sola, y el octubre que viene se lo vuelve a poner sola.
 *
 * El diseño de siempre no se ha tocado. Todo lo de Halloween cuelga del
 * atributo `data-tema="halloween"` de `<html>` —los estilos en
 * `app/globals.css`, las piezas en `components/halloween.tsx`—, así que sin
 * él la app es exactamente la de antes.
 *
 * `TEMA=classic` o `TEMA=halloween` en el entorno lo fuerza: para quitarlo
 * antes de tiempo, o para ver uno u otro fuera de fecha.
 */
export type Tema = "classic" | "halloween";

/** `avui` en `YYYY-MM-DD`, el de `today()`; `forcat`, el `TEMA` del entorno. */
export function temaDelDia(avui: string, forcat?: string): Tema {
  if (forcat === "classic" || forcat === "halloween") return forcat;

  // "YYYY-MM-DD" → "MM-DD": con el mismo formato, comparar texto basta.
  const dia = avui.slice(5);
  return dia >= "10-01" && dia <= "11-01" ? "halloween" : "classic";
}
