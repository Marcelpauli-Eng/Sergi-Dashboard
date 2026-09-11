import {
  DATOS_POR_DEFECTO,
  type ClienteFacturacion,
  type DatosFacturacion,
} from "./factura.ts";

/**
 * Los datos de emisor y cliente que salen en la factura.
 *
 * En el móvil, para poder componer la factura sin cobertura. Lo que sí
 * necesita conexión es emitirla, porque el número correlativo lo reparte el
 * servidor.
 *
 * Los CLIENTES, además, viven en la pestaña "Clients" del documento privado
 * (ver `lib/clients.ts`): son un dato de la empresa y no del teléfono, así
 * que cambiar de móvil no puede perder el NIF de a quién se factura ni dejar
 * dos dispositivos facturando a direcciones distintas. Lo de aquí es la
 * copia con la que se trabaja sin red; manda el documento, y por eso al
 * arrancar se baja y se pisa esta.
 *
 * El emisor sigue siendo solo de aquí: es siempre el mismo y no cambia de un
 * móvil a otro.
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

/**
 * Baja el emisor y los clientes del documento privado y los deja guardados.
 *
 * Devuelve los datos ya con ellos, o los de siempre si no se han podido leer
 * —sin cobertura, o con el documento todavía sin configurar—: quedarse sin
 * red no puede dejar la pantalla de facturar en blanco.
 *
 * Lo que llega vacío se ignora a propósito, campo por campo. Una pestaña que
 * aún no existe o está sin rellenar devuelve nada, y pisar con eso unos
 * datos correctos que ya tiene el móvil sería cambiarlos por ninguno.
 */
export async function sincronizarFacturacio(
  datos: DatosFacturacion,
): Promise<DatosFacturacion> {
  try {
    const respuesta = await fetch("/api/facturacio");
    if (!respuesta.ok) return datos;
    const cuerpo = (await respuesta.json()) as {
      emissor?: DatosFacturacion["emisor"] | null;
      clients?: ClienteFacturacion[];
    };

    const clientes = cuerpo.clients ?? [];
    const actualizados: DatosFacturacion = {
      ...datos,
      ...(cuerpo.emissor ? { emisor: cuerpo.emissor } : {}),
      ...(clientes.length > 0 ? { clientes } : {}),
    };

    guardarDatosFacturacion(actualizados);
    return actualizados;
  } catch {
    return datos;
  }
}

/**
 * Guarda el emisor y los clientes en el documento privado.
 *
 * Lanza si no se han podido guardar: quien llama ya ha dejado la copia local
 * hecha, pero tiene que poder decir que en el documento no están.
 */
export async function guardarFacturacioAlDocument(
  datos: DatosFacturacion,
): Promise<void> {
  const respuesta = await fetch("/api/facturacio", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ emissor: datos.emisor, clients: datos.clientes }),
  });
  if (!respuesta.ok) {
    const cuerpo = (await respuesta.json().catch(() => null)) as { error?: string } | null;
    throw new Error(cuerpo?.error ?? `El servidor respongué ${respuesta.status}`);
  }
}
