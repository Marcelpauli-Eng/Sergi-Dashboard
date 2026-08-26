import {
  DATOS_POR_DEFECTO,
  type ClienteFacturacion,
  type DatosFacturacion,
} from "./factura";

/**
 * Los datos de emisor y cliente que salen en la factura.
 *
 * Se guardan en el propio móvil y no en el Sheet: son cuatro campos que casi
 * nunca cambian, y así la factura se puede componer sin cobertura. Lo que sí
 * necesita conexión es emitirla, porque el número correlativo lo reparte el
 * servidor.
 *
 * Si se pierde el móvil se vuelven a los valores de partida, que ya son los
 * correctos: se perdería como mucho un cambio de domicilio.
 */

const CLAVE = "reparto:datos-facturacio";

export function leerDatosFacturacion(): DatosFacturacion {
  if (typeof window === "undefined") return DATOS_POR_DEFECTO;

  try {
    const guardado = window.localStorage.getItem(CLAVE);
    if (!guardado) return DATOS_POR_DEFECTO;

    const datos = JSON.parse(guardado) as Partial<DatosFacturacion> & {
      /** Como se guardaba cuando solo podía haber un cliente. */
      cliente?: Partial<ClienteFacturacion>;
    };

    // Lo guardado antes de que hubiera varios clientes trae `cliente` en vez
    // de `clientes`. Se convierte al vuelo en una lista de uno: nadie tiene
    // que volver a teclear los datos de su cliente por una versión nueva.
    const clientes =
      datos.clientes && datos.clientes.length > 0
        ? datos.clientes.map((c) => ({ ...DATOS_POR_DEFECTO.clientes[0], ...c }))
        : [{ ...DATOS_POR_DEFECTO.clientes[0], ...datos.cliente }];

    // Se fusiona por bloques con los valores de partida: si más adelante se
    // añade un campo nuevo, lo ya guardado sin él sigue sirviendo en vez de
    // dejar la factura con un hueco.
    return {
      ...DATOS_POR_DEFECTO,
      ...datos,
      emisor: { ...DATOS_POR_DEFECTO.emisor, ...datos.emisor },
      clientes,
    };
  } catch {
    // JSON corrupto: mejor los valores de partida que una pantalla rota.
    return DATOS_POR_DEFECTO;
  }
}

export function guardarDatosFacturacion(datos: DatosFacturacion): void {
  window.localStorage.setItem(CLAVE, JSON.stringify(datos));
}
