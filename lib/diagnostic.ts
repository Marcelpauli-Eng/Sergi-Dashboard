import "server-only";
import { env } from "./env";
import { today } from "./dates";
import { findLatestTabUpTo, findMonthTab } from "./sheet-tab";
import {
  TAB_FACTURAS,
  listSheetTabs,
  puedeEscribir,
  readSheet,
  type SheetDoc,
} from "./sheets";
import { TAB_IMPORTS } from "./importes";

/**
 * Qué le pasa a la configuración, contado desde el servidor que corre.
 *
 * Es el equivalente de `npm run check` pero desde dentro de la app, porque
 * `npm run check` solo mira el ordenador de quien lo ejecuta y esto se usa
 * desplegado. Cada comprobación dice qué arreglar, no solo que algo falla:
 * quien lo lee está mirando un móvil, no los logs de Vercel.
 *
 * Regla de oro: de aquí no sale un secreto. Ni claves, ni PINs, ni los IDs
 * enteros — solo su cola, que es lo que se compara con la URL del documento
 * que tienes abierto.
 */

export type EstadoComprobacion = "ok" | "aviso" | "error";

export interface Comprobacion {
  id: string;
  titulo: string;
  estado: EstadoComprobacion;
  detalle: string;
  /** Qué hacer. Solo cuando hay algo que hacer. */
  arreglo?: string;
}

/** Los últimos caracteres de un ID, para poder compararlo sin exponerlo. */
function cola(id: string): string {
  return id.length <= 6 ? id : `…${id.slice(-6)}`;
}

/** Traduce el fallo de Google a algo accionable. */
function porQueNoSeAbre(error: unknown, id: string): { detalle: string; arreglo: string } {
  const mensaje = error instanceof Error ? error.message : String(error);
  const codigo = mensaje.match(/respondió (\d{3})/)?.[1];

  if (codigo === "404") {
    return {
      detalle: `No existe ningún documento con ese ID (acaba en "${cola(id)}").`,
      arreglo:
        "El ID es el trozo de la URL entre /d/ y /edit. Comprueba que la cola " +
        "coincide con la del documento que tienes abierto.",
    };
  }
  if (codigo === "403") {
    return {
      detalle: `El documento existe pero la cuenta de servicio no puede entrar (acaba en "${cola(id)}").`,
      arreglo:
        `Ábrelo → Compartir → y ponle permiso de Editor a ${env.google.serviceAccountEmail}. ` +
        "Si ya aparece ahí, comprueba que es ESE documento: la cola del ID tiene que coincidir.",
    };
  }
  return {
    detalle: mensaje.slice(0, 300),
    arreglo: "",
  };
}

async function comprobarDocumento(
  id: string,
  doc: SheetDoc,
  etiqueta: string,
  pestañasEsperadas: string[],
): Promise<Comprobacion[]> {
  const salida: Comprobacion[] = [];
  let tabs: string[];

  try {
    tabs = await listSheetTabs(id);
  } catch (error) {
    const { detalle, arreglo } = porQueNoSeAbre(error, id);
    return [{ id: `${doc}-acceso`, titulo: `${etiqueta}: acceso`, estado: "error", detalle, arreglo }];
  }

  salida.push({
    id: `${doc}-acceso`,
    titulo: `${etiqueta}: acceso`,
    estado: "ok",
    detalle: `${tabs.length} pestañas. El ID acaba en "${cola(id)}".`,
  });

  // Leer no basta: la app crea pestañas y escribe filas. Compartido como
  // Lector todo parece bien hasta la primera entrega.
  const escritura = await puedeEscribir(id);
  salida.push(
    escritura.ok
      ? {
          id: `${doc}-escritura`,
          titulo: `${etiqueta}: permiso de escritura`,
          estado: "ok",
          detalle: "La cuenta de servicio puede escribir.",
        }
      : {
          id: `${doc}-escritura`,
          titulo: `${etiqueta}: permiso de escritura`,
          estado: "error",
          detalle: escritura.detalle,
          arreglo:
            `Está compartido como Lector. Ábrelo → Compartir → y cámbialo a ` +
            `Editor para ${env.google.serviceAccountEmail}.`,
        },
  );

  for (const pestaña of pestañasEsperadas) {
    salida.push({
      id: `${doc}-tab-${pestaña}`,
      titulo: `${etiqueta}: pestaña "${pestaña}"`,
      estado: tabs.includes(pestaña) ? "ok" : "aviso",
      detalle: tabs.includes(pestaña)
        ? "Creada."
        : "Todavía no existe; se crea sola la primera vez que haga falta.",
    });
  }

  return salida;
}

export async function comprobarConfiguracion(timezone: string): Promise<Comprobacion[]> {
  const salida: Comprobacion[] = [
    {
      id: "cuenta",
      titulo: "Cuenta de servicio",
      estado: "ok",
      detalle: env.google.serviceAccountEmail,
    },
  ];

  // ── La hoja de repartos ────────────────────────────────────────────────
  const repartos = env.google.sheetId;
  salida.push(...(await comprobarDocumento(repartos, "repartos", "Hoja de repartos", [])));

  // ¿Y hay pestaña para el mes de hoy?
  if (salida.every((c) => c.id !== "repartos-acceso" || c.estado === "ok")) {
    try {
      const tabs = await listSheetTabs(repartos);
      const mes = today(timezone).slice(0, 7);
      const delMes = findMonthTab(tabs, mes);
      const anterior = findLatestTabUpTo(tabs, mes);
      salida.push(
        delMes
          ? {
              id: "mes",
              titulo: "Pestaña del mes",
              estado: "ok",
              detalle: `Se está leyendo "${delMes}".`,
            }
          : {
              id: "mes",
              titulo: "Pestaña del mes",
              estado: "aviso",
              detalle: anterior
                ? `No existe la pestaña de ${mes}: se está leyendo "${anterior}", la más reciente.`
                : `No existe la pestaña de ${mes} ni ninguna anterior.`,
              arreglo:
                "Los pedidos de este mes no aparecerán hasta que la oficina cree " +
                "la pestaña. En cuanto exista, la app la coge sola.",
            },
      );
    } catch {
      // El acceso ya se ha reportado arriba.
    }

    /*
      Qué filas no se están leyendo.

      Hasta ahora esto solo salía en un `console.warn` del servidor, que
      nadie va a leer desde un móvil en mitad del reparto. Y no siempre es
      inofensivo: una comanda escrita a mano con el mismo nombre que otra
      —"RODES" en la hoja real— es una entrega entera que no aparece en
      ninguna pantalla.
    */
    try {
      const hoja = await readSheet();
      const bultos = hoja.orders.filter((o) => o.bultos > 1);
      const deMas = bultos.reduce((n, o) => n + o.bultos - 1, 0);
      const resumenBultos =
        bultos.length > 0
          ? ` ${bultos.length} comandas llevan más de un bulto (${deMas} filas juntadas).`
          : "";

      /*
        Las comandas partidas en varias entregas, con la fila de cada parte.

        Es la pregunta que no se puede contestar mirando la pantalla: "en la
        hoja hay dos 748 y a mí solo me sale uno". Aquí se ve si la app leyó
        las dos partes o si juntó la segunda como un bulto de la primera,
        que es lo que pasa cuando la fila no trae ni dirección ni la marca
        `_part`. Ver `construirComandes` en lib/sheet-rows.ts.
      */
      const partides = new Map<string, number[]>();
      for (const order of hoja.orders) {
        if (order.parts <= 1) continue;
        const files = partides.get(order.codi) ?? [];
        files.push(order.rowNumber);
        partides.set(order.codi, files);
      }
      const resumenPartides =
        partides.size > 0
          ? ` ${partides.size} ${partides.size === 1 ? "comanda va partida" : "comandas van partidas"} en varias entregas: ` +
            [...partides]
              .slice(0, 6)
              .map(([codi, files]) => `${codi} (${files.length} partes, filas ${files.join(" y ")})`)
              .join("; ") +
            (partides.size > 6 ? "…" : ".")
          : "";

      salida.push(
        hoja.skipped.length === 0
          ? {
              id: "filas",
              titulo: `Filas de "${hoja.sheetTab}"`,
              estado: "ok",
              detalle: `Se leen las ${hoja.orders.length} comandas.${resumenBultos}${resumenPartides}`,
            }
          : {
              id: "filas",
              titulo: `Filas de "${hoja.sheetTab}"`,
              estado: "aviso",
              detalle:
                `${hoja.orders.length} comandas leídas.${resumenBultos}${resumenPartides} ` +
                `${hoja.skipped.length} filas no se pueden leer: ` +
                hoja.skipped
                  .slice(0, 12)
                  .map((f) => `fila ${f.rowNumber} (${f.reason})`)
                  .join("; ") +
                (hoja.skipped.length > 12 ? "…" : "."),
              arreglo:
                "Son filas de la hoja de la oficina, no de la app. Cada una dice " +
                "qué le falta: normalmente un nº de comanda vacío. Un número " +
                "repetido ya NO se descarta: es una comanda partida en varias " +
                "entregas y sale como tal.",
            },
      );
    } catch {
      // Igual: si la hoja no se puede leer, ya se ha dicho arriba.
    }
  }

  // ── El documento privado ───────────────────────────────────────────────
  const privado = env.google.facturasSheetId;
  if (!privado) {
    salida.push({
      id: "privado",
      titulo: "Documento privado (facturas e importes)",
      estado: "error",
      detalle: "GOOGLE_SHEET_ID_FACTURAS no está definida en este servidor.",
      arreglo:
        "Los importes y las facturas no tienen dónde guardarse. Añádela a las " +
        "variables de entorno del despliegue —marcándola para Production— y vuelve " +
        "a desplegar: cambiar una variable no reconstruye nada por su cuenta.",
    });
    return salida;
  }

  if (privado === repartos) {
    salida.push({
      id: "privado",
      titulo: "Documento privado (facturas e importes)",
      estado: "error",
      detalle: "Apunta al MISMO documento que ve la empresa.",
      arreglo:
        "Lo que cobras acabaría en la hoja de pedidos, que es justo lo que esta " +
        "separación evita. Crea un documento aparte y pon su ID.",
    });
    return salida;
  }

  salida.push(
    ...(await comprobarDocumento(privado, "privado", "Documento privado", [
      TAB_FACTURAS,
      TAB_IMPORTS,
    ])),
  );

  return salida;
}
